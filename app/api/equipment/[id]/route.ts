// app/api/equipment/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { equipmentIdSchema, equipmentDetailSchema } from '@/lib/validators';
import { z } from 'zod';
import { clearSession, getSession } from '@/lib/auth';
import { getLiveUserState } from '@/lib/user-state';
import { resolveUserLimit, countUsedToday, dayCond } from '@/lib/quota';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    // 1) Сессия и актуальный статус пользователя
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // в сессии может быть устаревший activated — проверяем live
    const live = await getLiveUserState(session.id);
    if (!live || !live.activated) {
      clearSession();
      return NextResponse.json({ error: 'Доступ заблокирован' }, { status: 403 });
    }
    const isWorker = !!live.irbis_worker;

    // 2) Валидируем id
    const { id } = equipmentIdSchema.parse({ id: params.id });

    // 3) Получаем карточку оборудования (до проверки квоты — чтобы одинаково отвечать 404)
    const sql = `
      SELECT
        e.id::int                                  AS id,
        e.equipment_name,
        e.workshop_id::int                         AS workshop_id,

        e.equipment_score::float8                  AS equipment_score,
        e.equipment_score_real::float8             AS equipment_score_real,
        e.clean_score::float8                      AS clean_score,

        e.clean_url_1, e.clean_url_2, e.clean_url_3,
        e.description, e.description_url, e.images_url, e.images_promt,
        e.contamination, e.surface, e.problems,
        e.old_method, e.old_problem, e.benefit,
        e.synonyms_ru, e.synonyms_en,

        e.blaster, e.air,
        e.rate::float8                             AS rate,
        e.company_id::int                          AS company_id,

        s.utp_post, s.utp_mail,

        dc.decision_pr, dc.decision_prs, dc.decision_sov, dc.decision_operator, dc.decision_proc,

        ge.goods_examples,

        co.company_name, co.site_description

      FROM ib_equipment e
      LEFT JOIN ib_workshops w0 ON w0.id = e.workshop_id

      LEFT JOIN LATERAL (
        SELECT s.utp_post, s.utp_mail
        FROM ib_successful_story s
        WHERE s.company_id = e.company_id
        ORDER BY s.id DESC
        LIMIT 1
      ) s ON TRUE

      LEFT JOIN LATERAL (
        SELECT
          d.lpr        AS decision_pr,
          d.prs        AS decision_prs,
          d.sov        AS decision_sov,
          d."operator" AS decision_operator,
          d.proc       AS decision_proc
        FROM ib_decision_center d
        WHERE d.workshop_id = e.workshop_id
          AND d.company_id  = e.company_id
        ORDER BY d.id DESC
        LIMIT 1
      ) dc ON TRUE

      LEFT JOIN LATERAL (
        SELECT ARRAY(
          SELECT DISTINCT g.goods_name::text
          FROM ib_equipment e2
          JOIN ib_workshops w2        ON w2.id = e2.workshop_id
          JOIN ib_equipment_goods eg  ON eg.equipment_id = e2.id
          JOIN ib_goods g             ON g.id = eg.goods_id
          WHERE (w0.prodclass_id IS NOT NULL AND w2.prodclass_id = w0.prodclass_id)
          ORDER BY g.goods_name
        )::text[] AS goods_examples
      ) ge ON TRUE

      LEFT JOIN LATERAL (
        SELECT c.company_name, c.site_description
        FROM ib_clients c
        WHERE c.id = e.company_id
        LIMIT 1
      ) co ON TRUE

      WHERE e.id = $1
      LIMIT 1
    `;
    const result = await db.query(sql, [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Equipment not found' }, { status: 404 });
    }
    const equipment = equipmentDetailSchema.parse(result.rows[0]);

    // 4) Единый резолвер квоты
    const limitResolved = await resolveUserLimit(session.id, isWorker);

    // 5) Безлимит: просто логируем 1 раз в сутки и отдаём
    if (limitResolved.unlimited) {
      try {
        await db.query(
          `
            INSERT INTO users_activity (user_id, equipment_id, open_at)
            SELECT $1, $2, now()
            WHERE NOT EXISTS (
              SELECT 1 FROM users_activity
              WHERE user_id = $1
                AND equipment_id = $2
                AND ${dayCond('open_at')}
            )
          `,
          [session.id, id],
        );
      } catch (e) {
        // Телеметрия не должна ломать ответ
        console.warn('users_activity log (unlimited) failed:', e);
      }
      const res = NextResponse.json(equipment);
      res.headers.set('X-Views-Limit', 'unlimited');
      res.headers.set('X-Views-Remaining', 'unlimited');
      return res;
    }

    // 6) Ограниченный режим: проверяем, вставляем просмотр под защитой
    const limit = limitResolved.limit;

    // Ранний отказ без блокировки транзакции
    let usedBefore = await countUsedToday(session.id);
    if (usedBefore >= limit) {
      const blocked = NextResponse.json(
        { error: `Дневной лимит просмотров исчерпан (${limit} уникальных карточек/сутки).` },
        { status: 403 },
      );
      blocked.headers.set('X-Views-Limit', String(limit));
      blocked.headers.set('X-Views-Remaining', '0');
      return blocked;
    }

    // Пишем просмотр (уникально за сутки). Дополнительно защищено БД-уникальностью.
    try {
      await db.query('BEGIN');

      const seen = await db.query<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM users_activity
            WHERE user_id = $1 AND equipment_id = $2 AND ${dayCond('open_at')}
          ) AS exists
        `,
        [session.id, id],
      );

      if (!seen.rows[0]?.exists) {
        await db.query(
          `
            INSERT INTO users_activity (user_id, equipment_id, open_at)
            VALUES ($1, $2, now())
            ON CONFLICT DO NOTHING
          `,
          [session.id, id],
        );
        usedBefore += 1; // локально учтём вставку
      }

      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      // при гонке / конфликте просто продолжим — дальше возьмём фактический used
    }

    // финальный подсчёт и заголовки
    const usedAfter = await countUsedToday(session.id);
    const remaining = Math.max(0, limit - usedAfter);

    const res = NextResponse.json(equipment);
    res.headers.set('X-Views-Limit', String(limit));
    res.headers.set('X-Views-Remaining', String(remaining));
    return res;
  } catch (error) {
    console.error('Equipment detail API error:', error);
    try {
      await db.query('ROLLBACK');
    } catch {}
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: error.errors },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

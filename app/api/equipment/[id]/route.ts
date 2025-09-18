// app/api/equipment/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { equipmentIdSchema, equipmentDetailSchema } from '@/lib/validators';
import { z } from 'zod';
import { clearSession, getSession } from '@/lib/auth';
import { getLiveUserState } from '@/lib/user-state';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const DAILY_LIMIT = 10;
// Если нужно считать сутки по конкретной TZ, можно заменить CURRENT_DATE на:
// (now() at time zone 'Europe/Amsterdam')::date — и также ниже в SQL.
const DAY_COND = 'open_at::date = CURRENT_DATE';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    // 1) Проверяем сессию и права
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!session.activated) {
      return NextResponse.json({ error: 'Доступ заблокирован' }, { status: 403 });
    }

    const live = await getLiveUserState(session.id);
    if (!live || !live.activated) {
      clearSession();
      return NextResponse.json({ error: 'Доступ заблокирован' }, { status: 403 });
    }

    // 2) Валидируем id
    const { id } = equipmentIdSchema.parse({ id: params.id });

    // 3) Транзакция для последовательности действий
    await db.query('BEGIN');

    // 4) Сколько карточек уже открыто сегодня?
    const countSql = `
      SELECT COUNT(DISTINCT equipment_id)::int AS c
      FROM users_activity
      WHERE user_id = $1 AND ${DAY_COND}
    `;
    const { rows: beforeRows } = await db.query(countSql, [session.id]);
    const usedBefore: number = beforeRows[0]?.c ?? 0;

    // 5) Сброс флага на новый день: если сегодня первый заход и irbis_worker=false → поднять в true
    if (usedBefore === 0 && live.irbis_worker === false) {
      await db.query(
        `UPDATE users_irbis SET irbis_worker = TRUE WHERE id = $1 AND irbis_worker = FALSE`,
        [session.id],
      );
    }

    // 6) Если лимит уже выбран — фиксируем флаг и блокируем
    if (usedBefore >= DAILY_LIMIT) {
      if (live.irbis_worker === true) {
        await db.query(
          `UPDATE users_irbis SET irbis_worker = FALSE WHERE id = $1 AND irbis_worker = TRUE`,
          [session.id],
        );
      }
      await db.query('COMMIT');
      const blocked = NextResponse.json(
        { error: `Дневной лимит просмотров исчерпан (${DAILY_LIMIT} уникальных карточек/сутки).` },
        { status: 403 },
      );
      blocked.headers.set('X-Views-Limit', String(DAILY_LIMIT));
      blocked.headers.set('X-Views-Remaining', '0');
      return blocked;
    }

    // 7) Грузим карточку (404 не тратит лимит)
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
    `;
    const result = await db.query(sql, [id]);
    if (result.rows.length === 0) {
      await db.query('ROLLBACK');
      return NextResponse.json({ error: 'Equipment not found' }, { status: 404 });
    }

    // 8) Логируем просмотр (без изменения схемы — через NOT EXISTS)
    await db.query(
      `
      INSERT INTO users_activity (user_id, equipment_id, open_at)
      SELECT $1, $2, NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM users_activity
        WHERE user_id = $1
          AND equipment_id = $2
          AND ${DAY_COND}
      )
      `,
      [session.id, id],
    );

    // 9) Пересчёт после записи
    const { rows: afterRows } = await db.query(countSql, [session.id]);
    const usedAfter: number = afterRows[0]?.c ?? usedBefore; // на случай гонки

    // Если только что достигли лимита — опускаем флаг (но карточку отдаём)
    if (usedAfter >= DAILY_LIMIT && live.irbis_worker === true) {
      await db.query(
        `UPDATE users_irbis SET irbis_worker = FALSE WHERE id = $1 AND irbis_worker = TRUE`,
        [session.id],
      );
    }

    await db.query('COMMIT');

    const remaining = Math.max(0, DAILY_LIMIT - usedAfter);
    const equipment = equipmentDetailSchema.parse(result.rows[0]);

    const res = NextResponse.json(equipment);
    res.headers.set('X-Views-Limit', String(DAILY_LIMIT));
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

// app/api/equipment/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { equipmentIdSchema } from '@/lib/validators';
import { z } from 'zod';
import { clearSession, getSession } from '@/lib/auth';
import { getLiveUserState } from '@/lib/user-state';
import { resolveUserLimit, countUsedToday, dayCond } from '@/lib/quota';
import { getEquipmentDetail } from '@/lib/equipment';

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
    const equipment = await getEquipmentDetail(id);
    if (!equipment) {
      return NextResponse.json({ error: 'Equipment not found' }, { status: 404 });
    }

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

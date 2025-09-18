// app/api/user/quota/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, clearSession } from '@/lib/auth';
import { getLiveUserState } from '@/lib/user-state';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const DAILY_LIMIT = 10;
const DAY_COND = 'open_at::date = CURRENT_DATE';

export async function GET(_req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const live = await getLiveUserState(session.id);
    if (!live || !live.activated) {
      clearSession();
      return NextResponse.json({ error: 'Доступ заблокирован' }, { status: 403 });
    }

    await db.query('BEGIN');

    const countSql = `
      SELECT COUNT(DISTINCT equipment_id)::int AS c
      FROM users_activity
      WHERE user_id = $1 AND ${DAY_COND}
    `;
    const { rows } = await db.query(countSql, [session.id]);
    const used: number = rows[0]?.c ?? 0;

    // Сброс на новый день
    if (used === 0 && live.irbis_worker === false) {
      await db.query(
        `UPDATE users_irbis SET irbis_worker = TRUE WHERE id = $1 AND irbis_worker = FALSE`,
        [session.id],
      );
    }

    await db.query('COMMIT');

    const remaining = Math.max(0, DAILY_LIMIT - used);
    return NextResponse.json({ limit: DAILY_LIMIT, used, remaining });
  } catch (e) {
    try {
      await db.query('ROLLBACK');
    } catch {}
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

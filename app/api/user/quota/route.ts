// app/api/user/quota/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, clearSession } from '@/lib/auth';
import { getLiveUserState } from '@/lib/user-state';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const DEFAULT_DAILY_LIMIT = 10; // дефолт для тех, у кого нет персонального лимита и кто не сотрудник
const DAY_COND = 'open_at::date = CURRENT_DATE';

type Quota = {
  unlimited: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
};

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

    // used = COUNT DISTINCT за сегодня
    const { rows: usedRows } = await db.query<{ c: number }>(
      `
      SELECT COUNT(DISTINCT equipment_id)::int AS c
      FROM users_activity
      WHERE user_id = $1 AND ${DAY_COND}
    `,
      [session.id],
    );
    const used = usedRows?.[0]?.c ?? 0;

    const isWorker = !!live.irbis_worker;

    // тянем персональный лимит для любого пользователя
    const { rows: limRows } = await db.query<{ lim: number | null }>(
      `SELECT limits::int AS lim FROM users_irbis WHERE id = $1 LIMIT 1`,
      [session.id],
    );
    const personalLimit = limRows?.[0]?.lim ?? null;

    // логика:
    // 1) если limits > 0 — используем его для любого пользователя
    if ((personalLimit ?? 0) > 0) {
      const limit = personalLimit!;
      return NextResponse.json({
        unlimited: false,
        limit,
        used,
        remaining: Math.max(0, limit - used),
      } satisfies Quota);
    }

    // 2) если сотрудник и limits <= 0/NULL — безлимит
    if (isWorker) {
      return NextResponse.json({
        unlimited: true,
        limit: null,
        used,
        remaining: null,
      } as Quota);
    }

    // 3) иначе — дефолт
    return NextResponse.json({
      unlimited: false,
      limit: DEFAULT_DAILY_LIMIT,
      used,
      remaining: Math.max(0, DEFAULT_DAILY_LIMIT - used),
    } as Quota);
  } catch (e) {
    console.error('Quota error', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// app/api/user/quota/route.ts
import { NextResponse } from 'next/server';
import { getSession, clearSession } from '@/lib/auth';
import { getLiveUserState } from '@/lib/user-state';
import { resolveUserLimit, countUsedToday } from '@/lib/quota';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type Quota =
  | {
      authenticated: true;
      unlimited: boolean;
      limit: number | null;
      used: number;
      remaining: number | null;
    }
  | {
      authenticated: false;
    };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ authenticated: false } satisfies Quota, { status: 401 });
    }

    const live = await getLiveUserState(session.id);
    if (!live || !live.activated) {
      clearSession();
      return NextResponse.json({ authenticated: false } satisfies Quota, { status: 401 });
    }

    // 1) Сколько уже потрачено сегодня (по Europe/Amsterdam — внутри countUsedToday)
    const used = await countUsedToday(session.id);

    // 2) Резолвим лимит (персональный > 0 имеет приоритет; иначе сотрудник = безлимит; иначе дефолт)
    const resolved = await resolveUserLimit(session.id, !!live.irbis_worker);

    // 3) Формируем ответ + заголовки
    if (resolved.unlimited) {
      const res = NextResponse.json({
        authenticated: true,
        unlimited: true,
        limit: null,
        used,
        remaining: null,
      } satisfies Quota);
      res.headers.set('X-Views-Limit', 'unlimited');
      res.headers.set('X-Views-Remaining', 'unlimited');
      return res;
    }

    const limit = resolved.limit;
    const remaining = Math.max(0, limit - used);

    const res = NextResponse.json({
      authenticated: true,
      unlimited: false,
      limit,
      used,
      remaining,
    } satisfies Quota);
    res.headers.set('X-Views-Limit', String(limit));
    res.headers.set('X-Views-Remaining', String(remaining));
    return res;
  } catch (e) {
    console.error('Quota API error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

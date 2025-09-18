// app/api/auth/me/route.ts
import { NextResponse } from 'next/server';
import { getSession, clearSession } from '@/lib/auth';
import { getLiveUserState } from '@/lib/user-state';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ authenticated: false }, { status: 401 });

  // Живая проверка в БД
  const live = await getLiveUserState(sess.id);
  if (!live || !live.activated) {
    clearSession();
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // ── Получаем login гарантированно из БД, чтобы не зависеть от формы sess ──
  let login: string | null = null;
  try {
    const { rows } = await db.query<{ user_login: string }>(
      `SELECT user_login FROM users_irbis WHERE id = $1 LIMIT 1`,
      [sess.id],
    );
    login = rows[0]?.user_login ?? null;
  } catch {
    // fail-soft
  }

  const normLogin = (login ?? '').trim();
  const fallbackLogin = typeof (sess as any).login === 'string' ? (sess as any).login : '';
  const finalLogin = normLogin || fallbackLogin;

  const is_admin = finalLogin.toLowerCase() === 'admin';

  return NextResponse.json({
    authenticated: true,
    user: {
      id: sess.id,
      login: finalLogin,
      is_admin,
      activated: live.activated,
      irbis_worker: live.irbis_worker,
    },
  });
}

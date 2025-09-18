import { NextResponse } from 'next/server';
import { getSession, clearSession } from '@/lib/auth';
import { getLiveUserState } from '@/lib/user-state';

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

  return NextResponse.json({
    authenticated: true,
    user: { ...sess, activated: live.activated, irbis_worker: live.irbis_worker },
  });
}

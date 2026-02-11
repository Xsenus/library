import { NextResponse } from 'next/server';
import { clearSession, getSession, type SessionUser } from '@/lib/auth';
import { getLiveUserState, type LiveUserState } from '@/lib/user-state';

export type ApiAuthSuccess = {
  ok: true;
  session: SessionUser;
  live: LiveUserState;
};

export type ApiAuthFailure = {
  ok: false;
  response: NextResponse;
};

export type RequireApiAuthOptions = {
  requireActive?: boolean;
  requireWorker?: boolean;
};

export async function requireApiAuth(
  options: RequireApiAuthOptions = {},
): Promise<ApiAuthSuccess | ApiAuthFailure> {
  const { requireActive = true, requireWorker = false } = options;

  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const live = await getLiveUserState(session.id);
  if (!live) {
    clearSession();
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (requireActive && !live.activated) {
    clearSession();
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (requireWorker && !live.irbis_worker) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { ok: true, session, live };
}

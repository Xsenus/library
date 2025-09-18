import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

const COOKIE_NAME = 'cin_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 дней
const ISS = 'cin-auth';

function getSecretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export type SessionUser = {
  id: number;
  login: string;
  activated: boolean;
  irbis_worker: boolean;
};

export async function createSession(user: SessionUser, remember: boolean) {
  const token = await new SignJWT({ sub: String(user.id), user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISS)
    .setIssuedAt()
    .setExpirationTime(`${remember ? COOKIE_MAX_AGE : 60 * 60 * 24 /* 24h safety */}s`)
    .sign(getSecretKey());

  const base = {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production' && process.env.USE_HTTPS === 'true',
    path: '/',
  };

  // remember=true → persistent cookie на 7 дней; иначе — session cookie (без maxAge/expires)
  if (remember) {
    cookies().set({ ...base, maxAge: COOKIE_MAX_AGE });
  } else {
    cookies().set(base);
  }
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const token = cookies().get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, getSecretKey(), { issuer: ISS });
    const user = (payload as any).user as SessionUser | undefined;
    if (!user) return null;
    return user;
  } catch {
    return null;
  }
}

export function clearSession() {
  cookies().set({
    name: COOKIE_NAME,
    value: '',
    path: '/',
    httpOnly: true,
    maxAge: 0,
  });
}

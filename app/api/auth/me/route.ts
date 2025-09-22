// app/api/auth/me/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

import { db } from '@/lib/db';
import { getSession, clearSession, createSession } from '@/lib/auth';
import { getLiveUserState } from '@/lib/user-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ------------------------------ GET /api/auth/me ------------------------------ */

export async function GET() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ authenticated: false }, { status: 401 });

  const live = await getLiveUserState(sess.id);
  if (!live || !live.activated) {
    clearSession();
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // login + персональный лимит из БД
  let login: string | null = null;
  let limits: number | null = null;
  try {
    const { rows } = await db.query<{ user_login: string; limits: number | null }>(
      `SELECT user_login, limits FROM users_irbis WHERE id = $1 LIMIT 1`,
      [sess.id],
    );
    login = rows[0]?.user_login ?? null;
    limits = rows[0]?.limits ?? null;
  } catch {
    // fail-soft
  }

  const normLogin = (login ?? '').trim();
  const fallbackLogin = typeof (sess as any).login === 'string' ? (sess as any).login : '';
  const finalLogin = normLogin || fallbackLogin;

  const is_admin = finalLogin.toLowerCase() === 'admin';
  const isWorker = !!live.irbis_worker;
  const unlimited = isWorker && (!(limits ?? 0) || (limits as number) <= 0);

  return NextResponse.json({
    authenticated: true,
    user: {
      id: sess.id,
      login: finalLogin,
      is_admin,
      activated: live.activated,
      irbis_worker: live.irbis_worker,
      limits, // персональный лимит (null — не задан)
      unlimited, // true для сотрудников при limits<=0
    },
  });
}

/* ------------------------------ POST /api/auth/me ----------------------------- */

const loginSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional().default(false),
});

function isBcryptHash(value: string) {
  return /^\$2[aby]\$[\d]{2}\$/.test(value);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { login, password, remember } = loginSchema.parse(body);

    const sql = `
      SELECT
        id::int,
        user_login,
        user_password,
        activated,
        irbis_worker,
        COALESCE(limits, 0)::int AS limits
      FROM users_irbis
      WHERE user_login = $1
      LIMIT 1
    `;
    const { rows } = await db.query(sql, [login]);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
    }

    const u = rows[0] as {
      id: number;
      user_login: string;
      user_password: string;
      activated: boolean;
      irbis_worker: boolean;
      limits: number; // 0 => трактуем как безлимит для сотрудников
    };

    let ok = false;
    if (isBcryptHash(u.user_password)) ok = await bcrypt.compare(password, u.user_password);
    else ok = password === u.user_password;

    if (!ok) return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
    if (!u.activated) {
      return NextResponse.json(
        { error: 'Доступ заблокирован. Обратитесь к администратору.' },
        { status: 403 },
      );
    }

    // limits в сессию — опционально; /api/user/quota и так читает из БД
    await createSession(
      {
        id: u.id,
        login: u.user_login,
        activated: u.activated,
        irbis_worker: u.irbis_worker,
        limits: u.limits,
      } as any,
      remember,
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.issues) {
      return NextResponse.json({ error: 'Некорректные данные' }, { status: 400 });
    }
    console.error('Login error', e);
    return NextResponse.json({ error: 'Внутренняя ошибка' }, { status: 500 });
  }
}

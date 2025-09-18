import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { createSession } from '@/lib/auth';
import bcrypt from 'bcryptjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      SELECT id::int, user_login, user_password, activated, irbis_worker
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
    };

    let ok = false;
    if (isBcryptHash(u.user_password)) ok = await bcrypt.compare(password, u.user_password);
    else ok = password === u.user_password;

    if (!ok) return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
    if (!u.activated)
      return NextResponse.json(
        { error: 'Доступ заблокирован. Обратитесь к администратору.' },
        { status: 403 },
      );

    await createSession(
      {
        id: u.id,
        login: u.user_login,
        activated: u.activated,
        irbis_worker: u.irbis_worker,
      },
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

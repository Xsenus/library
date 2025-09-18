// app/api/equipment/[id]/es-confirm/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // --- безопасно определяем login ---
    let login: string | null = null;

    const sAny = session as Record<string, unknown>;
    if (typeof sAny?.login === 'string' && sAny.login) {
      login = String(sAny.login);
    } else {
      const idNum = Number(session.id);
      if (Number.isFinite(idNum)) {
        const q = `
          SELECT user_login
          FROM users_irbis
          WHERE id = $1
          LIMIT 1
        `;
        const { rows } = await db.query<{ user_login: string }>(q, [idNum]);
        login = rows[0]?.user_login ?? null;
      }
    }

    const isAdmin = (login ?? '').toLowerCase() === 'admin';
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // --- валидация equipment id ---
    const equipmentId = Number(params.id);
    if (!Number.isFinite(equipmentId)) {
      return NextResponse.json({ error: 'Bad equipment id' }, { status: 400 });
    }

    // --- тело запроса ---
    const body = await req.json().catch(() => ({}));
    const confirmed: boolean = !!body?.confirmed;

    const table = `public.ib_equipment`;

    // << КЛЮЧ: колонка numeric — пишем 0/1
    const sql = `
      UPDATE ${table}
         SET equipment_score_real = (CASE WHEN $1::boolean THEN 1 ELSE 0 END)::numeric
       WHERE id = $2
    RETURNING equipment_score_real
    `;

    const { rows } = await db.query<{ equipment_score_real: string | number }>(sql, [
      confirmed,
      equipmentId,
    ]);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // << Всегда возвращаем 0/1 числом
    const raw = rows[0].equipment_score_real;
    const out = Number(raw) ? 1 : 0;

    return NextResponse.json({ equipment_score_real: out });
  } catch (e) {
    console.error('es-confirm error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

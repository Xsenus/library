import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { okvedMainSchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET() {
  try {
    const sql = `
      SELECT id::int, okved_code, okved_main
      FROM ib_okved_main
      ORDER BY okved_code
    `;
    const { rows } = await db.query(sql);
    const items = rows.map((r: any) => okvedMainSchema.parse(r));
    return NextResponse.json({ items });
  } catch (e) {
    console.error('GET /api/okved/main error', e);
    return NextResponse.json({ items: [] });
  }
}

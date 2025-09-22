import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const industryId = Number(searchParams.get('industryId') ?? '') || null;

    // DISTINCT ON по okved_code — выбираем одну запись на код.
    // В порядке сортировки сначала те, где okved_main = true, затем по id.
    // Для красивой сортировки списка в ответе — сортируем по "натуральному" порядку кода.
    const { rows } = await db.query(
      `
      WITH dedup AS (
        SELECT DISTINCT ON (okved_code)
               id,
               okved_code,
               okved_main
        FROM ib_okved_main
        WHERE ($1::int IS NULL OR industry_id = $1)
        ORDER BY okved_code, okved_main DESC, id
      )
      SELECT id, okved_code, okved_main
      FROM dedup
      ORDER BY string_to_array(okved_code, '.')::text[];
      `,
      [industryId],
    );

    return NextResponse.json({ items: rows });
  } catch (e) {
    console.error('OKVED API error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

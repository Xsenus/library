import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const inn = (searchParams.get('inn') ?? '').trim();
    if (!inn) return NextResponse.json({ ok: false, error: 'inn required' });

    const infoSql = `
      SELECT inn, short_name, address
      FROM dadata_result
      WHERE inn = $1
      ORDER BY year DESC
      LIMIT 1
    `;
    const listSql = `
      SELECT year, revenue, branch_count
      FROM dadata_result
      WHERE inn = $1
      ORDER BY year DESC
    `;
    const [infoRes, listRes] = await Promise.all([
      dbBitrix.query(infoSql, [inn]),
      dbBitrix.query(listSql, [inn]),
    ]);

    const company = infoRes.rows[0] ?? null;
    const years = listRes.rows ?? [];
    return NextResponse.json({ ok: true, company, years });
  } catch (e) {
    console.error('GET /api/okved/company error', e);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}

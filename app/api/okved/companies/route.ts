import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { okvedCompaniesQuerySchema, okvedCompanySchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = okvedCompaniesQuerySchema.parse({
      okved: searchParams.get('okved'),
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
      query: null,
    });

    const offset = (query.page - 1) * query.pageSize;

    const countSql = `
      SELECT COUNT(*)::int AS cnt
      FROM dadata_result
      WHERE (status = 'ACTIVE' OR status = 'REORGANIZING')
        AND main_okved = $1
    `;
    const dataSql = `
      SELECT inn, short_name, address, branch_count, year, revenue
      FROM dadata_result
      WHERE (status = 'ACTIVE' OR status = 'REORGANIZING')
        AND main_okved = $1
      ORDER BY inn
      OFFSET $2 LIMIT $3
    `;

    const [countRes, dataRes] = await Promise.all([
      dbBitrix.query(countSql, [query.okved]),
      dbBitrix.query(dataSql, [query.okved, offset, query.pageSize]),
    ]);

    const items = dataRes.rows.map((r: any) => okvedCompanySchema.parse(r));
    const total = countRes.rows[0]?.cnt ?? 0;

    return NextResponse.json({ items, total, page: query.page, pageSize: query.pageSize });
  } catch (e) {
    console.error('GET /api/okved/companies error', e);
    return NextResponse.json({ items: [], total: 0 });
  }
}

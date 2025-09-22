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
      okved: searchParams.get('okved') ?? '',
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
      query: null,
    });

    const offset = (query.page - 1) * query.pageSize;

    const where: string[] = ["(status = 'ACTIVE' OR status = 'REORGANIZING')"];
    const args: any[] = [];
    let argIdx = 1;

    if (query.okved) {
      where.push(`main_okved = $${argIdx++}`);
      args.push(query.okved);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(*)::int AS cnt
      FROM dadata_result
      ${whereSql}
    `;
    const dataSql = `
      SELECT inn, short_name, address, branch_count, year, revenue
      FROM dadata_result
      ${whereSql}
      ORDER BY inn
      OFFSET $${argIdx} LIMIT $${argIdx + 1}
    `;

    const countRes = await dbBitrix.query(countSql, args);
    const total = countRes.rows[0]?.cnt ?? 0;

    const dataRes = await dbBitrix.query(dataSql, [...args, offset, query.pageSize]);
    const items = dataRes.rows.map((r: any) => okvedCompanySchema.parse(r));

    return NextResponse.json({ items, total, page: query.page, pageSize: query.pageSize });
  } catch (e) {
    console.error('GET /api/okved/companies error', e);
    return NextResponse.json({ items: [], total: 0 });
  }
}

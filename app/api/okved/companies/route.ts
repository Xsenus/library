// app/api/okved/companies/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { okvedCompaniesQuerySchema, okvedCompanySchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const base = okvedCompaniesQuerySchema.parse({
      okved: searchParams.get('okved') ?? '',
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
      query: undefined,
    });

    const q = (searchParams.get('q') ?? '').trim();
    const sortParam = (searchParams.get('sort') ?? 'revenue_desc') as
      | 'revenue_desc'
      | 'revenue_asc';
    const includeExtra = (searchParams.get('extra') ?? '0') === '1';

    const industryIdRaw = searchParams.get('industryId');
    const industryId = industryIdRaw ? Number(industryIdRaw) : null;

    const offset = (base.page - 1) * base.pageSize;

    const where: string[] = ["(d.status = 'ACTIVE' OR d.status = 'REORGANIZING')"];
    const args: any[] = [];
    let i = 1;

    if (base.okved) {
      if (includeExtra) {
        where.push(
          `(d.main_okved = $${i} OR EXISTS (
             SELECT 1
             FROM dadata_okveds x
             WHERE x.inn = d.inn AND x.okved = $${i}
           ))`,
        );
      } else {
        where.push(`d.main_okved = $${i}`);
      }
      args.push(base.okved);
      i++;
    }

    if (industryId && Number.isFinite(industryId)) {
      where.push(`
        split_part(d.main_okved, '.', 1) IN (
          SELECT DISTINCT split_part(m.okved_code, '.', 1)
          FROM ib_okved_main m
          WHERE m.industry_id = $${i}
        )
      `);
      args.push(industryId);
      i++;
    }

    if (q) {
      where.push(`d.short_name ILIKE $${i}`);
      args.push(`%${q}%`);
      i++;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const orderSql =
      sortParam === 'revenue_asc'
        ? `ORDER BY d.revenue ASC NULLS LAST, d.inn`
        : `ORDER BY d.revenue DESC NULLS LAST, d.inn`;

    const countSql = `
      SELECT COUNT(*)::int AS cnt
      FROM dadata_result d
      ${whereSql}
    `;

    const dataSql = `
      SELECT d.inn, d.short_name, d.address, d.branch_count, d.year, d.revenue
      FROM dadata_result d
      ${whereSql}
      ${orderSql}
      OFFSET $${i} LIMIT $${i + 1}
    `;

    const countRes = await dbBitrix.query(countSql, args);
    const total = countRes.rows[0]?.cnt ?? 0;

    const dataRes = await dbBitrix.query(dataSql, [...args, offset, base.pageSize]);
    const items = dataRes.rows.map((r: any) => okvedCompanySchema.parse(r));

    return NextResponse.json({
      items,
      total,
      page: base.page,
      pageSize: base.pageSize,
    });
  } catch (e) {
    console.error('GET /api/okved/companies error', e);
    return NextResponse.json({ items: [], total: 0 });
  }
}

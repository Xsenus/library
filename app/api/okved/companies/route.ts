// app/api/okved/companies/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { db } from '@/lib/db';
import { okvedCompaniesQuerySchema, okvedCompanySchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

// простой in-memory кэш корней по industryId
const rootsCache = new Map<number, { roots: string[]; ts: number }>();
const ROOTS_TTL_MS = 10 * 60 * 1000;

async function getOkvedRootsForIndustry(industryId: number): Promise<string[]> {
  const now = Date.now();
  const hit = rootsCache.get(industryId);
  if (hit && now - hit.ts < ROOTS_TTL_MS) return hit.roots;

  // тянем из второй БД (db): ib_okved_main
  const { rows } = await db.query<{ root: string }>(
    `
      SELECT DISTINCT split_part(m.okved_code, '.', 1) AS root
      FROM ib_okved_main m
      WHERE m.industry_id = $1
    `,
    [industryId],
  );
  const roots = rows.map((r) => r.root).filter(Boolean);
  rootsCache.set(industryId, { roots, ts: now });
  return roots;
}

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
    const industryId = industryIdRaw && /^\d+$/.test(industryIdRaw) ? Number(industryIdRaw) : null;

    const offset = (base.page - 1) * base.pageSize;

    const where: string[] = ["(d.status = 'ACTIVE' OR d.status = 'REORGANIZING')"];
    const args: any[] = [];
    let i = 1;

    // Фильтр по ОКВЭД
    if (base.okved) {
      if (includeExtra) {
        // main_okved ИЛИ в JSONB-списке дополнительных
        where.push(
          `(d.main_okved = $${i} OR EXISTS (
             SELECT 1
             FROM jsonb_array_elements(d.okveds) AS elem(val)
             WHERE
               (jsonb_typeof(elem.val) = 'string' AND elem.val::text = to_jsonb($${i})::text)
               OR (jsonb_typeof(elem.val) = 'object' AND (
                   elem.val->>'okved' = $${i} OR
                   elem.val->>'code' = $${i} OR
                   elem.val->>'okved_code' = $${i}
               ))
           ))`,
        );
      } else {
        where.push(`d.main_okved = $${i}`);
      }
      args.push(base.okved);
      i++;
    }

    // Фильтр по индустрии — тянем корни из ДРУГОЙ БД и фильтруем по ним в dadata_result
    if (industryId != null) {
      const roots = await getOkvedRootsForIndustry(industryId); // ['28','10','33',...]
      if (roots.length > 0) {
        // используем ANY($::text[]) — один параметр-массив вместо сотни плейсхолдеров
        where.push(`split_part(d.main_okved, '.', 1) = ANY($${i}::text[])`);
        args.push(roots);
        i++;
      } else {
        // если по индустрии нет корней — заведомо пусто
        return NextResponse.json({ items: [], total: 0, page: base.page, pageSize: base.pageSize });
      }
    }

    // Поиск по названию
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
    const total = countRes.rows?.[0]?.cnt ?? 0;

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

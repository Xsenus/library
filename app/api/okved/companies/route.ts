// app/api/okved/companies/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { db } from '@/lib/db';
import { okvedCompaniesQuerySchema, okvedCompanySchema } from '@/lib/validators';
import { requireApiAuth } from '@/lib/api-auth';
import { ensureCompanyMetaTable } from '@/lib/b24-meta';

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

async function getOkvedCodesForProdclass(prodclassId: number): Promise<string[]> {
  const { rows } = await db.query<{ code: string }>(
    `
      SELECT DISTINCT regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g') AS code
      FROM ib_okved o
      WHERE o.prodclass_id = $1
      ORDER BY code
    `,
    [prodclassId],
  );
  return rows.map((row) => row.code).filter(Boolean);
}

type CompanyColorOption = {
  value: string;
  label: string;
};

async function loadCompanyColorOptions(): Promise<CompanyColorOption[]> {
  await ensureCompanyMetaTable();

  const { rows } = await db.query<{ value: string | null; label: string | null }>(
    `
      SELECT DISTINCT
        COALESCE(NULLIF(btrim(color_xml_id), ''), NULLIF(btrim(color_label), '')) AS value,
        COALESCE(NULLIF(btrim(color_label), ''), NULLIF(btrim(color_xml_id), '')) AS label
      FROM b24_company_meta
      WHERE COALESCE(NULLIF(btrim(color_xml_id), ''), NULLIF(btrim(color_label), '')) IS NOT NULL
      ORDER BY label
      LIMIT 100
    `,
  );

  return rows
    .map((row) => ({
      value: String(row.value ?? '').trim(),
      label: String(row.label ?? '').trim(),
    }))
    .filter((row) => row.value && row.label);
}

async function resolveColorInns(color: string): Promise<string[]> {
  const normalized = color.trim();
  if (!normalized) return [];

  await ensureCompanyMetaTable();

  const { rows } = await db.query<{ inn: string }>(
    `
      SELECT inn
      FROM b24_company_meta
      WHERE color_xml_id = $1 OR color_label = $1
    `,
    [normalized],
  );

  return rows.map((row) => String(row.inn ?? '').trim()).filter(Boolean);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);

    const base = okvedCompaniesQuerySchema.parse({
      okved: searchParams.get('okved') ?? '',
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
      responsible: searchParams.get('responsible') ?? undefined,
      query: undefined,
    });

    const q = (searchParams.get('q') ?? '').trim();
    const responsible = (base.responsible ?? '').trim();
    const color = (searchParams.get('color') ?? '').trim();
    const pp719Only = searchParams.get('pp719') === '1';
    const sortParam = (searchParams.get('sort') ?? 'revenue_desc') as
      | 'revenue_desc'
      | 'revenue_asc';
    const includeExtra = (searchParams.get('extra') ?? '0') === '1'; // ЧБ №2
    const includeParent = (searchParams.get('parent') ?? '0') === '1'; // ЧБ №3

    const industryIdRaw = searchParams.get('industryId');
    const industryId = industryIdRaw && /^\d+$/.test(industryIdRaw) ? Number(industryIdRaw) : null;
    const prodclassIdRaw = searchParams.get('prodclassId');
    const prodclassId = prodclassIdRaw && /^\d+$/.test(prodclassIdRaw) ? Number(prodclassIdRaw) : null;

    const offset = (base.page - 1) * base.pageSize;

    const where: string[] = ["(d.status = 'ACTIVE' OR d.status = 'REORGANIZING')"];
    const args: any[] = [];
    let i = 1;

    // ---------- ФИЛЬТР ПО ОКВЭД ----------
    if (base.okved) {
      if (includeParent) {
        // Префикс по первым двум цифрам
        const prefix2 = (base.okved.match(/^\d{2}/)?.[0] ?? '').trim();
        if (!prefix2) {
          return NextResponse.json({
            items: [],
            total: 0,
            page: base.page,
            pageSize: base.pageSize,
          });
        }

        let cond = `TRIM(d.main_okved) ~ ('^' || $${i} || '(\\.|$)')`;
        args.push(prefix2);
        i++;

        if (includeExtra) {
          cond += `
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(d.okveds, '[]'::jsonb)) AS elem(val)
              WHERE
                (
                  jsonb_typeof(elem.val) = 'string'
                  AND TRIM(BOTH '"' FROM elem.val::text) ~ ('^' || $${i} || '(\\.|$)')
                )
                OR
                (
                  jsonb_typeof(elem.val) = 'object'
                  AND COALESCE(elem.val->>'okved', elem.val->>'code', elem.val->>'okved_code', '') ~ ('^' || $${i} || '(\\.|$)')
                )
            )`;
          args.push(prefix2);
          i++;
        }

        where.push(`(${cond})`);
      } else {
        let cond = `TRIM(d.main_okved) = $${i}`;
        args.push(base.okved);
        i++;

        if (includeExtra) {
          cond += `
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(d.okveds, '[]'::jsonb)) AS elem(val)
              WHERE
                (jsonb_typeof(elem.val) = 'string' AND TRIM(BOTH '"' FROM elem.val::text) = $${i})
                OR (
                  jsonb_typeof(elem.val) = 'object'
                  AND (
                    elem.val->>'okved' = $${i}
                    OR elem.val->>'code' = $${i}
                    OR elem.val->>'okved_code' = $${i}
                  )
                )
            )`;
          args.push(base.okved);
          i++;
        }

        where.push(`(${cond})`);
      }
    }

    // ---------- Фильтр по индустрии ----------
    if (industryId != null) {
      const roots = await getOkvedRootsForIndustry(industryId); // ['28','10','33',...]
      if (roots.length > 0) {
        where.push(`split_part(d.main_okved, '.', 1) = ANY($${i}::text[])`);
        args.push(roots);
        i++;
      } else {
        return NextResponse.json({ items: [], total: 0, page: base.page, pageSize: base.pageSize });
      }
    }

    // ---------- Фильтр по классу предприятия ----------
    if (prodclassId != null) {
      const codes = await getOkvedCodesForProdclass(prodclassId);
      if (codes.length > 0) {
        let cond = `TRIM(d.main_okved) = ANY($${i}::text[])`;
        args.push(codes);
        i++;

        if (includeExtra) {
          cond += `
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(d.okveds, '[]'::jsonb)) AS elem(val)
              WHERE
                (jsonb_typeof(elem.val) = 'string' AND TRIM(BOTH '"' FROM elem.val::text) = ANY($${i}::text[]))
                OR (
                  jsonb_typeof(elem.val) = 'object'
                  AND COALESCE(elem.val->>'okved', elem.val->>'code', elem.val->>'okved_code', '') = ANY($${i}::text[])
                )
            )`;
          args.push(codes);
          i++;
        }

        where.push(`(${cond})`);
      } else {
        return NextResponse.json({ items: [], total: 0, page: base.page, pageSize: base.pageSize });
      }
    }

    // ---------- Поиск по названию/ИНН ----------
    if (q) {
      where.push(`(d.short_name ILIKE $${i} OR d.inn ILIKE $${i})`);
      args.push(`%${q}%`);
      i++;
    }

    // ---------- Фильтр по ответственному ----------
    if (responsible) {
      await ensureCompanyMetaTable();

      const { rows: responsibleRows } = await db.query<{ inn: string }>(
        `
          SELECT inn
          FROM b24_company_meta
          WHERE COALESCE(assigned_name, '') ILIKE $1
        `,
        [`%${responsible}%`],
      );

      const responsibleInns = responsibleRows
        .map((row) => String(row.inn ?? '').trim())
        .filter(Boolean);

      if (!responsibleInns.length) {
        return NextResponse.json({
          items: [],
          total: 0,
          page: base.page,
          pageSize: base.pageSize,
        });
      }

      where.push(`d.inn = ANY($${i}::text[])`);
      args.push(responsibleInns);
      i++;
    }

    if (color) {
      const colorInns = await resolveColorInns(color);

      if (!colorInns.length) {
        return NextResponse.json({
          items: [],
          total: 0,
          page: base.page,
          pageSize: base.pageSize,
          filterOptions: { colors: await loadCompanyColorOptions() },
        });
      }

      where.push(`d.inn = ANY($${i}::text[])`);
      args.push(colorInns);
      i++;
    }

    if (pp719Only) {
      where.push(`
        EXISTS (
          SELECT 1
          FROM pp719companies p
          WHERE btrim(p.inn) = btrim(d.inn)
        )
      `);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const orderSql =
      sortParam === 'revenue_asc'
        ? `ORDER BY d.revenue ASC NULLS LAST, d.inn`
        : `ORDER BY d.revenue DESC NULLS LAST, d.inn`;

    // COUNT: одна строка на компанию, можно просто посчитать
    const countSql = `
      SELECT COUNT(*)::int AS cnt
      FROM dadata_result d
      ${whereSql}
    `;

    // Основной SELECT: алиасим колонки с дефисом
    const dataSql = `
      SELECT
        d.inn,
        d.short_name,
        d.address,
        d.branch_count,
        d.year,
        d.revenue,
        d.income,
        d.employee_count,
        "revenue-1" AS revenue_1,
        "revenue-2" AS revenue_2,
        "revenue-3" AS revenue_3,
        "income-1"  AS income_1,
        "income-2"  AS income_2,
        "income-3"  AS income_3,
        d.analysis_score,
        EXISTS (
          SELECT 1
          FROM pp719companies p
          WHERE btrim(p.inn) = btrim(d.inn)
        ) AS in_pp719
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
      filterOptions: { colors: await loadCompanyColorOptions() },
    });
  } catch (e) {
    console.error('GET /api/okved/companies error', e);
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50 }, { status: 500 });
  }
}

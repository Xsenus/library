import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dbBitrix } from '@/lib/db-bitrix';
import { requireApiAuth } from '@/lib/api-auth';
import { loadPp719Inns } from '@/lib/pp719';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

type MapCompanyRow = {
  inn: string | null;
  short_name: string | null;
  address: string | null;
  geo_lat: number | string | null;
  geo_lon: number | string | null;
  revenue: number | string | null;
  employee_count: number | string | null;
  branch_count: number | string | null;
  main_okved: string | null;
  web_sites: string | null;
  smb_type: string | null;
  smb_category: string | null;
  revenue_1: number | string | null;
  revenue_2: number | string | null;
  revenue_3: number | string | null;
  year: number | string | null;
  analysis_ok: number | string | null;
  analysis_score: number | string | null;
};

type CompanyMetaRow = {
  inn: string;
  company_id: string | null;
  assigned_name: string | null;
  color_label: string | null;
  color_xml_id: string | null;
};

type OkvedRootRow = { root: string };
type OkvedCodeRow = { code: string };
type InnRow = { inn: string };
type ResponsibleRow = { assigned_name: string | null };
type ColorRow = { value: string | null; label: string | null };
type MapStatsRow = { total: number; with_geo: number };
type QueryResult<Row> = { rows?: Row[] };

const rootsCache = new Map<number, { roots: string[]; ts: number }>();
const ROOTS_TTL_MS = 10 * 60 * 1000;
const RESPONSIBLES_TTL_MS = 5 * 60 * 1000;
let responsiblesCache: { items: string[]; ts: number } | null = null;
let colorsCache: { items: Array<{ value: string; label: string }>; ts: number } | null = null;

function parseFiniteNumber(value: string | null): number | null {
  if (value == null || value.trim() === '') return null;
  const normalized = value.replace(',', '.').trim();
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function parsePositiveInt(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function getOkvedRootsForIndustry(industryId: number): Promise<string[]> {
  const now = Date.now();
  const cached = rootsCache.get(industryId);
  if (cached && now - cached.ts < ROOTS_TTL_MS) return cached.roots;

  try {
    const { rows } = await db.query<OkvedRootRow>(
      `
        SELECT DISTINCT split_part(m.okved_code, '.', 1) AS root
        FROM ib_okved_main m
        WHERE m.industry_id = $1
      `,
      [industryId],
    );
    const roots = rows.map((row: OkvedRootRow) => row.root).filter(Boolean);
    rootsCache.set(industryId, { roots, ts: now });
    return roots;
  } catch (error) {
    console.warn('companies-map: failed to load industry roots from ib_okved_main.industry_id', error);
  }

  try {
    const { rows } = await db.query<OkvedRootRow>(
      `
        SELECT DISTINCT split_part(o.okved_code, '.', 1) AS root
        FROM ib_okved_main o
        JOIN ib_okved_industry_map m ON m.okved_id = o.id
        WHERE m.industry_id = $1
      `,
      [industryId],
    );
    const roots = rows.map((row: OkvedRootRow) => row.root).filter(Boolean);
    rootsCache.set(industryId, { roots, ts: now });
    return roots;
  } catch (error) {
    console.warn('companies-map: failed to load industry roots from ib_okved_industry_map', error);
    rootsCache.set(industryId, { roots: [], ts: now });
    return [];
  }
}

async function getOkvedCodesForProdclass(prodclassId: number): Promise<string[]> {
  try {
    const { rows } = await db.query<OkvedCodeRow>(
      `
        SELECT DISTINCT regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g') AS code
        FROM ib_okved o
        WHERE o.prodclass_id = $1
        ORDER BY code
      `,
      [prodclassId],
    );
    return rows.map((row: OkvedCodeRow) => row.code).filter(Boolean);
  } catch (error) {
    console.warn('companies-map: failed to load okved codes for prodclass', error);
    return [];
  }
}

async function resolveResponsibleInns(responsible: string): Promise<string[] | null> {
  const normalized = responsible.trim();
  if (!normalized) return null;

  try {
    const { rows } = await db.query<InnRow>(
      `
        SELECT inn
        FROM b24_company_meta
        WHERE COALESCE(assigned_name, '') ILIKE $1
      `,
      [`%${normalized}%`],
    );
    return rows.map((row: InnRow) => String(row.inn ?? '').trim()).filter(Boolean);
  } catch (error) {
    console.warn('companies-map: failed to resolve responsible filter', error);
    return [];
  }
}

async function resolveColorInns(color: string): Promise<string[] | null> {
  const normalized = color.trim();
  if (!normalized) return null;

  try {
    const { rows } = await db.query<InnRow>(
      `
        SELECT inn
        FROM b24_company_meta
        WHERE color_xml_id = $1 OR color_label = $1
      `,
      [normalized],
    );
    return rows.map((row: InnRow) => String(row.inn ?? '').trim()).filter(Boolean);
  } catch (error) {
    console.warn('companies-map: failed to resolve company color filter', error);
    return [];
  }
}

async function loadCompanyMeta(inns: string[]): Promise<Map<string, CompanyMetaRow>> {
  if (!inns.length) return new Map();

  try {
    const { rows } = await db.query<CompanyMetaRow>(
      `
        SELECT inn, company_id, assigned_name
          , color_label, color_xml_id
        FROM b24_company_meta
        WHERE inn = ANY($1::text[])
      `,
      [inns],
    );
    const entries: Array<[string, CompanyMetaRow]> = rows.map((row: CompanyMetaRow) => [
      String(row.inn ?? '').trim(),
      row,
    ]);
    return new Map(entries.filter(([inn]: [string, CompanyMetaRow]) => Boolean(inn)));
  } catch (error) {
    console.warn('companies-map: failed to load company meta', error);
    return new Map();
  }
}

async function loadCompanyColorOptions(): Promise<Array<{ value: string; label: string }>> {
  const now = Date.now();
  if (colorsCache && now - colorsCache.ts < RESPONSIBLES_TTL_MS) {
    return colorsCache.items;
  }

  try {
    const { rows } = await db.query<ColorRow>(
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
    const items = rows
      .map((row: ColorRow) => ({
        value: String(row.value ?? '').trim(),
        label: String(row.label ?? '').trim(),
      }))
      .filter((row) => row.value && row.label);
    colorsCache = { items, ts: now };
    return items;
  } catch (error) {
    console.warn('companies-map: failed to load company color options', error);
    colorsCache = { items: [], ts: now };
    return [];
  }
}

async function loadResponsibleOptions(): Promise<string[]> {
  const now = Date.now();
  if (responsiblesCache && now - responsiblesCache.ts < RESPONSIBLES_TTL_MS) {
    return responsiblesCache.items;
  }

  try {
    const { rows } = await db.query<ResponsibleRow>(
      `
        SELECT DISTINCT assigned_name
        FROM b24_company_meta
        WHERE COALESCE(assigned_name, '') <> ''
        ORDER BY assigned_name
        LIMIT 500
      `,
    );
    const items = rows.map((row: ResponsibleRow) => String(row.assigned_name ?? '').trim()).filter(Boolean);
    responsiblesCache = { items, ts: now };
    return items;
  } catch (error) {
    console.warn('companies-map: failed to load responsible options', error);
    responsiblesCache = { items: [], ts: now };
    return [];
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth({ requireWorker: true });
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = request.nextUrl;
    const industryId = parsePositiveInt(searchParams.get('industryId'));
    const prodclassId = parsePositiveInt(searchParams.get('prodclassId'));
    const okved = (searchParams.get('okved') ?? '').trim();
    const enterpriseType = (searchParams.get('enterpriseType') ?? '').trim();
    const mainOkvedOnly = searchParams.get('mainOkvedOnly') !== '0';
    const responsible = (searchParams.get('responsible') ?? '').trim();
    const color = (searchParams.get('color') ?? '').trim();
    const pp719Only = searchParams.get('pp719') === '1';
    const successOnly = searchParams.get('success') === '1';
    const revenueGrowing = searchParams.get('revenueGrowing') === '1';
    const scoreFrom = parseFiniteNumber(searchParams.get('scoreFrom'));
    const scoreTo = parseFiniteNumber(searchParams.get('scoreTo'));
    const revenueFromMln = parseFiniteNumber(searchParams.get('revenueFromMln'));
    const revenueToMln = parseFiniteNumber(searchParams.get('revenueToMln'));
    const pp719Inns = await loadPp719Inns();

    const where: string[] = ["(d.status = 'ACTIVE' OR d.status = 'REORGANIZING')"];
    const args: unknown[] = [];

    if (industryId) {
      const roots = await getOkvedRootsForIndustry(industryId);
      if (!roots.length) {
        const [responsibles, colors] = await Promise.all([loadResponsibleOptions(), loadCompanyColorOptions()]);
        return NextResponse.json({
          items: [],
          total: 0,
          withGeo: 0,
          skippedNoGeo: 0,
          filterOptions: { responsibles, colors },
        });
      }
      args.push(roots);
      where.push(`split_part(d.main_okved, '.', 1) = ANY($${args.length}::text[])`);
    }

    if (prodclassId) {
      const codes = await getOkvedCodesForProdclass(prodclassId);
      if (!codes.length) {
        const [responsibles, colors] = await Promise.all([loadResponsibleOptions(), loadCompanyColorOptions()]);
        return NextResponse.json({
          items: [],
          total: 0,
          withGeo: 0,
          skippedNoGeo: 0,
          filterOptions: { responsibles, colors },
        });
      }

      args.push(codes);
      const param = args.length;
      if (mainOkvedOnly) {
        where.push(`TRIM(d.main_okved) = ANY($${param}::text[])`);
      } else {
        where.push(`
          (
            TRIM(d.main_okved) = ANY($${param}::text[])
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(d.okveds, '[]'::jsonb)) AS elem(val)
              WHERE
                (jsonb_typeof(elem.val) = 'string' AND TRIM(BOTH '"' FROM elem.val::text) = ANY($${param}::text[]))
                OR (
                  jsonb_typeof(elem.val) = 'object'
                  AND COALESCE(elem.val->>'okved', elem.val->>'code', elem.val->>'okved_code', '') = ANY($${param}::text[])
                )
            )
          )
        `);
      }
    }

    if (okved) {
      args.push(okved);
      const param = args.length;
      if (mainOkvedOnly) {
        where.push(`TRIM(d.main_okved) = $${param}`);
      } else {
        where.push(`
          (
            TRIM(d.main_okved) = $${param}
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(d.okveds, '[]'::jsonb)) AS elem(val)
              WHERE
                (jsonb_typeof(elem.val) = 'string' AND TRIM(BOTH '"' FROM elem.val::text) = $${param})
                OR (
                  jsonb_typeof(elem.val) = 'object'
                  AND (
                    elem.val->>'okved' = $${param}
                    OR elem.val->>'code' = $${param}
                    OR elem.val->>'okved_code' = $${param}
                  )
                )
            )
          )
        `);
      }
    }

    if (enterpriseType) {
      if (enterpriseType === 'unknown') {
        where.push(`COALESCE(d.smb_category, '') = ''`);
      } else {
        args.push(enterpriseType);
        where.push(`d.smb_category = $${args.length}`);
      }
    }

    if (successOnly) {
      where.push('COALESCE(d.analysis_ok, 0) = 1');
    }

    if (scoreFrom != null) {
      args.push(scoreFrom);
      where.push(`d.analysis_score >= $${args.length}`);
    }

    if (scoreTo != null) {
      args.push(scoreTo);
      where.push(`d.analysis_score <= $${args.length}`);
    }

    if (revenueFromMln != null) {
      args.push(revenueFromMln * 1_000_000);
      where.push(`d.revenue >= $${args.length}`);
    }

    if (revenueToMln != null) {
      args.push(revenueToMln * 1_000_000);
      where.push(`d.revenue <= $${args.length}`);
    }

    if (revenueGrowing) {
      where.push(`d.revenue IS NOT NULL AND d."revenue-1" IS NOT NULL AND d.revenue > d."revenue-1"`);
    }

    if (responsible) {
      const responsibleInns = await resolveResponsibleInns(responsible);
      if (!responsibleInns?.length) {
        const [responsibles, colors] = await Promise.all([loadResponsibleOptions(), loadCompanyColorOptions()]);
        return NextResponse.json({
          items: [],
          total: 0,
          withGeo: 0,
          skippedNoGeo: 0,
          filterOptions: { responsibles, colors },
        });
      }
      args.push(responsibleInns);
      where.push(`d.inn = ANY($${args.length}::text[])`);
    }

    if (color) {
      const colorInns = await resolveColorInns(color);
      if (!colorInns?.length) {
        const [responsibles, colors] = await Promise.all([loadResponsibleOptions(), loadCompanyColorOptions()]);
        return NextResponse.json({
          items: [],
          total: 0,
          withGeo: 0,
          skippedNoGeo: 0,
          filterOptions: { responsibles, colors },
        });
      }
      args.push(colorInns);
      where.push(`d.inn = ANY($${args.length}::text[])`);
    }

    if (pp719Only) {
      if (!pp719Inns.length) {
        const [responsibles, colors] = await Promise.all([loadResponsibleOptions(), loadCompanyColorOptions()]);
        return NextResponse.json({
          items: [],
          total: 0,
          withGeo: 0,
          skippedNoGeo: 0,
          filterOptions: { responsibles, colors },
        });
      }
      args.push(pp719Inns);
      where.push(`d.inn = ANY($${args.length}::text[])`);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    const statsSql = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE d.geo_lat IS NOT NULL
            AND d.geo_lon IS NOT NULL
            AND d.geo_lat BETWEEN -90 AND 90
            AND d.geo_lon BETWEEN -180 AND 180
        )::int AS with_geo
      FROM dadata_result d
      ${whereSql}
    `;

    const dataSql = `
      SELECT
        d.inn,
        d.short_name,
        d.address,
        d.geo_lat,
        d.geo_lon,
        d.revenue,
        d.employee_count,
        d.branch_count,
        d.main_okved,
        d.web_sites,
        d.smb_type,
        d.smb_category,
        d."revenue-1" AS revenue_1,
        d."revenue-2" AS revenue_2,
        d."revenue-3" AS revenue_3,
        d.year,
        d.analysis_ok,
        d.analysis_score
      FROM dadata_result d
      ${whereSql}
        AND d.geo_lat IS NOT NULL
        AND d.geo_lon IS NOT NULL
        AND d.geo_lat BETWEEN -90 AND 90
        AND d.geo_lon BETWEEN -180 AND 180
      ORDER BY d.revenue DESC NULLS LAST, d.inn
    `;

    const [statsRes, dataRes, responsibles, colors] = await Promise.all([
      dbBitrix.query(statsSql, args) as Promise<QueryResult<MapStatsRow>>,
      dbBitrix.query(dataSql, args) as Promise<QueryResult<MapCompanyRow>>,
      loadResponsibleOptions(),
      loadCompanyColorOptions(),
    ]);

    const rows = dataRes.rows ?? [];
    const inns = rows.map((row: MapCompanyRow) => String(row.inn ?? '').trim()).filter(Boolean);
    const metaByInn = await loadCompanyMeta(inns);
    const pp719InnSet = new Set(pp719Inns);

    const items = rows
      .map((row: MapCompanyRow) => {
        const inn = String(row.inn ?? '').trim();
        if (!inn) return null;
        const lat = toNumber(row.geo_lat);
        const lon = toNumber(row.geo_lon);
        if (lat == null || lon == null) return null;
        const meta = metaByInn.get(inn);

        return {
          inn,
          short_name: String(row.short_name ?? '').trim() || 'Компания',
          address: row.address ?? null,
          geo_lat: lat,
          geo_lon: lon,
          revenue: toNumber(row.revenue),
          employee_count: toNumber(row.employee_count),
          branch_count: toNumber(row.branch_count),
          main_okved: row.main_okved ?? null,
          web_sites: row.web_sites ?? null,
          smb_type: row.smb_type ?? null,
          smb_category: row.smb_category ?? null,
          revenue_1: toNumber(row.revenue_1),
          revenue_2: toNumber(row.revenue_2),
          revenue_3: toNumber(row.revenue_3),
          year: toNumber(row.year),
          analysis_ok: toNumber(row.analysis_ok),
          analysis_score: toNumber(row.analysis_score),
          in_pp719: pp719InnSet.has(inn),
          responsible: meta?.assigned_name ?? null,
          color_label: meta?.color_label ?? null,
          color_xml_id: meta?.color_xml_id ?? null,
          company_id: meta?.company_id ?? null,
        };
      })
      .filter(Boolean);

    const total = Number(statsRes.rows?.[0]?.total ?? 0);
    const withGeo = Number(statsRes.rows?.[0]?.with_geo ?? items.length);

    return NextResponse.json({
      items,
      total,
      withGeo,
      skippedNoGeo: Math.max(0, total - withGeo),
      filterOptions: { responsibles, colors },
    });
  } catch (error) {
    console.error('GET /api/ai-analysis/companies-map error', error);
    return NextResponse.json(
      { items: [], total: 0, withGeo: 0, skippedNoGeo: 0, filterOptions: { responsibles: [], colors: [] } },
      { status: 500 },
    );
  }
}

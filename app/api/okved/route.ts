// app/api/okved/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { dbBitrix } from '@/lib/db-bitrix';
import { requireApiAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type OkvedItem = {
  id: number;
  okved_code: string;
  okved_main: string;
};

// Примерная структура. Подправь JOIN'ы под свои реальные таблицы/связи.
const SQL_ALL = `
  SELECT o.id, o.okved_code, o.okved_main
  FROM ib_okved_main o
  ORDER BY o.okved_code
  LIMIT 1000
`;

const SQL_BY_INDUSTRY = `
  SELECT DISTINCT o.id, o.okved_code, o.okved_main
  FROM ib_okved_main o
  WHERE o.industry_id = $1
  ORDER BY o.okved_code
  LIMIT 1000
`;

const SQL_BY_PRODCLASS = `
  SELECT DISTINCT ON (regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g'))
    o.id,
    regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g') AS okved_code,
    o.okved_main
  FROM ib_okved o
  WHERE o.prodclass_id = $1
  ORDER BY regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g'), o.okved_main DESC, o.id
  LIMIT 1000
`;

const SQL_BY_INDUSTRY_PRODCLASSES = `
  SELECT DISTINCT ON (regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g'))
    o.id,
    regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g') AS okved_code,
    o.okved_main
  FROM ib_okved o
  JOIN ib_prodclass p ON p.id = o.prodclass_id
  WHERE p.industry_id = $1
  ORDER BY regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g'), o.okved_main DESC, o.id
  LIMIT 1000
`;

async function getOkvedRootsForIndustry(industryId: number): Promise<string[]> {
  const { rows } = await db.query<{ root: string }>(
    `
      SELECT DISTINCT split_part(m.okved_code, '.', 1) AS root
      FROM ib_okved_main m
      WHERE m.industry_id = $1
    `,
    [industryId],
  );
  return rows.map((row) => row.root).filter(Boolean);
}

async function filterOkvedItemsByCompanies(
  rows: OkvedItem[],
  options: { mainOkvedOnly: boolean; onlyWithGeo: boolean; industryRoots?: string[] },
): Promise<OkvedItem[]> {
  const codes = Array.from(
    new Set(rows.map((row) => String(row.okved_code ?? '').trim()).filter(Boolean)),
  );
  if (!codes.length) return rows;
  if (options.industryRoots && options.industryRoots.length === 0) return [];

  const geoSql = options.onlyWithGeo
    ? `
        AND d.geo_lat IS NOT NULL
        AND d.geo_lon IS NOT NULL
        AND d.geo_lat BETWEEN -90 AND 90
        AND d.geo_lon BETWEEN -180 AND 180
      `
    : '';

  const extraOkvedSql = options.mainOkvedOnly
    ? ''
    : `
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(d.okveds, '[]'::jsonb)) AS elem(val)
          WHERE
            (jsonb_typeof(elem.val) = 'string' AND TRIM(BOTH '"' FROM elem.val::text) = selected.code)
            OR (
              jsonb_typeof(elem.val) = 'object'
              AND (
                elem.val->>'okved' = selected.code
                OR elem.val->>'code' = selected.code
                OR elem.val->>'okved_code' = selected.code
              )
            )
        )
      `;
  const industrySql = options.industryRoots
    ? `AND split_part(d.main_okved, '.', 1) = ANY($2::text[])`
    : '';
  const queryParams = options.industryRoots ? [codes, options.industryRoots] : [codes];

  try {
    const { rows: companyRows } = await dbBitrix.query<{ code: string }>(
      `
        SELECT selected.code
        FROM unnest($1::text[]) AS selected(code)
        WHERE EXISTS (
          SELECT 1
          FROM dadata_result d
          WHERE (d.status = 'ACTIVE' OR d.status = 'REORGANIZING')
            ${geoSql}
            ${industrySql}
            AND (
              TRIM(d.main_okved) = selected.code
              ${extraOkvedSql}
            )
        )
      `,
      queryParams,
    );
    const availableCodes = new Set(companyRows.map((row) => String(row.code ?? '').trim()));
    return rows.filter((row) => availableCodes.has(String(row.okved_code ?? '').trim()));
  } catch (error) {
    console.warn('/api/okved: failed to filter okved items by companies', error);
    return rows;
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth({ requireWorker: true });
    if (!auth.ok) return auth.response;


    const { searchParams } = new URL(req.url);
    const industryId = Number(searchParams.get('industryId') || '');
    const prodclassId = Number(searchParams.get('prodclassId') || '');
    const onlyWithCompanies = searchParams.get('onlyWithCompanies') === '1';
    const onlyWithGeo = searchParams.get('onlyWithGeo') === '1';
    const mainOkvedOnly = searchParams.get('mainOkvedOnly') !== '0';
    let industryRoots: string[] | undefined;

    let rows: OkvedItem[] = [];
    if (Number.isFinite(prodclassId) && prodclassId > 0) {
      const res = await db.query<OkvedItem>(SQL_BY_PRODCLASS, [prodclassId]);
      rows = res.rows;
      if (Number.isFinite(industryId) && industryId > 0) {
        industryRoots = await getOkvedRootsForIndustry(industryId);
      }
    } else if (Number.isFinite(industryId) && industryId > 0) {
      const res = await db.query<OkvedItem>(SQL_BY_INDUSTRY_PRODCLASSES, [industryId]).catch(() =>
        db.query<OkvedItem>(SQL_BY_INDUSTRY, [industryId]),
      );
      rows = res.rows;
      industryRoots = await getOkvedRootsForIndustry(industryId);
    } else {
      const res = await db.query<OkvedItem>(SQL_ALL);
      rows = res.rows;
    }

    if (onlyWithCompanies) {
      rows = await filterOkvedItemsByCompanies(rows, { mainOkvedOnly, onlyWithGeo, industryRoots });
    }

    return NextResponse.json({ items: rows });
  } catch (e: any) {
    console.error('/api/okved error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

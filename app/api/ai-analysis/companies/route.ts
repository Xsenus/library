import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { db } from '@/lib/db';
import {
  aiCompanyAnalysisQuerySchema,
  okvedCompanySchema,
} from '@/lib/validators';
import { getAiIntegrationHealth } from '@/lib/ai-integration';
import { refreshCompanyContacts } from '@/lib/company-contacts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

const rootsCache = new Map<number, { roots: string[]; ts: number }>();
const ROOTS_TTL_MS = 10 * 60 * 1000;

async function getOkvedRootsForIndustry(industryId: number): Promise<string[]> {
  const now = Date.now();
  const cached = rootsCache.get(industryId);
  if (cached && now - cached.ts < ROOTS_TTL_MS) return cached.roots;

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

type OptionalColumnSpec = {
  alias: string;
  candidates: string[];
  fallback: string;
};

const OPTIONAL_COLUMNS: OptionalColumnSpec[] = [
  { alias: 'sites', candidates: ['sites', 'site_urls', 'domains', 'site_list'], fallback: 'NULL::jsonb' },
  { alias: 'emails', candidates: ['emails', 'email_list', 'contacts_email'], fallback: 'NULL::jsonb' },
  { alias: 'analysis_status', candidates: ['analysis_status', 'analysis_state', 'analysis_stage'], fallback: 'NULL::text' },
  { alias: 'analysis_outcome', candidates: ['analysis_outcome', 'analysis_result', 'analysis_summary'], fallback: 'NULL::text' },
  { alias: 'analysis_progress', candidates: ['analysis_progress', 'analysis_percent', 'analysis_ratio'], fallback: 'NULL::numeric' },
  {
    alias: 'analysis_started_at',
    candidates: ['analysis_started_at', 'analysis_last_start', 'analysis_last_started_at'],
    fallback: 'NULL::timestamptz',
  },
  {
    alias: 'analysis_finished_at',
    candidates: ['analysis_finished_at', 'analysis_last_finish', 'analysis_last_finished_at'],
    fallback: 'NULL::timestamptz',
  },
  {
    alias: 'analysis_duration_ms',
    candidates: ['analysis_duration_ms', 'analysis_last_duration_ms', 'analysis_duration'],
    fallback: 'NULL::bigint',
  },
  { alias: 'analysis_attempts', candidates: ['analysis_attempts', 'analysis_retry_count'], fallback: 'NULL::int' },
  { alias: 'analysis_score', candidates: ['analysis_score', 'company_score'], fallback: 'NULL::numeric' },
  { alias: 'analysis_ok', candidates: ['analysis_ok'], fallback: 'NULL::int' },
  { alias: 'server_error', candidates: ['server_error', 'analysis_server_error'], fallback: 'NULL::int' },
  { alias: 'no_valid_site', candidates: ['no_valid_site', 'analysis_no_valid_site'], fallback: 'NULL::int' },
  { alias: 'analysis_domain', candidates: ['analysis_domain', 'domain_for_parsing', 'analysis_crawl_domain'], fallback: 'NULL::text' },
  { alias: 'analysis_match_level', candidates: ['analysis_match_level', 'match_level'], fallback: 'NULL::text' },
  { alias: 'analysis_class', candidates: ['analysis_class', 'analysis_found_class'], fallback: 'NULL::text' },
  {
    alias: 'analysis_equipment',
    candidates: ['analysis_equipment', 'top_equipment', 'analysis_top_equipment'],
    fallback: 'NULL::jsonb',
  },
  {
    alias: 'description_score',
    candidates: ['description_score', 'analysis_description_score', 'description_similarity'],
    fallback: 'NULL::numeric',
  },
  {
    alias: 'okved_score',
    candidates: ['okved_score', 'analysis_okved_score', 'okved_similarity'],
    fallback: 'NULL::numeric',
  },
  {
    alias: 'prodclass_by_okved',
    candidates: ['prodclass_by_okved', 'analysis_prodclass_by_okved', 'prodclass_by_okved_score'],
    fallback: 'NULL::int',
  },
  { alias: 'main_okved', candidates: ['main_okved', 'primary_okved'], fallback: 'NULL::text' },
  { alias: 'analysis_okved_match', candidates: ['analysis_okved_match', 'okved_match'], fallback: 'NULL::text' },
  {
    alias: 'analysis_description',
    candidates: ['analysis_description', 'site_description', 'ai_description'],
    fallback: 'NULL::text',
  },
  {
    alias: 'description_okved_score',
    candidates: ['description_okved_score', 'analysis_description_okved_score', 'description_okved_match'],
    fallback: 'NULL::numeric',
  },
  { alias: 'analysis_tnved', candidates: ['analysis_tnved', 'tnved_products', 'analysis_products'], fallback: 'NULL::jsonb' },
  {
    alias: 'analysis_info',
    candidates: ['analysis_info', 'analysis_payload', 'analysis_details', 'analysis_meta'],
    fallback: 'NULL::jsonb',
  },
  { alias: 'analysis_pipeline', candidates: ['analysis_pipeline', 'analysis_step', 'analysis_process'], fallback: 'NULL::text' },
];

const CONTACTS_MAX_AGE_MINUTES = 24 * 60;

let cachedColumns: { names: Set<string>; ts: number } | null = null;
const COL_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedQueueCheck: { available: boolean; ts: number } | null = null;
const QUEUE_CACHE_TTL_MS = 5 * 60 * 1000;
const QUEUE_STALE_MS = 120 * 60 * 1000;
const QUEUE_STALE_INTERVAL = `${QUEUE_STALE_MS / 1000 / 60} minutes`;

let cachedEquipmentCols: { names: Set<string>; available: boolean; tableName: string | null; ts: number } | null = null;
const EQUIPMENT_CACHE_TTL_MS = 5 * 60 * 1000;

type TableMetaCache = { names: Set<string>; available: boolean; tableName: string | null; ts: number };
const TABLE_CACHE_TTL_MS = 5 * 60 * 1000;
const tableCache = new Map<string, TableMetaCache>();

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function findTableName(
  table: string,
  { schema = 'public', connection = db }: { schema?: string; connection?: typeof db } = {},
): Promise<string | null> {
  try {
    const { rows } = await connection.query<{ table_name: string }>(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1 AND lower(table_name) = lower($2)
        LIMIT 1
      `,
      [schema, table],
    );

    return rows?.[0]?.table_name ?? null;
  } catch (error) {
    console.warn(`Failed to resolve table name for ${schema}.${table}`, error);
    return null;
  }
}

async function isQueueTableAvailable(): Promise<boolean> {
  const now = Date.now();
  if (cachedQueueCheck && now - cachedQueueCheck.ts < QUEUE_CACHE_TTL_MS) {
    return cachedQueueCheck.available;
  }
  try {
    const res = await dbBitrix.query<{ exists: boolean }>(
      "SELECT to_regclass('public.ai_analysis_queue') IS NOT NULL AS exists",
    );
    const available = !!res.rows?.[0]?.exists;
    cachedQueueCheck = { available, ts: now };
    return available;
  } catch (error) {
    console.warn('ai_analysis_queue availability check failed:', error);
    cachedQueueCheck = { available: false, ts: now };
    return false;
  }
}

async function getEquipmentColumns(): Promise<{ names: Set<string>; available: boolean; tableName: string | null }> {
  const now = Date.now();
  if (cachedEquipmentCols && now - cachedEquipmentCols.ts < EQUIPMENT_CACHE_TTL_MS) {
    return {
      names: cachedEquipmentCols.names,
      available: cachedEquipmentCols.available,
      tableName: cachedEquipmentCols.tableName,
    };
  }

  try {
    const resolvedName = await findTableName('equipment_all');
    if (!resolvedName) {
      cachedEquipmentCols = { names: new Set(), available: false, tableName: null, ts: now };
      return { names: new Set(), available: false, tableName: null };
    }

    const existsRes = await db.query<{ exists: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS exists`,
      [`public.${quoteIdent(resolvedName)}`],
    );
    const available = !!existsRes.rows?.[0]?.exists;
    if (!available) {
      cachedEquipmentCols = { names: new Set(), available, tableName: resolvedName, ts: now };
      return { names: new Set(), available, tableName: resolvedName };
    }

    const { rows } = await db.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `,
      [resolvedName],
    );

    const names = new Set(rows.map((r) => r.column_name));
    cachedEquipmentCols = { names, available: true, tableName: resolvedName, ts: now };
    return { names, available: true, tableName: resolvedName };
  } catch (error) {
    console.warn('Failed to load equipment_all metadata', error);
    cachedEquipmentCols = { names: new Set(), available: false, tableName: null, ts: now };
    return { names: new Set(), available: false, tableName: null };
  }
}

async function getTableColumns(
  table: string,
  { schema = 'public', connection = db, ttlMs = TABLE_CACHE_TTL_MS }: { schema?: string; connection?: typeof db; ttlMs?: number } = {},
): Promise<{ names: Set<string>; available: boolean; tableName: string | null }> {
  const key = `${schema}.${table}`;
  const now = Date.now();
  const cached = tableCache.get(key);
  if (cached && now - cached.ts < ttlMs) {
    return { names: cached.names, available: cached.available, tableName: cached.tableName };
  }

  const resolvedName = await findTableName(table, { schema, connection });

  if (!resolvedName) {
    const names = new Set<string>();
    tableCache.set(key, { names, available: false, tableName: null, ts: now });
    return { names, available: false, tableName: null };
  }

  try {
    const existsRes = await connection.query<{ exists: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS exists`,
      [`${schema}.${quoteIdent(resolvedName)}`],
    );
    const available = !!existsRes.rows?.[0]?.exists;
    if (!available) {
      const names = new Set<string>();
      tableCache.set(key, { names, available, tableName: resolvedName, ts: now });
      return { names, available, tableName: resolvedName };
    }

    const { rows } = await connection.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
      `,
      [schema, resolvedName],
    );

    const names = new Set(rows.map((r) => r.column_name));
    tableCache.set(key, { names, available: true, tableName: resolvedName, ts: now });
    return { names, available: true, tableName: resolvedName };
  } catch (error) {
    console.warn(`Failed to load metadata for ${schema}.${table}`, error);
    const names = new Set<string>();
    tableCache.set(key, { names, available: false, tableName: resolvedName, ts: now });
    return { names, available: false, tableName: resolvedName };
  }
}

async function getExistingColumns(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedColumns && now - cachedColumns.ts < COL_CACHE_TTL_MS) {
    return cachedColumns.names;
  }
  const { rows } = await dbBitrix.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dadata_result'
    `,
  );
  const names = new Set(rows.map((r) => r.column_name));
  cachedColumns = { names, ts: now };
  return names;
}

type SelectBuild = { sql: string; selected: Map<string, string | null> };

function buildOptionalSelect(existing: Set<string>): SelectBuild {
  const selected = new Map<string, string | null>();
  const parts: string[] = [];

  for (const spec of OPTIONAL_COLUMNS) {
    const found = spec.candidates.find((c) => existing.has(c));
    selected.set(spec.alias, found ?? null);
    const expr = found ? `d.${found}` : spec.fallback;
    parts.push(`${expr} AS ${spec.alias}`);
  }

  return { sql: parts.join(',\n        '), selected };
}

async function getEquipmentByInn(inns: string[]): Promise<Map<string, any[]>> {
  const result = new Map<string, any[]>();
  if (!inns.length) return result;

  const meta = await getEquipmentColumns();
  if (!meta.available || !meta.tableName) return result;

  const idColumn = meta.names.has('company_id') ? 'company_id' : meta.names.has('inn') ? 'inn' : null;
  if (!idColumn) return result;

  const equipmentCol = ['equipment', 'equipment_list', 'equipment_ai', 'equipment_data', 'equipment_json'].find((c) =>
    meta.names.has(c),
  );

  if (!equipmentCol) return result;

  const clientsMeta = await getTableColumns('clients_requests');

  const companyMap = new Map<number, string>();
  if (idColumn === 'company_id') {
    if (!clientsMeta.available || !clientsMeta.names.has('inn') || !clientsMeta.names.has('id')) return result;

    try {
      const orderExpr = clientsMeta.names.has('ended_at')
        ? 'COALESCE(cr.ended_at, cr.created_at) DESC NULLS LAST'
        : clientsMeta.names.has('created_at')
          ? 'cr.created_at DESC NULLS LAST'
          : 'cr.id DESC';

      const { rows } = await db.query<{ inn: string; company_id: number }>(
        `
          SELECT DISTINCT ON (cr.inn) cr.inn, cr.id AS company_id
          FROM clients_requests cr
          WHERE cr.inn = ANY($1::text[])
          ORDER BY cr.inn, ${orderExpr}
        `,
        [inns],
      );

      for (const row of rows) {
        if (row.company_id && row.inn) {
          companyMap.set(row.company_id, row.inn);
        }
      }
    } catch (error) {
      console.warn('Failed to load company_id for equipment_all lookup', error);
      return result;
    }

    if (!companyMap.size) return result;
  }

  try {
    const args =
      idColumn === 'company_id'
        ? [Array.from(companyMap.keys())]
        : [inns.map((inn) => (inn == null ? null : String(inn)))];

    const { rows } = await db.query<{ inn: string | number; equipment: any }>(
      `SELECT ${idColumn} AS inn, ${equipmentCol} AS equipment FROM ${quoteIdent(meta.tableName)} WHERE ${idColumn} = ANY($1::${
        idColumn === 'company_id' ? 'int' : 'text'
      }[])`,
      args,
    );

    for (const row of rows) {
      const inn = idColumn === 'company_id' ? companyMap.get(row.inn as number) : (row.inn as string);
      if (!inn) continue;
      const parsed = normalizeEquipment(row.equipment);
      if (parsed.length) {
        result.set(inn, parsed);
      }
    }
  } catch (error) {
    console.warn('Failed to load equipment_all data', error);
  }

  return result;
}

type SiteAnalyzerFallback = {
  parsId: number | null;
  companyId: number | null;
  description: string | null;
  domains: string[];
  prodclass: number | string | null;
  prodclassScore: number | null;
  descriptionScore: number | null;
  okvedScore: number | null;
  descriptionOkvedScore: number | null;
  prodclassByOkved: number | null;
  goods: any[];
  equipment: any[];
};

async function loadSiteAnalyzerFallbacks(inns: string[]): Promise<Map<string, SiteAnalyzerFallback>> {
  const result = new Map<string, SiteAnalyzerFallback>();
  if (!inns.length) return result;

  const clientsMeta = await getTableColumns('clients_requests');
  const parsMeta = await getTableColumns('pars_site');
  const prodclassMeta = await getTableColumns('ai_site_prodclass');
  const goodsMetaCandidates = [await getTableColumns('ai_site_goods_types'), await getTableColumns('goods_type')];
  const goodsMeta = goodsMetaCandidates.find((meta) => meta.available) ?? goodsMetaCandidates[0];
  const equipmentMeta = await getTableColumns('ai_site_equipment');
  const openAiMeta = await getTableColumns('ai_site_openai_responses');

  if (!clientsMeta.available || !parsMeta.available) return result;
  if (!clientsMeta.names.has('id') || !clientsMeta.names.has('inn')) return result;
  if (!parsMeta.names.has('company_id') || !parsMeta.names.has('id')) return result;

  const descriptionExpr = parsMeta.names.has('description') ? 'ps.description' : 'NULL::text';
  const domain1Expr = parsMeta.names.has('domain_1') ? 'ps.domain_1' : 'NULL::text';
  const domain2Expr = parsMeta.names.has('domain_2') ? 'ps.domain_2' : 'NULL::text';
  const urlExpr = parsMeta.names.has('url') ? 'ps.url' : 'NULL::text';
  const createdExpr = parsMeta.names.has('created_at') ? 'ps.created_at DESC NULLS LAST,' : '';
  const site1DescriptionExpr = clientsMeta.names.has('site_1_description')
    ? 'im.site_1_description'
    : 'NULL::text AS site_1_description';
  const site2DescriptionExpr = clientsMeta.names.has('site_2_description')
    ? 'im.site_2_description'
    : 'NULL::text AS site_2_description';
  const goodsExpr = clientsMeta.names.has('goods')
    ? 'im.goods'
    : clientsMeta.names.has('goods_list')
      ? 'im.goods_list'
      : clientsMeta.names.has('products')
        ? 'im.products'
        : 'NULL::text';
  const equipmentExpr = clientsMeta.names.has('equipment')
    ? 'im.equipment'
    : clientsMeta.names.has('equipment_list')
      ? 'im.equipment_list'
      : clientsMeta.names.has('equipments')
        ? 'im.equipments'
        : 'NULL::text';

  let parsRows: {
    inn: string;
    company_id: number | null;
    pars_id: number | null;
    description: any;
    domain_1: any;
    domain_2: any;
    url: any;
    site_1_description: any;
    site_2_description: any;
    goods_manual: any;
    equipment_manual: any;
  }[] = [];
  try {
    const { rows } = await db.query(
      `
          WITH inn_map AS (
            SELECT
              inn,
              id AS company_id,
              ${clientsMeta.names.has('site_1_description') ? 'site_1_description' : 'NULL::text AS site_1_description'},
              ${clientsMeta.names.has('site_2_description') ? 'site_2_description' : 'NULL::text AS site_2_description'},
              ${clientsMeta.names.has('domain_1') ? 'domain_1' : 'NULL::text AS domain_1'},
              ${clientsMeta.names.has('domain_2') ? 'domain_2' : 'NULL::text AS domain_2'},
              ${goodsExpr},
              ${equipmentExpr}
            FROM clients_requests
            WHERE inn = ANY($1::text[])
          )
          SELECT DISTINCT ON (im.inn)
            im.inn,
          im.company_id,
          ps.id AS pars_id,
          ${descriptionExpr} AS description,
            COALESCE(${domain1Expr}, im.domain_1) AS domain_1,
            COALESCE(${domain2Expr}, im.domain_2) AS domain_2,
            ${urlExpr} AS url,
            ${site1DescriptionExpr},
            ${site2DescriptionExpr},
            ${goodsExpr} AS goods_manual,
            ${equipmentExpr} AS equipment_manual
          FROM inn_map im
          LEFT JOIN pars_site ps ON ps.company_id = im.company_id
          ORDER BY im.inn, ${createdExpr} ps.id DESC
        `,
        [inns],
    );
    parsRows = rows as any;
  } catch (error) {
    console.warn('Failed to load pars_site data', error);
    return result;
  }

  if (!parsRows.length) return result;

  const parsIds = parsRows.map((row) => row.pars_id).filter((id) => typeof id === 'number');
  const companyIds = parsRows.map((row) => row.company_id).filter((id) => typeof id === 'number');

  const parseArray = (val: any): any[] => {
    const parsed = parseJson(val);
    return Array.isArray(parsed) ? parsed : [];
  };

  const mapGoodsList = (raw: any): any[] =>
    parseArray(raw).reduce<any[]>((acc, item) => {
      if (!item) return acc;
      if (typeof item === 'string') {
        acc.push({ name: item });
        return acc;
      }

      if (typeof item === 'object') {
        const name =
          parseString((item as any).goods_type) ||
          parseString((item as any).goods) ||
          parseString((item as any).name) ||
          parseString((item as any).title);
        const id =
          parseNumber((item as any).goods_type_id) ??
          parseNumber((item as any).match_id) ??
          parseNumber((item as any).id) ??
          parseNumber((item as any).code);
        const score =
          parseNumber((item as any).goods_types_score) ??
          parseNumber((item as any).score) ??
          parseNumber((item as any).match_score);

        if (!name && id == null) return acc;
        acc.push({ name: name || (id != null ? String(id) : '—'), id, score, text_vector: (item as any).text_vector ?? null });
        return acc;
      }

      acc.push({ name: String(item) });
      return acc;
    }, []);

  const mapEquipmentList = (raw: any): any[] =>
    parseArray(raw).reduce<any[]>((acc, item) => {
      if (!item) return acc;
      if (typeof item === 'string') {
        acc.push({ name: item });
        return acc;
      }

      if (typeof item === 'object') {
        const name =
          parseString((item as any).equipment) ||
          parseString((item as any).equipment_site) ||
          parseString((item as any).name) ||
          parseString((item as any).title);
        const id =
          parseNumber((item as any).equipment_id) ??
          parseNumber((item as any).match_id) ??
          parseNumber((item as any).id) ??
          parseNumber((item as any).code);
        const score =
          parseNumber((item as any).equipment_score) ??
          parseNumber((item as any).score) ??
          parseNumber((item as any).match_score);

        if (!name && id == null) return acc;
        acc.push({ name: name || (id != null ? String(id) : '—'), id, score, text_vector: (item as any).text_vector ?? null });
        return acc;
      }

      acc.push({ name: String(item) });
      return acc;
    }, []);

  const openAiMap = new Map<string, any>();
  if (openAiMeta.available && (openAiMeta.names.has('text_pars_id') || openAiMeta.names.has('company_id'))) {
    try {
      const openAiCols = [
        openAiMeta.names.has('text_pars_id') ? 'text_pars_id' : null,
        openAiMeta.names.has('company_id') ? 'company_id' : null,
        openAiMeta.names.has('description') ? 'description' : null,
        openAiMeta.names.has('description_score') ? 'description_score' : null,
        openAiMeta.names.has('description_okved_score') ? 'description_okved_score' : null,
        openAiMeta.names.has('okved_score') ? 'okved_score' : null,
        openAiMeta.names.has('prodclass') ? 'prodclass' : null,
        openAiMeta.names.has('prodclass_score') ? 'prodclass_score' : null,
        openAiMeta.names.has('prodclass_by_okved') ? 'prodclass_by_okved' : null,
        openAiMeta.names.has('equipment_site') ? 'equipment_site' : null,
        openAiMeta.names.has('equipment') ? 'equipment' : null,
        openAiMeta.names.has('goods') ? 'goods' : null,
        openAiMeta.names.has('goods_type') ? 'goods_type' : null,
      ].filter(Boolean) as string[];

      if (openAiCols.filter(Boolean).length > 0) {
        const orderExpr = openAiMeta.names.has('created_at')
          ? 'created_at DESC NULLS LAST'
          : openAiMeta.names.has('id')
            ? 'id DESC'
            : openAiMeta.names.has('text_pars_id')
              ? 'text_pars_id'
              : 'company_id';

        const predicates: string[] = [];
        const params: any[] = [];

        if (openAiMeta.names.has('text_pars_id') && parsIds.length) {
          params.push(parsIds);
          predicates.push(`text_pars_id = ANY($${params.length}::int[])`);
        }

        if (openAiMeta.names.has('company_id') && companyIds.length) {
          params.push(companyIds);
          predicates.push(`company_id = ANY($${params.length}::int[])`);
        }

        if (predicates.length) {
          const { rows } = await db.query(
            `
              SELECT DISTINCT ON (${openAiMeta.names.has('text_pars_id') ? 'text_pars_id' : 'company_id'})
                ${openAiCols.filter(Boolean).join(',\n              ')}
              FROM ai_site_openai_responses
              WHERE ${predicates.join(' OR ')}
              ORDER BY ${openAiMeta.names.has('text_pars_id') ? 'text_pars_id' : 'company_id'}, ${orderExpr}
            `,
            params,
          );

          for (const row of rows as any[]) {
            const key =
              row.text_pars_id != null
                ? `p:${row.text_pars_id}`
                : row.company_id != null
                  ? `c:${row.company_id}`
                  : null;
            if (!key) continue;
            openAiMap.set(key, row);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load ai_site_openai_responses data', error);
    }
  }

  const prodclassMap = new Map<string, any>();
  if (prodclassMeta.available && (prodclassMeta.names.has('text_pars_id') || prodclassMeta.names.has('company_id'))) {
    try {
      const prodclassCols = [
        prodclassMeta.names.has('text_pars_id') ? 'text_pars_id' : null,
        prodclassMeta.names.has('company_id') ? 'company_id' : null,
        prodclassMeta.names.has('prodclass') ? 'prodclass' : null,
        prodclassMeta.names.has('prodclass_score') ? 'prodclass_score' : null,
        prodclassMeta.names.has('description_score') ? 'description_score' : null,
        prodclassMeta.names.has('okved_score') ? 'okved_score' : null,
        prodclassMeta.names.has('description_okved_score') ? 'description_okved_score' : null,
        prodclassMeta.names.has('prodclass_by_okved') ? 'prodclass_by_okved' : null,
      ].filter(Boolean) as string[];

      if (prodclassCols.length) {
        const predicates: string[] = [];
        const params: any[] = [];

        if (prodclassMeta.names.has('text_pars_id') && parsIds.length) {
          params.push(parsIds);
          predicates.push(`text_pars_id = ANY($${params.length}::int[])`);
        }

        if (prodclassMeta.names.has('company_id') && companyIds.length) {
          params.push(companyIds);
          predicates.push(`company_id = ANY($${params.length}::int[])`);
        }

        if (predicates.length) {
          const { rows } = await db.query(
            `
              SELECT DISTINCT ON (${prodclassMeta.names.has('text_pars_id') ? 'text_pars_id' : 'company_id'})
                ${prodclassCols.join(',\n                ')}
              FROM ai_site_prodclass
              WHERE ${predicates.join(' OR ')}
              ORDER BY ${prodclassMeta.names.has('text_pars_id') ? 'text_pars_id' : 'company_id'}, id DESC
            `,
            params,
          );
          for (const row of rows as any[]) {
            const key =
              row.text_pars_id != null
                ? `p:${row.text_pars_id}`
                : row.company_id != null
                  ? `c:${row.company_id}`
                  : null;
            if (!key) continue;
            prodclassMap.set(key, row);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load ai_site_prodclass data', error);
    }
  }

  const goodsMap = new Map<string, any[]>();
  if (
    goodsMeta.available &&
    goodsMeta.tableName &&
    (goodsMeta.names.has('text_par_id') || goodsMeta.names.has('company_id'))
  ) {
    try {
      const goodsCols = [
        goodsMeta.names.has('goods_type') ? 'goods_type' : null,
        goodsMeta.names.has('goods_type_id') ? 'goods_type_id' : null,
        goodsMeta.names.has('match_id') ? 'match_id' : null,
        goodsMeta.names.has('goods_types_score') ? 'goods_types_score' : null,
        goodsMeta.names.has('text_vector') ? 'text_vector' : null,
        goodsMeta.names.has('text_par_id') ? 'text_par_id' : null,
        goodsMeta.names.has('company_id') ? 'company_id' : null,
      ].filter(Boolean) as string[];

      const predicates: string[] = [];
      const params: any[] = [];

      if (goodsMeta.names.has('text_par_id') && parsIds.length) {
        params.push(parsIds);
        predicates.push(`text_par_id = ANY($${params.length}::int[])`);
      }

      if (goodsMeta.names.has('company_id') && companyIds.length) {
        params.push(companyIds);
        predicates.push(`company_id = ANY($${params.length}::int[])`);
      }

      if (predicates.length) {
        const { rows } = await db.query(
          `
            SELECT ${goodsCols.join(',\n                   ')}
            FROM ${quoteIdent(goodsMeta.tableName)}
            WHERE ${predicates.join(' OR ')}
          `,
          params,
        );

        for (const row of rows as any[]) {
          const key =
            row.text_par_id != null
              ? `p:${row.text_par_id}`
              : row.company_id != null
                ? `c:${row.company_id}`
                : null;
          if (!key) continue;
          const current = goodsMap.get(key) ?? [];
          current.push(row);
          goodsMap.set(key, current);
        }
      }
    } catch (error) {
      console.warn('Failed to load ai_site_goods_types data', error);
    }
  }

  const equipmentMap = new Map<string, any[]>();
  if (
    equipmentMeta.available &&
    equipmentMeta.tableName &&
    (equipmentMeta.names.has('text_par_id') || equipmentMeta.names.has('company_id'))
  ) {
    try {
      const equipmentCols = [
        equipmentMeta.names.has('equipment') ? 'equipment' : null,
        equipmentMeta.names.has('equipment_id') ? 'equipment_id' : null,
        equipmentMeta.names.has('match_id') ? 'match_id' : null,
        equipmentMeta.names.has('equipment_score') ? 'equipment_score' : null,
        equipmentMeta.names.has('text_vector') ? 'text_vector' : null,
        equipmentMeta.names.has('text_par_id') ? 'text_par_id' : null,
        equipmentMeta.names.has('company_id') ? 'company_id' : null,
      ].filter(Boolean) as string[];

      const predicates: string[] = [];
      const params: any[] = [];

      if (equipmentMeta.names.has('text_par_id') && parsIds.length) {
        params.push(parsIds);
        predicates.push(`text_par_id = ANY($${params.length}::int[])`);
      }

      if (equipmentMeta.names.has('company_id') && companyIds.length) {
        params.push(companyIds);
        predicates.push(`company_id = ANY($${params.length}::int[])`);
      }

      if (predicates.length) {
        const { rows } = await db.query(
          `
            SELECT ${equipmentCols.join(',\n                   ')}
            FROM ${quoteIdent(equipmentMeta.tableName)}
            WHERE ${predicates.join(' OR ')}
          `,
          params,
        );

        for (const row of rows as any[]) {
          const key =
            row.text_par_id != null
              ? `p:${row.text_par_id}`
              : row.company_id != null
                ? `c:${row.company_id}`
                : null;
          if (!key) continue;
          const current = equipmentMap.get(key) ?? [];
          current.push(row);
          equipmentMap.set(key, current);
        }
      }
    } catch (error) {
      console.warn('Failed to load ai_site_equipment data', error);
    }
  }

  for (const row of parsRows) {
    const manualGoods = parseLooseList(row.goods_manual);
    const manualEquipment = parseLooseList(row.equipment_manual);
    const domains = [row.domain_1, row.domain_2, row.url]
      .map((d) => parseString(d))
      .filter((d): d is string => !!d);

    const prodclassRow =
      prodclassMap.get(`p:${row.pars_id}`) ?? prodclassMap.get(`c:${row.company_id}`) ?? {};
    const goodsRows = goodsMap.get(`p:${row.pars_id}`) ?? goodsMap.get(`c:${row.company_id}`) ?? [];
    const equipmentRows =
      equipmentMap.get(`p:${row.pars_id}`) ?? equipmentMap.get(`c:${row.company_id}`) ?? [];
    const openAiRow = openAiMap.get(`p:${row.pars_id}`) ?? openAiMap.get(`c:${row.company_id}`) ?? {};

    const fallbackGoods = goodsRows.length
      ? goodsRows
      : [
          ...mapGoodsList((openAiRow as any).goods),
          ...mapGoodsList((openAiRow as any).goods_type),
          ...(manualGoods ?? []).map((name) => ({ name })),
        ];

    const fallbackEquipment = equipmentRows.length
      ? equipmentRows
      : [
          ...mapEquipmentList((openAiRow as any).equipment),
          ...mapEquipmentList((openAiRow as any).equipment_site),
          ...(manualEquipment ?? []).map((name) => ({ name })),
        ];

    const fallback: SiteAnalyzerFallback = {
      parsId: row.pars_id ?? null,
      companyId: row.company_id ?? null,
      description:
        parseString(row.description) ||
        parseString(row.site_1_description) ||
        parseString(row.site_2_description) ||
        parseString((openAiRow as any).description),
      domains: Array.from(new Set(domains)),
      prodclass: prodclassRow.prodclass ?? (openAiRow as any).prodclass ?? null,
      prodclassScore: parseNumber(prodclassRow.prodclass_score) ?? parseNumber((openAiRow as any).prodclass_score),
      descriptionScore: parseNumber(prodclassRow.description_score) ?? parseNumber((openAiRow as any).description_score),
      okvedScore: parseNumber(prodclassRow.okved_score) ?? parseNumber((openAiRow as any).okved_score),
      descriptionOkvedScore:
        parseNumber(prodclassRow.description_okved_score) ??
        parseNumber((openAiRow as any).description_okved_score),
      prodclassByOkved:
        parseNumber(prodclassRow.prodclass_by_okved) ?? parseNumber((openAiRow as any).prodclass_by_okved),
      goods: fallbackGoods.map((g) => ({
        name:
          parseString(g.goods_type) ??
          parseString(g.goods_type_id) ??
          parseString(g.match_id) ??
          parseString((g as any).name),
        id: parseNumber(g.goods_type_id) ?? parseNumber(g.match_id) ?? parseNumber((g as any).id),
        score:
          parseNumber(g.goods_types_score) ??
          parseNumber((g as any).score) ??
          parseNumber((g as any).match_score),
        text_vector: g.text_vector ?? null,
      })),
      equipment: fallbackEquipment.map((eq) => ({
        name:
          parseString(eq.equipment) ??
          parseString(eq.equipment_id) ??
          parseString(eq.match_id) ??
          parseString((eq as any).name),
        id: parseNumber(eq.equipment_id) ?? parseNumber(eq.match_id) ?? parseNumber((eq as any).id),
        score:
          parseNumber(eq.equipment_score) ??
          parseNumber((eq as any).score) ??
          parseNumber((eq as any).match_score),
        text_vector: eq.text_vector ?? null,
      })),
    };

    result.set(row.inn, fallback);
  }

  return result;
}

function buildActivitySql(optionalSelect: SelectBuild, queueAvailable: boolean, whereSql: string): string | null {
  const statusCol = optionalSelect.selected.get('analysis_status');
  const progressCol = optionalSelect.selected.get('analysis_progress');
  const startedCol = optionalSelect.selected.get('analysis_started_at');
  const finishedCol = optionalSelect.selected.get('analysis_finished_at');
  const queuedCol = queueAvailable ? 'q.queued_at' : null;

  const runningParts: string[] = [];
  if (statusCol) {
    runningParts.push(`LOWER(COALESCE(d.${statusCol}, '')) SIMILAR TO '%(running|processing|in_progress|starting)%'`);
  }
  if (progressCol) {
    runningParts.push(`COALESCE(d.${progressCol}, 0) > 0 AND COALESCE(d.${progressCol}, 0) < 0.999`);
  }
  if (startedCol) {
    runningParts.push(
      `d.${startedCol} IS NOT NULL AND ${finishedCol ? `d.${finishedCol} IS NULL AND ` : ''}d.${startedCol} > now() - interval '${QUEUE_STALE_INTERVAL}'`,
    );
  }

  const queuedParts: string[] = [];
  if (statusCol) {
    const statusCondition = `LOWER(COALESCE(d.${statusCol}, '')) SIMILAR TO '%(queued|waiting|pending|scheduled)%'`;
    queuedParts.push(
      queuedCol
        ? `${statusCondition} AND ${queuedCol} > now() - interval '${QUEUE_STALE_INTERVAL}'`
        : statusCondition,
    );
  }
  if (queuedCol) {
    queuedParts.push(`${queuedCol} IS NOT NULL AND ${queuedCol} > now() - interval '${QUEUE_STALE_INTERVAL}'`);
    if (startedCol) {
      const finishedCheck = finishedCol ? `(d.${finishedCol} IS NULL OR ${queuedCol} > d.${finishedCol})` : 'TRUE';
      queuedParts.push(`${queuedCol} >= d.${startedCol} AND ${finishedCheck}`);
    }
  }

  if (!runningParts.length && !queuedParts.length) return null;

  const runningSql = runningParts.length ? runningParts.map((part) => `(${part})`).join(' OR ') : 'FALSE';
  const queuedSql = queuedParts.length ? queuedParts.map((part) => `(${part})`).join(' OR ') : 'FALSE';
  const queueJoinSql = queueAvailable ? `\n      LEFT JOIN ai_analysis_queue q ON q.inn = d.inn` : '';

  return `
    SELECT
      COUNT(*) FILTER (WHERE ${runningSql})::int AS running,
      COUNT(*) FILTER (WHERE ${queuedSql})::int AS queued
    FROM dadata_result d${queueJoinSql}
    ${whereSql}
  `;
}

function parseString(val: any): string | null {
  if (val == null) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    return trimmed;
  }
  return String(val ?? '').trim() || null;
}

function parseNumber(val: any): number | null {
  if (val == null) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function parseBooleanInt(val: any): number | null {
  if (val == null) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  if (num === 0) return 0;
  if (num === 1) return 1;
  return num;
}

function parseJson(val: any): any {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return val;
}

function parseStringArray(val: any): string[] | null {
  if (val == null) return null;
  const raw = Array.isArray(val) ? val : parseJson(val);
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const arr = raw
      .map((item) => {
        if (item == null) return null;
        if (typeof item === 'string') return item.trim();
        return String(item ?? '').trim();
      })
      .filter((s): s is string => !!s);
    return arr.length ? Array.from(new Set(arr)) : null;
  }
  if (typeof raw === 'string') {
    const parts = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? Array.from(new Set(parts)) : null;
  }
  return null;
}

function parseLooseList(val: any): string[] | null {
  const parsedArray = parseStringArray(val);
  if (parsedArray?.length) return parsedArray;

  const raw = parseString(val);
  if (!raw) return null;

  const tokens = raw
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);

  return tokens.length ? Array.from(new Set(tokens)) : null;
}

function parsePipeline(val: any): any {
  const raw = parseJson(val);
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    return raw;
  }
  return raw;
}

function parseIso(val: any): string | null {
  if (val == null) return null;
  if (val instanceof Date) return val.toISOString();
  const str = typeof val === 'string' ? val.trim() : String(val ?? '').trim();
  if (!str) return null;
  const dt = new Date(str);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function parseProgress(val: any): number | null {
  const num = parseNumber(val);
  if (num == null) return null;
  if (num > 1 && num <= 100) return Math.round(num) / 100;
  if (num >= 0 && num <= 1) return num;
  return null;
}

function mergeAnalyzerInfo(
  base: any,
  extra: {
    sites: string[] | null;
    description: string | null;
    domain: string | null;
    matchLevel: string | null;
    analysisClass: string | null;
    okvedMatch: string | null;
    equipment: any[];
    tnved: any[];
    descriptionScore: number | null;
    okvedScore: number | null;
    descriptionOkvedScore: number | null;
    prodclassByOkved: number | null;
  },
) {
  const company = base?.company && typeof base.company === 'object' ? { ...base.company } : {};
  const ai = base?.ai && typeof base.ai === 'object' ? { ...base.ai } : {};

  if (!ai.sites && extra.sites?.length) ai.sites = extra.sites;
  if (!ai.products && extra.tnved?.length) ai.products = extra.tnved;
  if (!ai.equipment && extra.equipment?.length) ai.equipment = extra.equipment;

  if (ai.description_score == null && extra.descriptionScore != null) {
    ai.description_score = extra.descriptionScore;
  }

  if (ai.okved_score == null && extra.okvedScore != null) {
    ai.okved_score = extra.okvedScore;
  }

  if (ai.description_okved_score == null && extra.descriptionOkvedScore != null) {
    ai.description_okved_score = extra.descriptionOkvedScore;
  }

  if (ai.prodclass_by_okved == null && extra.prodclassByOkved != null) {
    ai.prodclass_by_okved = extra.prodclassByOkved;
  }

  if (!ai.prodclass && (extra.analysisClass || extra.matchLevel || extra.okvedMatch)) {
    ai.prodclass = {
      name: extra.analysisClass ?? null,
      label: extra.analysisClass ?? null,
      score: extra.descriptionOkvedScore ?? (extra.matchLevel ? parseNumber(extra.matchLevel) : null),
      description_okved_score: extra.descriptionOkvedScore ?? (extra.okvedMatch ? parseNumber(extra.okvedMatch) : null),
      okved_score: extra.okvedScore ?? null,
    };
  } else if (ai.prodclass) {
    if (ai.prodclass.description_okved_score == null && extra.descriptionOkvedScore != null) {
      ai.prodclass.description_okved_score = extra.descriptionOkvedScore;
    }
    if (ai.prodclass.okved_score == null && extra.okvedScore != null) {
      ai.prodclass.okved_score = extra.okvedScore;
    }
    if (ai.prodclass.score == null && (extra.descriptionOkvedScore != null || extra.matchLevel)) {
      ai.prodclass.score =
        extra.descriptionOkvedScore ?? (extra.matchLevel ? parseNumber(extra.matchLevel) : ai.prodclass.score ?? null);
    }
  }

  if (!company.domain1 && extra.description) company.domain1 = extra.description;
  if (!company.domain1_site && extra.domain) company.domain1_site = extra.domain;

  const hasCompany = Object.keys(company).length > 0;
  const hasAi = Object.keys(ai).length > 0;

  if (!hasCompany && !hasAi) return base ?? null;

  return {
    ...base,
    ...(hasCompany ? { company } : {}),
    ...(hasAi ? { ai } : {}),
  };
}

function normalizeEquipment(raw: any): any[] {
  const parsed = parseJson(raw);
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  return [];
}

function normalizeTnved(raw: any): any[] {
  const parsed = parseJson(raw);
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === 'object') return [parsed];
  return [];
}

function ensureDurationMs(duration: any, started: string | null, finished: string | null): number | null {
  const direct = parseNumber(duration);
  if (direct != null) return direct;
  if (started && finished) {
    const startTs = new Date(started).getTime();
    const finishTs = new Date(finished).getTime();
    if (!Number.isNaN(startTs) && !Number.isNaN(finishTs) && finishTs >= startTs) {
      return finishTs - startTs;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const base = aiCompanyAnalysisQuerySchema.parse({
      okved: searchParams.get('okved') ?? undefined,
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
      industryId: searchParams.get('industryId') ?? undefined,
      q: searchParams.get('q') ?? undefined,
      sort: searchParams.get('sort') ?? undefined,
    });

    const statusFilters = Array.from(
      new Set(searchParams.getAll('status').map((s) => s.trim()).filter(Boolean)),
    );

    const includeExtra = searchParams.get('extra') === '1';
    const includeParent = searchParams.get('parent') === '1';

    const q = (base.q ?? '').trim();
    const offset = (base.page - 1) * base.pageSize;

    const existingColumns = await getExistingColumns();
    const optionalSelect = buildOptionalSelect(existingColumns);
    const queueAvailable = await isQueueTableAvailable();
    const integrationHealthPromise = getAiIntegrationHealth();

    const where: string[] = ["(d.status = 'ACTIVE' OR d.status = 'REORGANIZING')"];
    const args: any[] = [];
    let i = 1;

    if (base.okved) {
      if (includeParent) {
        const prefix = base.okved.match(/^\d{2}/)?.[0] ?? '';
        if (!prefix) {
          return NextResponse.json({ items: [], total: 0, page: base.page, pageSize: base.pageSize });
        }

        let cond = `TRIM(d.main_okved) ~ ('^' || $${i} || '(\\.|$)')`;
        args.push(prefix);
        i++;

        if (includeExtra) {
          cond += `
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(d.okveds, '[]'::jsonb)) AS elem(val)
              WHERE
                (
                  jsonb_typeof(elem.val) = 'string' AND TRIM(BOTH '"' FROM elem.val::text) ~ ('^' || $${i} || '(\\.|$)')
                )
                OR (
                  jsonb_typeof(elem.val) = 'object'
                  AND COALESCE(elem.val->>'okved', elem.val->>'code', elem.val->>'okved_code', '') ~ ('^' || $${i} || '(\\.|$)')
                )
            )`;
          args.push(prefix);
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

    const industryIdRaw = base.industryId;
    const industryId = industryIdRaw && /^\d+$/.test(industryIdRaw) ? Number(industryIdRaw) : null;
    if (industryId) {
      const roots = await getOkvedRootsForIndustry(industryId);
      if (roots.length > 0) {
        where.push(`split_part(d.main_okved, '.', 1) = ANY($${i}::text[])`);
        args.push(roots);
        i++;
      } else {
        return NextResponse.json({ items: [], total: 0, page: base.page, pageSize: base.pageSize });
      }
    }

    if (q) {
      where.push(`(d.short_name ILIKE $${i} OR d.inn ILIKE $${i})`);
      args.push(`%${q}%`);
      i++;
    }

    if (statusFilters.length) {
      const conditions: string[] = [];
      if (statusFilters.includes('success') && optionalSelect.selected.get('analysis_ok')) {
        conditions.push('COALESCE(d.analysis_ok, 0) = 1');
      }
      if (statusFilters.includes('server_error') && optionalSelect.selected.get('server_error')) {
        conditions.push('COALESCE(d.server_error, 0) = 1');
      }
      if (statusFilters.includes('no_valid_site') && optionalSelect.selected.get('no_valid_site')) {
        conditions.push('COALESCE(d.no_valid_site, 0) = 1');
      }
      if (conditions.length) {
        where.push(`(${conditions.join(' OR ')})`);
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const orderSql =
      base.sort === 'revenue_asc'
        ? 'ORDER BY d.revenue ASC NULLS LAST, d.inn'
        : 'ORDER BY d.revenue DESC NULLS LAST, d.inn';

    const countSql = `
      SELECT COUNT(*)::int AS cnt
      FROM dadata_result d
      ${whereSql}
    `;

    const activitySql = buildActivitySql(optionalSelect, queueAvailable, whereSql);

    const optionalSql = optionalSelect.sql ? `,\n        ${optionalSelect.sql}` : '';
    const queueSelectSql = queueAvailable ? `,\n        q.queued_at,\n        q.queued_by` : '';
    const queueJoinSql = queueAvailable ? `\n      LEFT JOIN ai_analysis_queue q ON q.inn = d.inn` : '';

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
        "income-3"  AS income_3${optionalSql}${queueSelectSql}
      FROM dadata_result d${queueJoinSql}
      ${whereSql}
      ${orderSql}
      OFFSET $${i} LIMIT $${i + 1}
    `;

    const countPromise = dbBitrix.query(countSql, args);
    const activityPromise = activitySql ? dbBitrix.query(activitySql, args) : Promise.resolve(null);
    const dataPromise = dbBitrix.query(dataSql, [...args, offset, base.pageSize]);

    const [countRes, activityRes, dataRes, integrationHealth] = await Promise.all([
      countPromise,
      activityPromise,
      dataPromise,
      integrationHealthPromise,
    ]);

    const inns = dataRes.rows.map((row: any) => row.inn).filter(Boolean);
    let contactsByInn = new Map<string, { emails?: any; webSites?: any }>();
    let equipmentByInn = new Map<string, any[]>();
    let siteAnalyzerByInn = new Map<string, SiteAnalyzerFallback>();

    if (inns.length) {
      try {
        const { items: contacts } = await refreshCompanyContacts(inns, {
          maxAgeMinutes: CONTACTS_MAX_AGE_MINUTES,
        });

        contactsByInn = new Map(
          contacts.map((item) => [
            item.inn,
            {
              emails: Array.isArray(item.emails) ? item.emails : undefined,
              webSites: Array.isArray(item.webSites) ? item.webSites : undefined,
            },
          ]),
        );
      } catch (error) {
        console.error('Failed to refresh company contacts', error);
      }

      equipmentByInn = await getEquipmentByInn(inns);
      siteAnalyzerByInn = await loadSiteAnalyzerFallbacks(inns);
    }

    const total = countRes.rows?.[0]?.cnt ?? 0;

    const items = dataRes.rows.map((row: any) => {
      const core = okvedCompanySchema.parse(row);
      const contacts = contactsByInn.get(core.inn);
      const siteFallback = siteAnalyzerByInn.get(core.inn);

      const analysisInfo = parseJson(row.analysis_info);

      const startedAt = parseIso(row.analysis_started_at);
      const finishedAt = parseIso(row.analysis_finished_at);
      const durationMs = ensureDurationMs(row.analysis_duration_ms, startedAt, finishedAt);
      const queuedAt = queueAvailable ? parseIso(row.queued_at) : null;
      const queuedBy = queueAvailable ? parseString(row.queued_by) : null;
      const rawStatus = parseString(row.analysis_status);
      const outcome = parseString(row.analysis_outcome);
      const statusLower = rawStatus ? rawStatus.toLowerCase() : '';
      const runningStatus = ['run', 'process', 'progress', 'start'].some((token) =>
        statusLower.includes(token),
      );
      const queueFresh = queuedAt ? Date.now() - Date.parse(queuedAt) < QUEUE_STALE_MS : false;
      const shouldForceQueued =
        queueAvailable && queuedAt && queueFresh && (!finishedAt || queuedAt > finishedAt) && !runningStatus;
      const status = shouldForceQueued ? 'queued' : rawStatus;

      const matchLevel =
        parseString(row.analysis_match_level) ||
        (analysisInfo && parseString((analysisInfo as any)?.match_level)) ||
        (siteFallback?.prodclassScore != null ? String(siteFallback.prodclassScore) : null);
      const analysisClass =
        parseString(row.analysis_class) ||
        (analysisInfo && parseString((analysisInfo as any)?.found_class)) ||
        (siteFallback?.prodclass != null ? parseString(siteFallback.prodclass) : null);
      const description =
        parseString(row.analysis_description) ||
        (analysisInfo && parseString((analysisInfo as any)?.description)) ||
        parseString(siteFallback?.description);
      const descriptionScore =
        parseNumber(row.description_score) ??
        parseNumber((analysisInfo as any)?.description_score) ??
        parseNumber((analysisInfo as any)?.ai?.description_score) ??
        siteFallback?.descriptionScore ?? null;
      const descriptionOkvedScore =
        parseNumber(row.description_okved_score) ??
        parseNumber((analysisInfo as any)?.description_okved_score) ??
        parseNumber((analysisInfo as any)?.ai?.description_okved_score) ??
        siteFallback?.descriptionOkvedScore ?? null;
      const okvedScore =
        parseNumber(row.okved_score) ??
        parseNumber((analysisInfo as any)?.okved_score) ??
        parseNumber((analysisInfo as any)?.ai?.okved_score) ??
        siteFallback?.okvedScore ?? null;
      const okvedMatch =
        parseString(row.analysis_okved_match) ||
        (analysisInfo && parseString((analysisInfo as any)?.okved_match)) ||
        (okvedScore != null ? String(okvedScore) : null) ||
        (descriptionOkvedScore != null ? String(descriptionOkvedScore) : null);
      const prodclassByOkved =
        parseNumber(row.prodclass_by_okved) ??
        parseNumber((analysisInfo as any)?.prodclass_by_okved) ??
        parseNumber((analysisInfo as any)?.ai?.prodclass_by_okved) ??
        siteFallback?.prodclassByOkved ?? null;
      const domain =
        parseString(row.analysis_domain) ||
        (analysisInfo && parseString((analysisInfo as any)?.domain)) ||
        (siteFallback?.domains?.[0] ?? null);

      let equipment = normalizeEquipment(row.analysis_equipment);
      if (!equipment.length) {
        const equipmentFromAux = equipmentByInn.get(core.inn);
        if (equipmentFromAux?.length) {
          equipment = equipmentFromAux;
        } else if (siteFallback?.equipment?.length) {
          equipment = siteFallback.equipment.filter((item) => item && (item.name || item.id));
        }
      }
      let tnved = normalizeTnved(row.analysis_tnved);
      if (!tnved.length && siteFallback?.goods?.length) {
        tnved = siteFallback.goods.filter((item) => item && (item.name || item.id));
      }
      const metaSites = parseStringArray(contacts?.webSites);
      const metaEmails = parseStringArray(contacts?.emails);

      const sites =
        metaSites ||
        parseStringArray(row.sites) ||
        parseStringArray((analysisInfo as any)?.sites) ||
        parseStringArray(row.analysis_domain ? [row.analysis_domain] : null) ||
        (siteFallback?.domains?.length ? siteFallback.domains : null);

      const emails =
        metaEmails ||
        parseStringArray(row.emails) ||
        parseStringArray((analysisInfo as any)?.emails);

      const mergedAnalyzer = mergeAnalyzerInfo(analysisInfo, {
        sites,
        description,
        domain,
        matchLevel,
        analysisClass,
        okvedMatch,
        equipment,
        tnved,
        descriptionScore,
        descriptionOkvedScore,
        okvedScore,
        prodclassByOkved,
      });
      const pipeline = parsePipeline(row.analysis_pipeline || (analysisInfo as any)?.pipeline);

      const score =
        parseNumber(row.analysis_score) ??
        descriptionOkvedScore ??
        parseNumber((analysisInfo as any)?.score) ??
        parseNumber((analysisInfo as any)?.ai?.score) ??
        okvedScore ??
        parseNumber((analysisInfo as any)?.company?.score);

      const progress = parseProgress(row.analysis_progress);

      const attempts =
        parseNumber(row.analysis_attempts) ??
        parseNumber((analysisInfo as any)?.attempts) ??
        parseNumber((analysisInfo as any)?.retry_count);

      const mainOkved =
        parseString(row.main_okved) ||
        parseString((analysisInfo as any)?.main_okved);

      return {
        ...core,
        sites,
        emails,
        analysis_status: status,
        analysis_outcome: outcome,
        analysis_progress: progress,
        analysis_started_at: startedAt,
        analysis_finished_at: finishedAt,
        analysis_duration_ms: durationMs,
        analysis_attempts: attempts,
        analysis_score: score,
        analysis_ok: parseBooleanInt(row.analysis_ok),
        server_error: parseBooleanInt(row.server_error),
        no_valid_site: parseBooleanInt(row.no_valid_site),
        analysis_domain: domain,
        analysis_match_level: matchLevel,
        analysis_class: analysisClass,
        analysis_equipment: equipment,
        description_score: descriptionScore,
        description_okved_score: descriptionOkvedScore,
        okved_score: okvedScore,
        prodclass_by_okved: prodclassByOkved,
        main_okved: mainOkved,
        analysis_okved_match: okvedMatch,
        analysis_description: description,
        analysis_tnved: tnved,
        analysis_info: mergedAnalyzer,
        analysis_pipeline: pipeline,
        queued_at: queuedAt,
        queued_by: queuedBy,
      };
    });

    const activityRow = activityRes?.rows?.[0] ?? null;
    const active = activityRow
      ? {
          running: Number(activityRow.running ?? 0),
          queued: Number(activityRow.queued ?? 0),
          total: Number(activityRow.running ?? 0) + Number(activityRow.queued ?? 0),
        }
      : null;

    const available = {
      analysis_ok: optionalSelect.selected.get('analysis_ok') !== null,
      server_error: optionalSelect.selected.get('server_error') !== null,
      no_valid_site: optionalSelect.selected.get('no_valid_site') !== null,
      analysis_progress: optionalSelect.selected.get('analysis_progress') !== null,
    };

    return NextResponse.json({
      items,
      total,
      page: base.page,
      pageSize: base.pageSize,
      available,
      active,
      integration: integrationHealth,
    });
  } catch (e) {
    console.error('GET /api/ai-analysis/companies error', e);
    return NextResponse.json(
      { items: [], total: 0, page: 1, pageSize: 50, available: {} },
      { status: 500 },
    );
  }
}

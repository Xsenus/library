import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { db } from '@/lib/db';
import {
  aiCompanyAnalysisQuerySchema,
  okvedCompanySchema,
} from '@/lib/validators';
import { getAiIntegrationHealth } from '@/lib/ai-integration';
import { refreshCompanyContacts } from '@/lib/company-contacts';
import {
  extractMeaningfulText,
  normalizeOkvedEntries,
  parseDisplayString,
  stripLargeAnalysisFields,
} from '@/lib/ai-analysis-value-normalizer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

const rootsCache = new Map<number, { roots: string[]; ts: number }>();
const ROOTS_TTL_MS = 10 * 60 * 1000;
let b24MetaAvailableCache: { value: boolean; ts: number } | null = null;
const B24_META_CHECK_TTL_MS = 5 * 60 * 1000;
const GOODS_TEXT_KEYS = ['goods_type', 'goods', 'name', 'title', 'product', 'product_name', 'goods_name', 'label', 'value', 'text'];
const EQUIPMENT_TEXT_KEYS = ['equipment', 'equipment_site', 'equipment_name', 'equipmentId', 'name', 'title', 'label', 'value', 'text'];
const TNVED_TEXT_KEYS = ['name', 'goods_type', 'goods', 'title', 'product', 'product_name', 'goods_name', 'label', 'value', 'text', 'description'];
const TNVED_CODE_KEYS = ['tnved_code', 'goods_type_code', 'tnved', 'code', 'tn_ved', 'tnvedCode'];
const OKVED_FALLBACK_DOMAIN = 'okved-fallback.local';
const OKVED_FALLBACK_SITE_TOKEN = 'okved://fallback';

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

async function isB24MetaAvailable(): Promise<boolean> {
  const now = Date.now();
  if (b24MetaAvailableCache && now - b24MetaAvailableCache.ts < B24_META_CHECK_TTL_MS) {
    return b24MetaAvailableCache.value;
  }

  try {
    const { rows } = await db.query<{ regclass: string | null }>(
      `SELECT to_regclass('public.b24_company_meta') AS regclass`,
    );
    const value = !!rows[0]?.regclass;
    b24MetaAvailableCache = { value, ts: now };
    return value;
  } catch (error) {
    console.warn('Failed to check b24_company_meta existence', error);
    b24MetaAvailableCache = { value: false, ts: now };
    return false;
  }
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
  { alias: 'company_id', candidates: ['company_id'], fallback: 'NULL::int' },
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
  { alias: 'score_source', candidates: ['score_source'], fallback: 'NULL::text' },
  { alias: 'analysis_tnved', candidates: ['analysis_tnved', 'tnved_products', 'analysis_products'], fallback: 'NULL::jsonb' },
  {
    alias: 'analysis_info',
    candidates: ['analysis_info', 'analysis_payload', 'analysis_details', 'analysis_meta'],
    fallback: 'NULL::jsonb',
  },
  { alias: 'analysis_pipeline', candidates: ['analysis_pipeline', 'analysis_step', 'analysis_process'], fallback: 'NULL::text' },
  { alias: 'okveds', candidates: ['okveds', 'okved_list'], fallback: 'NULL::jsonb' },
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

async function getEquipmentColumns({
  connection = db,
}: { connection?: typeof db } = {}): Promise<{
  names: Set<string>;
  available: boolean;
  tableName: string | null;
}> {
  const now = Date.now();
  if (cachedEquipmentCols && now - cachedEquipmentCols.ts < EQUIPMENT_CACHE_TTL_MS) {
    return {
      names: cachedEquipmentCols.names,
      available: cachedEquipmentCols.available,
      tableName: cachedEquipmentCols.tableName,
    };
  }

  try {
    const resolvedName = await findTableName('equipment_all', { connection });
    if (!resolvedName) {
      cachedEquipmentCols = { names: new Set(), available: false, tableName: null, ts: now };
      return { names: new Set(), available: false, tableName: null };
    }

    const existsRes = await connection.query<{ exists: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS exists`,
      [`public.${quoteIdent(resolvedName)}`],
    );
    const available = !!existsRes.rows?.[0]?.exists;
    if (!available) {
      cachedEquipmentCols = { names: new Set(), available, tableName: resolvedName, ts: now };
      return { names: new Set(), available, tableName: resolvedName };
    }

    const { rows } = await connection.query<{ column_name: string }>(
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

type Equipment = {
  id: string;
  equipment_name: string;
  score: number | null;
};

async function getEquipmentByInn(
  inns: string[],
): Promise<Map<string, Equipment[]>> {
  const result = new Map<string, Equipment[]>();
  if (!inns.length) return result;

  try {
    const companyByInn = new Map<string, string>();
    const { rows: companyRows } = await db.query<{ inn: string; id: string | number | null }>(
      `
        SELECT inn, id
        FROM clients_requests
        WHERE inn = ANY($1::text[])
      `,
      [inns],
    );

    for (const row of companyRows) {
      const inn = parseString(row.inn);
      const companyId = parseIdString(row.id);
      if (!inn || !companyId) continue;
      companyByInn.set(inn, companyId);
    }

    const companyIds = Array.from(new Set(companyByInn.values()));
    if (!companyIds.length) return result;

    const { names: equipmentColumns, available, tableName } = await getEquipmentColumns();
    if (!available || !tableName) return result;

    const equipmentColumnsLower = new Map(Array.from(equipmentColumns).map((column) => [column.toLowerCase(), column]));
    const companyIdColumn = equipmentColumnsLower.get('company_id') ?? null;
    const rowBasedColumns: Array<keyof Equipment | 'company_id'> = ['company_id', 'id', 'equipment_name', 'score'];
    const isRowBased = rowBasedColumns.every((column) => equipmentColumnsLower.has(column));

    if (!companyIdColumn) return result;

    const tableSql = `public.${quoteIdent(tableName)}`;
    let rows: Array<Record<string, unknown>> = [];

    if (isRowBased) {
      const queryResult = await db.query<{
        company_id: string | number;
        id: string | number | null;
        equipment_name: string | null;
        score: string | number | null;
      }>(
        `
          SELECT company_id, id, equipment_name, score
          FROM ${tableSql}
          WHERE company_id = ANY($1::bigint[])
          ORDER BY company_id, score DESC NULLS LAST, id DESC
        `,
        [companyIds],
      );
      rows = queryResult.rows;
    } else {
      const legacyJsonColumn = ['equipment_all', 'equipment', 'payload', 'data', 'items']
        .map((column) => equipmentColumnsLower.get(column) ?? null)
        .find(Boolean);
      if (!legacyJsonColumn) return result;

      const queryResult = await db.query<Record<string, unknown>>(
        `
          SELECT ${quoteIdent(companyIdColumn)} AS company_id, ${quoteIdent(legacyJsonColumn)} AS equipment_payload
          FROM ${tableSql}
          WHERE ${quoteIdent(companyIdColumn)} = ANY($1::bigint[])
        `,
        [companyIds],
      );
      rows = queryResult.rows;
    }

    const innByCompanyId = new Map<string, string>();
    companyByInn.forEach((cid, inn) => innByCompanyId.set(cid, inn));

    for (const row of rows) {
      const companyId = parseIdString(row.company_id as string | number | null);
      const inn = companyId ? innByCompanyId.get(companyId) : null;
      if (!inn) continue;

      if (isRowBased) {
        const equipmentName = parseString((row as any).equipment_name);
        const equipmentId = parseIdString((row as any).id);
        if (!equipmentName || !equipmentId) continue;

        const existing = result.get(inn) ?? [];
        existing.push({
          id: equipmentId,
          equipment_name: equipmentName,
          score: parseNumber((row as any).score),
        });
        result.set(inn, existing);
        continue;
      }

      const payloadItems = normalizeEquipment((row as any).equipment_payload);
      if (!payloadItems.length) continue;

      const existing = result.get(inn) ?? [];
      for (const payloadItem of payloadItems) {
        const equipmentName =
          parseString((payloadItem as any).equipment_name) ??
          parseString((payloadItem as any).name) ??
          parseString((payloadItem as any).equipment) ??
          null;
        const equipmentId =
          parseIdString((payloadItem as any).id) ??
          parseIdString((payloadItem as any).equipment_id) ??
          parseIdString((payloadItem as any).equipmentId) ??
          null;
        if (!equipmentName || !equipmentId) continue;
        existing.push({
          id: equipmentId,
          equipment_name: equipmentName,
          score:
            parseNumber((payloadItem as any).score) ??
            parseNumber((payloadItem as any).equipment_score) ??
            null,
        });
      }
      if (existing.length) result.set(inn, existing);
    }

    result.forEach((equipment, inn) => {
      const deduped = dedupeItems(equipment)
        .sort((a, b) => {
          const aScore = parseNumber(a.score);
          const bScore = parseNumber(b.score);
          if (aScore == null && bScore == null) return 0;
          if (aScore == null) return 1;
          if (bScore == null) return -1;
          return bScore - aScore;
        })
        .slice(0, 10);
      result.set(inn, deduped as Equipment[]);
    });
  } catch (error) {
    console.warn('Failed to load equipment_all data', error);
  }

  return result;
}


type SiteAnalyzerFallback = {
  parsId: string | number | null;
  companyId: string | number | null;
  description: string | null;
  domains: string[];
  prodclass: number | string | null;
  prodclassScore: number | null;
  descriptionScore: number | null;
  okvedScore: number | null;
  descriptionOkvedScore: number | null;
  scoreSource: string | null;
  prodclassByOkved: number | null;
  goods: any[];
  equipment: any[];
};

type CompanyCostSummary = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  tokens_total: number;
  cost_total_usd: number;
};

async function loadCompanyCostSummaries(companyIds: string[]): Promise<Map<string, CompanyCostSummary>> {
  const fromCostTable = await loadCompanyCostFromCostTable(companyIds);
  if (fromCostTable.size) return fromCostTable;

  return loadCompanyCostFromOpenAi(companyIds);
}

async function loadCompanyCostFromOpenAi(companyIds: string[]): Promise<Map<string, CompanyCostSummary>> {
  const result = new Map<string, CompanyCostSummary>();
  if (!companyIds.length) return result;

  const openAiMeta = await getTableColumns('ai_site_openai_responses');
  if (!openAiMeta.available || !openAiMeta.names.has('company_id')) return result;

  const inputExpr = openAiMeta.names.has('input_tokens') ? 'COALESCE(SUM(input_tokens), 0)::bigint' : '0::bigint';
  const cachedExpr = openAiMeta.names.has('cached_input_tokens')
    ? 'COALESCE(SUM(cached_input_tokens), 0)::bigint'
    : '0::bigint';
  const outputExpr = openAiMeta.names.has('output_tokens') ? 'COALESCE(SUM(output_tokens), 0)::bigint' : '0::bigint';
  const costExpr = openAiMeta.names.has('cost_usd')
    ? 'COALESCE(SUM(cost_usd), 0)::numeric(12,6)'
    : '0::numeric(12,6)';

  try {
    const { rows } = await db.query<{
      company_id: string | number;
      input_tokens: string | number;
      cached_input_tokens: string | number;
      output_tokens: string | number;
      cost_total_usd: string | number;
    }>(
      `
        SELECT
          company_id,
          ${inputExpr} AS input_tokens,
          ${cachedExpr} AS cached_input_tokens,
          ${outputExpr} AS output_tokens,
          ${costExpr} AS cost_total_usd
        FROM ai_site_openai_responses
        WHERE company_id = ANY($1::bigint[])
        GROUP BY company_id
      `,
      [companyIds],
    );

    for (const row of rows) {
      const companyId = parseIdString(row.company_id);
      if (!companyId) continue;

      const inputTokens = Number(row.input_tokens ?? 0);
      const cachedInputTokens = Number(row.cached_input_tokens ?? 0);
      const outputTokens = Number(row.output_tokens ?? 0);
      const costTotalUsd = Number(row.cost_total_usd ?? 0);
      const tokensTotal = inputTokens + cachedInputTokens + outputTokens;

      result.set(companyId, {
        input_tokens: Number.isFinite(inputTokens) ? inputTokens : 0,
        cached_input_tokens: Number.isFinite(cachedInputTokens) ? cachedInputTokens : 0,
        output_tokens: Number.isFinite(outputTokens) ? outputTokens : 0,
        tokens_total: Number.isFinite(tokensTotal) ? tokensTotal : 0,
        cost_total_usd: Number.isFinite(costTotalUsd) ? costTotalUsd : 0,
      });
    }
  } catch (error) {
    console.warn('Failed to load ai_site_openai_responses cost summary', error);
  }

  return result;
}

async function loadCompanyCostFromCostTable(companyIds: string[]): Promise<Map<string, CompanyCostSummary>> {
  const result = new Map<string, CompanyCostSummary>();
  if (!companyIds.length) return result;

  const costMeta = await getTableColumns('cost');
  if (!costMeta.available || !costMeta.tableName) return result;
  if (!costMeta.names.has('company_id')) return result;

  const orderExpr = costMeta.names.has('created_at')
    ? 'created_at DESC NULLS LAST'
    : costMeta.names.has('id')
      ? 'id DESC'
      : 'company_id';
  const tokensExpr = costMeta.names.has('tokens_total')
    ? 'tokens_total'
    : costMeta.names.has('total_tokens')
      ? 'total_tokens'
      : '0';
  const inputExpr = costMeta.names.has('input_tokens') ? 'input_tokens' : '0';
  const cachedExpr = costMeta.names.has('cached_input_tokens') ? 'cached_input_tokens' : '0';
  const outputExpr = costMeta.names.has('output_tokens') ? 'output_tokens' : '0';
  const costExpr = costMeta.names.has('cost_usd') ? 'cost_usd' : '0';

  try {
    const { rows } = await db.query<{
      company_id: string | number;
      tokens_total: number | string;
      input_tokens: number | string;
      cached_input_tokens: number | string;
      output_tokens: number | string;
      cost_total_usd: number | string;
    }>(
      `
        SELECT DISTINCT ON (company_id)
          company_id,
          COALESCE(${tokensExpr}, 0) AS tokens_total,
          COALESCE(${inputExpr}, 0) AS input_tokens,
          COALESCE(${cachedExpr}, 0) AS cached_input_tokens,
          COALESCE(${outputExpr}, 0) AS output_tokens,
          COALESCE(${costExpr}, 0) AS cost_total_usd
        FROM ${quoteIdent(costMeta.tableName)}
        WHERE company_id = ANY($1::bigint[])
        ORDER BY company_id, ${orderExpr}
      `,
      [companyIds],
    );

    for (const row of rows) {
      const companyId = parseIdString(row.company_id);
      if (!companyId) continue;
      const inputTokens = Number(row.input_tokens ?? 0);
      const cachedInputTokens = Number(row.cached_input_tokens ?? 0);
      const outputTokens = Number(row.output_tokens ?? 0);
      const tokensTotalRaw = Number(row.tokens_total ?? 0);
      const tokensTotal =
        Number.isFinite(tokensTotalRaw) && tokensTotalRaw > 0
          ? tokensTotalRaw
          : (Number.isFinite(inputTokens) ? inputTokens : 0) +
            (Number.isFinite(cachedInputTokens) ? cachedInputTokens : 0) +
            (Number.isFinite(outputTokens) ? outputTokens : 0);
      const costTotalUsd = Number(row.cost_total_usd ?? 0);

      result.set(companyId, {
        input_tokens: Number.isFinite(inputTokens) ? inputTokens : 0,
        cached_input_tokens: Number.isFinite(cachedInputTokens) ? cachedInputTokens : 0,
        output_tokens: Number.isFinite(outputTokens) ? outputTokens : 0,
        tokens_total: Number.isFinite(tokensTotal) ? tokensTotal : 0,
        cost_total_usd: Number.isFinite(costTotalUsd) ? costTotalUsd : 0,
      });
    }
  } catch (error) {
    console.warn('Failed to load cost summary from cost table', error);
  }

  return result;
}

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
  const clientGoodsCols = ['goods', 'goods_list', 'goods_ai', 'products', 'products_list', 'product_list']
    .filter((col) => clientsMeta.names.has(col))
    .map((col) => `cr.${quoteIdent(col)} AS ${quoteIdent(col)}`);
  const clientEquipmentCols = ['equipment', 'equipment_list', 'equipment_ai', 'equipment_name', 'equipmentId']
    .filter((col) => clientsMeta.names.has(col))
    .map((col) => `cr.${quoteIdent(col)} AS ${quoteIdent(col)}`);
  const site1DescriptionExpr = clientsMeta.names.has('site_1_description')
    ? 'im.site_1_description'
    : 'NULL::text AS site_1_description';
  const site2DescriptionExpr = clientsMeta.names.has('site_2_description')
    ? 'im.site_2_description'
    : 'NULL::text AS site_2_description';

  let parsRows: {
    inn: string;
    company_id: string | number | null;
    pars_id: string | number | null;
    description: any;
    domain_1: any;
    domain_2: any;
    url: any;
    site_1_description: any;
    site_2_description: any;
    goods?: any;
    goods_list?: any;
    goods_ai?: any;
    products?: any;
    products_list?: any;
    product_list?: any;
    equipment?: any;
    equipment_list?: any;
    equipment_ai?: any;
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
            ${clientsMeta.names.has('domain_2') ? 'domain_2' : 'NULL::text AS domain_2'}
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
          ${site2DescriptionExpr}${clientGoodsCols.length ? `,
          ${clientGoodsCols.join(',\n          ')}` : ''}${clientEquipmentCols.length ? `,
          ${clientEquipmentCols.join(',\n          ')}` : ''}
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

  // BIGINT из pg может приходить строкой, поэтому ключи/фильтры ведём в string.
  const parsIds = parsRows.map((row) => parseIdString(row.pars_id)).filter((id): id is string => !!id);
  const companyIds = parsRows.map((row) => parseIdString(row.company_id)).filter((id): id is string => !!id);

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
        const name = extractMeaningfulText(item, { preferredKeys: GOODS_TEXT_KEYS });
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
        acc.push({ name: name || (id != null ? String(id) : '—'), id, score });
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
        const name = extractMeaningfulText(item, { preferredKeys: EQUIPMENT_TEXT_KEYS });
        const id =
          parseNumber((item as any).equipment_id) ??
          parseNumber((item as any).equipmentId) ??
          parseNumber((item as any).match_id) ??
          parseNumber((item as any).id) ??
          parseNumber((item as any).code);
        const score =
          parseNumber((item as any).equipment_score) ??
          parseNumber((item as any).score) ??
          parseNumber((item as any).match_score);

        if (!name && id == null) return acc;
        acc.push({ name: name || (id != null ? String(id) : '—'), id, score });
        return acc;
      }

      acc.push({ name: String(item) });
      return acc;
    }, []);

  const openAiMap = new Map<string, any>();
  const domainValues = new Set<string>();
  const urlValues = new Set<string>();
  for (const row of parsRows) {
    const domain1 = parseString(row.domain_1);
    const domain2 = parseString(row.domain_2);
    const url = parseString(row.url);

    if (domain1) domainValues.add(domain1);
    if (domain2) domainValues.add(domain2);
    if (url) {
      urlValues.add(url);
      const normalizedUrlDomain = normalizeDomain(url);
      if (normalizedUrlDomain) domainValues.add(normalizedUrlDomain);
    }
  }

  if (
    openAiMeta.available &&
    (openAiMeta.names.has('text_pars_id') || openAiMeta.names.has('company_id') || openAiMeta.names.has('domain'))
  ) {
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
        openAiMeta.names.has('domain') ? 'domain' : null,
        openAiMeta.names.has('url') ? 'url' : null,
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
          predicates.push(`text_pars_id = ANY($${params.length}::bigint[])`);
        }

        if (openAiMeta.names.has('company_id') && companyIds.length) {
          params.push(companyIds);
          predicates.push(`company_id = ANY($${params.length}::bigint[])`);
        }

        if (openAiMeta.names.has('domain') && domainValues.size) {
          params.push(Array.from(domainValues));
          predicates.push(`domain = ANY($${params.length}::text[])`);
        }

        if (openAiMeta.names.has('url') && urlValues.size) {
          params.push(Array.from(urlValues));
          predicates.push(`url = ANY($${params.length}::text[])`);
        }

        if (predicates.length) {
          const { rows } = await db.query(
            `
              SELECT ${openAiCols.filter(Boolean).join(',\n                     ')}
              FROM ai_site_openai_responses
              WHERE ${predicates.map((p) => `(${p})`).join(' OR ')}
              ORDER BY ${orderExpr}
            `,
            params,
          );

          for (const row of rows as any[]) {
            const keys: (string | null)[] = [];

            if (row.text_pars_id != null) keys.push(`p:${String(row.text_pars_id)}`);
            if (row.company_id != null) keys.push(`c:${String(row.company_id)}`);

            const domainKey = normalizeDomain((row as any).domain);
            if (domainKey) keys.push(`d:${domainKey}`);

            const urlDomainKey = normalizeDomain((row as any).url);
            if (urlDomainKey) keys.push(`d:${urlDomainKey}`);

            for (const key of keys) {
              if (key && !openAiMap.has(key)) {
                openAiMap.set(key, row);
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load ai_site_openai_responses data', error);
    }
  }

  const prodclassMap = new Map<string, any>();
  if (prodclassMeta.available && prodclassMeta.names.has('text_pars_id')) {
    try {
      const prodclassCols = [
        prodclassMeta.names.has('text_pars_id') ? 'text_pars_id' : null,
        prodclassMeta.names.has('prodclass') ? 'prodclass' : null,
        prodclassMeta.names.has('prodclass_score') ? 'prodclass_score' : null,
        prodclassMeta.names.has('description_score') ? 'description_score' : null,
        prodclassMeta.names.has('okved_score') ? 'okved_score' : null,
        prodclassMeta.names.has('description_okved_score') ? 'description_okved_score' : null,
        prodclassMeta.names.has('score_source') ? 'score_source' : null,
        prodclassMeta.names.has('prodclass_by_okved') ? 'prodclass_by_okved' : null,
      ].filter(Boolean) as string[];

      if (prodclassCols.length) {
        const predicates: string[] = [];
        const params: any[] = [];

        if (prodclassMeta.names.has('text_pars_id') && parsIds.length) {
          params.push(parsIds);
          predicates.push(`text_pars_id = ANY($${params.length}::bigint[])`);
        }

        if (predicates.length) {
          const { rows } = await db.query(
            `
              SELECT ${prodclassCols.join(',\n                ')}
              FROM ai_site_prodclass
              WHERE ${predicates.join(' OR ')}
              ORDER BY id DESC
            `,
            params,
          );
          for (const row of rows as any[]) {
            const key = row.text_pars_id != null ? `p:${String(row.text_pars_id)}` : null;
            if (!key || prodclassMap.has(key)) continue;
            prodclassMap.set(key, row);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load ai_site_prodclass data', error);
    }
  }

  const goodsMap = new Map<string, any[]>();
  const goodsTypeIds = new Set<number>();
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
        goodsMeta.names.has('text_par_id') ? 'text_par_id' : null,
        goodsMeta.names.has('company_id') ? 'company_id' : null,
      ].filter(Boolean) as string[];

      const predicates: string[] = [];
      const params: any[] = [];

      if (goodsMeta.names.has('text_par_id') && parsIds.length) {
        params.push(parsIds);
        predicates.push(`text_par_id = ANY($${params.length}::bigint[])`);
      }

      if (goodsMeta.names.has('company_id') && companyIds.length) {
        params.push(companyIds);
        predicates.push(`company_id = ANY($${params.length}::bigint[])`);
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
              ? `p:${String(row.text_par_id)}`
              : row.company_id != null
                ? `c:${String(row.company_id)}`
                : null;
          if (!key) continue;
          const current = goodsMap.get(key) ?? [];
          current.push(row);
          goodsMap.set(key, current);

          const goodsTypeId = parseNumber((row as any).goods_type_id);
          if (goodsTypeId != null) goodsTypeIds.add(goodsTypeId);
        }
      }
    } catch (error) {
      console.warn('Failed to load ai_site_goods_types data', error);
    }
  }

  const goodsTypeMap = new Map<number, { goods_type_name: string | null; goods_type_code: string | null }>();
  if (goodsTypeIds.size) {
    try {
      const { rows } = await db.query<{
        id: number;
        goods_type_code: string | null;
        goods_type_name: string | null;
      }>(
        `
          SELECT id, goods_type_code, goods_type_name
          FROM ib_goods_types
          WHERE id = ANY($1::int[])
        `,
        [Array.from(goodsTypeIds)],
      );

      for (const row of rows) {
        const id = Number(row.id);
        if (!Number.isFinite(id)) continue;
        goodsTypeMap.set(id, {
          goods_type_name: parseString(row.goods_type_name),
          goods_type_code: parseString(row.goods_type_code),
        });
      }
    } catch (error) {
      console.warn('Failed to load ib_goods_types metadata', error);
    }
  }

  const equipmentMap = new Map<string, any[]>();
  const textParCol = equipmentMeta.names.has('text_pars_id')
    ? 'text_pars_id'
    : equipmentMeta.names.has('text_par_id')
      ? 'text_par_id'
      : null;
  if (
    equipmentMeta.available &&
    equipmentMeta.tableName &&
    (textParCol || equipmentMeta.names.has('company_id'))
  ) {
    try {
      const equipmentCols = [
        equipmentMeta.names.has('equipment') ? 'equipment' : null,
        equipmentMeta.names.has('equipment_name') ? 'equipment_name' : null,
        equipmentMeta.names.has('equipment_id') ? 'equipment_id' : null,
        equipmentMeta.names.has('equipmentId') ? 'equipmentId' : null,
        equipmentMeta.names.has('match_id') ? 'match_id' : null,
        equipmentMeta.names.has('equipment_score') ? 'equipment_score' : null,
        textParCol,
        equipmentMeta.names.has('company_id') ? 'company_id' : null,
      ].filter(Boolean) as string[];

      const predicates: string[] = [];
      const params: any[] = [];

      if (textParCol && parsIds.length) {
        params.push(parsIds);
        predicates.push(`${textParCol} = ANY($${params.length}::bigint[])`);
      }

      if (equipmentMeta.names.has('company_id') && companyIds.length) {
        params.push(companyIds);
        predicates.push(`company_id = ANY($${params.length}::bigint[])`);
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
            textParCol && row[textParCol] != null
              ? `p:${String(row[textParCol])}`
              : row.company_id != null
                ? `c:${String(row.company_id)}`
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
    const domains = [row.domain_1, row.domain_2, row.url]
      .map((d) => parseString(d))
      .filter((d): d is string => !!d);

    const prodclassRow = prodclassMap.get(`p:${String(row.pars_id)}`) ?? {};
    const goodsRows = goodsMap.get(`p:${String(row.pars_id)}`) ?? goodsMap.get(`c:${String(row.company_id)}`) ?? [];
    const equipmentRows =
      equipmentMap.get(`p:${String(row.pars_id)}`) ?? equipmentMap.get(`c:${String(row.company_id)}`) ?? [];
    const domainKeys = domains
      .map((d) => normalizeDomain(d))
      .filter((d): d is string => !!d);
    const domainMatch = domainKeys.map((key) => openAiMap.get(`d:${key}`)).find(Boolean);
    const openAiRow =
      openAiMap.get(`p:${String(row.pars_id)}`) ??
      openAiMap.get(`c:${String(row.company_id)}`) ??
      domainMatch ??
      {};

    const clientEquipmentRaw = clientEquipmentCols
      .map((col) => (row as any)[col.replace('cr.', '')])
      .find((val) => val != null);

    const fallbackGoods = goodsRows.length
      ? goodsRows
      : mapGoodsList((openAiRow as any).goods_type);

    const fallbackEquipment = equipmentRows.length
      ? equipmentRows
      : [
          ...mapEquipmentList((openAiRow as any).equipment),
          ...mapEquipmentList((openAiRow as any).equipment_site),
          ...normalizeEquipment(clientEquipmentRaw),
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
      scoreSource: parseString(prodclassRow.score_source) ?? parseString((openAiRow as any).score_source),
      prodclassByOkved:
        parseNumber(prodclassRow.prodclass_by_okved) ?? parseNumber((openAiRow as any).prodclass_by_okved),
      goods: fallbackGoods.map((g) => ({
        id: parseNumber(g.goods_type_id) ?? parseNumber(g.match_id) ?? parseNumber((g as any).id),
        name:
          ((): string | null => {
            const id = parseNumber(g.goods_type_id) ?? parseNumber(g.match_id) ?? parseNumber((g as any).id);
            if (id != null) {
              return goodsTypeMap.get(id)?.goods_type_name ?? null;
            }
            return null;
          })() ??
          extractMeaningfulText(g, { preferredKeys: GOODS_TEXT_KEYS }) ??
          parseString(g.goods_type_id) ??
          parseString(g.match_id),
        tnved_code:
          ((): string | null => {
            const id = parseNumber(g.goods_type_id) ?? parseNumber(g.match_id) ?? parseNumber((g as any).id);
            if (id != null) {
              return goodsTypeMap.get(id)?.goods_type_code ?? null;
            }
            return null;
          })(),
        score:
          parseNumber(g.goods_types_score) ??
          parseNumber((g as any).score) ??
          parseNumber((g as any).match_score),
        source: 'site',
      })),
      equipment: fallbackEquipment.map((eq) => ({
        name:
          extractMeaningfulText(eq, { preferredKeys: EQUIPMENT_TEXT_KEYS }) ??
          parseString(eq.equipment_id) ??
          parseString(eq.match_id),
        id:
          parseNumber(eq.equipment_id) ??
          parseNumber((eq as any).equipmentId) ??
          parseNumber(eq.match_id) ??
          parseNumber((eq as any).id),
        score:
          parseNumber(eq.equipment_score) ??
          parseNumber((eq as any).score) ??
          parseNumber((eq as any).match_score),
        source: 'site',
      })),
    };

    result.set(row.inn, fallback);
  }

  return result;
}

async function loadProdclassNames(ids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (!ids.length) return result;

  try {
    const { rows } = await db.query<{ id: number; prodclass: string }>(
      'SELECT id, prodclass FROM ib_prodclass WHERE id = ANY($1::int[])',
      [ids],
    );

    for (const row of rows) {
      if (row.id != null && row.prodclass) {
        result.set(Number(row.id), row.prodclass);
      }
    }
  } catch (error) {
    console.warn('Failed to load ib_prodclass names', error);
  }

  return result;
}

function buildActivitySql(optionalSelect: SelectBuild, queueAvailable: boolean, whereSql: string): string | null {
  const statusCol = optionalSelect.selected.get('analysis_status');
  const outcomeCol = optionalSelect.selected.get('analysis_outcome');
  const progressCol = optionalSelect.selected.get('analysis_progress');
  const startedCol = optionalSelect.selected.get('analysis_started_at');
  const finishedCol = optionalSelect.selected.get('analysis_finished_at');
  const analysisOkCol = optionalSelect.selected.get('analysis_ok');
  const serverErrorCol = optionalSelect.selected.get('server_error');
  const noValidSiteCol = optionalSelect.selected.get('no_valid_site');
  const queuedCol = queueAvailable ? 'q.queued_at' : null;

  const statusExpr = statusCol ? `LOWER(COALESCE(d.${statusCol}, ''))` : "''";
  const outcomeExpr = outcomeCol ? `LOWER(COALESCE(d.${outcomeCol}, ''))` : "''";
  const finishedExpr = finishedCol ? `d.${finishedCol}` : 'NULL';
  const analysisOkExpr = analysisOkCol ? `COALESCE(d.${analysisOkCol}, 0)` : '0';
  const serverErrorExpr = serverErrorCol ? `COALESCE(d.${serverErrorCol}, 0)` : '0';
  const noValidSiteExpr = noValidSiteCol ? `COALESCE(d.${noValidSiteCol}, 0)` : '0';

  const runningParts: string[] = [];
  if (statusCol) {
    runningParts.push(`LOWER(COALESCE(d.${statusCol}, '')) SIMILAR TO '%(running|processing|in_progress|starting|stop_requested|stopping)%'`);
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

  const terminalCondition = `(
    ${finishedExpr} IS NOT NULL
    OR ${analysisOkExpr} = 1
    OR ${serverErrorExpr} = 1
    OR ${noValidSiteExpr} = 1
    OR ${statusExpr} SIMILAR TO '%(failed|error|stopped|cancel|done|finish|success|complete|completed|partial)%'
    OR ${outcomeExpr} SIMILAR TO '%(failed|partial|completed|stopped|cancel|done|finish|success)%'
  )`;

  const runningSql = runningParts.length ? runningParts.map((part) => `(${part})`).join(' OR ') : 'FALSE';
  const queuedSql = queuedParts.length ? queuedParts.map((part) => `(${part})`).join(' OR ') : 'FALSE';
  const queueJoinSql = queueAvailable
    ? `\n      LEFT JOIN ai_analysis_queue q ON q.inn = d.inn AND COALESCE(to_jsonb(q)->>'state', 'queued') = 'queued'`
    : '';

  return `
    SELECT
      COUNT(*) FILTER (WHERE NOT ${terminalCondition} AND (${runningSql}))::int AS running,
      COUNT(*) FILTER (WHERE NOT ${terminalCondition} AND (${queuedSql}))::int AS queued
    FROM dadata_result d${queueJoinSql}
    ${whereSql}
  `;
}

function normalizeDomain(value: any): string | null {
  const str = parseString(value);
  if (!str) return null;

  try {
    const url = new URL(str.includes('://') ? str : `http://${str}`);
    const host = url.hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch (error) {
    const normalized = str
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split(/[\/\?#]/)[0]
      .trim()
      .toLowerCase();
    return normalized || null;
  }
}

function parseString(val: any): string | null {
  return parseDisplayString(val);
}

function parseIdString(val: any): string | null {
  const str = parseString(val);
  if (!str) return null;
  return /^-?\d+$/.test(str) ? str : null;
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
        if (typeof item === 'object') {
          return extractMeaningfulText(item, {
            preferredKeys: ['value', 'label', 'name', 'title', 'domain', 'site', 'url', 'email', 'text'],
          });
        }
        return parseString(item);
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

function parseOkvedCodeArray(val: any): string[] | null {
  const entries = normalizeOkvedEntries(Array.isArray(val) ? val : parseJson(val));
  return entries.length ? entries.map((entry) => entry.code) : null;
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

function isFallbackSiteMarker(value: any): boolean {
  const str = parseString(value)?.trim().toLowerCase();
  if (!str) return false;
  return str === OKVED_FALLBACK_DOMAIN || str === OKVED_FALLBACK_SITE_TOKEN;
}

function sanitizeSites(values: string[] | null): string[] | null {
  if (!Array.isArray(values)) return null;
  const cleaned = values
    .map((value) => parseString(value))
    .filter((value): value is string => !!value && !isFallbackSiteMarker(value));
  return cleaned.length ? cleaned : null;
}

function sanitizeAnalysisDomain(value: string | null): string | null {
  if (!value || isFallbackSiteMarker(value)) return null;
  return value;
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
    scoreSource: string | null;
    prodclassByOkved: number | null;
    prodclass: { id: number; name: string | null; score: number | null; source: 'site' | 'okved' } | null;
  },
) {
  const company = base?.company && typeof base.company === 'object' ? { ...base.company } : {};
  const ai = base?.ai && typeof base.ai === 'object' ? { ...base.ai } : {};
  const sanitizedSites = sanitizeSites(extra.sites);
  const sanitizedDomain = sanitizeAnalysisDomain(extra.domain);

  if (!ai.sites && sanitizedSites?.length) ai.sites = sanitizedSites;
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

  if (!ai.prodclass && extra.prodclass) {
    ai.prodclass = {
      id: extra.prodclass.id,
      name: extra.prodclass.name,
      label: extra.prodclass.name,
      score: extra.prodclass.score,
      score_source: extra.prodclass.source,
    };
  }

  if (!ai.prodclass && (extra.analysisClass || extra.matchLevel || extra.okvedMatch)) {
    ai.prodclass = {
      name: extra.analysisClass ?? null,
      label: extra.analysisClass ?? null,
      score: extra.descriptionOkvedScore ?? (extra.matchLevel ? parseNumber(extra.matchLevel) : null),
      description_okved_score: extra.descriptionOkvedScore ?? (extra.okvedMatch ? parseNumber(extra.okvedMatch) : null),
      okved_score: extra.okvedScore ?? null,
      score_source: extra.scoreSource ?? null,
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
    if (ai.prodclass.score_source == null && extra.scoreSource != null) {
      ai.prodclass.score_source = extra.scoreSource;
    }
  }

  if (!company.domain1 && extra.description) company.domain1 = extra.description;
  if (!company.domain1_site && sanitizedDomain) company.domain1_site = sanitizedDomain;

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

  const items = Array.isArray(parsed) ? parsed : [parsed];

  return items.reduce<any[]>((acc, item) => {
    if (!item) return acc;

    if (typeof item === 'string') {
      acc.push({ name: item });
      return acc;
    }

    if (typeof item === 'object') {
      const name =
        extractMeaningfulText(item, { preferredKeys: EQUIPMENT_TEXT_KEYS }) ||
        (parseNumber((item as any).equipment_id) ?? parseNumber((item as any).equipmentId))?.toString();
      const id =
        parseNumber((item as any).id) ??
        parseNumber((item as any).equipment_id) ??
        parseNumber((item as any).equipmentId) ??
        parseNumber((item as any).match_id) ??
        parseNumber((item as any).code) ??
        null;
      const score =
        parseNumber((item as any).score) ??
        parseNumber((item as any).equipment_score) ??
        parseNumber((item as any).match_score) ??
        null;

      const normalized: any = stripLargeAnalysisFields({ ...item });
      if (name) normalized.name = name;
      if (id != null) normalized.id = id;
      if (score != null && normalized.score == null) normalized.score = score;

      acc.push(normalized);
      return acc;
    }

    acc.push({ name: String(item) });
    return acc;
  }, []);
}

function normalizeTnved(raw: any): any[] {
  const parsed = parseJson(raw);
  if (!parsed) return [];
  const items = Array.isArray(parsed) ? parsed : typeof parsed === 'object' ? [parsed] : [];

  return items.reduce<any[]>((acc, item) => {
    if (!item) return acc;

    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      const name = parseString(item);
      if (name) acc.push({ name });
      return acc;
    }

    if (typeof item !== 'object') return acc;

    const id =
      parseNumber((item as any).id) ??
      parseNumber((item as any).goods_type_id) ??
      parseNumber((item as any).match_id) ??
      parseNumber((item as any).code) ??
      null;
    const name = extractMeaningfulText(item, { preferredKeys: TNVED_TEXT_KEYS }) ?? (id != null ? String(id) : null);
    const tnvedCode = extractMeaningfulText(item, { preferredKeys: TNVED_CODE_KEYS });
    const score =
      parseNumber((item as any).score) ??
      parseNumber((item as any).goods_types_score) ??
      parseNumber((item as any).match_score) ??
      null;

    if (!name && !tnvedCode && id == null) return acc;

    const normalized: any = stripLargeAnalysisFields({ ...(item as any) });
    if (id != null) normalized.id = id;
    if (name) normalized.name = name;
    if (tnvedCode) normalized.tnved_code = tnvedCode;
    if (score != null && normalized.score == null) normalized.score = score;

    acc.push(normalized);
    return acc;
  }, []);
}

function buildItemKey(item: any): string | null {
  if (item == null) return null;
  if (typeof item === 'string') return item.trim().toLowerCase();
  if (typeof item === 'object') {
    const name = extractMeaningfulText(item, {
      preferredKeys: ['name', 'title', 'equipment', 'equipment_name', 'goods_type', 'product', 'label', 'value', 'text'],
    });
    const id =
      parseNumber((item as any).id) ??
      parseNumber((item as any).equipment_id) ??
      parseNumber((item as any).equipmentId) ??
      parseNumber((item as any).goods_type_id) ??
      parseNumber((item as any).match_id) ??
      parseNumber((item as any).code);

    if (name) return name.trim().toLowerCase();
    if (id != null) return `id:${id}`;
    return null;
  }

  return String(item).trim().toLowerCase();
}

function dedupeItems<T>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = buildItemKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
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
      responsible: searchParams.get('responsible') ?? undefined,
    });

    const statusFilters = Array.from(
      new Set(searchParams.getAll('status').map((s) => s.trim()).filter(Boolean)),
    );

    const includeExtra = searchParams.get('extra') === '1';
    const includeParent = searchParams.get('parent') === '1';

    const q = (base.q ?? '').trim();
    const responsible = (base.responsible ?? '').trim();
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

    if (responsible) {
      const b24MetaAvailable = await isB24MetaAvailable();
      if (!b24MetaAvailable) {
        return NextResponse.json({ items: [], total: 0, page: base.page, pageSize: base.pageSize });
      }

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
        return NextResponse.json({ items: [], total: 0, page: base.page, pageSize: base.pageSize });
      }

      where.push(`d.inn = ANY($${i}::text[])`);
      args.push(responsibleInns);
      i++;
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
    const queueJoinSql = queueAvailable
      ? `\n      LEFT JOIN ai_analysis_queue q ON q.inn = d.inn AND COALESCE(to_jsonb(q)->>'state', 'queued') = 'queued'`
      : '';

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
    const companyIds = new Map<string, string>();
    for (const row of dataRes.rows) {
      if (row.inn != null && row.company_id != null) {
        const inn = String(row.inn);
        const cid = parseIdString(row.company_id);
        if (cid) {
          companyIds.set(inn, cid);
        }
      }
    }
    let contactsByInn = new Map<string, { emails?: any; webSites?: any }>();
    let responsiblesByInn = new Map<string, string>();
    let equipmentByInn = new Map<string, any[]>();
    let siteAnalyzerByInn = new Map<string, SiteAnalyzerFallback>();
    let costsByCompanyId = new Map<string, CompanyCostSummary>();

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
      siteAnalyzerByInn.forEach((fallback, inn) => {
        const fallbackCompanyId = parseIdString(fallback.companyId);
        if (!fallbackCompanyId) return;
        if (!companyIds.has(inn)) {
          companyIds.set(inn, fallbackCompanyId);
        }
      });

      costsByCompanyId = await loadCompanyCostSummaries(Array.from(new Set(companyIds.values())));

      if (await isB24MetaAvailable()) {
        try {
          const { rows: responsibleRows } = await db.query<{ inn: string; assigned_name: string | null }>(
            `
              SELECT inn, assigned_name
              FROM b24_company_meta
              WHERE inn = ANY($1::text[])
            `,
            [inns],
          );
          responsiblesByInn = new Map(
            responsibleRows
              .map((row) => [String(row.inn ?? '').trim(), String(row.assigned_name ?? '').trim()] as const)
              .filter(([inn, assignedName]) => !!inn && !!assignedName),
          );
        } catch (error) {
          console.warn('Failed to load responsibles for AI analysis companies', error);
        }
      }
    }

    const prodclassIds = new Set<number>();
    const collectProdclassId = (value: any) => {
      const id = parseNumber(value);
      if (id != null) {
        prodclassIds.add(id);
      }
    };

    for (const row of dataRes.rows) {
      const analysisInfo = stripLargeAnalysisFields(parseJson(row.analysis_info));
      collectProdclassId(row.prodclass_by_okved);
      collectProdclassId((analysisInfo as any)?.prodclass_by_okved);
      collectProdclassId((analysisInfo as any)?.ai?.prodclass_by_okved);

      const analyzerProdclass = (analysisInfo as any)?.ai?.prodclass ?? (analysisInfo as any)?.prodclass;
      if (analyzerProdclass && typeof analyzerProdclass === 'object') {
        collectProdclassId((analyzerProdclass as any).id ?? (analyzerProdclass as any).prodclass_id);
      }

      const siteFallback = siteAnalyzerByInn.get(String(row.inn));
      if (siteFallback) {
        collectProdclassId(siteFallback.prodclassByOkved);
      }
    }

    const prodclassNames = await loadProdclassNames(Array.from(prodclassIds));

    const total = countRes.rows?.[0]?.cnt ?? 0;

    const items = dataRes.rows.map((row: any) => {
      const core = okvedCompanySchema.parse(row);
      const contacts = contactsByInn.get(core.inn);
      const siteFallback = siteAnalyzerByInn.get(core.inn);

      const analysisInfo = stripLargeAnalysisFields(parseJson(row.analysis_info));
      const mainOkved =
        parseString(row.main_okved) ||
        parseString((analysisInfo as any)?.main_okved);
      const okvedEntries = normalizeOkvedEntries(parseJson(row.okveds));
      const okvedList = parseOkvedCodeArray(row.okveds);

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

      const prodclassByOkved =
        parseNumber(row.prodclass_by_okved) ??
        parseNumber((analysisInfo as any)?.prodclass_by_okved) ??
        parseNumber((analysisInfo as any)?.ai?.prodclass_by_okved) ??
        siteFallback?.prodclassByOkved ?? null;
      const prodclassName = prodclassByOkved != null ? prodclassNames.get(prodclassByOkved) ?? null : null;
      const matchLevel =
        parseString(row.analysis_match_level) ||
        (analysisInfo && parseString((analysisInfo as any)?.match_level)) ||
        (siteFallback?.prodclassScore != null ? String(siteFallback.prodclassScore) : null);
      const analysisClass =
        parseString(row.analysis_class) ||
        (analysisInfo && parseString((analysisInfo as any)?.found_class)) ||
        (siteFallback?.prodclass != null ? parseString(siteFallback.prodclass) : null) ||
        (prodclassByOkved != null ? String(prodclassByOkved) : null) ||
        mainOkved ||
        (okvedList?.length ? okvedList[0] : null);
      const description =
        parseString(row.analysis_description) ||
        (analysisInfo && parseString((analysisInfo as any)?.description)) ||
        parseString(siteFallback?.description);
      const descriptionOkvedScoreFromTables = siteFallback?.descriptionOkvedScore ?? null;
      const descriptionScore =
        parseNumber(row.description_score) ??
        parseNumber((analysisInfo as any)?.description_score) ??
        parseNumber((analysisInfo as any)?.ai?.description_score) ??
        siteFallback?.descriptionScore ?? null;
      const descriptionOkvedScore =
        descriptionOkvedScoreFromTables ??
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
      const scoreSource =
        parseString(row.score_source) ||
        parseString((analysisInfo as any)?.score_source) ||
        parseString((analysisInfo as any)?.ai?.score_source) ||
        parseString((analysisInfo as any)?.ai?.prodclass?.score_source) ||
        siteFallback?.scoreSource ||
        null;
      const isOkvedFallback = scoreSource === 'okved_fallback' || !siteFallback?.domains?.length;
      const prodclassScoreValue = descriptionOkvedScore ?? okvedScore ?? siteFallback?.prodclassScore ?? null;
      const domain = sanitizeAnalysisDomain(
        parseString(row.analysis_domain) ||
          (analysisInfo && parseString((analysisInfo as any)?.domain)) ||
          (siteFallback?.domains?.[0] ?? null),
      );

      const equipmentCandidates = [
        // В приоритете — данные последнего анализа, сохранённые в dadata_result.
        // equipment_all используем только как fallback, т.к. там могут оставаться
        // более старые или нерелевантные записи.
        ...normalizeEquipment(row.analysis_equipment),
        ...(siteFallback?.equipment?.filter((item) => item && (item.name || item.id)) ?? []),
        ...(equipmentByInn.get(core.inn) ?? []),
      ].filter(Boolean);
      const equipment = dedupeItems(equipmentCandidates).map((item) =>
        item && typeof item === 'object' ? stripLargeAnalysisFields(item) : item,
      );

      const tnvedCandidates = [
        ...(siteFallback?.goods?.filter((item) => item && (item.name || item.id)) ?? []),
        ...normalizeTnved(row.analysis_tnved),
      ].filter(Boolean);

      let tnved = dedupeItems(tnvedCandidates);

      if (!tnved.length) {
        if (okvedEntries.length) {
          tnved = okvedEntries.map((entry) => ({
            name: entry.name ?? entry.code,
            tnved_code: entry.code,
            source: 'okved',
          }));
        } else if (mainOkved) {
          tnved = [{ name: mainOkved, tnved_code: mainOkved, source: 'okved' }];
        }
      }

      tnved = tnved.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const id = parseNumber((item as any).id) ?? parseNumber((item as any).goods_type_id) ?? null;
        const source = parseString((item as any).source) ?? ((item as any).score == null ? 'okved' : 'site');
        return {
          ...stripLargeAnalysisFields(item as any),
          id,
          name: extractMeaningfulText(item, { preferredKeys: TNVED_TEXT_KEYS }) ?? (id != null ? String(id) : '—'),
          tnved_code:
            extractMeaningfulText(item, { preferredKeys: TNVED_CODE_KEYS }),
          score: parseNumber((item as any).score) ?? parseNumber((item as any).goods_types_score),
          source: source === 'okved' ? 'okved' : 'site',
        };
      });
      const metaSites = parseStringArray(contacts?.webSites);
      const metaEmails = parseStringArray(contacts?.emails);

      const sites = sanitizeSites(
        metaSites ||
          parseStringArray(row.sites) ||
          parseStringArray((analysisInfo as any)?.sites) ||
          parseStringArray(row.analysis_domain ? [row.analysis_domain] : null) ||
          (siteFallback?.domains?.length ? siteFallback.domains : null),
      );

      const emails =
        metaEmails ||
        parseStringArray(row.emails) ||
        parseStringArray((analysisInfo as any)?.emails);

      const mergedAnalyzer = stripLargeAnalysisFields(mergeAnalyzerInfo(analysisInfo, {
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
        scoreSource,
        okvedScore,
        prodclassByOkved,
        prodclass:
          prodclassByOkved != null
            ? {
                id: prodclassByOkved,
                name: prodclassName,
                score: prodclassScoreValue,
                source: isOkvedFallback ? 'okved' : 'site',
              }
            : null,
      }));
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

      const companyIdRaw = row.company_id ?? siteFallback?.companyId ?? null;
      const companyIdKey = parseIdString(companyIdRaw);
      const numericCompanyId = parseNumber(companyIdRaw);
      const costSummary = companyIdKey ? costsByCompanyId.get(companyIdKey) : null;

      return {
        ...core,
        sites,
        emails,
        analysis_status: status,
        analysis_outcome: outcome,
        company_id: Number.isFinite(numericCompanyId) ? numericCompanyId : null,
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
        score_source: scoreSource,
        okved_score: okvedScore,
        prodclass_by_okved: prodclassByOkved,
        prodclass_name: prodclassName,
        main_okved: mainOkved,
        analysis_okved_match: okvedMatch,
        analysis_description: description,
        analysis_tnved: tnved,
        analysis_info: mergedAnalyzer,
        analysis_pipeline: pipeline,
        queued_at: queuedAt,
        queued_by: queuedBy,
        responsible: responsiblesByInn.get(core.inn) ?? null,
        tokens_total: costSummary?.tokens_total ?? null,
        input_tokens: costSummary?.input_tokens ?? null,
        cached_input_tokens: costSummary?.cached_input_tokens ?? null,
        output_tokens: costSummary?.output_tokens ?? null,
        cost_total_usd: costSummary?.cost_total_usd ?? null,
        analysis_cost: costSummary
          ? {
              tokens_total: costSummary.tokens_total,
              cost_usd: costSummary.cost_total_usd,
            }
          : null,
        breakdown: costSummary
          ? {
              input_tokens: costSummary.input_tokens,
              cached_input_tokens: costSummary.cached_input_tokens,
              output_tokens: costSummary.output_tokens,
            }
          : null,
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


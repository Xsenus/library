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

  if (ai.prodclass_by_okved == null && extra.prodclassByOkved != null) {
    ai.prodclass_by_okved = extra.prodclassByOkved;
  }

  if (!ai.prodclass && (extra.analysisClass || extra.matchLevel || extra.okvedMatch)) {
    ai.prodclass = {
      name: extra.analysisClass ?? null,
      label: extra.analysisClass ?? null,
      score: extra.matchLevel ? parseNumber(extra.matchLevel) : null,
      description_okved_score: extra.okvedMatch ? parseNumber(extra.okvedMatch) : null,
    };
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
    }

    const total = countRes.rows?.[0]?.cnt ?? 0;

      const items = dataRes.rows.map((row: any) => {
        const core = okvedCompanySchema.parse(row);
        const contacts = contactsByInn.get(core.inn);

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
        (analysisInfo && parseString((analysisInfo as any)?.match_level));
      const analysisClass =
        parseString(row.analysis_class) ||
        (analysisInfo && parseString((analysisInfo as any)?.found_class));
      const description =
        parseString(row.analysis_description) ||
        (analysisInfo && parseString((analysisInfo as any)?.description));
      const okvedMatch =
        parseString(row.analysis_okved_match) ||
        (analysisInfo && parseString((analysisInfo as any)?.okved_match));
      const descriptionScore =
        parseNumber(row.description_score) ??
        parseNumber((analysisInfo as any)?.description_score) ??
        parseNumber((analysisInfo as any)?.ai?.description_score);
      const okvedScore =
        parseNumber(row.okved_score) ??
        parseNumber((analysisInfo as any)?.okved_score) ??
        parseNumber((analysisInfo as any)?.ai?.okved_score);
      const prodclassByOkved =
        parseNumber(row.prodclass_by_okved) ??
        parseNumber((analysisInfo as any)?.prodclass_by_okved) ??
        parseNumber((analysisInfo as any)?.ai?.prodclass_by_okved);
      const domain =
        parseString(row.analysis_domain) ||
        (analysisInfo && parseString((analysisInfo as any)?.domain));

      const equipment = normalizeEquipment(row.analysis_equipment);
        const tnved = normalizeTnved(row.analysis_tnved);
      const metaSites = parseStringArray(contacts?.webSites);
      const metaEmails = parseStringArray(contacts?.emails);

      const sites =
        metaSites ||
        parseStringArray(row.sites) ||
        parseStringArray((analysisInfo as any)?.sites) ||
        parseStringArray(row.analysis_domain ? [row.analysis_domain] : null);

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
        okvedScore,
        prodclassByOkved,
      });
      const pipeline = parsePipeline(row.analysis_pipeline || (analysisInfo as any)?.pipeline);

      const score =
        parseNumber(row.analysis_score) ??
        parseNumber((analysisInfo as any)?.score) ??
        parseNumber((analysisInfo as any)?.ai?.score) ??
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

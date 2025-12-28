import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { getSession } from '@/lib/auth';
import { getForcedLaunchMode, getForcedSteps } from '@/lib/ai-analysis-config';
import { getDadataColumns } from '@/lib/dadata-columns';
import type { StepKey } from '@/lib/ai-analysis-types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

const QUEUE_STALE_INTERVAL = `120 minutes`;

type OptionalColumnSpec = {
  alias: string;
  candidates: string[];
  fallback: string;
};

const OPTIONAL_COLUMNS: OptionalColumnSpec[] = [
  { alias: 'short_name', candidates: ['short_name', 'name'], fallback: 'NULL::text' },
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
  { alias: 'analysis_attempts', candidates: ['analysis_attempts', 'analysis_retry_count'], fallback: 'NULL::int' },
  { alias: 'analysis_score', candidates: ['analysis_score', 'company_score'], fallback: 'NULL::numeric' },
];

async function ensureQueueTable() {
  await dbBitrix.query(`
    CREATE TABLE IF NOT EXISTS ai_analysis_queue (
      inn text PRIMARY KEY,
      queued_at timestamptz NOT NULL DEFAULT now(),
      queued_by text,
      payload jsonb
    )
  `);
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_queue
      ADD COLUMN IF NOT EXISTS queued_at timestamptz NOT NULL DEFAULT now()
  `);
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_queue
      ADD COLUMN IF NOT EXISTS queued_by text
  `);
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_queue
      ADD COLUMN IF NOT EXISTS payload jsonb
  `);
}

async function getExistingColumns(): Promise<Set<string>> {
  const { rows } = await dbBitrix.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'dadata_result'
    `,
  );
  return new Set(rows.map((row) => row.column_name));
}

function buildOptionalSelect(columns: Set<string>): string[] {
  return OPTIONAL_COLUMNS.map((spec) => {
    const match = spec.candidates.find((candidate) => columns.has(candidate));
    if (!match) {
      return `${spec.fallback} AS ${spec.alias}`;
    }
    const safe = match.replace(/"/g, '""');
    return `d."${safe}" AS ${spec.alias}`;
  });
}

function normalizeRunningCondition(columns: Set<string>): string {
  const status = columns.has('analysis_status') ? 'd.analysis_status' : "COALESCE(d.status, '')";
  const progress = columns.has('analysis_progress') ? 'COALESCE(d.analysis_progress, 0)' : '0';
  const startedAt = columns.has('analysis_started_at') ? 'd.analysis_started_at' : 'NULL';
  const finishedAt = columns.has('analysis_finished_at') ? 'd.analysis_finished_at' : 'NULL';

  return `(
    LOWER(COALESCE(${status}, '')) SIMILAR TO '%(running|processing|in_progress|starting|queued)%'
    OR (${progress} > 0 AND ${progress} < 0.999)
    OR (${startedAt} IS NOT NULL AND ${finishedAt} IS NULL AND ${startedAt} > now() - interval '${QUEUE_STALE_INTERVAL}')
  )`;
}

function normalizeStatuses(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map((item) => String(item ?? '').trim()).filter(Boolean)));
}

function normalizeSteps(raw: unknown): StepKey[] {
  if (!Array.isArray(raw)) return [] as StepKey[];
  return Array.from(
    new Set(
      raw
        .map((item) => String(item ?? '').trim())
        .filter((item): item is StepKey => item.length > 0),
    ),
  );
}

function normalizeString(raw: unknown): string | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  return value.length ? value : null;
}

function normalizeLimit(raw: unknown, fallback = 200): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(1000, Math.max(1, Math.floor(num)));
}

async function markQueuedMany(inns: string[]) {
  if (!inns.length) return;

  const columns = await getDadataColumns();
  if (!columns.status) {
    console.warn('mark queued skipped: no status column in dadata_result');
    return;
  }

  const sets = [`"${columns.status}" = 'queued'`];

  if (columns.startedAt) {
    sets.push(`"${columns.startedAt}" = NULL`);
  }

  if (columns.finishedAt) {
    sets.push(`"${columns.finishedAt}" = NULL`);
  }

  if (columns.progress) {
    sets.push(`"${columns.progress}" = NULL`);
  }

  if (columns.outcome) {
    sets.push(`"${columns.outcome}" = 'pending'`);
  }

  if (columns.attempts) {
    sets.push(`"${columns.attempts}" = 0`);
  }

  const sql = `UPDATE dadata_result SET ${sets.join(', ')} WHERE inn = ANY($1::text[])`;

  await dbBitrix.query(sql, [inns]).catch((error) => console.warn('mark queued failed', error));
}

function buildStatusConditions(statuses: string[]): string[] {
  const requested = new Set(statuses);
  const conditions: string[] = [];

  if (requested.has('not_started')) {
    conditions.push(`(d.analysis_started_at IS NULL AND d.analysis_finished_at IS NULL)`);
  }

  if (requested.has('failed')) {
    conditions.push(
      `((COALESCE(d.server_error, 0) = 1) OR (COALESCE(d.no_valid_site, 0) = 1) OR LOWER(COALESCE(d.analysis_outcome, '')) = 'failed')`,
    );
  }

  if (requested.has('partial')) {
    conditions.push(
      `(LOWER(COALESCE(d.analysis_outcome, '')) = 'partial' OR (d.analysis_finished_at IS NOT NULL AND COALESCE(d.analysis_ok, 0) = 0))`,
    );
  }

  if (requested.has('completed')) {
    conditions.push(`(COALESCE(d.analysis_ok, 0) = 1 OR LOWER(COALESCE(d.analysis_outcome, '')) = 'completed')`);
  }

  return conditions;
}

export async function GET(request: NextRequest) {
  try {
    await ensureQueueTable();
    const limit = normalizeLimit(request.nextUrl.searchParams.get('limit'));
    const columns = await getExistingColumns();
    const optionalSelect = buildOptionalSelect(columns);
    const runningCondition = normalizeRunningCondition(columns);

    const selectList = [`q.source`, `q.inn`, `q.queued_at`, `q.queued_by`, ...optionalSelect].join(',\n          ');
    const selectListRunning = [`r.source`, `r.inn`, `r.queued_at`, `r.queued_by`, ...optionalSelect].join(',\n          ');

    const { rows } = await dbBitrix.query(
      `
        WITH queue_items AS (
          SELECT 'queue'::text AS source, q.inn, q.queued_at, q.queued_by, d.*
          FROM ai_analysis_queue q
          LEFT JOIN dadata_result d ON d.inn = q.inn
        ),
        running_items AS (
          SELECT 'running'::text AS source, d.inn, COALESCE(d.analysis_started_at, now()) AS queued_at, NULL::text AS queued_by, d.*
          FROM dadata_result d
          LEFT JOIN ai_analysis_queue q ON q.inn = d.inn
          WHERE q.inn IS NULL AND ${runningCondition}
        ),
        combined AS (
          SELECT ${selectList} FROM queue_items q
          UNION ALL
          SELECT ${selectListRunning} FROM running_items r
        )
        SELECT *
        FROM combined
        ORDER BY queued_at ASC
        LIMIT $1
      `,
      [limit],
    );

    const items = rows.map((row) => ({
      ...row,
      analysis_status: row.analysis_status ?? (row.source === 'queue' ? 'queued' : row.analysis_status),
      analysis_outcome: row.analysis_outcome ?? (row.source === 'queue' ? 'pending' : row.analysis_outcome),
    }));

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error('GET /api/ai-analysis/queue error', error);
    return NextResponse.json({ ok: false, items: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      query?: unknown;
      startsWith?: unknown;
      statuses?: unknown;
      okved?: unknown;
      industryId?: unknown;
      limit?: unknown;
      dryRun?: unknown;
      includeQueued?: unknown;
      includeRunning?: unknown;
      mode?: unknown;
      steps?: unknown;
    } | null;

    const q = normalizeString(body?.query);
    const startsWith = normalizeString(body?.startsWith);
    const okved = normalizeString(body?.okved);
    const industryId = Number(body?.industryId);
    const limit = normalizeLimit(body?.limit);
    const includeQueued = body?.includeQueued === true;
    const includeRunning = body?.includeRunning === true;
    const requestedStatuses = normalizeStatuses(body?.statuses);
    const dryRun = body?.dryRun === true;

    const forcedMode = getForcedLaunchMode();
    const mode: 'full' | 'steps' = body?.mode === 'full' || body?.mode === 'steps' ? body.mode : forcedMode;
    const forcedSteps = getForcedSteps();
    const steps = mode === 'steps' ? normalizeSteps(body?.steps).filter(Boolean) : [];

    const where: string[] = ["(d.status = 'ACTIVE' OR d.status = 'REORGANIZING')"];
    const args: any[] = [];
    let idx = 1;

    if (q) {
      where.push(`(d.short_name ILIKE $${idx} OR d.inn ILIKE $${idx})`);
      args.push(`%${q}%`);
      idx++;
    }

    if (startsWith) {
      where.push(`(d.short_name ILIKE $${idx} || '%' OR d.inn ILIKE $${idx} || '%')`);
      args.push(startsWith);
      idx++;
    }

    if (okved) {
      where.push(`TRIM(d.main_okved) ~ ('^' || $${idx} || '(\\.|$)')`);
      args.push(okved);
      idx++;
    }

    if (Number.isFinite(industryId) && industryId > 0) {
      where.push(`d.industry_id = $${idx}`);
      args.push(industryId);
      idx++;
    }

    if (!includeQueued) {
      where.push('q.inn IS NULL');
    }

    if (!includeRunning) {
      where.push(
        `NOT (LOWER(COALESCE(d.analysis_status, '')) SIMILAR TO '%(running|processing|in_progress|starting)%' OR (COALESCE(d.analysis_progress, 0) > 0 AND COALESCE(d.analysis_progress, 0) < 0.999) OR (d.analysis_started_at IS NOT NULL AND d.analysis_finished_at IS NULL AND d.analysis_started_at > now() - interval '${QUEUE_STALE_INTERVAL}'))`,
      );
    }

    const statusConditions = buildStatusConditions(requestedStatuses);
    if (statusConditions.length) {
      where.push(`(${statusConditions.join(' OR ')})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    await ensureQueueTable();

    const countSql = `
      SELECT COUNT(*)::int AS cnt
      FROM dadata_result d
      LEFT JOIN ai_analysis_queue q ON q.inn = d.inn
      ${whereSql}
    `;

    const dataSql = `
      SELECT d.inn
      FROM dadata_result d
      LEFT JOIN ai_analysis_queue q ON q.inn = d.inn
      ${whereSql}
      ORDER BY COALESCE(q.queued_at, d.analysis_started_at) NULLS LAST, d.inn
      LIMIT $${idx}
    `;

    const [countRes, dataRes] = await Promise.all([
      dbBitrix.query<{ cnt: number }>(countSql, args),
      dbBitrix.query<{ inn: string }>(dataSql, [...args, limit]),
    ]);

    const total = Number(countRes.rows?.[0]?.cnt ?? 0);
    const inns = Array.from(new Set((dataRes.rows ?? []).map((row) => row.inn).filter(Boolean)));

    if (dryRun) {
      return NextResponse.json({ ok: true, total, inns });
    }

    if (!inns.length) {
      return NextResponse.json({ ok: false, error: 'Нет компаний по заданным условиям' }, { status: 400 });
    }

    const session = await getSession();
    const requestedBy = session?.login ?? session?.id?.toString() ?? null;

    const payload: Record<string, unknown> = {
      source: 'filter',
      requested_at: new Date().toISOString(),
      requested_by: requestedBy,
      count: inns.length,
      mode,
      steps: mode === 'steps' ? (steps.length ? steps : forcedSteps) : null,
      defer_count: 0,
      completed_steps: [],
    };

    const placeholders = inns.map((_, i) => `($${i + 1})`).join(', ');
    const sql = `
      INSERT INTO ai_analysis_queue (inn, queued_at, queued_by, payload)
      SELECT v.inn_val, now(), $${inns.length + 1}, $${inns.length + 2}::jsonb
      FROM (VALUES ${placeholders}) AS v(inn_val)
      ON CONFLICT (inn) DO UPDATE
      SET queued_at = EXCLUDED.queued_at,
          queued_by = EXCLUDED.queued_by,
          payload = EXCLUDED.payload
    `;

    await dbBitrix.query(sql, [...inns, requestedBy, JSON.stringify(payload)]);
    await markQueuedMany(inns);

    return NextResponse.json({ ok: true, queued: inns.length, total });
  } catch (error) {
    console.error('POST /api/ai-analysis/queue error', error);
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { inns?: unknown } | null;
    const inns = Array.isArray(body?.inns)
      ? Array.from(new Set(body!.inns.map((inn) => String(inn ?? '').trim()).filter(Boolean)))
      : [];

    if (!inns.length) {
      return NextResponse.json(
        { ok: false, error: 'Не переданы компании для удаления из очереди' },
        { status: 400 },
      );
    }

    await ensureQueueTable();

    const deleteRes = await dbBitrix.query<{ count: string }>(
      `DELETE FROM ai_analysis_queue WHERE inn = ANY($1::text[]) RETURNING 1`,
      [inns],
    );
    const removed = deleteRes.rowCount ?? Number(deleteRes.rows?.length ?? 0);

    const columns = await getDadataColumns();
    const updates: string[] = [];

    if (columns.status) updates.push(`"${columns.status}" = NULL`);
    if (columns.outcome) updates.push(`"${columns.outcome}" = NULL`);
    if (columns.progress) updates.push(`"${columns.progress}" = NULL`);
    if (columns.startedAt) updates.push(`"${columns.startedAt}" = NULL`);
    if (columns.finishedAt) updates.push(`"${columns.finishedAt}" = NULL`);
    if (columns.attempts) updates.push(`"${columns.attempts}" = 0`);

    if (updates.length) {
      await dbBitrix
        .query(`UPDATE dadata_result SET ${updates.join(', ')} WHERE inn = ANY($1::text[])`, [inns])
        .catch((error) => console.warn('queue delete: failed to reset dadata_result', error));
    }

    return NextResponse.json({ ok: true, removed });
  } catch (error) {
    console.error('DELETE /api/ai-analysis/queue error', error);
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

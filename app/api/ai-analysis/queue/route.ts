import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { getSession } from '@/lib/auth';
import { getForcedLaunchMode, getForcedSteps } from '@/lib/ai-analysis-config';
import { syncAiAnalysisQueueWatchdog, triggerAiAnalysisQueueProcessing } from '@/lib/ai-analysis-queue-trigger';
import { resolveAiAnalysisQueuePriority } from '@/lib/ai-analysis-queue-priority';
import { buildAiAnalysisQueueSummary } from '@/lib/ai-analysis-queue-summary';
import { getDadataColumns } from '@/lib/dadata-columns';
import type { DadataColumns } from '@/lib/dadata-columns';
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
      payload jsonb,
      state text NOT NULL DEFAULT 'queued',
      priority integer NOT NULL DEFAULT 100,
      attempt_count integer NOT NULL DEFAULT 0,
      next_retry_at timestamptz,
      lease_expires_at timestamptz,
      started_at timestamptz,
      last_error text,
      last_error_kind text
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
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_queue
      ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'queued'
  `);
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_queue
      ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100
  `);
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_queue
      ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0
  `);
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_queue
      ADD COLUMN IF NOT EXISTS next_retry_at timestamptz
  `);
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_queue
      ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz
  `);
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_queue
      ADD COLUMN IF NOT EXISTS started_at timestamptz
  `);
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_queue
      ADD COLUMN IF NOT EXISTS last_error text
  `);
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_queue
      ADD COLUMN IF NOT EXISTS last_error_kind text
  `);
  await dbBitrix.query(`
    CREATE INDEX IF NOT EXISTS ai_analysis_queue_state_queued_at_idx
      ON ai_analysis_queue (state, priority, queued_at)
  `);
  await dbBitrix.query(`
    CREATE INDEX IF NOT EXISTS ai_analysis_queue_state_retry_priority_idx
      ON ai_analysis_queue (state, next_retry_at, priority, queued_at)
  `);
  await dbBitrix.query(`
    CREATE INDEX IF NOT EXISTS ai_analysis_queue_lease_expires_at_idx
      ON ai_analysis_queue (lease_expires_at)
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

function buildOptionalSelect(columns: Set<string>, tableAlias: string): string[] {
  return OPTIONAL_COLUMNS.map((spec) => {
    const match = spec.candidates.find((candidate) => columns.has(candidate));
    if (!match) {
      return `${spec.fallback} AS ${spec.alias}`;
    }
    const safe = match.replace(/"/g, '""');
    return `${tableAlias}."${safe}" AS ${spec.alias}`;
  });
}

function normalizeRunningCondition(columns: Set<string>): string {
  const status = columns.has('analysis_status') ? 'd.analysis_status' : "COALESCE(d.status, '')";
  const outcome = columns.has('analysis_outcome') ? 'd.analysis_outcome' : "''";
  const progress = columns.has('analysis_progress') ? 'COALESCE(d.analysis_progress, 0)' : '0';
  const startedAt = columns.has('analysis_started_at') ? 'd.analysis_started_at' : 'NULL';
  const finishedAt = columns.has('analysis_finished_at') ? 'd.analysis_finished_at' : 'NULL';
  const terminalStatus = `LOWER(COALESCE(${status}, '')) SIMILAR TO '%(failed|error|stopped|cancel|done|finish|success|complete|completed|partial)%'`;
  const terminalOutcome = `LOWER(COALESCE(${outcome}, '')) SIMILAR TO '%(failed|partial|completed|stopped|cancel|done|finish|success)%'`;

  return `(
    LOWER(COALESCE(${status}, '')) SIMILAR TO '%(running|processing|in_progress|starting|stop_requested|stopping)%'
    OR (${finishedAt} IS NULL AND NOT (${terminalStatus} OR ${terminalOutcome}) AND ${progress} > 0 AND ${progress} < 0.999)
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

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
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

  if (columns.okFlag) {
    sets.push(`"${columns.okFlag}" = 0`);
  }

  if (columns.serverError) {
    sets.push(`"${columns.serverError}" = 0`);
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

function buildStatusConditions(statuses: string[], columns: DadataColumns, existingColumns: Set<string>): string[] {
  const requested = new Set(statuses);
  const conditions: string[] = [];
  const startedExpr = columns.startedAt ? `d.${quoteIdent(columns.startedAt)}` : 'NULL::timestamptz';
  const finishedExpr = columns.finishedAt ? `d.${quoteIdent(columns.finishedAt)}` : 'NULL::timestamptz';
  const outcomeExpr = columns.outcome ? `LOWER(COALESCE(d.${quoteIdent(columns.outcome)}, ''))` : "''";
  const okFlagExpr = columns.okFlag ? `COALESCE(d.${quoteIdent(columns.okFlag)}, 0)` : '0';
  const serverErrorExpr = columns.serverError ? `COALESCE(d.${quoteIdent(columns.serverError)}, 0)` : '0';
  const noValidSiteExpr = existingColumns.has('no_valid_site') ? 'COALESCE(d.no_valid_site, 0)' : '0';

  if (requested.has('not_started')) {
    conditions.push(`(${startedExpr} IS NULL AND ${finishedExpr} IS NULL)`);
  }

  if (requested.has('failed')) {
    conditions.push(
      `(${serverErrorExpr} = 1 OR ${noValidSiteExpr} = 1 OR ${outcomeExpr} = 'failed')`,
    );
  }

  if (requested.has('partial')) {
    conditions.push(
      `(${outcomeExpr} = 'partial' OR (${finishedExpr} IS NOT NULL AND ${okFlagExpr} = 0))`,
    );
  }

  if (requested.has('completed')) {
    conditions.push(`(${okFlagExpr} = 1 OR ${outcomeExpr} = 'completed')`);
  }

  return conditions;
}

export async function GET(request: NextRequest) {
  try {
    await ensureQueueTable();
    const limit = normalizeLimit(request.nextUrl.searchParams.get('limit'));
    const columns = await getExistingColumns();
    const optionalSelect = buildOptionalSelect(columns, 'd');
    const runningCondition = normalizeRunningCondition(columns);

    const { rows } = await dbBitrix.query(
      `
        WITH queue_items AS (
          SELECT
            'queue'::text AS source,
            q.inn,
            q.queued_at,
            q.queued_by,
            q.state AS queue_state,
            q.priority AS queue_priority,
            q.attempt_count AS queue_attempt_count,
            q.next_retry_at,
            q.lease_expires_at,
            q.started_at AS queue_started_at,
            q.last_error AS queue_last_error,
            q.last_error_kind AS queue_last_error_kind,
            COALESCE(NULLIF(q.payload->>'source', ''), 'unknown') AS queue_source,
            COALESCE(NULLIF(q.payload->>'defer_count', ''), '0')::int AS queue_defer_count,
            ${optionalSelect.join(',\n            ')}
          FROM ai_analysis_queue q
          LEFT JOIN dadata_result d ON d.inn = q.inn
          WHERE
            q.state = 'queued'
            AND
            q.queued_at > now() - interval '${QUEUE_STALE_INTERVAL}'
        ),
        queue_running_items AS (
          SELECT
            'running'::text AS source,
            q.inn,
            COALESCE(q.started_at, d.analysis_started_at, q.queued_at, now()) AS queued_at,
            q.queued_by,
            q.state AS queue_state,
            q.priority AS queue_priority,
            q.attempt_count AS queue_attempt_count,
            q.next_retry_at,
            q.lease_expires_at,
            q.started_at AS queue_started_at,
            q.last_error AS queue_last_error,
            q.last_error_kind AS queue_last_error_kind,
            COALESCE(NULLIF(q.payload->>'source', ''), 'unknown') AS queue_source,
            COALESCE(NULLIF(q.payload->>'defer_count', ''), '0')::int AS queue_defer_count,
            ${optionalSelect.join(',\n            ')}
          FROM ai_analysis_queue q
          LEFT JOIN dadata_result d ON d.inn = q.inn
          WHERE q.state = 'running'
        ),
        running_items AS (
          SELECT
            'running'::text AS source,
            d.inn,
            COALESCE(d.analysis_started_at, now()) AS queued_at,
            NULL::text AS queued_by,
            NULL::text AS queue_state,
            NULL::int AS queue_priority,
            NULL::int AS queue_attempt_count,
            NULL::timestamptz AS next_retry_at,
            NULL::timestamptz AS lease_expires_at,
            NULL::timestamptz AS queue_started_at,
            NULL::text AS queue_last_error,
            NULL::text AS queue_last_error_kind,
            NULL::text AS queue_source,
            NULL::int AS queue_defer_count,
            ${optionalSelect.join(',\n            ')}
          FROM dadata_result d
          LEFT JOIN ai_analysis_queue q ON q.inn = d.inn
          WHERE q.inn IS NULL AND ${runningCondition}
        ),
        combined AS (
          SELECT * FROM queue_items
          UNION ALL
          SELECT * FROM queue_running_items
          UNION ALL
          SELECT * FROM running_items
        )
        SELECT *
        FROM combined
        ORDER BY COALESCE(queue_priority, 1000) ASC, COALESCE(next_retry_at, queued_at) ASC, queued_at ASC
        LIMIT $1
      `,
      [limit],
    );

    const items = rows.map((row) => {
      const normalizedStatus = String(row.analysis_status ?? '').toLowerCase();
      const stopRequested =
        row.source === 'running' && ['stop_requested', 'stop-requested', 'stopping'].some((token) => normalizedStatus.includes(token));
      const nextRetryTs = row.next_retry_at ? Date.parse(String(row.next_retry_at)) : Number.NaN;
      const retryScheduled = row.source === 'queue' && Number.isFinite(nextRetryTs) && nextRetryTs > Date.now();

      return {
        ...row,
        analysis_status: row.source === 'queue' ? (retryScheduled ? 'retry_scheduled' : 'queued') : stopRequested ? 'stop_requested' : 'running',
        analysis_outcome: row.source === 'queue' ? 'pending' : 'pending',
      };
    });

    const summary = buildAiAnalysisQueueSummary(items);

    void syncAiAnalysisQueueWatchdog();

    return NextResponse.json({
      ok: true,
      items,
      summary: {
        ...summary,
      },
    });
  } catch (error) {
    console.error('GET /api/ai-analysis/queue error', error);
    return NextResponse.json({ ok: false, items: [], summary: null }, { status: 500 });
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
    const columns = await getDadataColumns();
    const existingColumns = await getExistingColumns();
    const statusExpr = columns.status ? `LOWER(COALESCE(d.${quoteIdent(columns.status)}, ''))` : "''";
    const progressExpr = columns.progress ? `COALESCE(d.${quoteIdent(columns.progress)}, 0)` : '0';
    const startedExpr = columns.startedAt ? `d.${quoteIdent(columns.startedAt)}` : 'NULL::timestamptz';
    const finishedExpr = columns.finishedAt ? `d.${quoteIdent(columns.finishedAt)}` : 'NULL::timestamptz';

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
        `NOT (${statusExpr} SIMILAR TO '%(running|processing|in_progress|starting)%' OR (${progressExpr} > 0 AND ${progressExpr} < 0.999) OR (${startedExpr} IS NOT NULL AND ${finishedExpr} IS NULL AND ${startedExpr} > now() - interval '${QUEUE_STALE_INTERVAL}'))`,
      );
    }

    const statusConditions = buildStatusConditions(requestedStatuses, columns, existingColumns);
    if (statusConditions.length) {
      where.push(`(${statusConditions.join(' OR ')})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    await ensureQueueTable();

    const countSql = `
      SELECT COUNT(*)::int AS cnt
      FROM dadata_result d
      LEFT JOIN ai_analysis_queue q ON q.inn = d.inn AND q.state = 'queued'
      ${whereSql}
    `;

    const dataSql = `
      SELECT d.inn
      FROM dadata_result d
      LEFT JOIN ai_analysis_queue q ON q.inn = d.inn AND q.state = 'queued'
      ${whereSql}
      ORDER BY COALESCE(q.queued_at, ${startedExpr}) NULLS LAST, d.inn
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
    const queuePriority = resolveAiAnalysisQueuePriority(payload.source, inns.length);

    const placeholders = inns.map((_, i) => `($${i + 1})`).join(', ');
    const sql = `
      INSERT INTO ai_analysis_queue (
        inn,
        queued_at,
        queued_by,
        payload,
        state,
        priority,
        attempt_count,
        next_retry_at,
        lease_expires_at,
        started_at,
        last_error,
        last_error_kind
      )
      SELECT v.inn_val, now(), $${inns.length + 1}, $${inns.length + 2}::jsonb, 'queued', $${inns.length + 3}, 0, NULL, NULL, NULL, NULL, NULL
      FROM (VALUES ${placeholders}) AS v(inn_val)
      ON CONFLICT (inn) DO UPDATE
      SET queued_at = EXCLUDED.queued_at,
          queued_by = EXCLUDED.queued_by,
          payload = EXCLUDED.payload,
          state = 'queued',
          priority = EXCLUDED.priority,
          attempt_count = 0,
          next_retry_at = NULL,
          lease_expires_at = NULL,
          started_at = NULL,
          last_error = NULL,
          last_error_kind = NULL
    `;

    await dbBitrix.query(sql, [...inns, requestedBy, JSON.stringify(payload), queuePriority]);
    await markQueuedMany(inns);
    void triggerAiAnalysisQueueProcessing();
    void syncAiAnalysisQueueWatchdog();

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

    const deleteRes = await dbBitrix.query<{ inn: string }>(
      `DELETE FROM ai_analysis_queue WHERE inn = ANY($1::text[]) AND state = 'queued' RETURNING inn`,
      [inns],
    );
    const removedInns = (deleteRes.rows ?? []).map((row) => row.inn).filter(Boolean);
    const removed = deleteRes.rowCount ?? removedInns.length;

    const runningRes = await dbBitrix.query<{ inn: string }>(
      `SELECT inn FROM ai_analysis_queue WHERE inn = ANY($1::text[]) AND state = 'running'`,
      [inns],
    );
    const running = runningRes.rowCount ?? (runningRes.rows?.length ?? 0);

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
        .query(`UPDATE dadata_result SET ${updates.join(', ')} WHERE inn = ANY($1::text[])`, [removedInns])
        .catch((error) => console.warn('queue delete: failed to reset dadata_result', error));
    }

    void syncAiAnalysisQueueWatchdog();

    return NextResponse.json({ ok: true, removed, running });
  } catch (error) {
    console.error('DELETE /api/ai-analysis/queue error', error);
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

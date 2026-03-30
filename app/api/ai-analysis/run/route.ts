import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { db } from '@/lib/db';
import type { PoolClient } from 'pg';
import { getSession } from '@/lib/auth';
import { aiRequestId, callAiIntegration, getAiIntegrationBase } from '@/lib/ai-integration';
import { logAiDebugEvent } from '@/lib/ai-debug';
import {
  getForcedLaunchMode,
  getForcedSteps,
  getHealthTimeoutMs,
  getOverallTimeoutMs,
  getStepTimeoutMs,
  isLaunchModeLocked,
} from '@/lib/ai-analysis-config';
import { setAiAnalysisQueueTrigger, setAiAnalysisQueueWatchdogSync } from '@/lib/ai-analysis-queue-trigger';
import { resolveAiAnalysisQueuePriority } from '@/lib/ai-analysis-queue-priority';
import {
  QUEUE_WATCHDOG_RETRY_MS,
  QUEUE_WATCHDOG_GRACE_MS,
  resolveAiAnalysisQueueWatchdogDelay,
  shouldReuseAiAnalysisQueueWatchdog,
} from '@/lib/ai-analysis-queue-watchdog';
import { DEFAULT_STEPS, type StepKey } from '@/lib/ai-analysis-types';
import { getDadataColumns } from '@/lib/dadata-columns';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

let ensuredQueue = false;
let ensuredCommands = false;
let queueRunnerPromise: Promise<void> | null = null;
let queueWatchdogTimer: NodeJS.Timeout | null = null;
let queueWatchdogDueAtMs: number | null = null;
const PROCESS_LOCK_KEY = 42_111;
const MAX_STEP_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const MAX_COMPANY_ATTEMPTS = 3;
const MAX_FAILURE_STREAK = 5;
const STALE_QUEUE_MS = 2 * 60 * 60 * 1000;
const QUEUE_LEASE_MS = 10 * 60 * 1000;
const QUEUE_HEARTBEAT_MS = 60 * 1000;
const QUEUE_LEASE_INTERVAL = `${Math.max(1, Math.ceil(QUEUE_LEASE_MS / 60_000))} minutes`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureQueueTable() {
  if (ensuredQueue) return;
  await dbBitrix.query(`
    CREATE TABLE IF NOT EXISTS ai_analysis_queue (
      inn text PRIMARY KEY,
      queued_at timestamptz NOT NULL DEFAULT now(),
      queued_by text,
      payload jsonb,
      state text NOT NULL DEFAULT 'queued',
      priority integer NOT NULL DEFAULT 100,
      lease_expires_at timestamptz,
      started_at timestamptz,
      last_error text
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
    CREATE INDEX IF NOT EXISTS ai_analysis_queue_state_queued_at_idx
      ON ai_analysis_queue (state, priority, queued_at)
  `);
  await dbBitrix.query(`
    CREATE INDEX IF NOT EXISTS ai_analysis_queue_lease_expires_at_idx
      ON ai_analysis_queue (lease_expires_at)
  `);
  ensuredQueue = true;
}

async function ensureCommandsTable() {
  if (ensuredCommands) return;
  await dbBitrix.query(`
    CREATE TABLE IF NOT EXISTS ai_analysis_commands (
      id bigserial PRIMARY KEY,
      action text NOT NULL,
      payload jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_commands
      ADD COLUMN IF NOT EXISTS payload jsonb
  `);
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_commands
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()
  `);
  await dbBitrix.query(`
    ALTER TABLE ai_analysis_commands
      ADD COLUMN IF NOT EXISTS action text NOT NULL
  `);
  ensuredCommands = true;
}

async function acquireQueueLock(): Promise<PoolClient | null> {
  let client: PoolClient | null = null;
  try {
    client = await dbBitrix.connect();
    const res = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
      PROCESS_LOCK_KEY,
    ]);
    if (res.rows?.[0]?.locked) {
      return client;
    }
  } catch (error) {
    console.warn('Failed to acquire AI analysis queue lock', error);
  }

  client?.release();
  return null;
}

function scheduleQueueRetry() {
  if (queueRunnerPromise) return;

  queueRunnerPromise = (async () => {
    try {
      const lockClient = await acquireQueueLock();
      if (!lockClient) {
        return;
      }

      try {
        await processQueue(lockClient);
      } finally {
        await releaseQueueLock(lockClient);
      }
    } catch (error) {
      console.error('AI analysis queue runner failed', error);
    } finally {
      queueRunnerPromise = null;

      // Если после завершения остались элементы, запустим новую попытку.
      void syncQueueWatchdog();
    }
  })();
}

function clearQueueWatchdog() {
  if (queueWatchdogTimer) {
    clearTimeout(queueWatchdogTimer);
    queueWatchdogTimer = null;
  }
  queueWatchdogDueAtMs = null;
}

function scheduleQueueWatchdog(delayMs: number) {
  const safeDelayMs = Math.max(1000, Math.floor(delayMs));
  const dueAtMs = Date.now() + safeDelayMs;

  if (shouldReuseAiAnalysisQueueWatchdog(queueWatchdogDueAtMs, dueAtMs)) {
    return;
  }

  clearQueueWatchdog();
  queueWatchdogDueAtMs = dueAtMs;
  queueWatchdogTimer = setTimeout(() => {
    clearQueueWatchdog();
    void triggerQueueProcessing();
  }, safeDelayMs);

  if (typeof queueWatchdogTimer.unref === 'function') {
    queueWatchdogTimer.unref();
  }
}

async function syncQueueWatchdog() {
  await ensureQueueTable();

  const res = await dbBitrix.query<{ queued_count: number; next_lease_ms: number | null }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE state = 'queued')::int AS queued_count,
        MIN(
          CASE
            WHEN state = 'running' AND lease_expires_at IS NOT NULL
              THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (lease_expires_at - now())) * 1000))::bigint
            ELSE NULL
          END
        )::bigint AS next_lease_ms
      FROM ai_analysis_queue
      WHERE state IN ('queued', 'running')
    `,
  );

  const queuedCount = Number(res.rows?.[0]?.queued_count ?? 0);
  const nextLeaseMs = res.rows?.[0]?.next_lease_ms;

  const nextDelayMs = resolveAiAnalysisQueueWatchdogDelay({
    runnerActive: Boolean(queueRunnerPromise),
    queuedCount,
    nextLeaseMs,
  });

  if (nextDelayMs != null) {
    scheduleQueueWatchdog(nextDelayMs);
    return;
  }

  clearQueueWatchdog();
}

async function releaseQueueLock(client: PoolClient | null) {
  if (!client) return;
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [PROCESS_LOCK_KEY]);
  } catch (error) {
    console.warn('Failed to release AI analysis queue lock', error);
  } finally {
    client.release();
  }
}

function normalizeInns(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(raw.map((v) => (v == null ? '' : String(v).trim())).filter((v) => v.length > 0)),
  );
}

type QueueState = 'queued' | 'running';

async function removeFromQueue(inns: string[], states?: QueueState[]) {
  if (!inns.length) return [] as string[];
  await ensureQueueTable();
  if (states?.length) {
    const res = await dbBitrix.query<{ inn: string }>(
      'DELETE FROM ai_analysis_queue WHERE inn = ANY($1::text[]) AND state = ANY($2::text[]) RETURNING inn',
      [inns, states],
    );
    return (res.rows ?? []).map((row) => row.inn).filter(Boolean);
  }
  const res = await dbBitrix.query<{ inn: string }>(
    'DELETE FROM ai_analysis_queue WHERE inn = ANY($1::text[]) RETURNING inn',
    [inns],
  );
  return (res.rows ?? []).map((row) => row.inn).filter(Boolean);
}

async function enqueueItem(inn: string, payload: Record<string, unknown>, queuedBy: string | null) {
  await ensureQueueTable();
  const priority = resolveAiAnalysisQueuePriority(payload.source, Number(payload.count ?? 1));
  await dbBitrix.query(
    `INSERT INTO ai_analysis_queue (inn, queued_at, queued_by, payload, state, priority, lease_expires_at, started_at, last_error)
     VALUES ($1, now(), $2, $3::jsonb, 'queued', $4, NULL, NULL, NULL)
     ON CONFLICT (inn) DO UPDATE
     SET queued_at = EXCLUDED.queued_at,
         queued_by = COALESCE(EXCLUDED.queued_by, ai_analysis_queue.queued_by),
         payload = EXCLUDED.payload,
         state = 'queued',
         priority = EXCLUDED.priority,
         lease_expires_at = NULL,
         started_at = NULL,
         last_error = NULL`,
    [inn, queuedBy, JSON.stringify(payload), priority],
  );
}

type QueueItem = {
  inn: string;
  payload: Record<string, unknown> | null;
  queued_at: string | null;
  queued_by: string | null;
  state: QueueState | null;
  priority: number | null;
  lease_expires_at: string | null;
  started_at: string | null;
  last_error: string | null;
  previous_state: QueueState | null;
};

async function claimNextQueueItem(): Promise<QueueItem | null> {
  await ensureQueueTable();
  const columns = await getDadataColumns();

  const outcomeCol = columns.outcome ? `LOWER(COALESCE(d."${columns.outcome}", ''))` : null;
  const statusCol = columns.status ? `LOWER(COALESCE(d."${columns.status}", ''))` : null;
  const progressCol = columns.progress ? `COALESCE(d."${columns.progress}", 0)` : null;
  const finishedCol = columns.finishedAt ? `d."${columns.finishedAt}"` : null;

  const incompleteOutcomeSql = outcomeCol ? `${outcomeCol} IN ('partial', 'failed')` : 'FALSE';
  const notStartedOutcomeSql = outcomeCol
    ? `${outcomeCol} IN ('not_started', 'pending', '')`
    : finishedCol
      ? `${finishedCol} IS NULL`
      : 'TRUE';
  const incompleteProgressSql = progressCol
    ? `${progressCol} > 0 AND ${progressCol} < 0.999`
    : 'FALSE';
  const failedStatusSql = statusCol
    ? `${statusCol} SIMILAR TO '%(failed|error|partial)%'`
    : 'FALSE';

  const res = await dbBitrix.query<QueueItem>(
    `
      WITH next_item AS (
        SELECT
          q.inn,
          q.payload,
          q.queued_at,
          q.queued_by,
          q.state,
          q.priority,
          q.lease_expires_at,
          q.started_at,
          q.last_error,
          CASE WHEN q.state = 'running' THEN 0 ELSE 1 END AS lease_priority,
          COALESCE(d.retry_priority, 2) AS retry_priority
        FROM ai_analysis_queue q
        LEFT JOIN LATERAL (
          SELECT CASE
            WHEN ${incompleteOutcomeSql} OR ${incompleteProgressSql} OR ${failedStatusSql} THEN 0
            WHEN ${notStartedOutcomeSql} THEN 1
            ELSE 2
          END AS retry_priority
          FROM dadata_result d
          WHERE d.inn = q.inn
        ) d ON TRUE
        WHERE q.state = 'queued' OR (q.state = 'running' AND q.lease_expires_at IS NOT NULL AND q.lease_expires_at < now())
        ORDER BY lease_priority ASC, q.priority ASC, retry_priority ASC, q.queued_at ASC
        LIMIT 1
        FOR UPDATE OF q SKIP LOCKED
      )
      UPDATE ai_analysis_queue q
      SET
        state = 'running',
        started_at = now(),
        lease_expires_at = now() + interval '${QUEUE_LEASE_INTERVAL}'
      FROM next_item
      WHERE q.inn = next_item.inn
      RETURNING
        q.inn,
        q.payload,
        q.queued_at,
        q.queued_by,
        q.state,
        q.priority,
        q.lease_expires_at,
        q.started_at,
        q.last_error,
        next_item.state AS previous_state
    `,
  );
  return res.rows?.[0] ?? null;
}

async function cleanupStaleQueueItems() {
  await ensureQueueTable();
  const reclaimed = await dbBitrix.query<QueueItem>(
    `
      UPDATE ai_analysis_queue
      SET
        state = 'queued',
        lease_expires_at = NULL,
        started_at = NULL,
        last_error = COALESCE(last_error, 'Queue lease expired before task completion')
      WHERE
        state = 'running'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < now()
      RETURNING
        inn,
        payload,
        queued_at,
        queued_by,
        state,
        lease_expires_at,
        started_at,
        last_error,
        'running'::text AS previous_state
    `,
  );

  if (reclaimed.rows?.length) {
    await safeLog({
      type: 'notification',
      source: 'ai-integration',
      message: 'Найдены задачи с протухшим lease, они возвращены в очередь',
      payload: { inns: reclaimed.rows.map((row) => row.inn) },
    });
  }

  const res = await dbBitrix.query<QueueItem>(
    `
      DELETE FROM ai_analysis_queue
      WHERE
        state = 'queued'
        AND payload ? 'defer_count'
        AND COALESCE(NULLIF(payload->>'defer_count', ''), '0')::int >= $1
      RETURNING
        inn,
        payload,
        queued_at,
        queued_by,
        state,
        lease_expires_at,
        started_at,
        last_error,
        state AS previous_state
    `,
    [MAX_COMPANY_ATTEMPTS],
  );

  if (!res.rows?.length) return;

  const staleInns: string[] = [];
  for (const row of res.rows) {
    const inn = row.inn;
    staleInns.push(inn);
    const deferCountRaw = row.payload && typeof row.payload === 'object' ? (row.payload as any).defer_count : null;
    const deferCount = Number.isFinite(deferCountRaw) ? Number(deferCountRaw) : 0;
    const attempts = Math.max(1, deferCount + 1);
    await markFinished(
      inn,
      { status: 'failed', durationMs: 0 },
      { attempts, outcome: 'failed' },
    );
  }

  await safeLog({
    type: 'notification',
    source: 'ai-integration',
    message: 'Удалены зависшие элементы из очереди AI-анализа',
    payload: { inns: staleInns },
  });
}

async function refreshQueueLease(inn: string) {
  await ensureQueueTable();
  await dbBitrix.query(
    `
      UPDATE ai_analysis_queue
      SET lease_expires_at = now() + interval '${QUEUE_LEASE_INTERVAL}'
      WHERE inn = $1 AND state = 'running'
    `,
    [inn],
  );
}

function startQueueLeaseHeartbeat(inn: string) {
  const timer = setInterval(() => {
    void refreshQueueLease(inn).catch((error) => console.warn(`queue lease heartbeat failed for ${inn}`, error));
  }, QUEUE_HEARTBEAT_MS);

  if (typeof (timer as NodeJS.Timeout).unref === 'function') {
    timer.unref();
  }

  return () => clearInterval(timer);
}

async function getCompanyNames(inns: string[]): Promise<Map<string, string>> {
  if (!inns.length) return new Map();
  const placeholders = inns.map((_, idx) => `$${idx + 1}`).join(', ');
  const { rows } = await dbBitrix.query<{ inn: string; short_name: string }>(
    `SELECT inn, short_name FROM dadata_result WHERE inn IN (${placeholders})`,
    inns,
  );

  const map = new Map<string, string>();
  for (const row of rows ?? []) {
    if (row?.inn) {
      map.set(row.inn, row.short_name ?? '');
    }
  }
  return map;
}

type StepAttempt = {
  path: (inn: string) => string;
  label: string;
  method: 'GET' | 'POST';
  body?: (inn: string, context?: { clientId: number | null }) => Record<string, unknown>;
};

type StepDefinition = {
  primary: StepAttempt;
  fallbacks?: StepAttempt[];
};

type RunResult = {
  ok: boolean;
  status: number;
  error?: string;
  progress?: number;
  completedSteps?: StepKey[];
  outcome?: 'completed' | 'partial' | 'failed';
  failedSteps?: string[];
  parseSiteOkvedFallback?: boolean;
  analyzeJsonOkvedFallback?: boolean;
};

type StepRunResult = {
  step: StepKey;
  ok: boolean;
  status: number;
  error?: string;
  okvedFallbackUsed?: boolean;
};

type StepRuntimeFlags = {
  parseSiteOkvedFallback: boolean;
  analyzeJsonOkvedFallback: boolean;
};

type PipelineFullResponsePayload = {
  ok?: unknown;
  status?: unknown;
  errors?: unknown;
  completed_steps?: unknown;
  failed_steps?: unknown;
  lookup_card?: unknown;
  parse_site?: unknown;
  analyze_json?: unknown;
  ib_match?: unknown;
  equipment_selection?: unknown;
};

type PipelineStepErrorPayload = {
  step?: unknown;
  detail?: unknown;
};

const FULL_PIPELINE_STEP_KEYS = [
  'lookup_card',
  'parse_site',
  'analyze_json',
  'ib_match',
  'equipment_selection',
] as const;

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of raw) {
    const value = String(item ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function inferCompletedPipelineSteps(payload: PipelineFullResponsePayload): string[] {
  const explicit = normalizeStringList(payload.completed_steps);
  if (explicit.length) return explicit;

  return FULL_PIPELINE_STEP_KEYS.filter((step) => payload[step] != null);
}

function normalizePipelineErrors(raw: unknown): PipelineStepErrorPayload[] {
  if (!Array.isArray(raw)) return [];

  return raw.filter((item): item is PipelineStepErrorPayload => Boolean(item && typeof item === 'object'));
}

function summarizePipelineErrors(errors: PipelineStepErrorPayload[]): string | undefined {
  const parts = errors
    .map((error) => {
      const step = String(error.step ?? '').trim();
      const detail = String(error.detail ?? '').trim();
      if (step && detail) return `${step}: ${detail}`;
      return step || detail;
    })
    .filter(Boolean);

  if (!parts.length) return undefined;
  return parts.slice(0, 3).join('; ');
}

function extractPipelineRunResult(data: unknown, transportStatus: number): RunResult {
  if (!data || typeof data !== 'object') {
    return {
      ok: false,
      status: transportStatus,
      outcome: 'failed',
      error: 'AI integration returned an invalid pipeline response',
    };
  }

  const payload = data as PipelineFullResponsePayload;
  const errors = normalizePipelineErrors(payload.errors);
  const completedSteps = inferCompletedPipelineSteps(payload);
  const failedStepsFromErrors = normalizeStringList(errors.map((error) => error.step));
  const failedSteps = normalizeStringList(payload.failed_steps).length
    ? normalizeStringList(payload.failed_steps)
    : failedStepsFromErrors;
  const explicitStatus = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : '';
  const explicitOk = typeof payload.ok === 'boolean' ? payload.ok : null;

  let outcome: 'completed' | 'partial' | 'failed';
  if (explicitStatus === 'completed' || explicitOk === true) {
    outcome = errors.length === 0 && failedSteps.length === 0 ? 'completed' : 'partial';
  } else if (explicitStatus === 'failed') {
    outcome = 'failed';
  } else if (explicitStatus === 'partial') {
    outcome = 'partial';
  } else if (errors.length === 0 && failedSteps.length === 0) {
    outcome = explicitOk === false ? 'partial' : 'completed';
  } else {
    outcome = completedSteps.length > 0 ? 'partial' : 'failed';
  }

  const progressBase = FULL_PIPELINE_STEP_KEYS.length ? completedSteps.length / FULL_PIPELINE_STEP_KEYS.length : undefined;
  const progress = outcome === 'completed' ? 1 : progressBase;
  const error =
    outcome === 'completed'
      ? undefined
      : summarizePipelineErrors(errors) ??
        (failedSteps.length
          ? `Pipeline finished with ${outcome} status (${failedSteps.join(', ')})`
          : `Pipeline finished with ${outcome} status`);

  return {
    ok: outcome === 'completed',
    status: transportStatus,
    error,
    progress,
    outcome,
    failedSteps,
  };
}

const STEP_DEFINITIONS: Record<StepKey, StepDefinition> = {
  lookup: {
    primary: {
      path: (inn) => `/v1/lookup/${encodeURIComponent(inn)}/card`,
      label: 'Карта компании (lookup)',
      method: 'GET',
    },
    fallbacks: [
      {
        path: () => '/v1/lookup/card',
        label: 'POST lookup/card',
        method: 'POST',
        body: (inn) => ({ inn }),
      },
    ],
  },
  parse_site: {
    primary: {
      path: () => '/v1/parse-site',
      label: 'Парсинг сайта',
      method: 'POST',
      body: (inn) => ({ inn }),
    },
    fallbacks: [
      {
        path: (inn) => `/v1/parse-site/${encodeURIComponent(inn)}`,
        label: 'GET parse-site',
        method: 'GET',
      },
    ],
  },
  analyze_json: {
    primary: {
      path: (inn) => `/v1/analyze-json/${encodeURIComponent(inn)}`,
      label: 'AI-анализ',
      method: 'GET',
    },
    fallbacks: [
      {
        path: () => '/v1/analyze-json',
        label: 'POST analyze-json',
        method: 'POST',
        body: (inn) => ({ inn }),
      },
    ],
  },
  ib_match: {
    primary: {
      path: (inn) => `/v1/ib-match/by-inn?inn=${encodeURIComponent(inn)}`,
      label: 'Сопоставление продклассов',
      method: 'GET',
    },
    fallbacks: [
      {
        path: () => '/v1/ib-match/by-inn',
        label: 'POST ib-match/by-inn',
        method: 'POST',
        body: (inn) => ({ inn }),
      },
    ],
  },
  equipment_selection: {
    primary: {
      path: (inn) => `/v1/equipment-selection/by-inn/${encodeURIComponent(inn)}`,
      label: 'Подбор оборудования',
      method: 'GET',
    },
  },
};


function normalizeSteps(raw: unknown, fallback: StepKey[] = DEFAULT_STEPS): StepKey[] {
  if (!Array.isArray(raw)) return fallback;

  const seen = new Set<StepKey>();
  const ordered: StepKey[] = [];

  for (const item of raw) {
    const key = String(item || '')
      .toLowerCase()
      .replace(/[-\s]+/g, '_') as StepKey;
    if (key in STEP_DEFINITIONS && !seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }

  return ordered.length ? ordered : fallback;
}

async function safeLog(entry: Parameters<typeof logAiDebugEvent>[0]) {
  try {
    await logAiDebugEvent(entry);
  } catch (error) {
    console.warn('AI debug log skipped', error);
  }
}

async function ensureIntegrationHealthy(context: {
  inn?: string;
  stepLabel?: string;
  attempt: number;
  totalAttempts: number;
}) {
  const path = '/health';

  await safeLog({
    type: 'request',
    source: 'ai-integration',
    companyId: context.inn,
    message: `Проверка /health перед шагом ${context.stepLabel ?? 'pipeline'} (${context.attempt}/${context.totalAttempts})`,
    payload: { path, method: 'GET' },
  });

  const health = await callAiIntegration(path, { timeoutMs: getHealthTimeoutMs() });
  if (!health.ok || (health.data as { ok?: boolean } | null)?.ok === false) {
    const errorDetail = !health.ok
      ? health.error
      : ((health.data as { detail?: string } | null)?.detail ?? 'AI integration health check failed');
    await safeLog({
      type: 'error',
      source: 'ai-integration',
      companyId: context.inn,
      message: `AI integration недоступна перед шагом ${context.stepLabel ?? 'pipeline'}: ${errorDetail} (попытка ${context.attempt}/${context.totalAttempts})`,
      payload: { status: health.status },
    });
    return { ok: false as const, status: health.status, error: errorDetail };
  }
  await safeLog({
    type: 'response',
    source: 'ai-integration',
    companyId: context.inn,
    message: `Health ok перед шагом ${context.stepLabel ?? 'pipeline'}`,
    payload: { path, status: health.status, data: health.data },
  });
  return { ok: true as const };
}

function hasOkvedFallbackSignal(data: unknown): boolean {
  const extracted = extractAnalyzeJsonFallback(data);
  if (extracted.used) return true;

  if (!data || typeof data !== 'object') return false;

  const root = data as {
    okved_fallback_used?: boolean;
    site_unavailable?: unknown;
    external_response?: { site_unavailable?: unknown };
    external_response_raw?: { site_unavailable?: unknown };
    runs?: Array<{
      okved_fallback_used?: boolean;
      site_unavailable?: unknown;
      external_response?: { site_unavailable?: unknown };
      external_response_raw?: { site_unavailable?: unknown };
    }>;
  };

  if (root.okved_fallback_used === true) return true;
  if (root.site_unavailable) return true;
  if (root.external_response?.site_unavailable) return true;
  if (root.external_response_raw?.site_unavailable) return true;

  return Boolean(
    root.runs?.some(
      (run) =>
        run?.okved_fallback_used === true ||
        Boolean(run?.site_unavailable) ||
        Boolean(run?.external_response?.site_unavailable) ||
        Boolean(run?.external_response_raw?.site_unavailable),
    ),
  );
}

function parseProdclassIdFromValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const direct = Number(value.trim());
    if (Number.isFinite(direct)) {
      return Math.trunc(direct);
    }

    const match = value.match(/\d+/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) {
        return Math.trunc(parsed);
      }
    }
  }

  return null;
}

function extractProdclassByOkved(payload: Record<string, unknown>): number | null {
  const direct = parseProdclassIdFromValue(payload.prodclass_by_okved ?? payload.prodclass);
  if (direct != null) return direct;

  const parsed = payload.parsed;
  if (parsed && typeof parsed === 'object') {
    const value = parseProdclassIdFromValue((parsed as Record<string, unknown>).PRODCLASS);
    if (value != null) return value;
    return parseProdclassIdFromValue((parsed as Record<string, unknown>).prodclass);
  }

  return parseProdclassIdFromValue(payload.answer ?? payload.raw_response ?? payload.response);
}

function extractAnalyzeJsonFallback(data: unknown): { used: boolean; prodclassByOkved: number | null } {
  if (!data || typeof data !== 'object') {
    return { used: false, prodclassByOkved: null };
  }

  const root = data as Record<string, unknown>;
  const candidates: Record<string, unknown>[] = [root];

  const siteUnavailable = root.site_unavailable;
  if (siteUnavailable && typeof siteUnavailable === 'object') {
    candidates.push(siteUnavailable as Record<string, unknown>);
  }

  const externalResponse = root.external_response;
  if (externalResponse && typeof externalResponse === 'object') {
    candidates.push(externalResponse as Record<string, unknown>);
    const nested = (externalResponse as Record<string, unknown>).site_unavailable;
    if (nested && typeof nested === 'object') {
      candidates.push(nested as Record<string, unknown>);
    }
  }

  const externalResponseRaw = root.external_response_raw;
  if (externalResponseRaw && typeof externalResponseRaw === 'object') {
    candidates.push(externalResponseRaw as Record<string, unknown>);
    const nested = (externalResponseRaw as Record<string, unknown>).site_unavailable;
    if (nested && typeof nested === 'object') {
      candidates.push(nested as Record<string, unknown>);
    }
  }

  const runs = Array.isArray(root.runs) ? root.runs : [];
  for (const run of runs) {
    if (run && typeof run === 'object') {
      candidates.push(run as Record<string, unknown>);
      const nested = (run as Record<string, unknown>).site_unavailable;
      if (nested && typeof nested === 'object') {
        candidates.push(nested as Record<string, unknown>);
      }
    }
  }

  let used = false;
  let prodclassByOkved: number | null = null;

  for (const item of candidates) {
    if (item.okved_fallback_used === true || Boolean(item.site_unavailable)) {
      used = true;
    }

    if (prodclassByOkved == null) {
      prodclassByOkved = extractProdclassByOkved(item);
    }
  }

  return { used, prodclassByOkved };
}

async function saveOkvedFallbackToDadata(inn: string, prodclassByOkved: number): Promise<void> {
  const { rows } = await dbBitrix.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dadata_result'`,
  );
  const names = new Set((rows ?? []).map((row) => row.column_name));

  const prodclassColumn = ['prodclass_by_okved', 'analysis_prodclass_by_okved', 'prodclass_by_okved_score'].find((name) =>
    names.has(name),
  );
  const analysisClassColumn = ['analysis_class', 'analysis_found_class'].find((name) => names.has(name));

  const setters: string[] = [];
  const values: any[] = [inn];

  if (prodclassColumn) {
    values.push(prodclassByOkved);
    setters.push(`"${prodclassColumn}" = COALESCE("${prodclassColumn}", $${values.length})`);
  }

  if (analysisClassColumn) {
    values.push(String(prodclassByOkved));
    setters.push(`"${analysisClassColumn}" = COALESCE("${analysisClassColumn}", $${values.length})`);
  }

  if (!setters.length) return;

  await dbBitrix.query(`UPDATE dadata_result SET ${setters.join(', ')} WHERE inn = $1`, values);
}

async function persistOkvedFallbackState(inn: string, data: unknown): Promise<boolean> {
  const extracted = extractAnalyzeJsonFallback(data);
  if (extracted.prodclassByOkved != null) {
    await saveOkvedFallbackToDadata(inn, extracted.prodclassByOkved).catch((error) =>
      console.warn('failed to persist prodclass_by_okved fallback', error),
    );
  }

  return hasOkvedFallbackSignal(data);
}

async function getClientRequestIdByInn(inn: string): Promise<number | null> {
  const sql = 'SELECT id FROM clients_requests WHERE inn = $1 ORDER BY id DESC LIMIT 1';

  try {
    for (const source of [
      { label: 'main-db', run: () => db.query<{ id: number }>(sql, [inn]) },
      { label: 'bitrix-db', run: () => dbBitrix.query<{ id: number }>(sql, [inn]) },
    ] as const) {
      try {
        const { rows } = await source.run();
        const rawId = rows?.[0]?.id;
        if (Number.isFinite(rawId)) {
          return Number(rawId);
        }
      } catch (error) {
        console.warn(`Failed to resolve client_id from ${source.label}`, { inn, error });
      }
    }
  } catch (error) {
    console.warn('Failed to resolve client_id for ib-match fallback', { inn, error });
  }

  return null;
}

async function runStep(
  inn: string,
  step: StepKey,
  timeoutMs: number,
  runtimeFlags: StepRuntimeFlags = {
    parseSiteOkvedFallback: false,
    analyzeJsonOkvedFallback: false,
  },
): Promise<StepRunResult> {
  const definition = STEP_DEFINITIONS[step];
  const attempts: StepAttempt[] = [definition.primary, ...(definition.fallbacks ?? [])];
  const clientId = step === 'ib_match' ? await getClientRequestIdByInn(inn) : null;

  if (step === 'ib_match' && clientId != null) {
    attempts.splice(1, 0, {
      path: () => '/v1/ib-match',
      label: 'POST ib-match (client_id)',
      method: 'POST',
      body: (currentInn, context) => ({ inn: currentInn, client_id: context?.clientId }),
    });
  }

  let lastError: string | undefined;
  let lastStatus = 0;

  for (let attemptNo = 1; attemptNo <= MAX_STEP_ATTEMPTS; attemptNo++) {
    const health = await ensureIntegrationHealthy({
      inn,
      stepLabel: definition.primary.label,
      attempt: attemptNo,
      totalAttempts: MAX_STEP_ATTEMPTS,
    });
    if (!health.ok) {
      lastStatus = health.status;
      lastError = health.error;
    } else {
      for (const attempt of attempts) {
        const requestId = aiRequestId();
        const path = attempt.path(inn);
        const init: RequestInit & { timeoutMs?: number } = { method: attempt.method };

        const requestBody = attempt.body?.(inn, { clientId });
        if (requestBody) {
          init.body = JSON.stringify(requestBody);
        }

        await safeLog({
          type: 'request',
          source: 'ai-integration',
          requestId,
          companyId: inn,
          message: `Старт шага: ${definition.primary.label} (${attempt.label}), попытка ${attemptNo}/${MAX_STEP_ATTEMPTS}`,
          payload: { path, method: attempt.method, body: requestBody },
        });

        const res = await callAiIntegration(path, { ...init, timeoutMs });
        lastStatus = res.status;

        if (res.ok) {
          const okvedFallbackUsed =
            step === 'parse_site' || step === 'analyze_json'
              ? await persistOkvedFallbackState(inn, res.data)
              : false;
          await safeLog({
            type: 'response',
            source: 'ai-integration',
            requestId,
            companyId: inn,
            message: `Step completed: ${definition.primary.label} (${attempt.label})`,
            payload: { path, method: attempt.method, status: res.status, okvedFallbackUsed, data: res.data },
          });
          return { step, ok: true, status: res.status, okvedFallbackUsed };
        }

      lastError = res.error;
      await safeLog({
        type: 'error',
        source: 'ai-integration',
        requestId,
        companyId: inn,
        message: `Ошибка шага ${definition.primary.label} (${attempt.label}): ${res.error}`,
        payload: { path, method: attempt.method, status: res.status },
      });
    }
  }

    if (attemptNo < MAX_STEP_ATTEMPTS) {
      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        companyId: inn,
        message: `Повтор шага ${definition.primary.label} через ${Math.round(RETRY_DELAY_MS / 1000)}с (${attemptNo}/${MAX_STEP_ATTEMPTS})`,
        payload: { lastStatus, lastError },
      });
      await sleep(RETRY_DELAY_MS);
    }
  }

  if (step === 'ib_match') {
    const okvedFallback = runtimeFlags.analyzeJsonOkvedFallback;
    if (okvedFallback) {
      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        companyId: inn,
        message: 'Сопоставление продклассов пропущено: используется fallback по ОКВЭД',
        payload: { lastStatus, lastError },
      });
      return { step, ok: true, status: lastStatus || 200, okvedFallbackUsed: true };
    }
  }

  if (step === 'analyze_json') {
    const okvedFallback = runtimeFlags.parseSiteOkvedFallback;
    if (okvedFallback) {
      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        companyId: inn,
        message: 'AI-анализ пропущен: используется fallback по ОКВЭД из parse-site',
        payload: { lastStatus, lastError },
      });
      return { step, ok: true, status: lastStatus || 200, okvedFallbackUsed: true };
    }
  }

  return { step, ok: false, status: lastStatus, error: lastError ?? 'Unknown error' };
}

async function markRunning(inn: string, attempt?: number) {
  const columns = await getDadataColumns();
  if (!columns.status) {
    console.warn('mark running skipped: no status column in dadata_result');
    return;
  }

  const params: any[] = [inn];
  const sets = [`"${columns.status}" = 'running'`];

  if (columns.attempts && Number.isFinite(attempt)) {
    params.push(attempt);
    const idx = params.length;
    sets.push(`"${columns.attempts}" = $${idx}`);
  }

  if (columns.startedAt) {
    sets.push(`"${columns.startedAt}" = COALESCE("${columns.startedAt}", now())`);
  }

  if (columns.finishedAt) {
    sets.push(`"${columns.finishedAt}" = NULL`);
  }

  if (columns.progress) {
    sets.push(`"${columns.progress}" = 0`);
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

  const sql = `UPDATE dadata_result SET ${sets.join(', ')} WHERE inn = $1`;

  await dbBitrix.query(sql, params).catch((error) => console.warn('mark running failed', error));
}

async function markQueued(inn: string) {
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

  const sql = `UPDATE dadata_result SET ${sets.join(', ')} WHERE inn = $1`;

  await dbBitrix.query(sql, [inn]).catch((error) => console.warn('mark queued failed', error));
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

async function markFinished(
  inn: string,
  result:
    | { status: 'completed'; durationMs: number }
    | { status: 'partial' | 'failed'; durationMs: number; progress?: number },
  options?: { attempts?: number; outcome?: 'partial' | 'failed' },
) {
  const columns = await getDadataColumns();
  if (!columns.status) {
    console.warn('mark finished skipped: no status column in dadata_result');
    return;
  }

  const progress = result.status === 'completed' ? 1 : result.progress ?? null;
  const params: any[] = [inn];
  const setters: string[] = [];

  params.push(result.status);
  const statusIdx = params.length;
  setters.push(`"${columns.status}" = $${statusIdx}`);

  if (columns.finishedAt) {
    setters.push(`"${columns.finishedAt}" = now()`);
  }

  if (columns.attempts && Number.isFinite(options?.attempts)) {
    params.push(options?.attempts);
    const idx = params.length;
    setters.push(`"${columns.attempts}" = $${idx}`);
  }

  if (columns.durationMs) {
    params.push(result.durationMs);
    const idx = params.length;
    setters.push(`"${columns.durationMs}" = $${idx}`);
  }

  if (columns.progress) {
    params.push(progress);
    const idx = params.length;
    setters.push(`"${columns.progress}" = $${idx}`);
  }

  if (columns.okFlag) {
    setters.push(`"${columns.okFlag}" = CASE WHEN $${statusIdx} = 'completed' THEN 1 ELSE 0 END`);
  }

  if (columns.serverError) {
    setters.push(`"${columns.serverError}" = CASE WHEN $${statusIdx} IN ('failed', 'partial') THEN 1 ELSE 0 END`);
  }

  if (columns.outcome) {
    const outcomeValue =
      options?.outcome ?? (result.status === 'completed' ? 'completed' : result.status === 'partial' ? 'partial' : 'failed');
    params.push(outcomeValue);
    const idx = params.length;
    setters.push(`"${columns.outcome}" = $${idx}`);
  }

  if (!setters.length) {
    console.warn('mark finished skipped: no writable columns');
    return;
  }

  const sql = `UPDATE dadata_result SET ${setters.join(', ')} WHERE inn = $1`;
  await dbBitrix.query(sql, params).catch((error) => console.warn('mark finished failed', error));
}

async function markStopped(inns: string[]) {
  if (!inns.length) return;
  const columns = await getDadataColumns();
  if (!columns.status) {
    console.warn('mark stopped skipped: no status column in dadata_result');
    return;
  }

  const sets = [`"${columns.status}" = 'stopped'`];

  if (columns.startedAt) {
    sets.push(`"${columns.startedAt}" = NULL`);
  }

  if (columns.finishedAt) {
    sets.push(`"${columns.finishedAt}" = now()`);
  }

  if (columns.progress) {
    sets.push(`"${columns.progress}" = NULL`);
  }

  if (columns.outcome) {
    sets.push(`"${columns.outcome}" = 'partial'`);
  }

  const sql = `UPDATE dadata_result SET ${sets.join(', ')} WHERE inn = ANY($1::text[])`;

  await dbBitrix
    .query(sql, [inns])
    .catch((error) => console.warn('mark stopped failed', error));
}

async function consumeStopSignals(existing?: Set<string>) {
  const stopSet = existing ? new Set(existing) : new Set<string>();
  await ensureCommandsTable();
  const res = await dbBitrix.query<{ payload: any }>(
    `DELETE FROM ai_analysis_commands WHERE action = 'stop' RETURNING payload`,
  );

  const requested: string[] = [];
  for (const row of res.rows ?? []) {
    const inns = normalizeInns(row?.payload?.inns);
    if (inns.length) {
      requested.push(...inns);
    }
  }

  const unique = Array.from(new Set(requested));
  const fresh = unique.filter((inn) => !stopSet.has(inn));
  if (fresh.length) {
    const removedQueued = await removeFromQueue(fresh, ['queued']);
    if (removedQueued.length) {
      await markStopped(removedQueued);
    }
    fresh.forEach((inn) => stopSet.add(inn));
  }

  return { stopSet, freshStops: fresh };
}

async function runFullPipeline(inn: string, timeoutMs: number): Promise<RunResult> {
  let lastStatus = 0;
  let lastError: string | undefined;
  let lastOutcome: RunResult['outcome'];
  let lastProgress: number | undefined;
  let lastFailedSteps: string[] | undefined;

  for (let attemptNo = 1; attemptNo <= MAX_STEP_ATTEMPTS; attemptNo++) {
    const health = await ensureIntegrationHealthy({
      inn,
      stepLabel: 'Полный пайплайн',
      attempt: attemptNo,
      totalAttempts: MAX_STEP_ATTEMPTS,
    });

    if (!health.ok) {
      lastStatus = health.status;
      lastError = health.error;
    } else {
      const requestId = aiRequestId();
      await safeLog({
        type: 'request',
        source: 'ai-integration',
        requestId,
        companyId: inn,
        message: `Пуск пайплайна через /v1/pipeline/full, попытка ${attemptNo}/${MAX_STEP_ATTEMPTS}`,
        payload: { path: '/v1/pipeline/full', body: { inn } },
      });

      const res = await callAiIntegration(`/v1/pipeline/full`, {
        method: 'POST',
        body: JSON.stringify({ inn }),
        timeoutMs,
      });

      lastStatus = res.status;
      if (res.ok) {
        const pipelineResult = extractPipelineRunResult(res.data, res.status);
        await safeLog({
          type: pipelineResult.ok ? 'response' : 'error',
          source: 'ai-integration',
          requestId,
          companyId: inn,
          message: 'Пайплайн принят внешним сервисом',
          payload: res.data,
        });
        if (pipelineResult.ok) {
          return pipelineResult;
        }

        lastError = pipelineResult.error;
        lastOutcome = pipelineResult.outcome;
        lastProgress = pipelineResult.progress;
        lastFailedSteps = pipelineResult.failedSteps;
      } else {

      lastError = res.error;
      await safeLog({
        type: 'error',
        source: 'ai-integration',
        requestId,
        companyId: inn,
        message: `Ошибка при вызове AI integration: ${res.error}`,
        payload: { status: res.status },
      });
    }
    }

    if (attemptNo < MAX_STEP_ATTEMPTS) {
      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        companyId: inn,
        message: `Повтор вызова пайплайна через ${Math.round(RETRY_DELAY_MS / 1000)}с (${attemptNo}/${MAX_STEP_ATTEMPTS})`,
        payload: { lastStatus, lastError },
      });
      await sleep(RETRY_DELAY_MS);
    }
  }

  return {
    ok: false as const,
    status: lastStatus,
    error: lastError ?? 'Unknown error',
    progress: lastProgress,
    outcome: lastOutcome ?? 'failed',
    failedSteps: lastFailedSteps,
  };
}

async function hasQueuedItems(): Promise<boolean> {
  await ensureQueueTable();
  const res = await dbBitrix.query(`SELECT 1 FROM ai_analysis_queue WHERE state IN ('queued', 'running') LIMIT 1`);
  return (res.rowCount ?? 0) > 0;
}

async function processQueue(lockClient: PoolClient) {
  await cleanupStaleQueueItems();
  const integrationResults: Array<{
    inn: string;
    ok: boolean;
    status: number;
    error?: string;
    progress?: number;
    outcome?: 'completed' | 'partial' | 'failed';
    failedSteps?: string[];
    deferred?: boolean;
  }> = [];
  const perStep: Array<{ inn: string; results: Awaited<ReturnType<typeof runStep>>[] }> = [];
  const stepTimeoutMs = getStepTimeoutMs();
  const overallTimeoutMs = getOverallTimeoutMs();

  let item: QueueItem | null;
  let stopRequests = new Set<string>();
  const failedSequence = new Set<string>();

  while ((item = await claimNextQueueItem())) {
    const stopSignals = await consumeStopSignals(stopRequests);
    stopRequests = stopSignals.stopSet;
    if (stopSignals.freshStops.length) {
      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        message: 'Обнаружены сигналы остановки, часть компаний пропущена',
        payload: { inns: stopSignals.freshStops },
      });
    }

    if (stopRequests.has(item.inn)) {
      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        companyId: item.inn,
        message: 'Анализ пропущен из-за запроса на остановку',
      });
      await removeFromQueue([item.inn]);
      await markStopped([item.inn]);
      continue;
    }

    const inn = item.inn;
    const payload = (item.payload || {}) as {
      mode?: unknown;
      steps?: unknown;
      defer_count?: unknown;
      completed_steps?: unknown;
      parse_site_okved_fallback?: unknown;
      analyze_json_okved_fallback?: unknown;
    };
    const modeFromPayload: 'full' | 'steps' = payload.mode === 'full' ? 'full' : 'steps';
    const stepsFromPayload = modeFromPayload === 'steps' ? normalizeSteps(payload.steps) : null;
    const deferCount = Number.isFinite((payload as any).defer_count)
      ? Number((payload as any).defer_count)
      : 0;
    const attemptNo = Math.max(1, deferCount + 1);
    const companyNameMap = await getCompanyNames([inn]);
    const companyName = companyNameMap.get(inn);
    const startedAt = Date.now();

    if (item.previous_state === 'running') {
      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        companyId: inn,
        companyName,
        message: 'Задача восстановлена после истечения lease и возвращена в выполнение',
      });
    }

    const stopCheckBeforeRun = await consumeStopSignals(stopRequests);
    stopRequests = stopCheckBeforeRun.stopSet;
    if (stopRequests.has(inn)) {
      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        companyId: inn,
        companyName,
        message: 'Анализ отменён перед запуском по запросу пользователя',
        payload: { stopRequested: true },
      });
      await removeFromQueue([inn]);
      await markStopped([inn]);
      continue;
    }

    await safeLog({
      type: 'notification',
      source: 'ai-integration',
      companyId: inn,
      companyName,
      notificationKey: 'analysis_start',
    });

    const columns = await getDadataColumns();
    await markRunning(inn, attemptNo);
    const stopLeaseHeartbeat = startQueueLeaseHeartbeat(inn);

    const runInn = async () => {
      if (modeFromPayload === 'steps' && stepsFromPayload) {
        const completedSteps = new Set<StepKey>(normalizeSteps(payload.completed_steps, []));
        const runtimeFlags: StepRuntimeFlags = {
          parseSiteOkvedFallback: payload.parse_site_okved_fallback === true,
          analyzeJsonOkvedFallback: payload.analyze_json_okved_fallback === true,
        };
        const stepResults: Awaited<ReturnType<typeof runStep>>[] = [];
        const totalSteps = stepsFromPayload.length;
        let progress = totalSteps ? completedSteps.size / totalSteps : 0;
        const hasProgressColumn = Boolean(columns.progress);

        const updateProgress = async (value: number) => {
          if (!hasProgressColumn) return;
          await dbBitrix
            .query(`UPDATE dadata_result SET "${columns.progress}" = $2 WHERE inn = $1`, [inn, value])
            .catch((error) => console.warn('progress update failed', error));
        };

        if (progress > 0) {
          await updateProgress(progress);
        }

        for (let idx = 0; idx < stepsFromPayload.length; idx++) {
          const step = stepsFromPayload[idx];
          if (completedSteps.has(step)) {
            continue;
          }
          const res = await runStep(inn, step, stepTimeoutMs, runtimeFlags);
          stepResults.push(res);
          if (res.ok) {
            completedSteps.add(step);
            if (step === 'parse_site' && res.okvedFallbackUsed) {
              runtimeFlags.parseSiteOkvedFallback = true;
            }
            if (step === 'analyze_json' && res.okvedFallbackUsed) {
              runtimeFlags.analyzeJsonOkvedFallback = true;
            }
            progress = Math.max(progress, completedSteps.size / totalSteps);
            await updateProgress(progress);
          }
          if (!res.ok) break;
        }
        perStep.push({ inn, results: stepResults });
        const ok = completedSteps.size === totalSteps && stepResults.every((s) => s.ok);
        const lastStatus = stepResults.length ? stepResults[stepResults.length - 1]?.status : 0;
        const firstError = stepResults.find((s) => !s.ok)?.error;
        return {
          ok,
          status: lastStatus ?? 0,
          error: firstError,
          progress,
          completedSteps: Array.from(completedSteps),
          parseSiteOkvedFallback: runtimeFlags.parseSiteOkvedFallback,
          analyzeJsonOkvedFallback: runtimeFlags.analyzeJsonOkvedFallback,
        };
      }

      return runFullPipeline(inn, overallTimeoutMs);
    };

    let timedResult: RunResult;
    try {
      timedResult = (await Promise.race([
        runInn(),
        new Promise<{ ok: false; status: number; error: string }>((resolve) =>
          setTimeout(() => resolve({ ok: false, status: 504, error: 'AI integration timed out' }), overallTimeoutMs),
        ),
      ])) as RunResult;
    } catch (error: any) {
      timedResult = {
        ok: false,
        status: 500,
        error: error?.message ?? 'AI integration run failed',
      };
    } finally {
      stopLeaseHeartbeat();
    }

    const stopSignalsAfterRun = await consumeStopSignals(stopRequests);
    stopRequests = stopSignalsAfterRun.stopSet;
    if (stopRequests.has(inn)) {
      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        companyId: inn,
        companyName,
        message: 'Анализ остановлен по запросу пользователя',
        payload: { stopRequested: true },
      });
      await removeFromQueue([inn]);
      await markStopped([inn]);
      continue;
    }

    const shouldRetry = !timedResult.ok && attemptNo < MAX_COMPANY_ATTEMPTS;
    if (timedResult.ok) {
      failedSequence.clear();
    } else {
      failedSequence.add(inn);
    }

    integrationResults.push({ inn, ...timedResult, deferred: shouldRetry });

    if (!timedResult.ok && failedSequence.size >= MAX_FAILURE_STREAK) {
      const streakStatus: 'partial' | 'failed' = timedResult.outcome === 'partial' ? 'partial' : 'failed';
      await markFinished(
        inn,
        { status: streakStatus, durationMs: Date.now() - startedAt, progress: timedResult.progress },
        {
          attempts: attemptNo,
          outcome: streakStatus === 'failed' ? 'failed' : 'partial',
        },
      );
      await safeLog({
        type: 'error',
        source: 'ai-integration',
        message: 'Анализ остановлен: слишком много ошибок подряд',
        payload: { streak: Array.from(failedSequence), limit: MAX_FAILURE_STREAK },
      });
      await removeFromQueue([inn]);
      break;
    }

    if (shouldRetry) {
      const completedStepsForRetry =
        timedResult.completedSteps ??
        (modeFromPayload === 'steps' && stepsFromPayload
          ? normalizeSteps(payload.completed_steps, [])
          : []);

      const nextPayload = {
        ...payload,
        defer_count: attemptNo,
        completed_steps: completedStepsForRetry,
        parse_site_okved_fallback:
          payload.parse_site_okved_fallback === true || timedResult.parseSiteOkvedFallback === true,
        analyze_json_okved_fallback:
          payload.analyze_json_okved_fallback === true || timedResult.analyzeJsonOkvedFallback === true,
      };
      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        companyId: inn,
        companyName,
        message: `Анализ отложен после ошибки (попытка ${attemptNo + 1}/${MAX_COMPANY_ATTEMPTS})`,
        payload: { error: timedResult.error, status: timedResult.status },
      });
      await markQueued(inn);
      await enqueueItem(inn, nextPayload, item.queued_by);
      continue;
    }

    const durationMs = Date.now() - startedAt;
    const finalStatus: 'completed' | 'partial' | 'failed' =
      timedResult.ok ? 'completed' : timedResult.outcome === 'partial' ? 'partial' : 'failed';
    if (timedResult.ok) {
      await markFinished(inn, { status: 'completed', durationMs }, { attempts: attemptNo });
      await removeFromQueue([inn]);
      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        companyId: inn,
        companyName,
        notificationKey: 'analysis_success',
        message: 'Анализ завершён',
      });
    } else {
      await markFinished(
        inn,
        {
          status: finalStatus,
          durationMs,
          progress: timedResult.progress,
        },
        { attempts: attemptNo, outcome: finalStatus === 'failed' ? 'failed' : 'partial' },
      );
      await removeFromQueue([inn]);
      await safeLog({
        type: finalStatus === 'partial' ? 'notification' : 'error',
        source: 'ai-integration',
        companyId: inn,
        companyName,
        message: `Анализ завершён с ошибкой: ${timedResult.error ?? 'неизвестная ошибка'}`,
      });
    }
  }

  if (integrationResults.length) {
    await safeLog({
      type: 'notification',
      source: 'ai-integration',
      message: 'Фоновый запуск анализа завершён',
      payload: { results: integrationResults, perStep },
    });
  }
}

async function triggerQueueProcessing() {
  if (queueRunnerPromise) return queueRunnerPromise;

  queueRunnerPromise = (async () => {
    const lockClient = await acquireQueueLock();
    if (!lockClient) {
      queueRunnerPromise = null;
      void syncQueueWatchdog();
      return;
    }

    try {
      await processQueue(lockClient);
    } finally {
      await releaseQueueLock(lockClient);
      queueRunnerPromise = null;
      void syncQueueWatchdog();
    }
  })();

  return queueRunnerPromise;
}

setAiAnalysisQueueTrigger(triggerQueueProcessing);
setAiAnalysisQueueWatchdogSync(syncQueueWatchdog);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      inns?: unknown;
      payload?: unknown;
      mode?: unknown;
      steps?: unknown;
      source?: unknown;
    } | null;

    const inns = normalizeInns(body?.inns);
    if (!inns.length) {
      return NextResponse.json({ ok: false, error: 'Нет компаний для запуска' }, { status: 400 });
    }

    const integrationBase = getAiIntegrationBase();
    if (!integrationBase) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'AI integration base URL is not configured (set AI_INTEGRATION_BASE_URL or AI_INTEGRATION_BASE)',
        },
        { status: 503 },
      );
    }

    await safeLog({
      type: 'request',
      source: 'ai-integration',
      message: 'Проверка доступности AI integration перед запуском',
      payload: { path: '/health', method: 'GET' },
    });

    const health = await callAiIntegration<{ ok?: boolean; detail?: string; connections?: Record<string, string> }>('/health', {
      timeoutMs: getHealthTimeoutMs(),
    });
    const healthBodyOk = health.ok ? (health.data?.ok ?? true) : false;
    const healthError = !health.ok
      ? health.error
      : healthBodyOk
        ? undefined
        : health.data?.detail ?? 'AI integration health check failed';
    await safeLog({
      type: health.ok && healthBodyOk ? 'response' : 'error',
      source: 'ai-integration',
      message: health.ok && healthBodyOk
        ? 'AI integration доступна перед запуском'
        : `AI integration недоступна перед запуском: ${healthError}`,
      payload: { path: '/health', status: health.status, data: health.ok ? health.data : undefined },
    });
    if (!health.ok || !healthBodyOk) {
      return NextResponse.json(
        {
          ok: false,
          error: `AI integration недоступна: ${healthError}`,
        },
        { status: 502 },
      );
    }

    const payloadRaw =
      body?.payload && typeof body.payload === 'object' && body.payload !== null
        ? (body.payload as Record<string, unknown>)
        : {};

    const source =
      typeof body?.source === 'string' && body.source
        ? String(body.source)
        : typeof (payloadRaw as any).source === 'string' && (payloadRaw as any).source
          ? String((payloadRaw as any).source)
          : 'manual';

    const forcedMode = getForcedLaunchMode();
    const isDebugRequest = source === 'debug-step';
    const modeLocked = isDebugRequest ? false : isLaunchModeLocked();
    const requestedMode: 'full' | 'steps' = body?.mode === 'full' ? 'full' : 'steps';
    const mode: 'full' | 'steps' = modeLocked ? forcedMode : isDebugRequest ? 'steps' : requestedMode;
    const requestedSteps = normalizeSteps(body?.steps);
    const steps = mode === 'steps'
      ? isDebugRequest
        ? requestedSteps.slice(0, 1)
        : modeLocked
        ? getForcedSteps()
        : requestedSteps
      : null;

    const session = await getSession();
    const requestedBy = session?.login ?? session?.id?.toString() ?? null;

    const payload: Record<string, unknown> = {
      ...payloadRaw,
      source,
      count: inns.length,
      requested_at: new Date().toISOString(),
      mode,
      steps: mode === 'steps' ? steps : null,
      defer_count: 0,
      completed_steps: [],
      parse_site_okved_fallback: false,
      analyze_json_okved_fallback: false,
    };
    const queuePriority = resolveAiAnalysisQueuePriority(source, inns.length);

    const isImmediateDebugStep =
      source === 'debug-step' && mode === 'steps' && inns.length === 1 && (steps?.length ?? 0) === 1;



    if (isImmediateDebugStep) {
      const inn = inns[0];
      const step = steps![0]!;
      const stepTimeoutMs = getStepTimeoutMs();

      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        companyId: inn,
        message: 'Запуск одиночного шага для отладки (без очереди)',
        payload: { step, requestedBy, source },
      });

      const runResult = await runStep(inn, step, stepTimeoutMs);

      await safeLog({
        type: runResult.ok ? 'response' : 'error',
        source: 'ai-integration',
        companyId: inn,
        message: runResult.ok
          ? `Шаг ${step} завершился успешно (debug)`
          : `Шаг ${step} завершился ошибкой (debug): ${runResult.error ?? 'unknown'}`,
        payload: { status: runResult.status },
      });

      return NextResponse.json({
        ok: runResult.ok,
        status: runResult.status,
        error: runResult.error,
        okvedFallbackUsed: runResult.okvedFallbackUsed,
        mode,
        steps,
        integration: { base: integrationBase, mode, modeLocked, steps },
      });
    }

    await ensureQueueTable();

    const placeholders = inns.map((_, idx) => `($${idx + 1})`).join(', ');

    const sql = `
      INSERT INTO ai_analysis_queue (inn, queued_at, queued_by, payload, state, priority, lease_expires_at, started_at, last_error)
      SELECT v.inn_val, now(), $${inns.length + 1}, $${inns.length + 2}::jsonb, 'queued', $${inns.length + 3}, NULL, NULL, NULL
      FROM (VALUES ${placeholders}) AS v(inn_val)
      ON CONFLICT (inn) DO UPDATE
      SET queued_at = EXCLUDED.queued_at,
          queued_by = EXCLUDED.queued_by,
          payload = EXCLUDED.payload,
          state = 'queued',
          priority = EXCLUDED.priority,
          lease_expires_at = NULL,
          started_at = NULL,
          last_error = NULL
    `;

    await dbBitrix.query(sql, [...inns, requestedBy, JSON.stringify(payload), queuePriority]);

    await safeLog({
      type: 'notification',
      source: 'ai-integration',
      message: 'Компании поставлены в очередь на AI-анализ',
      payload: { inns, requestedBy, mode, steps, source, queuePriority },
    });

    // Немедленно помечаем компании как поставленные в очередь, чтобы UI не ждал долгий запрос
    await markQueuedMany(inns);

    const sampleInn = inns[0] ?? '{inn}';
    const stepPlan =
      mode === 'full'
        ? [
            {
              label: 'Полный пайплайн',
              request: { method: 'POST' as const, path: '/v1/pipeline/full', body: { inn: sampleInn } },
              fallbacks: [],
            },
          ]
        : (steps ?? []).map((step) => {
            const def = STEP_DEFINITIONS[step];
            return {
              step,
              label: def.primary.label,
              request: {
                method: def.primary.method,
                path: def.primary.path(sampleInn),
                body: def.primary.body?.(sampleInn),
              },
              fallbacks: (def.fallbacks ?? []).map((fb) => ({
                method: fb.method,
                path: fb.path(sampleInn),
                body: fb.body?.(sampleInn),
              })),
            };
          });

    const ack = NextResponse.json({
      ok: true,
      queued: inns.length,
      mode,
      steps,
      integration: {
        base: integrationBase,
        mode,
        modeLocked,
        steps,
        plan: stepPlan,
      },
    });

    // Запускаем обработку очереди в фоне, чтобы ответ вернулся сразу
    void triggerQueueProcessing();

    return ack;
  } catch (e) {
    console.error('POST /api/ai-analysis/run error', e);
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { getSession } from '@/lib/auth';
import { aiRequestId, callAiIntegration, getAiIntegrationBase } from '@/lib/ai-integration';
import { logAiDebugEvent } from '@/lib/ai-debug';
import {
  getForcedLaunchMode,
  getForcedSteps,
  getOverallTimeoutMs,
  getStepTimeoutMs,
  isLaunchModeLocked,
} from '@/lib/ai-analysis-config';
import { DEFAULT_STEPS, type StepKey } from '@/lib/ai-analysis-types';
import { getDadataColumns } from '@/lib/dadata-columns';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

let ensuredQueue = false;
let ensuredCommands = false;
const PROCESS_LOCK_KEY = 42_111;
const MAX_STEP_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const MAX_COMPANY_ATTEMPTS = 3;
const MAX_FAILURE_STREAK = 5;

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

async function acquireQueueLock(): Promise<boolean> {
  try {
    const res = await dbBitrix.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
      PROCESS_LOCK_KEY,
    ]);
    return !!res.rows?.[0]?.locked;
  } catch (error) {
    console.warn('Failed to acquire AI analysis queue lock', error);
    return false;
  }
}

async function releaseQueueLock() {
  try {
    await dbBitrix.query('SELECT pg_advisory_unlock($1)', [PROCESS_LOCK_KEY]);
  } catch (error) {
    console.warn('Failed to release AI analysis queue lock', error);
  }
}

function normalizeInns(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(raw.map((v) => (v == null ? '' : String(v).trim())).filter((v) => v.length > 0)),
  );
}

async function removeFromQueue(inns: string[]) {
  if (!inns.length) return;
  await ensureQueueTable();
  await dbBitrix.query('DELETE FROM ai_analysis_queue WHERE inn = ANY($1::text[])', [inns]);
}

async function enqueueItem(inn: string, payload: Record<string, unknown>, queuedBy: string | null) {
  await ensureQueueTable();
  await dbBitrix.query(
    `INSERT INTO ai_analysis_queue (inn, queued_at, queued_by, payload)
     VALUES ($1, now(), $2, $3::jsonb)
     ON CONFLICT (inn) DO UPDATE
     SET queued_at = EXCLUDED.queued_at,
         queued_by = COALESCE(EXCLUDED.queued_by, ai_analysis_queue.queued_by),
         payload = EXCLUDED.payload`,
    [inn, queuedBy, JSON.stringify(payload)],
  );
}

type QueueItem = { inn: string; payload: Record<string, unknown> | null; queued_at: string | null; queued_by: string | null };

async function dequeueNext(): Promise<QueueItem | null> {
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
          CASE
            WHEN ${incompleteOutcomeSql} OR ${incompleteProgressSql} OR ${failedStatusSql} THEN 0
            WHEN ${notStartedOutcomeSql} THEN 1
            ELSE 2
          END AS priority
        FROM ai_analysis_queue q
        LEFT JOIN dadata_result d ON d.inn = q.inn
        ORDER BY priority ASC, q.queued_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM ai_analysis_queue q
      USING next_item
      WHERE q.inn = next_item.inn
      RETURNING q.inn, q.payload, q.queued_at, q.queued_by
    `,
  );
  return res.rows?.[0] ?? null;
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
  body?: boolean;
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
};

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
        body: true,
      },
    ],
  },
  parse_site: {
    primary: { path: () => '/v1/parse-site', label: 'Парсинг сайта', method: 'POST', body: true },
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
        body: true,
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
        path: () => '/v1/ib-match',
        label: 'POST ib-match',
        method: 'POST',
        body: true,
      },
      {
        path: () => '/v1/ib-match/by-inn',
        label: 'POST ib-match/by-inn',
      method: 'POST',
      body: true,
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

function normalizeSteps(raw: unknown): StepKey[] {
  if (!Array.isArray(raw)) return DEFAULT_STEPS;

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

  return ordered.length ? ordered : DEFAULT_STEPS;
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

  const health = await callAiIntegration(path, { timeoutMs: 3000 });
  if (!health.ok) {
    await safeLog({
      type: 'error',
      source: 'ai-integration',
      companyId: context.inn,
      message: `AI integration недоступна перед шагом ${context.stepLabel ?? 'pipeline'}: ${health.error} (попытка ${context.attempt}/${context.totalAttempts})`,
      payload: { status: health.status },
    });
    return { ok: false as const, status: health.status, error: health.error };
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

async function runStep(inn: string, step: StepKey, timeoutMs: number) {
  const definition = STEP_DEFINITIONS[step];
  const attempts: StepAttempt[] = [definition.primary, ...(definition.fallbacks ?? [])];
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

        if (attempt.body) {
          init.body = JSON.stringify({ inn });
        }

        await safeLog({
          type: 'request',
          source: 'ai-integration',
          requestId,
          companyId: inn,
          message: `Старт шага: ${definition.primary.label} (${attempt.label}), попытка ${attemptNo}/${MAX_STEP_ATTEMPTS}`,
          payload: { path, method: attempt.method, body: attempt.body ? { inn } : undefined },
        });

        const res = await callAiIntegration(path, { ...init, timeoutMs });
        lastStatus = res.status;

        if (res.ok) {
        await safeLog({
          type: 'response',
          source: 'ai-integration',
          requestId,
          companyId: inn,
          message: `Шаг успешно принят: ${definition.primary.label} (${attempt.label})`,
          payload: { path, method: attempt.method, status: res.status, data: res.data },
        });
        return { step, ok: true, status: res.status };
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

  return { step, ok: false as const, status: lastStatus, error: lastError ?? 'Unknown error' };
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
    | { status: 'failed'; durationMs: number; progress?: number },
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
    setters.push(`"${columns.serverError}" = CASE WHEN $${statusIdx} = 'failed' THEN 1 ELSE 0 END`);
  }

  if (columns.outcome) {
    const outcomeValue = options?.outcome ?? (result.status === 'completed' ? 'completed' : 'partial');
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
    await removeFromQueue(fresh);
    await markStopped(fresh);
    fresh.forEach((inn) => stopSet.add(inn));
  }

  return { stopSet, freshStops: fresh };
}

async function runFullPipeline(inn: string, timeoutMs: number): Promise<RunResult> {
  let lastStatus = 0;
  let lastError: string | undefined;

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
        await safeLog({
          type: 'response',
          source: 'ai-integration',
          requestId,
          companyId: inn,
          message: 'Пайплайн принят внешним сервисом',
          payload: res.data,
        });
        return { ok: true as const, status: res.status };
      }

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

  return { ok: false as const, status: lastStatus, error: lastError ?? 'Unknown error' };
}

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
            'AI integration base URL is not configured (set AI_INTEGRATION_BASE или AI_ANALYZE_BASE/ANALYZE_BASE)',
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

    const health = await callAiIntegration('/health', { timeoutMs: 3000 });
    await safeLog({
      type: health.ok ? 'response' : 'error',
      source: 'ai-integration',
      message: health.ok
        ? 'AI integration доступна перед запуском'
        : `AI integration недоступна перед запуском: ${health.error}`,
      payload: { path: '/health', status: health.status, data: health.ok ? health.data : undefined },
    });
    if (!health.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `AI integration недоступна: ${health.error}`,
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
    };

    const isImmediateDebugStep =
      source === 'debug-step' && mode === 'steps' && inns.length === 1 && (steps?.length ?? 0) === 1;

    const isImmediateFullRun = !isDebugRequest && mode === 'full' && inns.length === 1;
    const isImmediateSingleSteps = !isDebugRequest && mode === 'steps' && inns.length === 1;

    if (isImmediateFullRun) {
      const inn = inns[0];
      const stepTimeoutMs = getStepTimeoutMs();
      const companyNameMap = await getCompanyNames([inn]);
      const companyName = companyNameMap.get(inn);

      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        companyId: inn,
        companyName,
        message: 'Запуск полного анализа без очереди',
        payload: { requestedBy, source },
      });

      await markRunning(inn, 1);
      const startedAt = Date.now();
      const runResult = await runFullPipeline(inn, stepTimeoutMs);
      const durationMs = Date.now() - startedAt;

      if (runResult.ok) {
        await markFinished(inn, { status: 'completed', durationMs }, { attempts: 1 });
        await safeLog({
          type: 'notification',
          source: 'ai-integration',
          companyId: inn,
          companyName,
          notificationKey: 'analysis_success',
          message: 'Полный анализ завершён (без очереди)',
          payload: { status: runResult.status },
        });
      } else {
        await markFinished(
          inn,
          { status: 'failed', durationMs, progress: runResult.progress },
          { attempts: 1, outcome: 'failed' },
        );
        await safeLog({
          type: 'error',
          source: 'ai-integration',
          companyId: inn,
          companyName,
          message: `Полный анализ завершился ошибкой: ${runResult.error ?? 'unknown'}`,
          payload: { status: runResult.status },
        });
      }

      return NextResponse.json({
        ok: runResult.ok,
        status: runResult.status,
        error: runResult.error,
        mode,
        steps,
        integration: { base: integrationBase, mode, modeLocked, steps },
      });
    }

    if (isImmediateSingleSteps) {
      const inn = inns[0];
      const stepsToRun = steps && steps.length ? steps : DEFAULT_STEPS;
      const stepTimeoutMs = getStepTimeoutMs();
      const overallTimeoutMs = getOverallTimeoutMs();
      const companyNameMap = await getCompanyNames([inn]);
      const companyName = companyNameMap.get(inn);
      const columns = await getDadataColumns();
      const hasProgressColumn = Boolean(columns.progress);

      const updateProgress = async (value: number) => {
        if (!hasProgressColumn) return;
        await dbBitrix
          .query(`UPDATE dadata_result SET "${columns.progress}" = $2 WHERE inn = $1`, [inn, value])
          .catch((error) => console.warn('progress update failed', error));
      };

      await safeLog({
        type: 'notification',
        source: 'ai-integration',
        companyId: inn,
        companyName,
        notificationKey: 'analysis_start',
        message: 'Старт одиночного анализа (без очереди)',
        payload: { steps: stepsToRun, mode },
      });

      await markRunning(inn, 1);

      const runAllSteps = async (): Promise<RunResult> => {
        const totalSteps = stepsToRun.length;
        const completedSteps = new Set<StepKey>();
        if (totalSteps === 0) {
          return { ok: true as const, status: 200, completedSteps: [] };
        }

        let progress = 0;
        await updateProgress(progress);

        for (let idx = 0; idx < stepsToRun.length; idx++) {
          const step = stepsToRun[idx];
          const result = await runStep(inn, step, stepTimeoutMs);
          if (result.ok) {
            completedSteps.add(step);
            progress = completedSteps.size / totalSteps;
            await updateProgress(progress);
            continue;
          }

          return {
            ok: false as const,
            status: result.status,
            error: result.error,
            progress,
            completedSteps: Array.from(completedSteps),
          };
        }

        return { ok: true as const, status: 200, progress: 1, completedSteps: Array.from(completedSteps) };
      };

      const startedAt = Date.now();
      let timedResult: RunResult;
      try {
        timedResult = (await Promise.race([
          runAllSteps(),
          new Promise<{ ok: false; status: number; error: string }>((resolve) =>
            setTimeout(() => resolve({ ok: false, status: 504, error: 'AI integration timed out' }), overallTimeoutMs),
          ),
        ])) as RunResult;
      } catch (error: any) {
        timedResult = { ok: false, status: 500, error: error?.message ?? 'AI integration run failed' };
      }

      const durationMs = Date.now() - startedAt;
      if (timedResult.ok) {
        await markFinished(inn, { status: 'completed', durationMs }, { attempts: 1 });
        await safeLog({
          type: 'notification',
          source: 'ai-integration',
          companyId: inn,
          companyName,
          notificationKey: 'analysis_success',
          message: 'Полный анализ завершён (без очереди)',
          payload: { status: timedResult.status },
        });
      } else {
        await markFinished(
          inn,
          {
            status: 'failed',
            durationMs,
            progress: timedResult.progress,
          },
          { attempts: 1, outcome: 'failed' },
        );
        await safeLog({
          type: 'error',
          source: 'ai-integration',
          companyId: inn,
          companyName,
          message: `Полный анализ завершился ошибкой: ${timedResult.error ?? 'unknown'}`,
          payload: { status: timedResult.status },
        });
      }

      return NextResponse.json({
        ok: timedResult.ok,
        status: timedResult.status,
        error: timedResult.error,
        mode,
        steps,
        integration: { base: integrationBase, mode, modeLocked, steps },
      });
    }

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
        mode,
        steps,
        integration: { base: integrationBase, mode, modeLocked, steps },
      });
    }

    await ensureQueueTable();

    const placeholders = inns.map((_, idx) => `($${idx + 1})`).join(', ');

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

    await safeLog({
      type: 'notification',
      source: 'ai-integration',
      message: 'Компании поставлены в очередь на AI-анализ',
      payload: { inns, requestedBy, mode, steps, source },
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
                body: def.primary.body ? { inn: sampleInn } : undefined,
              },
              fallbacks: (def.fallbacks ?? []).map((fb) => ({
                method: fb.method,
                path: fb.path(sampleInn),
                body: fb.body ? { inn: sampleInn } : undefined,
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

    // Запускаем интеграцию в фоне, чтобы сам запрос отвечал сразу
    void (async () => {
      try {
        const integrationResults: Array<{
          inn: string;
          ok: boolean;
          status: number;
          error?: string;
          progress?: number;
          deferred?: boolean;
        }> = [];
        const perStep: Array<{ inn: string; results: Awaited<ReturnType<typeof runStep>>[] }> = [];
        const stepTimeoutMs = getStepTimeoutMs();
        const overallTimeoutMs = getOverallTimeoutMs();

        if (!(await acquireQueueLock())) {
          console.warn('AI analysis queue is already being processed, skipping duplicate runner');
          return;
        }

        try {
          let item: QueueItem | null;
          let stopRequests = new Set<string>();
          const failedSequence = new Set<string>();
          while ((item = await dequeueNext())) {
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
              continue;
            }

            const inn = item.inn;
            const payload = (item.payload || {}) as {
              mode?: unknown;
              steps?: unknown;
              defer_count?: unknown;
              completed_steps?: unknown;
            };
            const modeFromPayload: 'full' | 'steps' = payload.mode === 'full' ? 'full' : 'steps';
            const stepsFromPayload =
              modeFromPayload === 'steps' ? normalizeSteps(payload.steps) : null;
            const deferCount = Number.isFinite((payload as any).defer_count)
              ? Number((payload as any).defer_count)
              : 0;
            const attemptNo = Math.max(1, deferCount + 1);
            const companyNameMap = await getCompanyNames([inn]);
            const companyName = companyNameMap.get(inn);
            const startedAt = Date.now();

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

            const runInn = async () => {
              if (modeFromPayload === 'steps' && stepsFromPayload) {
                const completedSteps = new Set<StepKey>(normalizeSteps(payload.completed_steps));
                const stepResults: Awaited<ReturnType<typeof runStep>>[] = [];
                const totalSteps = stepsFromPayload.length;
                let progress = totalSteps ? completedSteps.size / totalSteps : 0;
                const hasProgressColumn = Boolean(columns.progress);

                const updateProgress = async (value: number) => {
                  if (!hasProgressColumn) return;
                  await dbBitrix
                    .query(`UPDATE dadata_result SET "${columns.progress}" = $2 WHERE inn = $1`, [
                      inn,
                      value,
                    ])
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
                  const res = await runStep(inn, step, stepTimeoutMs);
                  stepResults.push(res);
                  if (res.ok) {
                    completedSteps.add(step);
                    progress = Math.max(progress, completedSteps.size / totalSteps);
                    await updateProgress(progress);
                  }
                  if (!res.ok) break;
                }
                perStep.push({ inn, results: stepResults });
                const ok = completedSteps.size === totalSteps && stepResults.every((s) => s.ok);
                const lastStatus = stepResults.length
                  ? stepResults[stepResults.length - 1]?.status
                  : 0;
                const firstError = stepResults.find((s) => !s.ok)?.error;
                return {
                  ok,
                  status: lastStatus ?? 0,
                  error: firstError,
                  progress,
                  completedSteps: Array.from(completedSteps),
                };
              }

              return runFullPipeline(inn, stepTimeoutMs);
            };

            let timedResult: RunResult;
            try {
              timedResult = (await Promise.race([
                runInn(),
                new Promise<{ ok: false; status: number; error: string }>((resolve) =>
                  setTimeout(
                    () => resolve({ ok: false, status: 504, error: 'AI integration timed out' }),
                    overallTimeoutMs,
                  ),
                ),
              ])) as RunResult;
            } catch (error: any) {
              timedResult = {
                ok: false,
                status: 500,
                error: error?.message ?? 'AI integration run failed',
              };
            } finally {
              await removeFromQueue([inn]);
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
              await markFinished(inn, { status: 'failed', durationMs: Date.now() - startedAt }, {
                attempts: attemptNo,
                outcome: 'failed',
              });
              await safeLog({
                type: 'error',
                source: 'ai-integration',
                message: 'Анализ остановлен: слишком много ошибок подряд',
                payload: { streak: Array.from(failedSequence), limit: MAX_FAILURE_STREAK },
              });
              break;
            }

            if (shouldRetry) {
              const completedStepsForRetry =
                timedResult.completedSteps ??
                (modeFromPayload === 'steps' && stepsFromPayload
                  ? normalizeSteps(payload.completed_steps)
                  : []);

              const nextPayload = {
                ...payload,
                defer_count: attemptNo,
                completed_steps: completedStepsForRetry,
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
            if (timedResult.ok) {
              await markFinished(inn, { status: 'completed', durationMs }, { attempts: attemptNo });
              await safeLog({
                type: 'notification',
                source: 'ai-integration',
                companyId: inn,
                companyName,
                notificationKey: 'analysis_success',
                message: 'Анализ завершён',
              });
            } else {
              await markFinished(inn, {
                status: 'failed',
                durationMs,
                progress: timedResult.progress,
              }, { attempts: attemptNo, outcome: 'failed' });
              await safeLog({
                type: 'error',
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
        } finally {
          await releaseQueueLock();
        }
      } catch (error) {
        console.error('Background AI analysis run failed', error);
      }
    })();

    return ack;
  } catch (e) {
    console.error('POST /api/ai-analysis/run error', e);
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

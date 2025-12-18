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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

let ensuredQueue = false;
let ensuredCommands = false;
const PROCESS_LOCK_KEY = 42_111;
const MAX_STEP_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2000;
const MAX_DEFER_ATTEMPTS = 3;

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
  const res = await dbBitrix.query<QueueItem>(
    `
      WITH next_item AS (
        SELECT inn, payload, queued_at, queued_by
        FROM ai_analysis_queue
        ORDER BY queued_at ASC
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

const STEP_DEFINITIONS: Record<StepKey, StepDefinition> = {
  lookup: {
    primary: {
      path: () => '/v1/lookup/card',
      label: 'Карта компании (lookup)',
      method: 'POST',
      body: true,
    },
    fallbacks: [
      {
        path: (inn) => `/v1/lookup/${encodeURIComponent(inn)}/card`,
        label: 'GET lookup',
        method: 'GET',
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
    primary: { path: () => '/v1/analyze-json', label: 'AI-анализ', method: 'POST', body: true },
    fallbacks: [
      {
        path: (inn) => `/v1/analyze-json/${encodeURIComponent(inn)}`,
        label: 'GET analyze-json',
        method: 'GET',
      },
    ],
  },
  ib_match: {
    primary: {
      path: () => '/v1/ib-match',
      label: 'Сопоставление продклассов',
      method: 'POST',
      body: true,
    },
    fallbacks: [
      {
        path: () => '/v1/ib-match/by-inn',
        label: 'POST ib-match/by-inn',
        method: 'POST',
        body: true,
      },
      {
        path: (inn) => `/v1/ib-match/by-inn?inn=${encodeURIComponent(inn)}`,
        label: 'GET ib-match/by-inn',
        method: 'GET',
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
  const health = await callAiIntegration('/health', { timeoutMs: 3000 });
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
            payload: res.data,
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
          payload: { status: res.status },
        });

        if (![404, 405].includes(res.status)) {
          break;
        }
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

async function markRunning(inn: string) {
  await dbBitrix
    .query(
      `UPDATE dadata_result
       SET analysis_status = 'running', analysis_started_at = COALESCE(analysis_started_at, now()), analysis_finished_at = NULL, analysis_progress = 0, server_error = 0
       WHERE inn = $1`,
      [inn],
    )
    .catch((error) => console.warn('mark running failed', error));
}

async function markQueued(inn: string) {
  await dbBitrix
    .query(
      `UPDATE dadata_result
       SET analysis_status = 'queued', analysis_started_at = NULL, analysis_finished_at = NULL
       WHERE inn = $1`,
      [inn],
    )
    .catch((error) => console.warn('mark queued failed', error));
}

async function markFinished(
  inn: string,
  result:
    | { status: 'completed'; durationMs: number }
    | { status: 'failed'; durationMs: number; progress?: number },
) {
  const progress = result.status === 'completed' ? 1 : result.progress ?? null;
  await dbBitrix
    .query(
      `UPDATE dadata_result
       SET analysis_status = $2,
           analysis_finished_at = now(),
           analysis_duration_ms = $3,
           analysis_progress = $4,
           analysis_ok = CASE WHEN $2 = 'completed' THEN 1 ELSE 0 END,
           server_error = CASE WHEN $2 = 'failed' THEN 1 ELSE 0 END
       WHERE inn = $1`,
      [inn, result.status, result.durationMs, progress],
    )
    .catch((error) => console.warn('mark finished failed', error));
}

async function markStopped(inns: string[]) {
  if (!inns.length) return;
  await dbBitrix
    .query(
      `UPDATE dadata_result
       SET analysis_status = 'stopped',
           analysis_started_at = NULL,
           analysis_finished_at = now(),
           analysis_progress = NULL
       WHERE inn = ANY($1::text[])`,
      [inns],
    )
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

async function runFullPipeline(inn: string, timeoutMs: number) {
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

    const health = await callAiIntegration('/health', { timeoutMs: 3000 });
    if (!health.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `AI integration недоступна: ${health.error}`,
        },
        { status: 502 },
      );
    }

    const forcedMode = getForcedLaunchMode();
    const modeLocked = isLaunchModeLocked();
    const mode: 'full' | 'steps' = modeLocked
      ? forcedMode
      : body?.mode === 'full'
      ? 'full'
      : 'steps';
    const steps =
      mode === 'steps' ? (modeLocked ? getForcedSteps() : normalizeSteps(body?.steps)) : null;

    const payloadRaw =
      body?.payload && typeof body.payload === 'object' && body.payload !== null
        ? (body.payload as Record<string, unknown>)
        : {};

    const source =
      typeof (payloadRaw as any).source === 'string' && (payloadRaw as any).source
        ? String((payloadRaw as any).source)
        : 'manual';

    const payload: Record<string, unknown> = {
      ...payloadRaw,
      source,
      count: inns.length,
      requested_at: new Date().toISOString(),
      mode,
      steps: mode === 'steps' ? steps : null,
      defer_count: 0,
    };

    await ensureQueueTable();

    const session = await getSession();
    const requestedBy = session?.login ?? session?.id?.toString() ?? null;

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
    await dbBitrix
      .query(
        `UPDATE dadata_result SET analysis_status = 'queued', analysis_started_at = NULL, analysis_finished_at = NULL WHERE inn = ANY($1::text[])`,
        [inns],
      )
      .catch((error) => console.warn('mark queued failed', error));

    const ack = NextResponse.json({
      ok: true,
      queued: inns.length,
      mode,
      steps,
      integration: { base: integrationBase },
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
            const payload = (item.payload || {}) as { mode?: unknown; steps?: unknown; defer_count?: unknown };
            const modeFromPayload: 'full' | 'steps' = payload.mode === 'full' ? 'full' : 'steps';
            const stepsFromPayload =
              modeFromPayload === 'steps' ? normalizeSteps(payload.steps) : null;
            const deferCount = Number.isFinite((payload as any).defer_count)
              ? Number((payload as any).defer_count)
              : 0;
            const companyNameMap = await getCompanyNames([inn]);
            const companyName = companyNameMap.get(inn);
            const startedAt = Date.now();

            await safeLog({
              type: 'notification',
              source: 'ai-integration',
              companyId: inn,
              companyName,
              notificationKey: 'analysis_start',
            });

            await markRunning(inn);

            const runInn = async () => {
              if (modeFromPayload === 'steps' && stepsFromPayload) {
                const stepResults: Awaited<ReturnType<typeof runStep>>[] = [];
                let progress = 0;

                for (let idx = 0; idx < stepsFromPayload.length; idx++) {
                  const step = stepsFromPayload[idx];
                  const res = await runStep(inn, step, stepTimeoutMs);
                  stepResults.push(res);
                  if (res.ok) {
                    progress = Math.max(progress, (idx + 1) / stepsFromPayload.length);
                    await dbBitrix
                      .query(`UPDATE dadata_result SET analysis_progress = $2 WHERE inn = $1`, [
                        inn,
                        progress,
                      ])
                      .catch((error) => console.warn('progress update failed', error));
                  }
                  if (!res.ok) break;
                }
                perStep.push({ inn, results: stepResults });
                const ok = stepResults.every((s) => s.ok);
                const lastStatus = stepResults.length
                  ? stepResults[stepResults.length - 1]?.status
                  : 0;
                const firstError = stepResults.find((s) => !s.ok)?.error;
                return { ok, status: lastStatus ?? 0, error: firstError, progress };
              }

              return runFullPipeline(inn, stepTimeoutMs);
            };

            let timedResult: { ok: boolean; status: number; error?: string; progress?: number };
            try {
              timedResult = (await Promise.race([
                runInn(),
                new Promise<{ ok: false; status: number; error: string }>((resolve) =>
                  setTimeout(
                    () => resolve({ ok: false, status: 504, error: 'AI integration timed out' }),
                    overallTimeoutMs,
                  ),
                ),
              ])) as { ok: boolean; status: number; error?: string; progress?: number };
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

            const shouldDefer = !timedResult.ok && deferCount < MAX_DEFER_ATTEMPTS;
            integrationResults.push({ inn, ...timedResult, deferred: shouldDefer });

            if (shouldDefer) {
              const nextPayload = { ...payload, defer_count: deferCount + 1 };
              await safeLog({
                type: 'notification',
                source: 'ai-integration',
                companyId: inn,
                companyName,
                message: `Анализ отложен после ошибки (попытка ${deferCount + 1}/${MAX_DEFER_ATTEMPTS})`,
                payload: { error: timedResult.error, status: timedResult.status },
              });
              await markQueued(inn);
              await enqueueItem(inn, nextPayload, item.queued_by);
              continue;
            }

            const durationMs = Date.now() - startedAt;
            if (timedResult.ok) {
              await markFinished(inn, { status: 'completed', durationMs });
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
              });
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

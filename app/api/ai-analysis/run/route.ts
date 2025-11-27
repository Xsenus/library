import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { getSession } from '@/lib/auth';
import { aiRequestId, callAiIntegration, getAiIntegrationBase } from '@/lib/ai-integration';
import { logAiDebugEvent } from '@/lib/ai-debug';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

let ensuredQueue = false;

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

function normalizeInns(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((v) => (v == null ? '' : String(v).trim()))
        .filter((v) => v.length > 0),
    ),
  );
}

async function removeFromQueue(inns: string[]) {
  if (!inns.length) return;
  await ensureQueueTable();
  await dbBitrix.query('DELETE FROM ai_analysis_queue WHERE inn = ANY($1::text[])', [inns]);
}

type StepKey = 'lookup' | 'parse_site' | 'analyze_json' | 'ib_match' | 'equipment_selection';

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
    primary: { path: () => '/v1/lookup/card', label: 'Карта компании (lookup)', method: 'POST', body: true },
    fallbacks: [{ path: (inn) => `/v1/lookup/${encodeURIComponent(inn)}/card`, label: 'GET lookup', method: 'GET' }],
  },
  parse_site: {
    primary: { path: () => '/v1/parse-site', label: 'Парсинг сайта', method: 'POST', body: true },
    fallbacks: [{ path: (inn) => `/v1/parse-site/${encodeURIComponent(inn)}`, label: 'GET parse-site', method: 'GET' }],
  },
  analyze_json: {
    primary: { path: () => '/v1/analyze-json', label: 'AI-анализ', method: 'POST', body: true },
    fallbacks: [{ path: (inn) => `/v1/analyze-json/${encodeURIComponent(inn)}`, label: 'GET analyze-json', method: 'GET' }],
  },
  ib_match: {
    primary: { path: () => '/v1/ib-match', label: 'Сопоставление продклассов', method: 'POST', body: true },
    fallbacks: [
      { path: () => '/v1/ib-match/by-inn', label: 'POST ib-match/by-inn', method: 'POST', body: true },
      { path: (inn) => `/v1/ib-match/by-inn?inn=${encodeURIComponent(inn)}`, label: 'GET ib-match/by-inn', method: 'GET' },
    ],
  },
  equipment_selection: {
    primary: {
      path: (inn) => `/v1/equipment-selection/by-inn/${encodeURIComponent(inn)}`,
      label: 'Подбор оборудования',
      method: 'GET',
    },
    fallbacks: [{ path: (inn) => `/v1/equipment-selection?inn=${encodeURIComponent(inn)}`, label: 'GET equipment-selection', method: 'GET' }],
  },
};

const DEFAULT_STEPS: StepKey[] = ['lookup', 'parse_site', 'analyze_json', 'ib_match', 'equipment_selection'];

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

async function runStep(inn: string, step: StepKey) {
  const definition = STEP_DEFINITIONS[step];
  const attempts: StepAttempt[] = [definition.primary, ...(definition.fallbacks ?? [])];
  let lastError: string | undefined;
  let lastStatus = 0;

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
      message: `Старт шага: ${definition.primary.label} (${attempt.label})`,
      payload: { path, method: attempt.method, body: attempt.body ? { inn } : undefined },
    });

    const res = await callAiIntegration(path, init);
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

  return { step, ok: false as const, status: lastStatus, error: lastError ?? 'Unknown error' };
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
        { ok: false, error: 'AI integration base URL is not configured (AI_INTEGRATION_BASE)' },
        { status: 503 },
      );
    }

    const mode: 'full' | 'steps' = body?.mode === 'steps' ? 'steps' : 'full';
    const steps = mode === 'steps' ? normalizeSteps(body?.steps) : null;

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
    const integrationResults: Array<{ inn: string; ok: boolean; status: number; error?: string }> = [];
    const perStep: Array<{ inn: string; results: Awaited<ReturnType<typeof runStep>>[] }> = [];

    for (const inn of inns) {
      if (mode === 'steps' && steps) {
        const stepResults: Awaited<ReturnType<typeof runStep>>[] = [];
        for (const step of steps) {
          const res = await runStep(inn, step);
          stepResults.push(res);
        }
        perStep.push({ inn, results: stepResults });
        const ok = stepResults.every((s) => s.ok);
        const lastStatus = stepResults.length ? stepResults[stepResults.length - 1]?.status : 0;
        const firstError = stepResults.find((s) => !s.ok)?.error;
        if (!ok) {
          await removeFromQueue([inn]);
        }
        integrationResults.push({ inn, ok, status: lastStatus ?? 0, error: firstError });
      } else {
        const requestId = aiRequestId();
        await safeLog({
          type: 'request',
          source: 'ai-integration',
          requestId,
          companyId: inn,
          message: 'Пуск пайплайна через /v1/pipeline/full',
          payload: { path: '/v1/pipeline/full', body: { inn } },
        });

        const res = await callAiIntegration(`/v1/pipeline/full`, {
          method: 'POST',
          body: JSON.stringify({ inn }),
        });

        if (res.ok) {
          integrationResults.push({ inn, ok: true, status: res.status });
          await safeLog({
            type: 'response',
            source: 'ai-integration',
            requestId,
            companyId: inn,
            message: 'Пайплайн принят внешним сервисом',
            payload: res.data,
          });
        } else {
          await removeFromQueue([inn]);
          integrationResults.push({ inn, ok: false, status: res.status, error: res.error });
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
    }

    const integrationSummary = {
      base: integrationBase,
      mode,
      attempted: integrationResults.length,
      succeeded: integrationResults.filter((r) => r.ok).length,
      failed: integrationResults.filter((r) => !r.ok),
      steps,
      perStep,
    };

    const overallOk = integrationResults.every((r) => r.ok);
    const status = overallOk ? 200 : 502;

    return NextResponse.json(
      { ok: overallOk, queued: inns.length, integration: integrationSummary },
      { status },
    );
  } catch (e) {
    console.error('POST /api/ai-analysis/run error', e);
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

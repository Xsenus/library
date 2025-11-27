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

async function safeLog(entry: Parameters<typeof logAiDebugEvent>[0]) {
  try {
    await logAiDebugEvent(entry);
  } catch (error) {
    console.warn('AI debug log skipped', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      inns?: unknown;
      payload?: unknown;
    } | null;

    const inns = normalizeInns(body?.inns);
    if (!inns.length) {
      return NextResponse.json({ ok: false, error: 'Нет компаний для запуска' }, { status: 400 });
    }

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

    const integrationBase = getAiIntegrationBase();
    const integrationResults: Array<{ inn: string; ok: boolean; status: number; error?: string }> = [];

    for (const inn of inns) {
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

    const integrationSummary = {
      base: integrationBase,
      attempted: integrationResults.length,
      succeeded: integrationResults.filter((r) => r.ok).length,
      failed: integrationResults.filter((r) => !r.ok),
    };

    return NextResponse.json({ ok: true, queued: inns.length, integration: integrationSummary });
  } catch (e) {
    console.error('POST /api/ai-analysis/run error', e);
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { getSession } from '@/lib/auth';
import { syncAiAnalysisQueueWatchdog } from '@/lib/ai-analysis-queue-trigger';
import { logAiDebugEvent } from '@/lib/ai-debug';
import { getAiIntegrationBase } from '@/lib/ai-integration';
import { getDadataColumns } from '@/lib/dadata-columns';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

let ensuredCommands = false;
let ensuredQueue = false;
const QUEUE_STALE_INTERVAL = `120 minutes`;

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
  ensuredQueue = true;
}

function normalizeInns(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((value) => (value == null ? '' : String(value).trim()))
        .filter((value) => value.length > 0),
    ),
  );
}

async function findRunningInns(inns: string[]): Promise<string[]> {
  if (!inns.length) return [];

  const columns = await getDadataColumns();
  const statusExpr = columns.status ? `LOWER(COALESCE("${columns.status}", ''))` : "''";
  const progressExpr = columns.progress ? `COALESCE("${columns.progress}", 0)` : '0';
  const startedExpr = columns.startedAt ? `"${columns.startedAt}"` : 'NULL';
  const finishedExpr = columns.finishedAt ? `"${columns.finishedAt}"` : 'NULL';

  const { rows } = await dbBitrix.query<{ inn: string }>(
    `
      SELECT inn
      FROM dadata_result
      WHERE inn = ANY($1::text[])
        AND (
          ${statusExpr} SIMILAR TO '%(running|processing|in_progress|starting|stop_requested|stopping)%'
          OR (${finishedExpr} IS NULL AND ${progressExpr} > 0 AND ${progressExpr} < 0.999)
          OR (${startedExpr} IS NOT NULL AND ${finishedExpr} IS NULL AND ${startedExpr} > now() - interval '${QUEUE_STALE_INTERVAL}')
        )
    `,
    [inns],
  );

  return Array.from(new Set((rows ?? []).map((row) => row.inn).filter(Boolean)));
}

async function findAllRunningInns(): Promise<string[]> {
  const columns = await getDadataColumns();
  const statusExpr = columns.status ? `LOWER(COALESCE("${columns.status}", ''))` : "''";
  const progressExpr = columns.progress ? `COALESCE("${columns.progress}", 0)` : '0';
  const startedExpr = columns.startedAt ? `"${columns.startedAt}"` : 'NULL';
  const finishedExpr = columns.finishedAt ? `"${columns.finishedAt}"` : 'NULL';

  const { rows } = await dbBitrix.query<{ inn: string }>(
    `
      SELECT inn
      FROM dadata_result
      WHERE
        ${statusExpr} SIMILAR TO '%(running|processing|in_progress|starting|stop_requested|stopping)%'
        OR (${finishedExpr} IS NULL AND ${progressExpr} > 0 AND ${progressExpr} < 0.999)
        OR (${startedExpr} IS NOT NULL AND ${finishedExpr} IS NULL AND ${startedExpr} > now() - interval '${QUEUE_STALE_INTERVAL}')
    `,
  );

  return Array.from(new Set((rows ?? []).map((row) => row.inn).filter(Boolean)));
}

async function findAllQueuedOrRunningInns(): Promise<string[]> {
  await ensureQueueTable();
  const { rows } = await dbBitrix.query<{ inn: string }>(
    "SELECT inn FROM ai_analysis_queue WHERE state IN ('queued', 'running')",
  );
  return Array.from(
    new Set([
      ...(rows ?? []).map((row) => row.inn).filter(Boolean),
      ...(await findAllRunningInns()),
    ]),
  );
}

async function markStopRequested(inns: string[]) {
  if (!inns.length) return;

  const columns = await getDadataColumns();
  if (!columns.status) {
    console.warn('mark stop requested skipped: no status column in dadata_result');
    return;
  }

  const sets = [`"${columns.status}" = 'stop_requested'`];

  if (columns.finishedAt) {
    sets.push(`"${columns.finishedAt}" = NULL`);
  }

  if (columns.outcome) {
    sets.push(`"${columns.outcome}" = 'pending'`);
  }

  if (columns.okFlag) {
    sets.push(`"${columns.okFlag}" = 0`);
  }

  const sql = `UPDATE dadata_result SET ${sets.join(', ')} WHERE inn = ANY($1::text[])`;

  await dbBitrix.query(sql, [inns]).catch((error) => console.warn('mark stop requested failed', error));
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      inns?: unknown;
      all?: unknown;
      payload?: unknown;
    } | null;
    const inns = body?.all === true ? await findAllQueuedOrRunningInns() : normalizeInns(body?.inns);
    await ensureCommandsTable();

    const session = await getSession();
    const requestedBy = session?.login ?? session?.id?.toString() ?? null;

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
      requested_by: requestedBy,
      requested_at: new Date().toISOString(),
      source,
      inns,
    };

    let removed = 0;
    let running = 0;
    let removedInns: string[] = [];
    let runningInns: string[] = [];
    if (inns.length) {
      await ensureQueueTable();
      const res = await dbBitrix.query<{ inn: string }>(
        "DELETE FROM ai_analysis_queue WHERE inn = ANY($1::text[]) AND state = 'queued' RETURNING inn",
        [inns],
      );
      removedInns = (res.rows ?? []).map((row) => row.inn).filter(Boolean);
      removed = res.rowCount ?? removedInns.length;
      payload.removed_from_queue = removed;
      const runningRes = await dbBitrix.query<{ inn: string }>(
        "SELECT inn FROM ai_analysis_queue WHERE inn = ANY($1::text[]) AND state = 'running'",
        [inns],
      );
      runningInns = Array.from(
        new Set([
          ...(runningRes.rows ?? []).map((row) => row.inn).filter(Boolean),
          ...(await findRunningInns(inns.filter((inn) => !removedInns.includes(inn)))),
        ]),
      );
      running = runningInns.length;
      payload.running_in_queue = running;
      payload.removed_inns = removedInns;
      payload.running_inns = runningInns;

      // Помечаем остановку в витрине, чтобы UI сразу отобразил финальный статус
      const columns = await getDadataColumns();
      if (columns.status && removedInns.length) {
        const sets = [`"${columns.status}" = 'stopped'`];

        if (columns.outcome) {
          sets.push(`"${columns.outcome}" = 'partial'`);
        }

        if (columns.finishedAt) {
          sets.push(`"${columns.finishedAt}" = now()`);
        }

        if (columns.progress) {
          sets.push(`"${columns.progress}" = NULL`);
        }

        if (columns.startedAt) {
          sets.push(`"${columns.startedAt}" = NULL`);
        }

        const sql = `UPDATE dadata_result SET ${sets.join(', ')} WHERE inn = ANY($1::text[])`;

        await dbBitrix.query(sql, [removedInns]).catch((error) => console.warn('mark stopped failed', error));
      } else if (!columns.status) {
        console.warn('mark stopped skipped: no status column in dadata_result');
      }

      if (runningInns.length) {
        await markStopRequested(runningInns);
      }
    }

    const integrationBase = getAiIntegrationBase();
    if (integrationBase && inns.length) {
      payload.integration_stop =
        'Внешний AI-сервис не поддерживает остановку уже запущенных задач; завершаем только локальную очередь и статус.';
    }

    await dbBitrix.query(
      `INSERT INTO ai_analysis_commands (action, payload) VALUES ('stop', $1::jsonb)`,
      [JSON.stringify(payload)],
    );

    await logAiDebugEvent({
      type: 'notification',
      source: 'ai-integration',
      message: 'Запрошена остановка анализа',
      payload,
    });

    void syncAiAnalysisQueueWatchdog();

    return NextResponse.json({ ok: true, removed, running, removedInns, runningInns });
  } catch (e) {
    console.error('POST /api/ai-analysis/stop error', e);
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

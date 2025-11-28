import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { getSession } from '@/lib/auth';
import { logAiDebugEvent } from '@/lib/ai-debug';
import { getAiIntegrationBase } from '@/lib/ai-integration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

let ensuredCommands = false;
let ensuredQueue = false;

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
        .map((value) => (value == null ? '' : String(value).trim()))
        .filter((value) => value.length > 0),
    ),
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      inns?: unknown;
      payload?: unknown;
    } | null;
    const inns = normalizeInns(body?.inns);
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
    if (inns.length) {
      await ensureQueueTable();
      const res = await dbBitrix.query<{ inn: string }>(
        'DELETE FROM ai_analysis_queue WHERE inn = ANY($1::text[]) RETURNING inn',
        [inns],
      );
      removed = res.rowCount ?? 0;
      payload.removed_from_queue = removed;
    }

    const integrationBase = getAiIntegrationBase();
    if (integrationBase && inns.length) {
      payload.integration_stop =
        'пропущено: во внешнем API нет ручки остановки, прекращаем только локальную очередь';
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

    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    console.error('POST /api/ai-analysis/stop error', e);
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

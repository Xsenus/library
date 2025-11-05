import { NextRequest, NextResponse } from 'next/server';
import { dbBitrix } from '@/lib/db-bitrix';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

let ensuredCommands = false;

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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { payload?: unknown } | null;
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
    };

    await dbBitrix.query(
      `INSERT INTO ai_analysis_commands (action, payload) VALUES ('stop', $1::jsonb)`,
      [JSON.stringify(payload)],
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('POST /api/ai-analysis/stop error', e);
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

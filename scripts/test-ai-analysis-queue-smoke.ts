import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

import { Client } from 'pg';

const SERVER_PORT = 3013;
const BASE_URL = `http://127.0.0.1:${SERVER_PORT}`;
const READY_TIMEOUT_MS = 60_000;
const WATCHDOG_TIMEOUT_MS = 20_000;

function loadEnv(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex < 0) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function createClient() {
  const client = new Client({
    host: process.env.BITRIX_DB_HOST,
    port: Number(process.env.BITRIX_DB_PORT ?? 5432),
    database: process.env.BITRIX_DB_NAME,
    user: process.env.BITRIX_DB_USER,
    password: process.env.BITRIX_DB_PASSWORD,
    ssl:
      ['require', 'enable'].includes(String(process.env.BITRIX_DB_SSL ?? '').toLowerCase())
        ? { rejectUnauthorized: false }
        : undefined,
  });
  await client.connect();
  return client;
}

async function ensureQueueSchema(client: Client) {
  await client.query(`
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
  await client.query(`ALTER TABLE ai_analysis_queue ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE ai_analysis_queue ADD COLUMN IF NOT EXISTS next_retry_at timestamptz`);
  await client.query(`ALTER TABLE ai_analysis_queue ADD COLUMN IF NOT EXISTS last_error_kind text`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_analysis_commands (
      id bigserial PRIMARY KEY,
      action text NOT NULL,
      payload jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

function startServer(): ChildProcess {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value != null),
  ) as NodeJS.ProcessEnv;
  const child = spawn('npm run dev -- -p ' + String(SERVER_PORT), {
    cwd: process.cwd(),
    env,
    shell: true,
    stdio: 'pipe',
  });

  child.stdout?.on('data', (chunk) => process.stdout.write(String(chunk)));
  child.stderr?.on('data', (chunk) => process.stderr.write(String(chunk)));
  return child;
}

async function waitForServer() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/ai-analysis/queue?limit=1`, { cache: 'no-store' });
      if (res.ok) return;
    } catch {
      // server still starting
    }
    await sleep(750);
  }
  throw new Error(`Queue API did not start within ${READY_TIMEOUT_MS}ms`);
}

async function stopServer(child: ChildProcess) {
  if (child.killed) return;

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function cleanupTestData(client: Client, inns: string[]) {
  await client.query(`DELETE FROM ai_analysis_queue WHERE inn = ANY($1::text[])`, [inns]);
  await client.query(
    `DELETE FROM ai_analysis_commands WHERE action = 'stop' AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(COALESCE(payload->'inns', '[]'::jsonb)) AS inn_value(value)
       WHERE inn_value.value = ANY($1::text[])
     )`,
    [inns],
  );
}

async function waitForQueueRemoval(client: Client, inn: string) {
  const deadline = Date.now() + WATCHDOG_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await client.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM ai_analysis_queue WHERE inn = $1`,
      [inn],
    );
    if (Number(res.rows?.[0]?.cnt ?? 0) === 0) {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`Lease recovery did not remove ${inn} within ${WATCHDOG_TIMEOUT_MS}ms`);
}

async function main() {
  loadEnv(path.join(process.cwd(), '.env.local'));
  const client = await createClient();
  const retryInn = `zz-test-retry-${Date.now()}`;
  const leaseInn = `zz-test-lease-${Date.now()}`;
  const inns = [retryInn, leaseInn];
  const server = startServer();

  try {
    await ensureQueueSchema(client);
    await cleanupTestData(client, inns);
    await waitForServer();

    // Load run-route module so watchdog hooks are registered.
    await fetch(`${BASE_URL}/api/ai-analysis/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inns: [] }),
    }).catch(() => null);

    const nextRetryAt = new Date(Date.now() + 60_000).toISOString();
    await client.query(
      `
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
        VALUES ($1, now(), 'codex', $2::jsonb, 'queued', 10, 1, $3::timestamptz, NULL, NULL, 'AI integration timed out', 'timeout')
        ON CONFLICT (inn) DO UPDATE
        SET
          queued_at = EXCLUDED.queued_at,
          queued_by = EXCLUDED.queued_by,
          payload = EXCLUDED.payload,
          state = EXCLUDED.state,
          priority = EXCLUDED.priority,
          attempt_count = EXCLUDED.attempt_count,
          next_retry_at = EXCLUDED.next_retry_at,
          lease_expires_at = EXCLUDED.lease_expires_at,
          started_at = EXCLUDED.started_at,
          last_error = EXCLUDED.last_error,
          last_error_kind = EXCLUDED.last_error_kind
      `,
      [retryInn, JSON.stringify({ source: 'manual-play', defer_count: 1, mode: 'full' }), nextRetryAt],
    );

    const queueRes = await fetch(`${BASE_URL}/api/ai-analysis/queue?limit=20`, { cache: 'no-store' });
    assert.equal(queueRes.ok, true, 'queue GET should respond with 200');
    const queueData = (await queueRes.json()) as {
      ok?: boolean;
      items?: Array<Record<string, unknown>>;
      summary?: Record<string, unknown> | null;
    };
    assert.equal(queueData.ok, true, 'queue GET should be ok');
    const retryItem = (queueData.items ?? []).find((item) => item.inn === retryInn);
    assert.ok(retryItem, 'retry item should be visible in queue');
    assert.equal(retryItem?.analysis_status, 'retry_scheduled');
    assert.equal(retryItem?.queue_attempt_count, 1);
    assert.equal(retryItem?.queue_last_error_kind, 'timeout');
    assert.equal(Number(queueData.summary?.retry_scheduled ?? 0) >= 1, true);

    await client.query(
      `
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
        VALUES (
          $1,
          now() - interval '5 minutes',
          'codex',
          $2::jsonb,
          'running',
          40,
          1,
          NULL,
          now() - interval '1 minute',
          now() - interval '5 minutes',
          'Queue lease expired before task completion',
          'timeout'
        )
        ON CONFLICT (inn) DO UPDATE
        SET
          queued_at = EXCLUDED.queued_at,
          queued_by = EXCLUDED.queued_by,
          payload = EXCLUDED.payload,
          state = EXCLUDED.state,
          priority = EXCLUDED.priority,
          attempt_count = EXCLUDED.attempt_count,
          next_retry_at = EXCLUDED.next_retry_at,
          lease_expires_at = EXCLUDED.lease_expires_at,
          started_at = EXCLUDED.started_at,
          last_error = EXCLUDED.last_error,
          last_error_kind = EXCLUDED.last_error_kind
      `,
      [leaseInn, JSON.stringify({ source: 'manual-queue', defer_count: 1, mode: 'steps', steps: ['lookup'] })],
    );

    const stopRes = await fetch(`${BASE_URL}/api/ai-analysis/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inns: [leaseInn], payload: { source: 'smoke-test' } }),
    });
    assert.equal(stopRes.ok, true, 'stop POST should respond with 200');
    const stopData = (await stopRes.json()) as { ok?: boolean; running?: number };
    assert.equal(stopData.ok, true);
    assert.equal(Number(stopData.running ?? 0) >= 1, true, 'running lease item should be detected');

    // Arm queue watchdog and wait until it picks up the expired lease and applies stop.
    await fetch(`${BASE_URL}/api/ai-analysis/queue?limit=20`, { cache: 'no-store' });
    await waitForQueueRemoval(client, leaseInn);

    console.log(
      JSON.stringify({
        ok: true,
        retryInn,
        leaseInn,
        verified: ['retry_scheduled queue item', 'lease recovery with stop command'],
      }),
    );
  } finally {
    await cleanupTestData(client, inns).catch(() => undefined);
    await client.end().catch(() => undefined);
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

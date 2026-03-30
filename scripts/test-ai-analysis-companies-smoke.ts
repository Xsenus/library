import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

import { Client } from 'pg';

const SERVER_PORT = 3014;
const BASE_URL = `http://127.0.0.1:${SERVER_PORT}`;
const READY_TIMEOUT_MS = 60_000;

const SITE_INN = '7452042601';
const FALLBACK_INN = '7707701187';
const OKVED_FALLBACK_DOMAIN = 'okved-fallback.local';

type CompanyResponse = {
  inn: string;
  analysis_status?: string | null;
  analysis_domain?: string | null;
  score_source?: string | null;
  prodclass_by_okved?: number | null;
  analysis_tnved?: Array<Record<string, unknown>> | null;
  analysis_info?: {
    ai?: {
      products?: Array<Record<string, unknown>>;
    } | null;
  } | null;
};

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

async function createBitrixClient() {
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

async function createPrimaryClient() {
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl:
      ['require', 'enable'].includes(String(process.env.PGSSLMODE ?? '').toLowerCase())
        ? { rejectUnauthorized: false }
        : undefined,
  });
  await client.connect();
  return client;
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
      const res = await fetch(`${BASE_URL}/api/ai-analysis/companies?page=1&pageSize=1`, {
        cache: 'no-store',
      });
      if (res.ok) return;
    } catch {
      // server is still starting
    }
    await sleep(750);
  }
  throw new Error(`Companies API did not start within ${READY_TIMEOUT_MS}ms`);
}

async function stopServer(child: ChildProcess) {
  if (child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

async function fetchCompany(inn: string): Promise<CompanyResponse> {
  const res = await fetch(
    `${BASE_URL}/api/ai-analysis/companies?q=${encodeURIComponent(inn)}&page=1&pageSize=5`,
    { cache: 'no-store' },
  );
  assert.equal(res.ok, true, `companies API should return 200 for ${inn}`);
  const data = (await res.json()) as { items?: CompanyResponse[] };
  const company = Array.isArray(data.items) ? data.items.find((item) => item.inn === inn) : null;
  assert.ok(company, `company ${inn} should be present in companies API response`);
  return company as CompanyResponse;
}

function hasLargePayloadKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasLargePayloadKey(entry));
  }
  if (!value || typeof value !== 'object') return false;

  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    if (['text_vector', 'vector', 'vectors', 'embedding', 'embeddings', 'prompt_raw', 'answer_raw'].includes(key)) {
      return true;
    }
    return hasLargePayloadKey(entry);
  });
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

async function verifyWritePath(primaryClient: Client) {
  const { rows: siteCompanyRows } = await primaryClient.query<{ id: string }>(
    `SELECT id FROM clients_requests WHERE inn = $1 ORDER BY id DESC LIMIT 1`,
    [SITE_INN],
  );
  assert.ok(siteCompanyRows[0]?.id, 'site case should have clients_requests row');

  const siteCompanyId = siteCompanyRows[0].id;
  const { rows: siteParsRows } = await primaryClient.query<{ id: string; domain_1: string | null }>(
    `SELECT id, domain_1 FROM pars_site WHERE company_id = $1 ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1`,
    [siteCompanyId],
  );
  assert.ok(siteParsRows[0]?.id, 'site case should have pars_site snapshot');

  const siteParsId = siteParsRows[0].id;
  const { rows: siteProdclassRows } = await primaryClient.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM ai_site_prodclass WHERE text_pars_id = $1`,
    [siteParsId],
  );
  assert.equal(Number(siteProdclassRows[0]?.cnt ?? 0) > 0, true, 'site case should persist prodclass rows');

  const { rows: siteGoodsRows } = await primaryClient.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM ai_site_goods_types WHERE text_par_id = $1`,
    [siteParsId],
  );
  const { rows: siteOpenAiRows } = await primaryClient.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM ai_site_openai_responses WHERE text_pars_id = $1`,
    [siteParsId],
  );
  assert.equal(
    Number(siteGoodsRows[0]?.cnt ?? 0) > 0 || Number(siteOpenAiRows[0]?.cnt ?? 0) > 0,
    true,
    'site case should persist goods or openai response rows',
  );

  const { rows: fallbackCompanyRows } = await primaryClient.query<{ id: string }>(
    `SELECT id FROM clients_requests WHERE inn = $1 ORDER BY id DESC LIMIT 1`,
    [FALLBACK_INN],
  );
  assert.ok(fallbackCompanyRows[0]?.id, 'fallback case should have clients_requests row');

  const fallbackCompanyId = fallbackCompanyRows[0].id;
  const { rows: fallbackParsRows } = await primaryClient.query<{ id: string; domain_1: string | null }>(
    `SELECT id, domain_1 FROM pars_site WHERE company_id = $1 ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1`,
    [fallbackCompanyId],
  );
  assert.ok(fallbackParsRows[0]?.id, 'fallback case should have pars_site snapshot');
  assert.equal(
    normalizeString(fallbackParsRows[0]?.domain_1) === OKVED_FALLBACK_DOMAIN,
    true,
    'fallback case should persist okved-fallback.local domain marker',
  );

  const fallbackParsId = fallbackParsRows[0].id;
  const { rows: fallbackProdclassRows } = await primaryClient.query<{
    score_source: string | null;
    prodclass_by_okved: number | null;
  }>(
    `
      SELECT score_source, prodclass_by_okved
      FROM ai_site_prodclass
      WHERE text_pars_id = $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [fallbackParsId],
  );
  assert.equal(
    normalizeString(fallbackProdclassRows[0]?.score_source),
    'okved_fallback',
    'fallback case should persist okved_fallback score source',
  );
  assert.equal(
    Number.isFinite(Number(fallbackProdclassRows[0]?.prodclass_by_okved)),
    true,
    'fallback case should persist prodclass_by_okved',
  );
}

async function main() {
  loadEnv(path.join(process.cwd(), '.env.local'));
  const bitrixClient = await createBitrixClient();
  const primaryClient = await createPrimaryClient();
  const server = startServer();

  try {
    await waitForServer();

    const siteCompany = await fetchCompany(SITE_INN);
    assert.equal(siteCompany.analysis_status, 'completed');
    assert.equal(normalizeString(siteCompany.score_source), 'site');
    assert.notEqual(normalizeString(siteCompany.analysis_domain), OKVED_FALLBACK_DOMAIN);
    assert.equal(Array.isArray(siteCompany.analysis_tnved) && siteCompany.analysis_tnved.length > 0, true);
    assert.equal(hasLargePayloadKey(siteCompany.analysis_tnved), false, 'site API payload should not expose vectors');
    assert.equal(
      hasLargePayloadKey(siteCompany.analysis_info?.ai?.products ?? []),
      false,
      'analysis_info.ai.products should not expose vectors',
    );

    const fallbackCompany = await fetchCompany(FALLBACK_INN);
    assert.equal(fallbackCompany.analysis_status, 'completed');
    assert.equal(normalizeString(fallbackCompany.score_source), 'okved_fallback');
    assert.equal(
      normalizeString(fallbackCompany.analysis_domain),
      '',
      'fallback case should hide internal fallback domain from public API',
    );
    assert.equal(Number(fallbackCompany.prodclass_by_okved) > 0, true);
    assert.equal(Array.isArray(fallbackCompany.analysis_tnved) && fallbackCompany.analysis_tnved.length > 0, true);

    const fallbackProducts = fallbackCompany.analysis_tnved ?? [];
    assert.equal(
      fallbackProducts.every((item) => normalizeString(item.source) === 'okved'),
      true,
      'fallback products should be marked as okved sourced',
    );
    assert.equal(
      fallbackProducts.every((item) => normalizeString(item.name) !== '[object object]' && normalizeString(item.name) !== 'okved'),
      true,
      'fallback products should be human readable',
    );
    assert.equal(
      fallbackProducts.every((item) => normalizeString(item.tnved_code).length > 0),
      true,
      'fallback products should include code',
    );
    assert.equal(
      fallbackProducts.some((item) => normalizeString(item.name) !== normalizeString(item.tnved_code)),
      true,
      'fallback products should include okved names, not only raw codes',
    );
    assert.equal(
      hasLargePayloadKey(fallbackCompany.analysis_info?.ai?.products ?? []),
      false,
      'fallback analyzer products should not expose vectors',
    );

    await verifyWritePath(primaryClient);

    const { rows: bitrixRows } = await bitrixClient.query<{ main_okved: string | null }>(
      `SELECT main_okved FROM dadata_result WHERE inn = $1`,
      [FALLBACK_INN],
    );
    assert.ok(bitrixRows[0]?.main_okved, 'fallback case should still keep main_okved in bitrix_data');

    console.log(
      JSON.stringify({
        ok: true,
        verified: [
          'companies API site payload without vectors',
          'companies API okved fallback payload with human readable names',
          'write path for site and fallback cases',
        ],
      }),
    );
  } finally {
    await bitrixClient.end().catch(() => undefined);
    await primaryClient.end().catch(() => undefined);
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

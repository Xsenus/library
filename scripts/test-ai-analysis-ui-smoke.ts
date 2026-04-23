import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { chromium, type Locator, type Page } from 'playwright';

type SmokeSummary = {
  ok: boolean;
  mode: 'public' | 'authenticated';
  baseUrl: string;
  authenticated: boolean;
  publicRedirectPath: string | null;
  aiAnalysisLoaded: boolean;
  companyDialogOpened: boolean;
  dialogTitle: string | null;
  artifactDir: string;
  screenshots: string[];
};

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return;
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

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function normalizeBaseUrl(value: string | undefined): string {
  const baseUrl = String(value ?? 'https://ai.irbistech.com').trim();
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function locatorByTestIdOr(page: Page, testId: string, fallbackSelector: string): Locator {
  return page.locator(`[data-testid="${testId}"], ${fallbackSelector}`).first();
}

async function capturePage(target: Page, filePath: string, summary: SmokeSummary) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await target.screenshot({ path: filePath, fullPage: true });
  summary.screenshots.push(filePath);
}

async function captureLocator(target: Locator, filePath: string, summary: SmokeSummary) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await target.screenshot({ path: filePath });
  summary.screenshots.push(filePath);
}

async function waitForAiAnalysis(page: Page) {
  await page.getByTestId('tab-aianalysis').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('ai-analysis-table').waitFor({ state: 'visible', timeout: 30_000 });
  await page
    .locator('[data-testid^="ai-analysis-company-info-"]')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
}

async function main() {
  loadEnv(path.join(process.cwd(), '.env.local'));

  const baseUrl = normalizeBaseUrl(process.env.AI_ANALYSIS_UI_SMOKE_BASE_URL);
  const login = String(process.env.AI_ANALYSIS_UI_SMOKE_LOGIN ?? '').trim();
  const password = String(process.env.AI_ANALYSIS_UI_SMOKE_PASSWORD ?? '');
  const captureEnabled = envBoolean('AI_ANALYSIS_UI_SMOKE_CAPTURE', true);
  const headless = envBoolean('AI_ANALYSIS_UI_SMOKE_HEADLESS', true);
  const requireAuth = envBoolean('AI_ANALYSIS_UI_SMOKE_REQUIRE_AUTH', false);
  const artifactDir = path.resolve(
    process.cwd(),
    process.env.AI_ANALYSIS_UI_SMOKE_ARTIFACT_DIR || 'artifacts/ai-analysis-ui-smoke',
  );
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(artifactDir, sanitizeSegment(runStamp));
  fs.mkdirSync(runDir, { recursive: true });

  const summary: SmokeSummary = {
    ok: false,
    mode: login && password ? 'authenticated' : 'public',
    baseUrl,
    authenticated: false,
    publicRedirectPath: null,
    aiAnalysisLoaded: false,
    companyDialogOpened: false,
    dialogTitle: null,
    artifactDir: runDir,
    screenshots: [],
  };

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    ignoreHTTPSErrors: baseUrl.startsWith('https://'),
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForURL(/\/login(?:\?|$)/, { timeout: 30_000 });
    summary.publicRedirectPath = new URL(page.url()).pathname;
    assert.equal(summary.publicRedirectPath, '/login', 'public access should redirect to /login');
    const loginInput = locatorByTestIdOr(page, 'login-input', 'input[autocomplete="username"]');
    const passwordInput = locatorByTestIdOr(
      page,
      'login-password-input',
      'input[autocomplete="current-password"]',
    );
    const submitButton = locatorByTestIdOr(page, 'login-submit', 'button[type="submit"]');

    await loginInput.waitFor({ state: 'visible', timeout: 30_000 });

    if (captureEnabled) {
      await capturePage(page, path.join(runDir, '01-login.png'), summary);
    }

    if (!login || !password) {
      if (requireAuth) {
        throw new Error(
          'AI_ANALYSIS_UI_SMOKE_REQUIRE_AUTH=true, but AI_ANALYSIS_UI_SMOKE_LOGIN/PASSWORD are not configured',
        );
      }
      summary.ok = true;
      fs.writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
      console.log(JSON.stringify(summary));
      return;
    }

    await loginInput.fill(login);
    await passwordInput.fill(password);
    await Promise.all([
      page.waitForURL(/\/library(?:\?|$)/, { timeout: 30_000 }),
      submitButton.click(),
    ]);
    summary.authenticated = true;

    if (captureEnabled) {
      await capturePage(page, path.join(runDir, '02-library-home.png'), summary);
    }

    await page.goto(`${baseUrl}/library?tab=aianalysis`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForAiAnalysis(page);
    summary.aiAnalysisLoaded = true;

    if (captureEnabled) {
      await capturePage(page, path.join(runDir, '03-ai-analysis.png'), summary);
    }

    const infoButton = page.locator('[data-testid^="ai-analysis-company-info-"]').first();
    await infoButton.click();
    const dialog = page.getByTestId('ai-analysis-company-dialog');
    await dialog.waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('ai-analysis-company-equipment').waitFor({ state: 'visible', timeout: 30_000 });
    summary.companyDialogOpened = true;
    summary.dialogTitle = await page.getByTestId('ai-analysis-company-dialog-title').innerText();

    if (captureEnabled) {
      await captureLocator(dialog, path.join(runDir, '04-company-dialog.png'), summary);
    }

    summary.ok = true;
    fs.writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary));
  } catch (error) {
    if (captureEnabled) {
      await capturePage(page, path.join(runDir, '99-error.png'), summary).catch(() => undefined);
    }
    fs.writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    throw error;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';

export type AiAnalysisUiSmokeMode = 'public' | 'authenticated';

export type AiAnalysisUiSmokeSummary = {
  checkedAt: string;
  ok: boolean;
  mode: AiAnalysisUiSmokeMode;
  baseUrl: string;
  authenticated: boolean;
  requireAuth: boolean;
  publicRedirectPath: string | null;
  aiAnalysisLoaded: boolean;
  companyDialogOpened: boolean;
  dialogTitle: string | null;
  artifactDir: string;
  artifactPath: string;
  screenshots: string[];
  error: string | null;
};

export type RunAiAnalysisUiSmokeOptions = {
  baseUrl: string;
  login?: string | null;
  password?: string | null;
  capture: boolean;
  headless: boolean;
  requireAuth: boolean;
  artifactDir: string;
  timeoutMs: number;
};

export type LoginToLibraryResult = {
  authenticated: boolean;
  publicRedirectPath: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function sanitizeArtifactSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeAiAnalysisUiSmokeBaseUrl(value: string | undefined): string {
  const baseUrl = String(value ?? 'https://ai.irbistech.com').trim();
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export function locatorByTestIdOr(page: Page, testId: string, fallbackSelector: string): Locator {
  return page.locator(`[data-testid="${testId}"], ${fallbackSelector}`).first();
}

export async function capturePageScreenshot(
  target: Page,
  filePath: string,
  screenshots?: string[],
) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await target.screenshot({ path: filePath, fullPage: true });
  screenshots?.push(filePath);
}

export async function captureLocatorScreenshot(
  target: Locator,
  filePath: string,
  screenshots?: string[],
) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await target.screenshot({ path: filePath });
  screenshots?.push(filePath);
}

async function writeSummary(summary: AiAnalysisUiSmokeSummary): Promise<void> {
  fs.mkdirSync(path.dirname(summary.artifactPath), { recursive: true });
  fs.writeFileSync(summary.artifactPath, `${JSON.stringify(summary, null, 2)}\n`);
}

export async function waitForAiAnalysis(page: Page, timeoutMs: number) {
  await page.getByTestId('tab-aianalysis').waitFor({ state: 'visible', timeout: timeoutMs });
  await page.getByTestId('ai-analysis-table').waitFor({ state: 'visible', timeout: timeoutMs });
  await page
    .locator('[data-testid^="ai-analysis-company-info-"]')
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loginToLibrary({
  page,
  baseUrl,
  login,
  password,
  timeoutMs,
}: {
  page: Page;
  baseUrl: string;
  login: string;
  password: string;
  timeoutMs: number;
}): Promise<LoginToLibraryResult> {
  const currentUrl = page.url();
  const alreadyOnLogin =
    currentUrl &&
    currentUrl !== 'about:blank' &&
    currentUrl.startsWith(baseUrl) &&
    /\/login(?:\?|$)/.test(currentUrl);

  if (!alreadyOnLogin) {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  }
  await page.waitForURL(/\/login(?:\?|$)/, { timeout: timeoutMs });

  const publicRedirectPath = new URL(page.url()).pathname;
  assert.equal(publicRedirectPath, '/login', 'public access should redirect to /login');

  const loginInput = locatorByTestIdOr(page, 'login-input', 'input[autocomplete="username"]');
  const passwordInput = locatorByTestIdOr(
    page,
    'login-password-input',
    'input[autocomplete="current-password"]',
  );
  const submitButton = locatorByTestIdOr(page, 'login-submit', 'button[type="submit"]');

  await loginInput.waitFor({ state: 'visible', timeout: timeoutMs });
  await loginInput.fill(login);
  await passwordInput.fill(password);
  await Promise.all([
    page.waitForURL(/\/library(?:\?|$)/, { timeout: timeoutMs }),
    submitButton.click(),
  ]);

  return {
    authenticated: true,
    publicRedirectPath,
  };
}

export async function openAiAnalysisPage({
  page,
  baseUrl,
  timeoutMs,
}: {
  page: Page;
  baseUrl: string;
  timeoutMs: number;
}) {
  await page.goto(`${baseUrl}/library?tab=aianalysis`, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs,
  });
  await waitForAiAnalysis(page, timeoutMs);
}

export async function runAiAnalysisUiSmoke({
  baseUrl,
  login,
  password,
  capture,
  headless,
  requireAuth,
  artifactDir,
  timeoutMs,
}: RunAiAnalysisUiSmokeOptions): Promise<AiAnalysisUiSmokeSummary> {
  const checkedAt = nowIso();
  const normalizedBaseUrl = normalizeAiAnalysisUiSmokeBaseUrl(baseUrl);
  const hasCredentials = Boolean(login && password);
  const artifactRoot = path.resolve(artifactDir);
  const runDir = path.join(artifactRoot, sanitizeArtifactSegment(checkedAt.replace(/[:.]/g, '-')));
  const artifactPath = path.join(runDir, 'summary.json');

  fs.mkdirSync(runDir, { recursive: true });

  const summary: AiAnalysisUiSmokeSummary = {
    checkedAt,
    ok: false,
    mode: hasCredentials ? 'authenticated' : 'public',
    baseUrl: normalizedBaseUrl,
    authenticated: false,
    requireAuth,
    publicRedirectPath: null,
    aiAnalysisLoaded: false,
    companyDialogOpened: false,
    dialogTitle: null,
    artifactDir: runDir,
    artifactPath,
    screenshots: [],
    error: null,
  };

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless });
    context = await browser.newContext({
      ignoreHTTPSErrors: normalizedBaseUrl.startsWith('https://'),
      viewport: { width: 1440, height: 1200 },
    });
    page = await context.newPage();

    await page.goto(normalizedBaseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForURL(/\/login(?:\?|$)/, { timeout: timeoutMs });
    summary.publicRedirectPath = new URL(page.url()).pathname;
    assert.equal(summary.publicRedirectPath, '/login', 'public access should redirect to /login');

    if (capture) {
      await capturePageScreenshot(page, path.join(runDir, '01-login.png'), summary.screenshots);
    }

    if (!hasCredentials) {
      if (requireAuth) {
        throw new Error(
          'AI_ANALYSIS_UI_SMOKE_REQUIRE_AUTH=true, but AI_ANALYSIS_UI_SMOKE_LOGIN/PASSWORD are not configured',
        );
      }
      summary.ok = true;
      return summary;
    }

    const loginResult = await loginToLibrary({
      page,
      baseUrl: normalizedBaseUrl,
      login: login ?? '',
      password: password ?? '',
      timeoutMs,
    });
    summary.authenticated = loginResult.authenticated;
    summary.publicRedirectPath = loginResult.publicRedirectPath;

    if (capture) {
      await capturePageScreenshot(
        page,
        path.join(runDir, '02-library-home.png'),
        summary.screenshots,
      );
    }

    await openAiAnalysisPage({ page, baseUrl: normalizedBaseUrl, timeoutMs });
    summary.aiAnalysisLoaded = true;

    if (capture) {
      await capturePageScreenshot(page, path.join(runDir, '03-ai-analysis.png'), summary.screenshots);
    }

    const infoButton = page.locator('[data-testid^="ai-analysis-company-info-"]').first();
    await infoButton.click();
    const dialog = page.getByTestId('ai-analysis-company-dialog');
    await dialog.waitFor({ state: 'visible', timeout: timeoutMs });
    await page.getByTestId('ai-analysis-company-equipment').waitFor({ state: 'visible', timeout: timeoutMs });
    summary.companyDialogOpened = true;
    summary.dialogTitle = await page.getByTestId('ai-analysis-company-dialog-title').innerText();

    if (capture) {
      await captureLocatorScreenshot(
        dialog,
        path.join(runDir, '04-company-dialog.png'),
        summary.screenshots,
      );
    }

    summary.ok = true;
    return summary;
  } catch (error) {
    summary.error = errorText(error);
    if (capture && page) {
      await capturePageScreenshot(
        page,
        path.join(runDir, '99-error.png'),
        summary.screenshots,
      ).catch(() => undefined);
    }
    return summary;
  } finally {
    await writeSummary(summary).catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

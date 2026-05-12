import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';

import {
  DEFAULT_ARTIFACT_RETENTION,
  isTimestampedArtifactRunDirectory,
  parseArtifactRetentionCount,
  pruneArtifactEntries,
} from './artifact-retention';
import {
  validateAcceptanceTraceCase,
  type AcceptanceCaseConfig,
  type AcceptanceCaseResult,
  type AcceptanceTracePayload,
} from './ai-analysis-acceptance-qa';
import {
  captureLocatorScreenshot,
  capturePageScreenshot,
  loginToLibrary,
  locatorByTestIdOr,
  normalizeAiAnalysisUiSmokeBaseUrl,
  openAiAnalysisPage,
  sanitizeArtifactSegment,
} from './ai-analysis-ui-smoke';

export type AiAnalysisUiQaCaseConfig = AcceptanceCaseConfig;

export type AiAnalysisUiQaRuntimeOptions = {
  baseUrl: string;
  login: string;
  password: string;
  timeoutMs: number;
  capture: boolean;
  headless: boolean;
  artifactDir: string;
  artifactRetentionCount: number;
  cases: AiAnalysisUiQaCaseConfig[];
};

export type AiAnalysisUiQaCaseSummary = {
  name: string;
  inn: string;
  ok: boolean;
  dialogTitle: string | null;
  selectionStrategy: string | null;
  finalSource: string | null;
  originKind: string | null;
  artifactDir: string;
  rowScreenshotPath: string | null;
  dialogScreenshotPath: string | null;
  equipmentScreenshotPath: string | null;
  pathTablesFound: string[];
  companyArtifactPath: string | null;
  equipmentTraceArtifactPath: string | null;
  productTraceArtifactPath: string | null;
  validation: AcceptanceCaseResult | null;
  error: string | null;
};

export type AiAnalysisUiQaSummary = {
  checkedAt: string;
  ok: boolean;
  baseUrl: string;
  authenticated: boolean;
  publicRedirectPath: string | null;
  artifactDir: string;
  artifactPath: string;
  cases: AiAnalysisUiQaCaseSummary[];
  screenshots: string[];
  error: string | null;
};

export type RunAiAnalysisUiQaOptions = AiAnalysisUiQaRuntimeOptions;

type JsonFetchResult = {
  ok: boolean;
  status: number;
  payload: unknown;
};

function nowIso(): string {
  return new Date().toISOString();
}

function trimEnvValue(value: string | undefined): string {
  return String(value ?? '').trim();
}

function pickFirstNonEmpty(
  env: Record<string, string | undefined>,
  keys: string[],
  fallback = '',
): string {
  for (const key of keys) {
    const value = trimEnvValue(env[key]);
    if (value) {
      return value;
    }
  }
  return fallback;
}

function parseBoolean(value: string, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parsePositiveNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function ensureRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function makeDefaultCases(env: Record<string, string | undefined>): AiAnalysisUiQaCaseConfig[] {
  return [
    {
      name: 'okved-1way',
      inn: pickFirstNonEmpty(
        env,
        ['AI_ANALYSIS_UI_QA_OKVED_INN', 'AI_ANALYSIS_ACCEPTANCE_OKVED_INN'],
        '1841109992',
      ),
      requiredSource: '1way',
      expectedSelectionStrategy: 'okved',
      expectedOriginKind: 'okved',
    },
    {
      name: 'product-2way',
      inn: pickFirstNonEmpty(
        env,
        ['AI_ANALYSIS_UI_QA_2WAY_INN', 'AI_ANALYSIS_ACCEPTANCE_2WAY_INN'],
        '6320002223',
      ),
      requiredSource: '2way',
      expectedSelectionStrategy: 'site',
      expectedOriginKind: 'product',
      requireMatchedProduct: true,
    },
    {
      name: 'site-3way',
      inn: pickFirstNonEmpty(
        env,
        ['AI_ANALYSIS_UI_QA_3WAY_INN', 'AI_ANALYSIS_ACCEPTANCE_3WAY_INN'],
        '3444070534',
      ),
      requiredSource: '3way',
      expectedSelectionStrategy: 'site',
      expectedOriginKind: 'site',
      requireMatchedSite: true,
    },
  ];
}

export function resolveAiAnalysisUiQaOptions(
  env: Record<string, string | undefined>,
  cwd = process.cwd(),
): AiAnalysisUiQaRuntimeOptions {
  const baseUrl = normalizeAiAnalysisUiSmokeBaseUrl(
    pickFirstNonEmpty(env, ['AI_ANALYSIS_UI_QA_BASE_URL', 'AI_ANALYSIS_UI_SMOKE_BASE_URL'], 'https://ai.irbistech.com'),
  );

  return {
    baseUrl,
    login: pickFirstNonEmpty(env, ['AI_ANALYSIS_UI_QA_LOGIN', 'AI_ANALYSIS_UI_SMOKE_LOGIN']),
    password: pickFirstNonEmpty(env, ['AI_ANALYSIS_UI_QA_PASSWORD', 'AI_ANALYSIS_UI_SMOKE_PASSWORD']),
    timeoutMs: parsePositiveNumber(
      pickFirstNonEmpty(env, ['AI_ANALYSIS_UI_QA_TIMEOUT_MS', 'AI_ANALYSIS_UI_SMOKE_TIMEOUT_MS'], '60000'),
      60_000,
    ),
    capture: parseBoolean(
      pickFirstNonEmpty(env, ['AI_ANALYSIS_UI_QA_CAPTURE', 'AI_ANALYSIS_UI_SMOKE_CAPTURE'], 'true'),
      true,
    ),
    headless: parseBoolean(
      pickFirstNonEmpty(env, ['AI_ANALYSIS_UI_QA_HEADLESS', 'AI_ANALYSIS_UI_SMOKE_HEADLESS'], 'true'),
      true,
    ),
    artifactDir: path.resolve(
      cwd,
      pickFirstNonEmpty(env, ['AI_ANALYSIS_UI_QA_ARTIFACT_DIR'], 'artifacts/ai-analysis-ui-qa'),
    ),
    artifactRetentionCount: parseArtifactRetentionCount(
      pickFirstNonEmpty(env, ['AI_ANALYSIS_UI_QA_ARTIFACT_RETENTION']),
      DEFAULT_ARTIFACT_RETENTION,
    ),
    cases: makeDefaultCases(env),
  };
}

function writeJsonArtifact(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function buildCaseDir(baseDir: string, caseName: string): string {
  return path.join(baseDir, sanitizeArtifactSegment(caseName));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function assertElementContains(locator: Locator, expectedText: string, message: string) {
  const text = await locator.innerText();
  assert.match(text, new RegExp(expectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), message);
}

async function fetchJsonWithSession(page: Page, relativeUrl: string): Promise<JsonFetchResult> {
  return page.evaluate(async (target) => {
    const response = await fetch(target, { cache: 'no-store' });
    const rawText = await response.text();
    let payload: unknown = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = rawText;
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  }, relativeUrl);
}

async function focusCompanyByInn(page: Page, inn: string, timeoutMs: number) {
  const filtersButton = page.getByTestId('ai-analysis-filters-button');
  await filtersButton.click();

  const filtersDialog = page.getByTestId('ai-analysis-filters-dialog');
  await filtersDialog.waitFor({ state: 'visible', timeout: timeoutMs });

  const searchInput = locatorByTestIdOr(
    page,
    'ai-analysis-filters-query',
    'input[placeholder*="ИНН"], input[placeholder*="названию"]',
  );
  await searchInput.fill('');
  const companySearchResponse = page
    .waitForResponse(
      (response) => {
        if (!response.url().includes('/api/ai-analysis/companies?')) {
          return false;
        }

        try {
          const url = new URL(response.url());
          return url.searchParams.get('q') === inn;
        } catch {
          return false;
        }
      },
      { timeout: timeoutMs },
    )
    .catch(() => null);
  await searchInput.fill(inn);
  await companySearchResponse;
  await page.keyboard.press('Escape');
  await filtersDialog.waitFor({ state: 'hidden', timeout: timeoutMs });

  const row = page.getByTestId(`ai-analysis-company-row-${inn}`);
  await row.waitFor({ state: 'visible', timeout: timeoutMs });
  return row;
}

async function captureCaseArtifacts({
  page,
  baseUrl,
  timeoutMs,
  capture,
  runDir,
  caseConfig,
  screenshots,
}: {
  page: Page;
  baseUrl: string;
  timeoutMs: number;
  capture: boolean;
  runDir: string;
  caseConfig: AiAnalysisUiQaCaseConfig;
  screenshots: string[];
}): Promise<AiAnalysisUiQaCaseSummary> {
  const caseDir = buildCaseDir(runDir, caseConfig.name);
  fs.mkdirSync(caseDir, { recursive: true });

  const summary: AiAnalysisUiQaCaseSummary = {
    name: caseConfig.name,
    inn: caseConfig.inn,
    ok: false,
    dialogTitle: null,
    selectionStrategy: null,
    finalSource: null,
    originKind: null,
    artifactDir: caseDir,
    rowScreenshotPath: null,
    dialogScreenshotPath: null,
    equipmentScreenshotPath: null,
    pathTablesFound: [],
    companyArtifactPath: path.join(caseDir, 'company.json'),
    equipmentTraceArtifactPath: path.join(caseDir, 'equipment-trace.json'),
    productTraceArtifactPath: path.join(caseDir, 'product-trace.json'),
    validation: null,
    error: null,
  };

  try {
    await openAiAnalysisPage({ page, baseUrl, timeoutMs });

    const row = await focusCompanyByInn(page, caseConfig.inn, timeoutMs);
    if (capture) {
      summary.rowScreenshotPath = path.join(caseDir, '01-company-row.png');
      await captureLocatorScreenshot(row, summary.rowScreenshotPath, screenshots);
    }

    const infoButton = page.getByTestId(`ai-analysis-company-info-${caseConfig.inn}`);
    await infoButton.click();

    const dialog = page.getByTestId('ai-analysis-company-dialog');
    await dialog.waitFor({ state: 'visible', timeout: timeoutMs });
    const equipmentSection = page.getByTestId('ai-analysis-company-equipment');
    await equipmentSection.waitFor({ state: 'visible', timeout: timeoutMs });
    const expectedPathTables = [
      { id: 'ai-analysis-path-top', label: 'Топ-10 оборудования' },
      { id: 'ai-analysis-path-products', label: 'Путь 1' },
      { id: 'ai-analysis-path-site-equipment', label: 'Путь 2' },
      { id: 'ai-analysis-path-okved', label: 'Путь 3' },
    ];
    for (const table of expectedPathTables) {
      const section = page.getByTestId(table.id);
      await section.waitFor({ state: 'visible', timeout: timeoutMs });
      await assertElementContains(section, table.label, `${caseConfig.name}: ${table.label} section should be visible`);
      summary.pathTablesFound.push(table.id);
    }

    summary.dialogTitle = (await page.getByTestId('ai-analysis-company-dialog-title').innerText()).trim();
    assert.match(summary.dialogTitle, new RegExp(caseConfig.inn), 'dialog title should contain INN');

    if (capture) {
      summary.dialogScreenshotPath = path.join(caseDir, '02-company-dialog.png');
      summary.equipmentScreenshotPath = path.join(caseDir, '03-equipment-section.png');
      await captureLocatorScreenshot(dialog, summary.dialogScreenshotPath, screenshots);
      await captureLocatorScreenshot(equipmentSection, summary.equipmentScreenshotPath, screenshots);
    }

    const companyResponse = await fetchJsonWithSession(
      page,
      `/api/ai-analysis/companies?page=1&pageSize=1&q=${encodeURIComponent(caseConfig.inn)}`,
    );
    const equipmentTraceResponse = await fetchJsonWithSession(
      page,
      `/api/ai-analysis/equipment-trace/${encodeURIComponent(caseConfig.inn)}`,
    );
    const productTraceResponse = await fetchJsonWithSession(
      page,
      `/api/ai-analysis/product-trace/${encodeURIComponent(caseConfig.inn)}`,
    );

    writeJsonArtifact(summary.companyArtifactPath ?? path.join(caseDir, 'company.json'), companyResponse.payload);
    writeJsonArtifact(
      summary.equipmentTraceArtifactPath ?? path.join(caseDir, 'equipment-trace.json'),
      equipmentTraceResponse.payload,
    );
    writeJsonArtifact(
      summary.productTraceArtifactPath ?? path.join(caseDir, 'product-trace.json'),
      productTraceResponse.payload,
    );

    assert.equal(companyResponse.ok, true, `${caseConfig.name}: companies endpoint should be OK`);
    assert.equal(equipmentTraceResponse.ok, true, `${caseConfig.name}: equipment-trace endpoint should be OK`);
    assert.equal(productTraceResponse.ok, true, `${caseConfig.name}: product-trace endpoint should be OK`);

    const companyPayload = ensureRecord(companyResponse.payload);
    const companyItems = Array.isArray(companyPayload.items) ? companyPayload.items : [];
    assert.ok(companyItems.length > 0, `${caseConfig.name}: companies search should return at least one item`);

    const validation = validateAcceptanceTraceCase(
      caseConfig,
      ensureRecord(equipmentTraceResponse.payload) as AcceptanceTracePayload,
    );
    summary.validation = validation;
    summary.selectionStrategy = validation.selectionStrategy;
    summary.finalSource = validation.selectedItem.finalSource;
    summary.originKind = validation.selectedItem.originKind;
    summary.ok = true;
    return summary;
  } catch (error) {
    summary.error = errorText(error);
    if (capture) {
      const errorScreenshotPath = path.join(caseDir, '99-error.png');
      await capturePageScreenshot(page, errorScreenshotPath, screenshots).catch(() => undefined);
    }
    return summary;
  } finally {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.getByTestId('ai-analysis-company-dialog').waitFor({ state: 'hidden', timeout: 1_000 }).catch(() => undefined);
  }
}

function writeSummary(summary: AiAnalysisUiQaSummary) {
  writeJsonArtifact(summary.artifactPath, summary);
}

export async function runAiAnalysisUiQa({
  baseUrl,
  login,
  password,
  timeoutMs,
  capture,
  headless,
  artifactDir,
  artifactRetentionCount,
  cases,
}: RunAiAnalysisUiQaOptions): Promise<AiAnalysisUiQaSummary> {
  const checkedAt = nowIso();
  const normalizedBaseUrl = normalizeAiAnalysisUiSmokeBaseUrl(baseUrl);
  const runDir = path.join(artifactDir, sanitizeArtifactSegment(checkedAt.replace(/[:.]/g, '-')));
  const artifactPath = path.join(runDir, 'summary.json');

  fs.mkdirSync(runDir, { recursive: true });

  const summary: AiAnalysisUiQaSummary = {
    checkedAt,
    ok: false,
    baseUrl: normalizedBaseUrl,
    authenticated: false,
    publicRedirectPath: null,
    artifactDir: runDir,
    artifactPath,
    cases: [],
    screenshots: [],
    error: null,
  };

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    assert.ok(login, 'AI Analysis UI QA requires AI_ANALYSIS_UI_QA_LOGIN or AI_ANALYSIS_UI_SMOKE_LOGIN');
    assert.ok(password, 'AI Analysis UI QA requires AI_ANALYSIS_UI_QA_PASSWORD or AI_ANALYSIS_UI_SMOKE_PASSWORD');

    browser = await chromium.launch({ headless });
    context = await browser.newContext({
      ignoreHTTPSErrors: normalizedBaseUrl.startsWith('https://'),
      viewport: { width: 1440, height: 1200 },
    });
    page = await context.newPage();

    await page.goto(normalizedBaseUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForURL(/\/login(?:\?|$)/, { timeout: timeoutMs });

    if (capture) {
      await capturePageScreenshot(page, path.join(runDir, '00-login.png'), summary.screenshots);
    }

    const loginResult = await loginToLibrary({
      page,
      baseUrl: normalizedBaseUrl,
      login,
      password,
      timeoutMs,
    });
    summary.authenticated = loginResult.authenticated;
    summary.publicRedirectPath = loginResult.publicRedirectPath;

    if (capture) {
      await capturePageScreenshot(page, path.join(runDir, '00-library-home.png'), summary.screenshots);
    }

    for (const caseConfig of cases) {
      const caseSummary = await captureCaseArtifacts({
        page,
        baseUrl: normalizedBaseUrl,
        timeoutMs,
        capture,
        runDir,
        caseConfig,
        screenshots: summary.screenshots,
      });
      summary.cases.push(caseSummary);
    }

    summary.ok = summary.cases.length > 0 && summary.cases.every((item) => item.ok);
    return summary;
  } catch (error) {
    summary.error = errorText(error);
    if (capture && page) {
      await capturePageScreenshot(page, path.join(runDir, '99-error.png'), summary.screenshots).catch(() => undefined);
    }
    return summary;
  } finally {
    writeSummary(summary);
    await pruneArtifactEntries({
      rootDir: artifactDir,
      keepLatest: artifactRetentionCount,
      matchEntry: (entry) => entry.isDirectory && isTimestampedArtifactRunDirectory(entry.name),
    }).catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

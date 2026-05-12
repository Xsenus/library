import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveAiAnalysisUiQaOptions, runAiAnalysisUiQa } from '../lib/ai-analysis-ui-qa';

test('resolveAiAnalysisUiQaOptions prefers dedicated UI QA env values', () => {
  const options = resolveAiAnalysisUiQaOptions(
    {
      AI_ANALYSIS_UI_QA_BASE_URL: 'https://qa.irbistech.com/',
      AI_ANALYSIS_UI_QA_LOGIN: 'worker',
      AI_ANALYSIS_UI_QA_PASSWORD: 'secret',
      AI_ANALYSIS_UI_QA_TIMEOUT_MS: '45000',
      AI_ANALYSIS_UI_QA_CAPTURE: 'false',
      AI_ANALYSIS_UI_QA_HEADLESS: 'false',
      AI_ANALYSIS_UI_QA_ARTIFACT_DIR: 'custom/ui-qa',
      AI_ANALYSIS_UI_QA_OKVED_INN: '1111111111',
      AI_ANALYSIS_UI_QA_2WAY_INN: '2222222222',
      AI_ANALYSIS_UI_QA_3WAY_INN: '3333333333',
    },
    '/workspace/library',
  );

  assert.equal(options.baseUrl, 'https://qa.irbistech.com');
  assert.equal(options.login, 'worker');
  assert.equal(options.password, 'secret');
  assert.equal(options.timeoutMs, 45_000);
  assert.equal(options.capture, false);
  assert.equal(options.headless, false);
  assert.equal(options.artifactDir, path.resolve('/workspace/library', 'custom/ui-qa'));
  assert.equal(options.artifactRetentionCount, 14);
  assert.deepEqual(
    options.cases.map((item) => [item.name, item.inn, item.requiredSource]),
    [
      ['okved-1way', '1111111111', '1way'],
      ['product-2way', '2222222222', '2way'],
      ['site-3way', '3333333333', '3way'],
    ],
  );
});

test('resolveAiAnalysisUiQaOptions falls back to smoke and acceptance env values', () => {
  const options = resolveAiAnalysisUiQaOptions(
    {
      AI_ANALYSIS_UI_SMOKE_BASE_URL: 'https://ai.irbistech.com/',
      AI_ANALYSIS_UI_SMOKE_LOGIN: 'fallback-worker',
      AI_ANALYSIS_UI_SMOKE_PASSWORD: 'fallback-secret',
      AI_ANALYSIS_UI_SMOKE_TIMEOUT_MS: '30000',
      AI_ANALYSIS_UI_SMOKE_CAPTURE: 'true',
      AI_ANALYSIS_UI_SMOKE_HEADLESS: 'true',
      AI_ANALYSIS_UI_QA_ARTIFACT_RETENTION: '9',
      AI_ANALYSIS_ACCEPTANCE_OKVED_INN: '1841109992',
      AI_ANALYSIS_ACCEPTANCE_2WAY_INN: '6320002223',
      AI_ANALYSIS_ACCEPTANCE_3WAY_INN: '3444070534',
    },
    '/workspace/library',
  );

  assert.equal(options.baseUrl, 'https://ai.irbistech.com');
  assert.equal(options.login, 'fallback-worker');
  assert.equal(options.password, 'fallback-secret');
  assert.equal(options.timeoutMs, 30_000);
  assert.equal(options.capture, true);
  assert.equal(options.headless, true);
  assert.equal(options.artifactDir, path.resolve('/workspace/library', 'artifacts/ai-analysis-ui-qa'));
  assert.equal(options.artifactRetentionCount, 9);
  assert.deepEqual(
    options.cases.map((item) => ({
      name: item.name,
      inn: item.inn,
      source: item.requiredSource,
      origin: item.expectedOriginKind,
    })),
    [
      { name: 'okved-1way', inn: '1841109992', source: '1way', origin: 'okved' },
      { name: 'product-2way', inn: '6320002223', source: '2way', origin: 'product' },
      { name: 'site-3way', inn: '3444070534', source: '3way', origin: 'site' },
    ],
  );
});

test('runAiAnalysisUiQa fails with a clear error when worker credentials are absent', async () => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-analysis-ui-qa-'));
  const summary = await runAiAnalysisUiQa({
    baseUrl: 'https://ai.irbistech.com',
    login: '',
    password: '',
    timeoutMs: 1_000,
    capture: false,
    headless: true,
    artifactDir,
    artifactRetentionCount: 14,
    cases: [],
  });

  assert.equal(summary.ok, false);
  assert.match(summary.error ?? '', /AI Analysis UI QA requires/);
  assert.equal(fs.existsSync(summary.artifactPath), true);
});

test('ui qa targets the dedicated company search input and keeps responsible filter separate', () => {
  const qaSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ai-analysis-ui-qa.ts'), 'utf8');
  const componentSource = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'library', 'ai-company-analysis-tab.tsx'),
    'utf8',
  );

  assert.match(qaSource, /ai-analysis-filters-query/);
  assert.match(qaSource, /waitForResponse/);
  assert.match(componentSource, /data-testid="ai-analysis-filters-query"/);
  assert.match(componentSource, /data-testid="ai-analysis-filters-responsible"/);
});

test('ui qa verifies the path tables requested by the customer', () => {
  const qaSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ai-analysis-ui-qa.ts'), 'utf8');
  const componentSource = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'library', 'ai-company-analysis-tab.tsx'),
    'utf8',
  );

  for (const testId of [
    'ai-analysis-path-top',
    'ai-analysis-path-products',
    'ai-analysis-path-site-equipment',
    'ai-analysis-path-okved',
    'ai-analysis-path-tab-top',
    'ai-analysis-path-tab-products',
    'ai-analysis-path-tab-site-equipment',
    'ai-analysis-path-tab-okved',
  ]) {
    assert.match(componentSource, new RegExp(`data-testid="${testId}"`));
    assert.match(qaSource, new RegExp(testId));
  }

  assert.match(componentSource, /<Tabs defaultValue="top"/);
  assert.match(qaSource, /pathTablesFound/);
});

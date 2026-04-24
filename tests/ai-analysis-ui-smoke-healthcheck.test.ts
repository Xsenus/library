import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildAiAnalysisUiSmokeAlertText,
  currentAiAnalysisUiSmokeState,
  shouldSendAiAnalysisUiSmokeAlert,
  summaryToJson,
  writeAiAnalysisUiSmokeHealthArtifact,
} from '../lib/ai-analysis-ui-smoke-healthcheck';
import { normalizeAiAnalysisUiSmokeBaseUrl, type AiAnalysisUiSmokeSummary } from '../lib/ai-analysis-ui-smoke';

function makeSummary(overrides: Partial<AiAnalysisUiSmokeSummary> = {}): AiAnalysisUiSmokeSummary {
  return {
    checkedAt: '2026-04-23T12:00:00.000Z',
    ok: true,
    mode: 'public',
    baseUrl: 'https://ai.irbistech.com',
    authenticated: false,
    requireAuth: false,
    publicRedirectPath: '/login',
    aiAnalysisLoaded: false,
    companyDialogOpened: false,
    dialogTitle: null,
    artifactDir: '/tmp/ui-smoke/2026-04-23T12-00-00-000Z',
    artifactPath: '/tmp/ui-smoke/2026-04-23T12-00-00-000Z/summary.json',
    screenshots: ['/tmp/ui-smoke/2026-04-23T12-00-00-000Z/01-login.png'],
    error: null,
    ...overrides,
  };
}

test('normalizeAiAnalysisUiSmokeBaseUrl trims trailing slash', () => {
  assert.equal(normalizeAiAnalysisUiSmokeBaseUrl('https://ai.irbistech.com/'), 'https://ai.irbistech.com');
});

test('shouldSendAiAnalysisUiSmokeAlert deduplicates unhealthy alerts and can alert on recovery', () => {
  assert.equal(currentAiAnalysisUiSmokeState(true), 'healthy');
  assert.equal(currentAiAnalysisUiSmokeState(false), 'unhealthy');

  assert.equal(
    shouldSendAiAnalysisUiSmokeAlert({
      previousStatus: undefined,
      currentStatus: 'unhealthy',
      alertOnRecovery: true,
    }),
    true,
  );
  assert.equal(
    shouldSendAiAnalysisUiSmokeAlert({
      previousStatus: 'unhealthy',
      currentStatus: 'unhealthy',
      alertOnRecovery: true,
    }),
    false,
  );
  assert.equal(
    shouldSendAiAnalysisUiSmokeAlert({
      previousStatus: 'unhealthy',
      currentStatus: 'healthy',
      alertOnRecovery: true,
    }),
    true,
  );
  assert.equal(
    shouldSendAiAnalysisUiSmokeAlert({
      previousStatus: 'unhealthy',
      currentStatus: 'healthy',
      alertOnRecovery: false,
    }),
    false,
  );
});

test('buildAiAnalysisUiSmokeAlertText includes compact browser-failure context', () => {
  const text = buildAiAnalysisUiSmokeAlertText(
    makeSummary({
      ok: false,
      mode: 'authenticated',
      authenticated: true,
      requireAuth: true,
      aiAnalysisLoaded: true,
      companyDialogOpened: false,
      error: 'Timed out waiting for [data-testid="ai-analysis-company-dialog"]',
    }),
  );

  assert.match(text, /ai-analysis ui smoke is NOT OK/);
  assert.match(text, /mode=authenticated/);
  assert.match(text, /authenticated=yes/);
  assert.match(text, /dialog=not_opened/);
  assert.match(text, /Timed out waiting/);
});

test('summaryToJson exposes artifact paths and screenshots for monitoring consumers', () => {
  const payload = summaryToJson(makeSummary());

  assert.equal(payload.ok, true);
  assert.equal(payload.artifactPath, '/tmp/ui-smoke/2026-04-23T12-00-00-000Z/summary.json');
  assert.deepEqual(payload.screenshots, ['/tmp/ui-smoke/2026-04-23T12-00-00-000Z/01-login.png']);
});

test('writeAiAnalysisUiSmokeHealthArtifact writes timestamped and latest JSON evidence', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-smoke-health-artifact-'));

  try {
    const artifactPath = await writeAiAnalysisUiSmokeHealthArtifact(tmpDir, makeSummary());
    const latestPath = path.join(tmpDir, 'latest.json');

    assert.equal(path.basename(artifactPath), 'ai-analysis-ui-smoke-health-2026-04-23T12-00-00-000Z.json');
    assert.equal(fs.existsSync(artifactPath), true);
    assert.equal(fs.existsSync(latestPath), true);

    const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8')) as Record<string, unknown>;
    assert.equal(latest.ok, true);
    assert.equal(latest.checkedAt, '2026-04-23T12:00:00.000Z');
    assert.equal(latest.artifactPath, '/tmp/ui-smoke/2026-04-23T12-00-00-000Z/summary.json');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

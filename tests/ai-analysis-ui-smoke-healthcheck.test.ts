import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAiAnalysisUiSmokeAlertText,
  currentAiAnalysisUiSmokeState,
  shouldSendAiAnalysisUiSmokeAlert,
  summaryToJson,
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

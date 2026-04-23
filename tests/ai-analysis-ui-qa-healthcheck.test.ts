import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAiAnalysisUiQaAlertText,
  currentAiAnalysisUiQaState,
  shouldSendAiAnalysisUiQaAlert,
  summaryToJson,
} from '../lib/ai-analysis-ui-qa-healthcheck';
import type { AiAnalysisUiQaSummary } from '../lib/ai-analysis-ui-qa';

function makeSummary(overrides: Partial<AiAnalysisUiQaSummary> = {}): AiAnalysisUiQaSummary {
  return {
    checkedAt: '2026-04-23T12:00:00.000Z',
    ok: true,
    baseUrl: 'https://ai.irbistech.com',
    authenticated: true,
    publicRedirectPath: '/login',
    artifactDir: '/tmp/ui-qa/2026-04-23T12-00-00-000Z',
    artifactPath: '/tmp/ui-qa/2026-04-23T12-00-00-000Z/summary.json',
    cases: [
      {
        name: 'okved-1way',
        inn: '1841109992',
        ok: true,
        dialogTitle: 'Test Company · ИНН 1841109992',
        selectionStrategy: 'okved',
        finalSource: '1way',
        originKind: 'okved',
        artifactDir: '/tmp/ui-qa/2026-04-23T12-00-00-000Z/okved-1way',
        rowScreenshotPath: '/tmp/ui-qa/2026-04-23T12-00-00-000Z/okved-1way/01-company-row.png',
        dialogScreenshotPath: '/tmp/ui-qa/2026-04-23T12-00-00-000Z/okved-1way/02-company-dialog.png',
        equipmentScreenshotPath: '/tmp/ui-qa/2026-04-23T12-00-00-000Z/okved-1way/03-equipment-section.png',
        companyArtifactPath: '/tmp/ui-qa/2026-04-23T12-00-00-000Z/okved-1way/company.json',
        equipmentTraceArtifactPath: '/tmp/ui-qa/2026-04-23T12-00-00-000Z/okved-1way/equipment-trace.json',
        productTraceArtifactPath: '/tmp/ui-qa/2026-04-23T12-00-00-000Z/okved-1way/product-trace.json',
        validation: null,
        error: null,
      },
    ],
    screenshots: ['/tmp/ui-qa/2026-04-23T12-00-00-000Z/00-login.png'],
    error: null,
    ...overrides,
  };
}

test('shouldSendAiAnalysisUiQaAlert deduplicates unhealthy alerts and can alert on recovery', () => {
  assert.equal(currentAiAnalysisUiQaState(true), 'healthy');
  assert.equal(currentAiAnalysisUiQaState(false), 'unhealthy');

  assert.equal(
    shouldSendAiAnalysisUiQaAlert({
      previousStatus: undefined,
      currentStatus: 'unhealthy',
      alertOnRecovery: true,
    }),
    true,
  );
  assert.equal(
    shouldSendAiAnalysisUiQaAlert({
      previousStatus: 'unhealthy',
      currentStatus: 'unhealthy',
      alertOnRecovery: true,
    }),
    false,
  );
  assert.equal(
    shouldSendAiAnalysisUiQaAlert({
      previousStatus: 'unhealthy',
      currentStatus: 'healthy',
      alertOnRecovery: true,
    }),
    true,
  );
  assert.equal(
    shouldSendAiAnalysisUiQaAlert({
      previousStatus: 'unhealthy',
      currentStatus: 'healthy',
      alertOnRecovery: false,
    }),
    false,
  );
});

test('buildAiAnalysisUiQaAlertText includes failed case context', () => {
  const text = buildAiAnalysisUiQaAlertText(
    makeSummary({
      ok: false,
      cases: [
        {
          name: 'site-3way',
          inn: '3444070534',
          ok: false,
          dialogTitle: null,
          selectionStrategy: null,
          finalSource: null,
          originKind: null,
          artifactDir: '/tmp/ui-qa/2026-04-23T12-00-00-000Z/site-3way',
          rowScreenshotPath: null,
          dialogScreenshotPath: null,
          equipmentScreenshotPath: null,
          companyArtifactPath: null,
          equipmentTraceArtifactPath: null,
          productTraceArtifactPath: null,
          validation: null,
          error: '3way row should expose raw site equipment score',
        },
      ],
    }),
  );

  assert.match(text, /ai-analysis ui qa is NOT OK/);
  assert.match(text, /authenticated=yes/);
  assert.match(text, /failed=site-3way/);
  assert.match(text, /raw site equipment score/);
});

test('summaryToJson exposes artifact paths and case details for monitoring consumers', () => {
  const payload = summaryToJson(makeSummary());

  assert.equal(payload.ok, true);
  assert.equal(payload.artifactPath, '/tmp/ui-qa/2026-04-23T12-00-00-000Z/summary.json');
  assert.deepEqual(payload.screenshots, ['/tmp/ui-qa/2026-04-23T12-00-00-000Z/00-login.png']);
  assert.ok(Array.isArray(payload.cases));
});

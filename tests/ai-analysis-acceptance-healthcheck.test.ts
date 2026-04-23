import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAiAnalysisAcceptanceAlertText,
  buildDefaultAcceptanceCases,
  currentAiAnalysisAcceptanceState,
  shouldSendAiAnalysisAcceptanceAlert,
  summaryToJson,
  type AiAnalysisAcceptanceHealthSummary,
} from '../lib/ai-analysis-acceptance-healthcheck';

function makeSummary(overrides: Partial<AiAnalysisAcceptanceHealthSummary> = {}): AiAnalysisAcceptanceHealthSummary {
  return {
    checkedAt: '2026-04-23T00:00:00.000Z',
    baseUrl: 'https://ai.irbistech.com',
    ok: true,
    reason: 'ok',
    health: {
      ok: true,
      severity: 'ok',
      error: null,
    },
    failedCases: [],
    cases: [
      {
        name: 'okved-1way',
        inn: '1841109992',
        ok: true,
        finalSource: '1way',
        finalScore: 0.99,
        formulaDelta: 0,
        originKind: 'okved',
        originName: 'Подбор по ОКВЭД',
        error: null,
      },
    ],
    ...overrides,
  };
}

test('buildDefaultAcceptanceCases keeps the production trace sentinels configurable', () => {
  const cases = buildDefaultAcceptanceCases({
    okvedInn: '111',
    twoWayInn: '222',
    threeWayInn: '333',
  });

  assert.deepEqual(
    cases.map((item) => [item.name, item.inn, item.requiredSource]),
    [
      ['okved-1way', '111', '1way'],
      ['product-2way', '222', '2way'],
      ['site-3way', '333', '3way'],
    ],
  );
  assert.equal(cases[0]?.expectedOriginKind, 'okved');
  assert.equal(cases[1]?.requireMatchedProduct, true);
  assert.equal(cases[2]?.requireMatchedSite, true);
});

test('shouldSendAiAnalysisAcceptanceAlert deduplicates unhealthy alerts and can alert on recovery', () => {
  assert.equal(currentAiAnalysisAcceptanceState(true), 'healthy');
  assert.equal(currentAiAnalysisAcceptanceState(false), 'unhealthy');

  assert.equal(
    shouldSendAiAnalysisAcceptanceAlert({
      previousStatus: undefined,
      currentStatus: 'unhealthy',
      alertOnRecovery: true,
    }),
    true,
  );
  assert.equal(
    shouldSendAiAnalysisAcceptanceAlert({
      previousStatus: 'unhealthy',
      currentStatus: 'unhealthy',
      alertOnRecovery: true,
    }),
    false,
  );
  assert.equal(
    shouldSendAiAnalysisAcceptanceAlert({
      previousStatus: 'unhealthy',
      currentStatus: 'healthy',
      alertOnRecovery: true,
    }),
    true,
  );
  assert.equal(
    shouldSendAiAnalysisAcceptanceAlert({
      previousStatus: 'unhealthy',
      currentStatus: 'healthy',
      alertOnRecovery: false,
    }),
    false,
  );
});

test('buildAiAnalysisAcceptanceAlertText includes compact failed case context', () => {
  const text = buildAiAnalysisAcceptanceAlertText(
    makeSummary({
      ok: false,
      reason: 'failed_cases:site-3way',
      failedCases: ['site-3way'],
      cases: [
        {
          name: 'site-3way',
          inn: '3444070534',
          ok: false,
          finalSource: null,
          finalScore: null,
          formulaDelta: null,
          originKind: null,
          originName: null,
          error: '3way row should expose raw site match score',
        },
      ],
    }),
  );

  assert.match(text, /ai-analysis acceptance is NOT OK/);
  assert.match(text, /failed=site-3way/);
  assert.match(text, /raw site match score/);
});

test('summaryToJson exposes artifact path for monitoring consumers', () => {
  const payload = summaryToJson(makeSummary({ artifactPath: '/tmp/latest.json' }));

  assert.equal(payload.ok, true);
  assert.equal(payload.artifactPath, '/tmp/latest.json');
  assert.deepEqual(payload.failedCases, []);
});

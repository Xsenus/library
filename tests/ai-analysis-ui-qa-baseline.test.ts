import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAiAnalysisUiQaBaselineSnapshot,
  renderAiAnalysisUiQaBaselineMarkdown,
} from '../lib/ai-analysis-ui-qa-baseline';
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
        dialogTitle: 'ЮПИТЕР · ИНН 1841109992',
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
    screenshots: [
      '/tmp/ui-qa/2026-04-23T12-00-00-000Z/00-login.png',
      '/tmp/ui-qa/2026-04-23T12-00-00-000Z/00-library-home.png',
    ],
    error: null,
    ...overrides,
  };
}

test('buildAiAnalysisUiQaBaselineSnapshot converts run artifacts into reviewable metadata', () => {
  const snapshot = buildAiAnalysisUiQaBaselineSnapshot(makeSummary(), {
    generatedAt: '2026-04-24T00:00:00.000Z',
  });

  assert.equal(snapshot.generatedAt, '2026-04-24T00:00:00.000Z');
  assert.equal(snapshot.artifactRunId, '2026-04-23T12-00-00-000Z');
  assert.deepEqual(snapshot.screenshots, ['00-login.png', '00-library-home.png']);
  assert.equal(snapshot.cases[0]?.artifactDir, 'okved-1way');
  assert.equal(snapshot.cases[0]?.dialogScreenshotPath, 'okved-1way/02-company-dialog.png');
  assert.equal(snapshot.cases[0]?.equipmentTraceArtifactPath, 'okved-1way/equipment-trace.json');
});

test('renderAiAnalysisUiQaBaselineMarkdown emits stable case-oriented review notes', () => {
  const markdown = renderAiAnalysisUiQaBaselineMarkdown(
    buildAiAnalysisUiQaBaselineSnapshot(makeSummary(), {
      generatedAt: '2026-04-24T00:00:00.000Z',
    }),
  );

  assert.match(markdown, /^# AI Analysis UI QA Visual Baseline/m);
  assert.match(markdown, /### okved-1way/);
  assert.match(markdown, /winning path: `1way`/);
  assert.match(markdown, /dialog screenshot: `okved-1way\/02-company-dialog\.png`/);
  assert.match(markdown, /metadata only; screenshot and JSON binaries remain outside git/i);
  assert.match(markdown, /npm run ui:qa:baseline -- --summary <path>/);
});

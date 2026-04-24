import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAiIrbistechAcceptanceReportSnapshot,
  isAiIrbistechAcceptanceReportClean,
  renderAiIrbistechAcceptanceReportMarkdown,
  resolveAiIrbistechAcceptanceReportExitCode,
  type AiIrbistechAcceptanceReportSources,
} from '../lib/ai-irbistech-acceptance-report';

function makeSources(): AiIrbistechAcceptanceReportSources {
  return {
    aiIntegrationAcceptance: {
      inputPath: '/tmp/ai-integration/equipment-score-acceptance/latest.json',
      payload: {
        checked_at: '2026-04-24T08:00:00.000Z',
        ok: true,
        reason: 'ok',
        health: {
          ok: true,
          http_status: 200,
          error: null,
        },
        failed_cases: [],
        cases: [
          {
            name: 'okved-1way',
            ok: true,
            source: '1way',
            final_score: 0.8531,
            formula_delta: 0.00001,
          },
          {
            name: 'product-2way',
            ok: true,
            source: '2way',
            final_score: 0.7642,
            formula_delta: 0.00003,
          },
        ],
        artifact_path: '/tmp/ai-integration/equipment-score-acceptance/2026-04-24T08-00-00-000Z.json',
      },
    },
    aiIntegrationSyncHealth: {
      inputPath: '/tmp/ai-integration/analysis-score-sync-health/latest.json',
      payload: {
        checked_at: '2026-04-24T08:01:00.000Z',
        ok: true,
        reason: 'ok',
        url: 'https://ai-integration.local/v1/equipment-selection/analysis-score-sync-health',
        http_status: 200,
        counters: {
          total: 3,
          local_failed: 0,
          bitrix_failed: 0,
          local_skipped: 0,
          bitrix_skipped: 1,
        },
        local_target: {
          required: true,
          configured: true,
          table_exists: true,
          column_exists: true,
          index_exists: true,
          note: null,
        },
        bitrix_target: {
          required: false,
          configured: true,
          table_exists: true,
          column_exists: true,
          index_exists: true,
          note: 'best-effort',
        },
        artifact_path: '/tmp/ai-integration/analysis-score-sync-health/20260424T080100Z.json',
      },
    },
    aiIntegrationSqlReadiness: {
      inputPath: '/tmp/ai-integration/analysis-score-sql-readiness/latest.json',
      payload: {
        checked_at: '2026-04-24T08:01:30.000Z',
        ok: true,
        reason: 'ok',
        policy: {
          postgres_required: false,
          bitrix_required: true,
        },
        counters: {
          total: 2,
          configured: 2,
          required: 1,
          schema_ready: 2,
          effective_ok: 2,
          required_failed: 0,
          optional_failed: 0,
        },
        postgres_target: {
          required: false,
          configured: true,
          table_exists: true,
          column_exists: true,
          index_exists: true,
          note: null,
        },
        bitrix_target: {
          required: true,
          configured: true,
          table_exists: true,
          column_exists: true,
          index_exists: true,
          note: null,
        },
        sql_artifacts: {
          postgres: {
            path: '/tmp/sql/postgres.sql',
            exists: true,
          },
          bitrix: {
            path: '/tmp/sql/bitrix.sql',
            exists: true,
          },
        },
        artifact_path: '/tmp/ai-integration/analysis-score-sql-readiness/20260424T080130Z.json',
      },
    },
    libraryHealth: {
      inputPath: '/tmp/library/system-health/latest.json',
      payload: {
        checkedAt: '2026-04-24T08:02:00.000Z',
        ok: true,
        url: 'https://ai.irbistech.com/api/health',
        httpStatus: 200,
        severity: 'ok',
        reason: 'ok',
        failedServices: [],
        degradedServices: [],
        services: {
          main_db: { required: true, status: 'ok' },
          bitrix_db: { required: true, status: 'ok' },
          ai_integration: { required: true, status: 'ok' },
          analysis_score_sync: { required: false, status: 'ok' },
        },
      },
    },
    libraryAcceptance: {
      inputPath: '/tmp/library/ai-analysis-acceptance-health/latest.json',
      payload: {
        checkedAt: '2026-04-24T08:03:00.000Z',
        ok: true,
        baseUrl: 'https://ai.irbistech.com',
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
            ok: true,
            finalSource: '1way',
            originKind: 'okved',
          },
          {
            name: 'site-3way',
            ok: true,
            finalSource: '3way',
            originKind: 'site',
          },
        ],
        artifactPath: '/tmp/library/ai-analysis-acceptance-health/2026-04-24T08-03-00-000Z.json',
      },
    },
    libraryUiSmoke: {
      inputPath: '/tmp/library/ai-analysis-ui-smoke/latest.json',
      payload: {
        checkedAt: '2026-04-24T08:04:00.000Z',
        ok: true,
        mode: 'authenticated',
        baseUrl: 'https://ai.irbistech.com',
        authenticated: true,
        requireAuth: true,
        publicRedirectPath: '/login',
        aiAnalysisLoaded: true,
        companyDialogOpened: true,
        dialogTitle: 'Test company',
        artifactDir: '/tmp/library/ai-analysis-ui-smoke/2026-04-24T08-04-00-000Z',
        artifactPath: '/tmp/library/ai-analysis-ui-smoke/2026-04-24T08-04-00-000Z/summary.json',
        screenshots: ['01-login.png', '02-ai-analysis.png'],
        error: null,
      },
    },
    libraryUiQa: {
      inputPath: '/tmp/library/ai-analysis-ui-qa-health/latest.json',
      payload: {
        checkedAt: '2026-04-24T08:05:00.000Z',
        ok: true,
        baseUrl: 'https://ai.irbistech.com',
        authenticated: true,
        publicRedirectPath: '/login',
        artifactDir: '/tmp/library/ai-analysis-ui-qa/2026-04-24T08-05-00-000Z',
        artifactPath: '/tmp/library/ai-analysis-ui-qa/2026-04-24T08-05-00-000Z/summary.json',
        screenshots: ['01-login.png', '02-dialog.png'],
        cases: [
          {
            name: 'okved-1way',
            ok: true,
            finalSource: '1way',
            originKind: 'okved',
          },
          {
            name: 'product-2way',
            ok: true,
            finalSource: '2way',
            originKind: 'product',
          },
        ],
        error: null,
      },
    },
    aiSiteAnalyzerHealth: {
      inputPath: '/tmp/ai-site-analyzer/system-health/latest.json',
      payload: {
        checked_at: '2026-04-24T08:06:00.000Z',
        ok: true,
        severity: 'ok',
        reason: 'ok',
        base_url: 'https://site-analyzer.irbistech.com',
        health_http_status: 200,
        billing_http_status: 200,
        billing_configured: true,
        billing_error: null,
        billing_currency: 'USD',
        billing_spent_usd: 15.5,
        billing_remaining_usd: 84.5,
      },
    },
  };
}

test('buildAiIrbistechAcceptanceReportSnapshot reports ready when all checks pass', () => {
  const snapshot = buildAiIrbistechAcceptanceReportSnapshot(makeSources(), {
    generatedAt: '2026-04-24T09:00:00.000Z',
  });

  assert.equal(snapshot.generatedAt, '2026-04-24T09:00:00.000Z');
  assert.equal(snapshot.overallStatus, 'ready');
  assert.equal(snapshot.releaseReady, true);
  assert.equal(snapshot.counts.pass, 8);
  assert.equal(snapshot.counts.warn, 0);
  assert.equal(snapshot.counts.fail, 0);
  assert.equal(snapshot.counts.missing, 0);
  assert.deepEqual(snapshot.failedCheckIds, []);
  assert.deepEqual(snapshot.missingCheckIds, []);
});

test('buildAiIrbistechAcceptanceReportSnapshot surfaces degraded ai-site-analyzer as warning', () => {
  const sources = makeSources();
  const payload = sources.aiSiteAnalyzerHealth?.payload as Record<string, unknown>;
  payload.severity = 'degraded';
  payload.reason = 'billing_degraded';
  payload.billing_configured = false;
  payload.billing_error = 'missing api.usage.read scope';

  const snapshot = buildAiIrbistechAcceptanceReportSnapshot(sources, {
    generatedAt: '2026-04-24T09:10:00.000Z',
  });

  assert.equal(snapshot.overallStatus, 'ready_with_warnings');
  assert.equal(snapshot.releaseReady, true);
  assert.equal(snapshot.counts.pass, 7);
  assert.equal(snapshot.counts.warn, 1);
  assert.deepEqual(snapshot.warningCheckIds, ['aiSiteAnalyzerHealth']);
  const check = snapshot.checks.find((item) => item.id === 'aiSiteAnalyzerHealth');
  assert.equal(check?.status, 'warn');
  assert.match(check?.summary ?? '', /billing_degraded/);
});

test('buildAiIrbistechAcceptanceReportSnapshot surfaces optional SQL rollout gap as warning', () => {
  const sources = makeSources();
  const payload = sources.aiIntegrationSqlReadiness?.payload as Record<string, unknown>;
  payload.reason = 'ok_with_optional_gap:postgres_target_not_ready';
  payload.counters = {
    total: 2,
    configured: 2,
    required: 1,
    schema_ready: 1,
    effective_ok: 2,
    required_failed: 0,
    optional_failed: 1,
  };
  payload.postgres_target = {
    required: false,
    configured: true,
    table_exists: false,
    column_exists: null,
    index_exists: null,
    note: 'public.dadata_result is absent',
  };

  const snapshot = buildAiIrbistechAcceptanceReportSnapshot(sources, {
    generatedAt: '2026-04-24T09:12:00.000Z',
  });

  assert.equal(snapshot.overallStatus, 'ready_with_warnings');
  assert.equal(snapshot.releaseReady, true);
  assert.deepEqual(snapshot.warningCheckIds, ['aiIntegrationSqlReadiness']);
  const check = snapshot.checks.find((item) => item.id === 'aiIntegrationSqlReadiness');
  assert.equal(check?.status, 'warn');
  assert.match(check?.summary ?? '', /optional_failed=1/);
});

test('resolveAiIrbistechAcceptanceReportExitCode distinguishes release-ready from clean status', () => {
  const cleanSnapshot = buildAiIrbistechAcceptanceReportSnapshot(makeSources(), {
    generatedAt: '2026-04-24T09:15:00.000Z',
  });
  const warningSources = makeSources();
  const warningPayload = warningSources.aiSiteAnalyzerHealth?.payload as Record<string, unknown>;
  warningPayload.severity = 'degraded';
  warningPayload.reason = 'billing_degraded';
  warningPayload.billing_configured = false;
  warningPayload.billing_error = 'missing scope';
  const warningSnapshot = buildAiIrbistechAcceptanceReportSnapshot(warningSources, {
    generatedAt: '2026-04-24T09:16:00.000Z',
  });
  const incompleteSources = makeSources();
  delete incompleteSources.libraryUiQa;
  const incompleteSnapshot = buildAiIrbistechAcceptanceReportSnapshot(incompleteSources, {
    generatedAt: '2026-04-24T09:17:00.000Z',
  });

  assert.equal(isAiIrbistechAcceptanceReportClean(cleanSnapshot), true);
  assert.equal(resolveAiIrbistechAcceptanceReportExitCode(cleanSnapshot, { requireReleaseReady: true }), 0);
  assert.equal(resolveAiIrbistechAcceptanceReportExitCode(cleanSnapshot, { requireClean: true }), 0);

  assert.equal(warningSnapshot.releaseReady, true);
  assert.equal(isAiIrbistechAcceptanceReportClean(warningSnapshot), false);
  assert.equal(resolveAiIrbistechAcceptanceReportExitCode(warningSnapshot, { requireReleaseReady: true }), 0);
  assert.equal(resolveAiIrbistechAcceptanceReportExitCode(warningSnapshot, { requireClean: true }), 1);

  assert.equal(incompleteSnapshot.releaseReady, false);
  assert.equal(resolveAiIrbistechAcceptanceReportExitCode(incompleteSnapshot, { requireReleaseReady: true }), 1);
});

test('renderAiIrbistechAcceptanceReportMarkdown highlights missing inputs as incomplete', () => {
  const sources = makeSources();
  delete sources.libraryUiQa;

  const markdown = renderAiIrbistechAcceptanceReportMarkdown(
    buildAiIrbistechAcceptanceReportSnapshot(sources, {
      generatedAt: '2026-04-24T09:20:00.000Z',
    }),
  );

  assert.match(markdown, /^# AI IRBISTECH 1.1 Acceptance Report/m);
  assert.match(markdown, /overall status: `incomplete`/);
  assert.match(markdown, /## Missing Inputs/);
  assert.match(markdown, /`libraryUiQa`: Артефакт проверки не передан/);
  assert.match(markdown, /### library: AI Analysis UI QA/);
  assert.match(markdown, /- status: `missing`/);
  assert.match(markdown, /### ai-integration: SQL readiness analysis_score/);
  assert.match(markdown, /### ai-integration: acceptance проверки формулы/);
});

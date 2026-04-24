import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  renderAiIrbistechReleaseGateMarkdown,
  resolveAiIrbistechReleaseGateExitCode,
  runAiIrbistechReleaseGate,
} from '../lib/ai-irbistech-release-gate';

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeMarkdown(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

test('runAiIrbistechReleaseGate combines suite and live readiness into one ready_with_warnings gate', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-irbistech-release-gate-'));
  const suiteOutputDir = path.join(tmpDir, 'suite-output');

  try {
    const suiteReportJsonPath = path.join(suiteOutputDir, 'latest.json');
    const suiteReportMarkdownPath = path.join(suiteOutputDir, 'latest.md');
    const suiteSuiteJsonPath = path.join(suiteOutputDir, 'latest.suite.json');
    const suiteSuiteMarkdownPath = path.join(suiteOutputDir, 'latest.suite.md');
    const suiteReadinessJsonPath = path.join(suiteOutputDir, 'latest.release-readiness.json');
    const suiteReadinessMarkdownPath = path.join(suiteOutputDir, 'latest.release-readiness.md');

    writeJson(suiteReportJsonPath, { overallStatus: 'ready' });
    writeMarkdown(suiteReportMarkdownPath, '# acceptance\n');
    writeJson(suiteSuiteJsonPath, { runId: 'suite-run' });
    writeMarkdown(suiteSuiteMarkdownPath, '# suite\n');
    writeJson(suiteReadinessJsonPath, { overallStatus: 'ready_with_warnings' });
    writeMarkdown(suiteReadinessMarkdownPath, '# suite readiness\n');

    const summary = await runAiIrbistechReleaseGate({
      cwd: tmpDir,
      outputDir: path.join(tmpDir, 'gate-output'),
      suiteOutputDir,
      reportName: 'latest',
      requireReady: true,
      acceptanceSuiteRunner: async () => ({
        startedAt: '2026-04-24T08:00:00.000Z',
        finishedAt: '2026-04-24T08:05:00.000Z',
        runId: 'suite-run',
        reportName: 'latest',
        outputDir: suiteOutputDir,
        artifactRootDir: path.join(tmpDir, 'suite-artifacts'),
        requireReleaseReady: false,
        requireClean: false,
        prerequisites: {
          playwrightChromium: { ok: true, reason: null },
          uiQaCredentials: { ok: true, reason: null },
        },
        counts: { passed: 8, failed: 0, skipped: 0 },
        tasks: [],
        report: {
          jsonPath: suiteReportJsonPath,
          markdownPath: suiteReportMarkdownPath,
          suiteJsonPath: suiteSuiteJsonPath,
          suiteMarkdownPath: suiteSuiteMarkdownPath,
          overallStatus: 'ready',
          releaseReady: true,
          exitCode: 0,
        },
        releaseReadiness: {
          jsonPath: suiteReadinessJsonPath,
          markdownPath: suiteReadinessMarkdownPath,
          overallStatus: 'ready_with_warnings',
          releaseReady: true,
          exitCode: 0,
        },
        taskFailureExitCode: 0,
        exitCode: 0,
        snapshot: {
          generatedAt: '2026-04-24T08:05:00.000Z',
          overallStatus: 'ready',
          releaseReady: true,
          counts: { pass: 8, warn: 0, fail: 0, missing: 0 },
          checks: [],
          passedCheckIds: [],
          warningCheckIds: [],
          failedCheckIds: [],
          missingCheckIds: [],
        },
        releaseReadinessSnapshot: {
          generatedAt: '2026-04-24T08:05:00.000Z',
          overallStatus: 'ready_with_warnings',
          releaseReady: true,
          counts: { pass: 10, warn: 2, fail: 0, missing: 0 },
          checks: [],
          passedCheckIds: [],
          warningCheckIds: [],
          failedCheckIds: [],
          missingCheckIds: [],
        },
      }),
      liveReleaseReadinessBuilder: async () => ({
        generatedAt: '2026-04-24T08:06:00.000Z',
        overallStatus: 'ready',
        releaseReady: true,
        counts: { pass: 12, warn: 0, fail: 0, missing: 0 },
        checks: [],
        passedCheckIds: [],
        warningCheckIds: [],
        failedCheckIds: [],
        missingCheckIds: [],
      }),
    });

    assert.equal(summary.overallStatus, 'ready_with_warnings');
    assert.equal(summary.releaseReady, true);
    assert.equal(summary.exitCode, 0);
    assert.equal(summary.liveReleaseReadiness?.overallStatus, 'ready');
    assert.equal(summary.resolvedInputs.libraryBaseUrl, null);
    assert.equal(summary.resolvedInputs.aiIntegrationBaseUrl, null);
    assert.equal(summary.resolvedInputs.aiSiteAnalyzerBaseUrl, null);
    assert.equal(fs.existsSync(path.join(summary.outputDir, 'latest.json')), true);
    assert.equal(fs.existsSync(path.join(summary.outputDir, 'latest.md')), true);
    assert.equal(fs.existsSync(path.join(summary.outputDir, 'latest.live-release-readiness.json')), true);
    assert.equal(fs.existsSync(path.join(summary.outputDir, 'latest.live-release-readiness.md')), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runAiIrbistechReleaseGate returns failing exit code when live readiness is incomplete', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-irbistech-release-gate-fail-'));

  try {
    const summary = await runAiIrbistechReleaseGate({
      cwd: tmpDir,
      outputDir: path.join(tmpDir, 'gate-output'),
      reportName: 'latest',
      requireReady: true,
      acceptanceSuiteRunner: async () => ({
        startedAt: '2026-04-24T08:00:00.000Z',
        finishedAt: '2026-04-24T08:05:00.000Z',
        runId: 'suite-run',
        reportName: 'latest',
        outputDir: path.join(tmpDir, 'suite-output'),
        artifactRootDir: path.join(tmpDir, 'suite-artifacts'),
        requireReleaseReady: false,
        requireClean: false,
        prerequisites: {
          playwrightChromium: { ok: false, reason: 'missing' },
          uiQaCredentials: { ok: false, reason: 'missing' },
        },
        counts: { passed: 6, failed: 0, skipped: 2 },
        tasks: [],
        report: {
          jsonPath: path.join(tmpDir, 'suite-output', 'latest.json'),
          markdownPath: path.join(tmpDir, 'suite-output', 'latest.md'),
          suiteJsonPath: path.join(tmpDir, 'suite-output', 'latest.suite.json'),
          suiteMarkdownPath: path.join(tmpDir, 'suite-output', 'latest.suite.md'),
          overallStatus: 'ready_with_warnings',
          releaseReady: true,
          exitCode: 0,
        },
        releaseReadiness: {
          jsonPath: path.join(tmpDir, 'suite-output', 'latest.release-readiness.json'),
          markdownPath: path.join(tmpDir, 'suite-output', 'latest.release-readiness.md'),
          overallStatus: 'ready',
          releaseReady: true,
          exitCode: 0,
        },
        taskFailureExitCode: 0,
        exitCode: 0,
        snapshot: {
          generatedAt: '2026-04-24T08:05:00.000Z',
          overallStatus: 'ready_with_warnings',
          releaseReady: true,
          counts: { pass: 6, warn: 2, fail: 0, missing: 0 },
          checks: [],
          passedCheckIds: [],
          warningCheckIds: [],
          failedCheckIds: [],
          missingCheckIds: [],
        },
        releaseReadinessSnapshot: {
          generatedAt: '2026-04-24T08:05:00.000Z',
          overallStatus: 'ready',
          releaseReady: true,
          counts: { pass: 8, warn: 0, fail: 0, missing: 0 },
          checks: [],
          passedCheckIds: [],
          warningCheckIds: [],
          failedCheckIds: [],
          missingCheckIds: [],
        },
      }),
      liveReleaseReadinessBuilder: async () => ({
        generatedAt: '2026-04-24T08:06:00.000Z',
        overallStatus: 'incomplete',
        releaseReady: false,
        counts: { pass: 5, warn: 2, fail: 0, missing: 1 },
        checks: [],
        passedCheckIds: [],
        warningCheckIds: [],
        failedCheckIds: [],
        missingCheckIds: ['libraryArtifacts'],
      }),
    });

    assert.equal(summary.overallStatus, 'incomplete');
    assert.equal(summary.releaseReady, false);
    assert.equal(summary.exitCode, 1);
    assert.equal(summary.liveReleaseReadiness?.exitCode, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('renderAiIrbistechReleaseGateMarkdown includes suite and live readiness sections', () => {
  const markdown = renderAiIrbistechReleaseGateMarkdown({
    startedAt: '2026-04-24T08:00:00.000Z',
    finishedAt: '2026-04-24T08:10:00.000Z',
    reportName: 'latest',
    outputDir: '/tmp/release-gate',
    overallStatus: 'ready_with_warnings',
    releaseReady: true,
    exitCode: 0,
    resolvedInputs: {
      libraryBaseUrl: 'http://127.0.0.1:8090',
      aiIntegrationBaseUrl: 'http://127.0.0.1:8000',
      aiSiteAnalyzerBaseUrl: 'http://127.0.0.1:8123',
      aiIntegrationEnvFile: '/tmp/env/ai-integration.env',
      libraryEnvFile: '/tmp/env/library.env',
      aiSiteAnalyzerEnvFile: '/tmp/env/ai-site-analyzer.env',
    },
    suite: {
      runId: 'suite-run',
      overallStatus: 'ready',
      releaseReady: true,
      exitCode: 0,
      taskFailureExitCode: 0,
      reportJsonPath: '/tmp/suite/latest.json',
      reportMarkdownPath: '/tmp/suite/latest.md',
      suiteJsonPath: '/tmp/suite/latest.suite.json',
      suiteMarkdownPath: '/tmp/suite/latest.suite.md',
      releaseReadinessJsonPath: '/tmp/suite/latest.release-readiness.json',
      releaseReadinessMarkdownPath: '/tmp/suite/latest.release-readiness.md',
    },
    liveReleaseReadiness: {
      overallStatus: 'ready_with_warnings',
      releaseReady: true,
      exitCode: 0,
      jsonPath: '/tmp/release-gate/latest.live-release-readiness.json',
      markdownPath: '/tmp/release-gate/latest.live-release-readiness.md',
    },
    suiteSummary: {} as never,
    liveReleaseReadinessSnapshot: null,
  });

  assert.match(markdown, /^# AI IRBISTECH 1.1 Release Gate/m);
  assert.match(markdown, /## Inputs/);
  assert.match(markdown, /## Acceptance Suite/);
  assert.match(markdown, /## Live Release Readiness/);
});

test('resolveAiIrbistechReleaseGateExitCode treats warnings as ready but incomplete as failing by default', () => {
  assert.equal(resolveAiIrbistechReleaseGateExitCode('ready_with_warnings'), 0);
  assert.equal(resolveAiIrbistechReleaseGateExitCode('incomplete'), 1);
  assert.equal(resolveAiIrbistechReleaseGateExitCode('ready_with_warnings', { requireClean: true }), 1);
});

test('runAiIrbistechReleaseGate auto-resolves suite base URLs from monitoring env files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-irbistech-release-gate-env-'));
  const envDir = path.join(tmpDir, 'env');
  let receivedOptions: Record<string, unknown> | null = null;

  try {
    writeMarkdown(
      path.join(envDir, 'ai-integration.env'),
      [
        'ANALYSIS_SCORE_SYNC_HEALTH_URL=http://127.0.0.1:8000/v1/equipment-selection/analysis-score-sync-health',
      ].join('\n'),
    );
    writeMarkdown(
      path.join(envDir, 'library.env'),
      ['AI_ANALYSIS_ACCEPTANCE_HEALTH_BASE_URL=http://127.0.0.1:8090'].join('\n'),
    );
    writeMarkdown(
      path.join(envDir, 'ai-site-analyzer.env'),
      ['AI_SITE_ANALYZER_HEALTHCHECK_BASE_URL=http://127.0.0.1:8123'].join('\n'),
    );

    const summary = await runAiIrbistechReleaseGate({
      cwd: tmpDir,
      outputDir: path.join(tmpDir, 'gate-output'),
      reportName: 'latest',
      skipLiveReadiness: true,
      liveAiIntegrationEnvFile: path.join(envDir, 'ai-integration.env'),
      liveLibraryEnvFile: path.join(envDir, 'library.env'),
      liveAiSiteAnalyzerEnvFile: path.join(envDir, 'ai-site-analyzer.env'),
      acceptanceSuiteRunner: async (options) => {
        receivedOptions = options as Record<string, unknown>;
        return {
          startedAt: '2026-04-24T08:00:00.000Z',
          finishedAt: '2026-04-24T08:05:00.000Z',
          runId: 'suite-run',
          reportName: 'latest',
          outputDir: path.join(tmpDir, 'suite-output'),
          artifactRootDir: path.join(tmpDir, 'suite-artifacts'),
          requireReleaseReady: false,
          requireClean: false,
          prerequisites: {
            playwrightChromium: { ok: true, reason: null },
            uiQaCredentials: { ok: true, reason: null },
          },
          counts: { passed: 8, failed: 0, skipped: 0 },
          tasks: [],
          report: {
            jsonPath: path.join(tmpDir, 'suite-output', 'latest.json'),
            markdownPath: path.join(tmpDir, 'suite-output', 'latest.md'),
            suiteJsonPath: path.join(tmpDir, 'suite-output', 'latest.suite.json'),
            suiteMarkdownPath: path.join(tmpDir, 'suite-output', 'latest.suite.md'),
            overallStatus: 'ready',
            releaseReady: true,
            exitCode: 0,
          },
          releaseReadiness: {
            jsonPath: path.join(tmpDir, 'suite-output', 'latest.release-readiness.json'),
            markdownPath: path.join(tmpDir, 'suite-output', 'latest.release-readiness.md'),
            overallStatus: 'ready',
            releaseReady: true,
            exitCode: 0,
          },
          taskFailureExitCode: 0,
          exitCode: 0,
          snapshot: {
            generatedAt: '2026-04-24T08:05:00.000Z',
            overallStatus: 'ready',
            releaseReady: true,
            counts: { pass: 8, warn: 0, fail: 0, missing: 0 },
            checks: [],
            passedCheckIds: [],
            warningCheckIds: [],
            failedCheckIds: [],
            missingCheckIds: [],
          },
          releaseReadinessSnapshot: {
            generatedAt: '2026-04-24T08:05:00.000Z',
            overallStatus: 'ready',
            releaseReady: true,
            counts: { pass: 8, warn: 0, fail: 0, missing: 0 },
            checks: [],
            passedCheckIds: [],
            warningCheckIds: [],
            failedCheckIds: [],
            missingCheckIds: [],
          },
        };
      },
    });

    assert.equal(receivedOptions?.libraryBaseUrl, 'http://127.0.0.1:8090');
    assert.equal(receivedOptions?.aiIntegrationBaseUrl, 'http://127.0.0.1:8000');
    assert.equal(receivedOptions?.aiSiteAnalyzerBaseUrl, 'http://127.0.0.1:8123');
    assert.equal(summary.resolvedInputs.libraryBaseUrl, 'http://127.0.0.1:8090');
    assert.equal(summary.resolvedInputs.aiIntegrationBaseUrl, 'http://127.0.0.1:8000');
    assert.equal(summary.resolvedInputs.aiSiteAnalyzerBaseUrl, 'http://127.0.0.1:8123');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

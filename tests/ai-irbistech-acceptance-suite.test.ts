import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  runAiIrbistechAcceptanceSuite,
  type AiIrbistechAcceptanceSuiteRunCommand,
} from '../lib/ai-irbistech-acceptance-suite';

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function resolveArtifactInputPath(command: AiIrbistechAcceptanceSuiteRunCommand): string {
  const artifactDirIndex = command.args.indexOf('--artifact-dir');
  if (artifactDirIndex !== -1) {
    return command.args[artifactDirIndex + 1]!;
  }
  const artifactPathIndex = command.args.indexOf('--artifact-path');
  if (artifactPathIndex !== -1) {
    return command.args[artifactPathIndex + 1]!;
  }
  throw new Error(`artifact path not found for task ${command.taskId}`);
}

function makePassingPayload(taskId: AiIrbistechAcceptanceSuiteRunCommand['taskId']): unknown {
  switch (taskId) {
    case 'aiIntegrationSqlReadiness':
      return {
        checked_at: '2026-04-24T08:00:30.000Z',
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
        },
        bitrix_target: {
          required: true,
          configured: true,
          table_exists: true,
          column_exists: true,
          index_exists: true,
        },
      };
    case 'aiIntegrationSyncHealth':
      return {
        checked_at: '2026-04-24T08:01:00.000Z',
        ok: true,
        reason: 'ok',
        http_status: 200,
        counters: {
          total: 3,
          local_failed: 0,
          bitrix_failed: 0,
        },
        local_target: {
          required: true,
          configured: true,
          table_exists: true,
          column_exists: true,
          index_exists: true,
        },
        bitrix_target: {
          required: false,
          configured: true,
          table_exists: true,
          column_exists: true,
          index_exists: true,
        },
      };
    case 'aiIntegrationAcceptance':
      return {
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
        ],
      };
    case 'libraryHealth':
      return {
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
      };
    case 'libraryAcceptance':
      return {
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
        ],
      };
    case 'libraryUiSmoke':
      return {
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
        screenshots: ['01-login.png', '02-ai-analysis.png'],
        error: null,
      };
    case 'libraryUiQa':
      return {
        checkedAt: '2026-04-24T08:05:00.000Z',
        ok: true,
        baseUrl: 'https://ai.irbistech.com',
        authenticated: true,
        publicRedirectPath: '/login',
        screenshots: ['01-login.png', '02-dialog.png'],
        cases: [
          {
            name: 'okved-1way',
            ok: true,
            finalSource: '1way',
            originKind: 'okved',
          },
        ],
        error: null,
      };
    case 'aiSiteAnalyzerHealth':
      return {
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
      };
  }
}

test('runAiIrbistechAcceptanceSuite builds a report and auto-skips UI QA without credentials', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-irbistech-suite-'));
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const libraryRoot = path.join(workspaceRoot, 'library');
  const aiIntegrationRoot = path.join(workspaceRoot, 'ai-integration');
  const aiSiteAnalyzerRoot = path.join(workspaceRoot, 'ai-site-analyzer');
  fs.mkdirSync(libraryRoot, { recursive: true });
  fs.mkdirSync(aiIntegrationRoot, { recursive: true });
  fs.mkdirSync(aiSiteAnalyzerRoot, { recursive: true });

  const calls: string[] = [];

  try {
    const summary = await runAiIrbistechAcceptanceSuite({
      cwd: libraryRoot,
      roots: {
        workspaceRoot,
        libraryRoot,
        aiIntegrationRoot,
        aiSiteAnalyzerRoot,
      },
      env: {},
      playwrightChromiumStatus: {
        ok: true,
        reason: null,
      },
      requireReleaseReady: false,
      commandRunner: async (command) => {
        calls.push(command.taskId);
        const artifactDir = resolveArtifactInputPath(command);
        writeJson(path.join(artifactDir, 'latest.json'), makePassingPayload(command.taskId));
        return {
          exitCode: 0,
          stdout: `ok:${command.taskId}\n`,
          stderr: '',
          error: null,
        };
      },
    });

    assert.equal(calls.includes('libraryUiQa'), false);
    assert.equal(summary.counts.passed, 7);
    assert.equal(summary.counts.failed, 0);
    assert.equal(summary.counts.skipped, 1);
    assert.equal(summary.tasks.find((task) => task.taskId === 'libraryUiQa')?.status, 'skipped');
    assert.match(summary.tasks.find((task) => task.taskId === 'libraryUiQa')?.skipReason ?? '', /missing AI_ANALYSIS_UI_QA/);
    assert.equal(summary.prerequisites.playwrightChromium.ok, true);
    assert.equal(summary.prerequisites.uiQaCredentials.ok, false);
    assert.equal(summary.snapshot.overallStatus, 'incomplete');
    assert.equal(summary.report.releaseReady, false);
    assert.equal(summary.releaseReadiness.overallStatus, 'ready_with_warnings');
    assert.equal(summary.releaseReadiness.releaseReady, true);
    assert.equal(summary.exitCode, 0);
    assert.equal(fs.existsSync(summary.report.jsonPath), true);
    assert.equal(fs.existsSync(summary.report.markdownPath), true);
    assert.equal(fs.existsSync(summary.report.suiteJsonPath), true);
    assert.equal(fs.existsSync(summary.report.suiteMarkdownPath), true);
    assert.equal(fs.existsSync(summary.releaseReadiness.jsonPath), true);
    assert.equal(fs.existsSync(summary.releaseReadiness.markdownPath), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runAiIrbistechAcceptanceSuite continues after task failure and keeps the final report strict', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-irbistech-suite-fail-'));
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const libraryRoot = path.join(workspaceRoot, 'library');
  const aiIntegrationRoot = path.join(workspaceRoot, 'ai-integration');
  const aiSiteAnalyzerRoot = path.join(workspaceRoot, 'ai-site-analyzer');
  fs.mkdirSync(libraryRoot, { recursive: true });
  fs.mkdirSync(aiIntegrationRoot, { recursive: true });
  fs.mkdirSync(aiSiteAnalyzerRoot, { recursive: true });

  try {
    const summary = await runAiIrbistechAcceptanceSuite({
      cwd: libraryRoot,
      roots: {
        workspaceRoot,
        libraryRoot,
        aiIntegrationRoot,
        aiSiteAnalyzerRoot,
      },
      env: {
        AI_ANALYSIS_UI_QA_LOGIN: 'worker',
        AI_ANALYSIS_UI_QA_PASSWORD: 'secret',
      },
      playwrightChromiumStatus: {
        ok: true,
        reason: null,
      },
      requireReleaseReady: true,
      commandRunner: async (command) => {
        const artifactDir = resolveArtifactInputPath(command);
        if (command.taskId === 'aiIntegrationAcceptance') {
          writeJson(path.join(artifactDir, 'latest.json'), {
            checked_at: '2026-04-24T08:00:00.000Z',
            ok: false,
            reason: 'failed_cases:site-3way',
            health: {
              ok: true,
              http_status: 200,
              error: null,
            },
            failed_cases: ['site-3way'],
            cases: [
              {
                name: 'site-3way',
                ok: false,
                error: 'FINAL != VECTOR x GEN',
              },
            ],
          });
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'failed aiIntegrationAcceptance\n',
            error: null,
          };
        }

        writeJson(path.join(artifactDir, 'latest.json'), makePassingPayload(command.taskId));
        return {
          exitCode: 0,
          stdout: `ok:${command.taskId}\n`,
          stderr: '',
          error: null,
        };
      },
    });

    assert.equal(summary.counts.passed, 7);
    assert.equal(summary.counts.failed, 1);
    assert.equal(summary.counts.skipped, 0);
    assert.equal(summary.tasks.find((task) => task.taskId === 'aiIntegrationAcceptance')?.status, 'failed');
    assert.equal(summary.snapshot.overallStatus, 'not_ready');
    assert.equal(summary.report.releaseReady, false);
    assert.equal(summary.report.exitCode, 1);
    assert.equal(summary.releaseReadiness.overallStatus, 'not_ready');
    assert.equal(summary.releaseReadiness.releaseReady, false);
    assert.equal(summary.releaseReadiness.exitCode, 1);
    assert.equal(summary.exitCode, 1);
    assert.match(
      fs.readFileSync(summary.report.suiteMarkdownPath, 'utf8'),
      /ai-integration: acceptance проверки формулы/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runAiIrbistechAcceptanceSuite auto-skips browser tasks when Playwright Chromium is unavailable', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-irbistech-suite-browser-skip-'));
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const libraryRoot = path.join(workspaceRoot, 'library');
  const aiIntegrationRoot = path.join(workspaceRoot, 'ai-integration');
  const aiSiteAnalyzerRoot = path.join(workspaceRoot, 'ai-site-analyzer');
  fs.mkdirSync(libraryRoot, { recursive: true });
  fs.mkdirSync(aiIntegrationRoot, { recursive: true });
  fs.mkdirSync(aiSiteAnalyzerRoot, { recursive: true });

  const calls: string[] = [];

  try {
    const summary = await runAiIrbistechAcceptanceSuite({
      cwd: libraryRoot,
      roots: {
        workspaceRoot,
        libraryRoot,
        aiIntegrationRoot,
        aiSiteAnalyzerRoot,
      },
      env: {
        AI_ANALYSIS_UI_QA_LOGIN: 'worker',
        AI_ANALYSIS_UI_QA_PASSWORD: 'secret',
      },
      playwrightChromiumStatus: {
        ok: false,
        reason: 'Playwright Chromium is not available: executable is missing',
      },
      requireReleaseReady: false,
      uiSmokeMode: 'auto',
      uiQaMode: 'auto',
      commandRunner: async (command) => {
        calls.push(command.taskId);
        const artifactDir = resolveArtifactInputPath(command);
        writeJson(path.join(artifactDir, 'latest.json'), makePassingPayload(command.taskId));
        return {
          exitCode: 0,
          stdout: `ok:${command.taskId}\n`,
          stderr: '',
          error: null,
        };
      },
    });

    assert.equal(calls.includes('libraryUiSmoke'), false);
    assert.equal(calls.includes('libraryUiQa'), false);
    assert.equal(summary.counts.passed, 6);
    assert.equal(summary.counts.failed, 0);
    assert.equal(summary.counts.skipped, 2);
    assert.equal(summary.tasks.find((task) => task.taskId === 'libraryUiSmoke')?.status, 'skipped');
    assert.equal(summary.tasks.find((task) => task.taskId === 'libraryUiQa')?.status, 'skipped');
    assert.match(
      summary.tasks.find((task) => task.taskId === 'libraryUiSmoke')?.skipReason ?? '',
      /Playwright Chromium is not available/,
    );
    assert.equal(summary.prerequisites.playwrightChromium.ok, false);
    assert.equal(summary.prerequisites.uiQaCredentials.ok, true);
    assert.equal(summary.snapshot.overallStatus, 'incomplete');
    assert.equal(summary.releaseReadiness.releaseReady, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runAiIrbistechAcceptanceSuite release-readiness respects browser modes set to never', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-irbistech-suite-browser-never-'));
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const libraryRoot = path.join(workspaceRoot, 'library');
  const aiIntegrationRoot = path.join(workspaceRoot, 'ai-integration');
  const aiSiteAnalyzerRoot = path.join(workspaceRoot, 'ai-site-analyzer');
  fs.mkdirSync(libraryRoot, { recursive: true });
  fs.mkdirSync(aiIntegrationRoot, { recursive: true });
  fs.mkdirSync(aiSiteAnalyzerRoot, { recursive: true });

  const calls: string[] = [];

  try {
    const summary = await runAiIrbistechAcceptanceSuite({
      cwd: libraryRoot,
      roots: {
        workspaceRoot,
        libraryRoot,
        aiIntegrationRoot,
        aiSiteAnalyzerRoot,
      },
      env: {
        AI_ANALYSIS_UI_QA_LOGIN: 'worker',
        AI_ANALYSIS_UI_QA_PASSWORD: 'secret',
      },
      playwrightChromiumStatus: {
        ok: true,
        reason: null,
      },
      requireReleaseReady: false,
      uiSmokeMode: 'never',
      uiQaMode: 'never',
      commandRunner: async (command) => {
        calls.push(command.taskId);
        const artifactDir = resolveArtifactInputPath(command);
        writeJson(path.join(artifactDir, 'latest.json'), makePassingPayload(command.taskId));
        return {
          exitCode: 0,
          stdout: `ok:${command.taskId}\n`,
          stderr: '',
          error: null,
        };
      },
    });

    assert.equal(calls.includes('libraryUiSmoke'), false);
    assert.equal(calls.includes('libraryUiQa'), false);
    assert.equal(summary.tasks.find((task) => task.taskId === 'libraryUiSmoke')?.status, 'skipped');
    assert.equal(summary.tasks.find((task) => task.taskId === 'libraryUiQa')?.status, 'skipped');
    assert.equal(summary.releaseReadiness.overallStatus, 'ready_with_warnings');
    assert.equal(summary.releaseReadiness.releaseReady, true);
    assert.equal(summary.releaseReadinessSnapshot.missingCheckIds.includes('libraryArtifacts'), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runAiIrbistechAcceptanceSuite forwards strict postgres SQL requirement to ai-integration checker', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-irbistech-suite-sql-policy-'));
  const workspaceRoot = path.join(tmpDir, 'workspace');
  const libraryRoot = path.join(workspaceRoot, 'library');
  const aiIntegrationRoot = path.join(workspaceRoot, 'ai-integration');
  const aiSiteAnalyzerRoot = path.join(workspaceRoot, 'ai-site-analyzer');
  fs.mkdirSync(libraryRoot, { recursive: true });
  fs.mkdirSync(aiIntegrationRoot, { recursive: true });
  fs.mkdirSync(aiSiteAnalyzerRoot, { recursive: true });

  try {
    let sqlCommand: AiIrbistechAcceptanceSuiteRunCommand | null = null;

    await runAiIrbistechAcceptanceSuite({
      cwd: libraryRoot,
      roots: {
        workspaceRoot,
        libraryRoot,
        aiIntegrationRoot,
        aiSiteAnalyzerRoot,
      },
      env: {},
      playwrightChromiumStatus: {
        ok: false,
        reason: 'Playwright Chromium is not available',
      },
      requireReleaseReady: false,
      requirePostgresSqlTarget: true,
      commandRunner: async (command) => {
        if (command.taskId === 'aiIntegrationSqlReadiness') {
          sqlCommand = command;
        }
        const artifactDir = resolveArtifactInputPath(command);
        writeJson(path.join(artifactDir, 'latest.json'), makePassingPayload(command.taskId));
        return {
          exitCode: 0,
          stdout: `ok:${command.taskId}\n`,
          stderr: '',
          error: null,
        };
      },
    });

    assert.ok(sqlCommand);
    assert.equal(sqlCommand?.args.includes('--require-postgres-target'), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runAiIrbistechAcceptanceSuite supports split production roots and remote ai-site-analyzer health', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-irbistech-suite-split-roots-'));
  const libraryRoot = path.join(tmpDir, 'library-app');
  const aiIntegrationRoot = path.join(tmpDir, 'opt-ai-integration');
  const missingAiSiteAnalyzerRoot = path.join(tmpDir, 'missing-ai-site-analyzer');
  fs.mkdirSync(libraryRoot, { recursive: true });
  fs.mkdirSync(aiIntegrationRoot, { recursive: true });

  try {
    let sqlCommand: AiIrbistechAcceptanceSuiteRunCommand | null = null;
    let aiSiteCommand: AiIrbistechAcceptanceSuiteRunCommand | null = null;

    const summary = await runAiIrbistechAcceptanceSuite({
      cwd: libraryRoot,
      roots: {
        libraryRoot,
        aiIntegrationRoot,
        aiSiteAnalyzerRoot: missingAiSiteAnalyzerRoot,
      },
      env: {},
      aiIntegrationPythonExecutable: '/opt/ai-integration/.venv/bin/python',
      aiSiteAnalyzerBaseUrl: 'http://37.221.125.221:8123',
      playwrightChromiumStatus: {
        ok: false,
        reason: 'Playwright Chromium is not available',
      },
      requireReleaseReady: false,
      commandRunner: async (command) => {
        if (command.taskId === 'aiIntegrationSqlReadiness') {
          sqlCommand = command;
        }
        if (command.taskId === 'aiSiteAnalyzerHealth') {
          aiSiteCommand = command;
        }
        const artifactDir = resolveArtifactInputPath(command);
        writeJson(path.join(artifactDir, 'latest.json'), makePassingPayload(command.taskId));
        return {
          exitCode: 0,
          stdout: `ok:${command.taskId}\n`,
          stderr: '',
          error: null,
        };
      },
    });

    assert.equal(summary.counts.failed, 0);
    assert.ok(sqlCommand);
    assert.equal(sqlCommand?.executable, '/opt/ai-integration/.venv/bin/python');
    assert.ok(aiSiteCommand);
    assert.equal(aiSiteCommand?.executable.endsWith('npm') || aiSiteCommand?.executable.endsWith('npm.cmd'), true);
    assert.equal(aiSiteCommand?.cwd, libraryRoot);
    assert.deepEqual(aiSiteCommand?.args.slice(0, 4), ['run', 'ai-site-analyzer:remote-healthcheck', '--', '--json']);
    assert.equal(aiSiteCommand?.args.includes('--base-url'), true);
    assert.equal(aiSiteCommand?.args.includes('http://37.221.125.221:8123'), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

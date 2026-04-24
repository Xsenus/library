import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildAiIrbistechReleaseReadinessSnapshot,
  renderAiIrbistechReleaseReadinessMarkdown,
  resolveAiIrbistechReleaseReadinessExitCode,
  type AiIrbistechReleaseReadinessCommand,
} from '../lib/ai-irbistech-release-readiness';

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath: string, payload: unknown): void {
  writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

test('buildAiIrbistechReleaseReadinessSnapshot reports warnings for missing webhook destinations and optional credentials', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-readiness-warn-'));

  try {
    const aiIntegrationEnvFile = path.join(tmpDir, 'ai-integration.env');
    const libraryEnvFile = path.join(tmpDir, 'library.env');
    const aiSiteAnalyzerEnvFile = path.join(tmpDir, 'ai-site-analyzer.env');

    writeFile(
      aiIntegrationEnvFile,
      [
        'ANALYSIS_SCORE_SYNC_ARTIFACT_PATH=' + path.join(tmpDir, 'ai-integration', 'analysis-score-sync-health'),
        'ANALYSIS_SCORE_SQL_READINESS_ARTIFACT_PATH=' + path.join(tmpDir, 'ai-integration', 'analysis-score-sql-readiness'),
        'EQUIPMENT_SCORE_ACCEPTANCE_ARTIFACT_PATH=' + path.join(tmpDir, 'ai-integration', 'equipment-score-acceptance'),
      ].join('\n'),
    );
    writeFile(
      libraryEnvFile,
      [
        'LIBRARY_SYSTEM_HEALTH_ARTIFACT_DIR=' + path.join(tmpDir, 'library', 'library-system-health'),
        'AI_ANALYSIS_ACCEPTANCE_HEALTH_ARTIFACT_DIR=' + path.join(tmpDir, 'library', 'ai-analysis-acceptance-health'),
        'AI_ANALYSIS_UI_SMOKE_HEALTH_ARTIFACT_DIR=' + path.join(tmpDir, 'library', 'ai-analysis-ui-smoke-health'),
        'AI_ANALYSIS_UI_QA_HEALTH_ARTIFACT_DIR=' + path.join(tmpDir, 'library', 'ai-analysis-ui-qa-health'),
        'LIBRARY_SYSTEM_HEALTH_ALERT_WEBHOOK_URL=https://alerts.example.test/library',
      ].join('\n'),
    );
    writeFile(
      aiSiteAnalyzerEnvFile,
      [
        'AI_SITE_ANALYZER_HEALTHCHECK_ARTIFACT_DIR=' + path.join(tmpDir, 'ai-site-analyzer', 'system-health'),
      ].join('\n'),
    );

    writeJson(path.join(tmpDir, 'ai-integration', 'analysis-score-sync-health', 'latest.json'), {
      checked_at: '2026-04-24T08:01:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'ai-integration', 'analysis-score-sql-readiness', 'latest.json'), {
      checked_at: '2026-04-24T08:02:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'ai-integration', 'equipment-score-acceptance', 'latest.json'), {
      checked_at: '2026-04-24T08:03:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'library', 'library-system-health', 'latest.json'), {
      checkedAt: '2026-04-24T08:04:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'library', 'ai-analysis-acceptance-health', 'latest.json'), {
      checkedAt: '2026-04-24T08:05:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'ai-site-analyzer', 'system-health', 'latest.json'), {
      checked_at: '2026-04-24T08:06:00.000Z',
      ok: true,
      reason: 'ok',
    });

    const summary = await buildAiIrbistechReleaseReadinessSnapshot({
      cwd: tmpDir,
      generatedAt: '2026-04-24T08:10:00.000Z',
      aiIntegrationEnvFile,
      libraryEnvFile,
      aiSiteAnalyzerEnvFile,
      useSystemctl: false,
      playwrightChromiumStatus: {
        ok: false,
        reason: 'Playwright Chromium is not available',
      },
    });

    assert.equal(summary.overallStatus, 'ready_with_warnings');
    assert.equal(summary.releaseReady, true);
    assert.ok(summary.warningCheckIds.includes('libraryPlaywrightChromium'));
    assert.ok(summary.warningCheckIds.includes('aiIntegrationWebhooks'));
    assert.ok(summary.warningCheckIds.includes('libraryWebhooks'));
    assert.ok(summary.warningCheckIds.includes('aiSiteAnalyzerWebhooks'));
    assert.ok(summary.warningCheckIds.includes('libraryUiQaCredentials'));
    assert.ok(summary.warningCheckIds.includes('aiSiteAnalyzerBillingKey'));
    assert.equal(resolveAiIrbistechReleaseReadinessExitCode(summary, { requireReady: true }), 0);
    assert.equal(resolveAiIrbistechReleaseReadinessExitCode(summary, { requireClean: true }), 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('buildAiIrbistechReleaseReadinessSnapshot fails when a required timer is inactive', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-readiness-fail-'));

  try {
    const aiIntegrationEnvFile = path.join(tmpDir, 'ai-integration.env');
    const libraryEnvFile = path.join(tmpDir, 'library.env');
    const aiSiteAnalyzerEnvFile = path.join(tmpDir, 'ai-site-analyzer.env');

    writeFile(aiIntegrationEnvFile, 'ANALYSIS_SCORE_SYNC_ALERT_WEBHOOK_URL=https://alerts.example.test/sync\n');
    writeFile(libraryEnvFile, 'LIBRARY_SYSTEM_HEALTH_ALERT_WEBHOOK_URL=https://alerts.example.test/library\n');
    writeFile(aiSiteAnalyzerEnvFile, 'AI_SITE_ANALYZER_HEALTHCHECK_ALERT_WEBHOOK_URL=https://alerts.example.test/site\nOPENAI_ADMIN_KEY=sk-test\n');

    const commandRunner = async (command: AiIrbistechReleaseReadinessCommand) => {
      const unit = command.args[1] ?? '';
      const isEnabled = command.args[0] === 'is-enabled';
      if (unit === 'analysis-score-sync-healthcheck.timer' && !isEnabled) {
        return {
          exitCode: 3,
          stdout: 'inactive\n',
          stderr: '',
          error: null,
        };
      }
      return {
        exitCode: 0,
        stdout: `${isEnabled ? 'enabled' : 'active'}\n`,
        stderr: '',
        error: null,
      };
    };

    const summary = await buildAiIrbistechReleaseReadinessSnapshot({
      cwd: tmpDir,
      generatedAt: '2026-04-24T08:10:00.000Z',
      aiIntegrationEnvFile,
      libraryEnvFile,
      aiSiteAnalyzerEnvFile,
      useSystemctl: true,
      commandRunner,
      playwrightChromiumStatus: {
        ok: false,
        reason: 'Playwright Chromium is not available',
      },
    });

    assert.equal(summary.overallStatus, 'not_ready');
    assert.equal(summary.releaseReady, false);
    assert.ok(summary.failedCheckIds.includes('aiIntegrationTimers'));
    const check = summary.checks.find((item) => item.id === 'aiIntegrationTimers');
    assert.equal(check?.status, 'fail');
    assert.match(check?.summary ?? '', /required_failed=1/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('buildAiIrbistechReleaseReadinessSnapshot marks missing required monitoring artifacts as incomplete', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-readiness-artifacts-missing-'));

  try {
    const aiIntegrationEnvFile = path.join(tmpDir, 'ai-integration.env');
    const libraryEnvFile = path.join(tmpDir, 'library.env');
    const aiSiteAnalyzerEnvFile = path.join(tmpDir, 'ai-site-analyzer.env');

    writeFile(aiIntegrationEnvFile, 'ANALYSIS_SCORE_SYNC_ALERT_WEBHOOK_URL=https://alerts.example.test/sync\n');
    writeFile(libraryEnvFile, 'LIBRARY_SYSTEM_HEALTH_ALERT_WEBHOOK_URL=https://alerts.example.test/library\n');
    writeFile(aiSiteAnalyzerEnvFile, 'AI_SITE_ANALYZER_HEALTHCHECK_ALERT_WEBHOOK_URL=https://alerts.example.test/site\nOPENAI_ADMIN_KEY=sk-test\n');

    const summary = await buildAiIrbistechReleaseReadinessSnapshot({
      cwd: tmpDir,
      generatedAt: '2026-04-24T08:10:00.000Z',
      aiIntegrationEnvFile,
      libraryEnvFile,
      aiSiteAnalyzerEnvFile,
      useSystemctl: false,
      playwrightChromiumStatus: {
        ok: false,
        reason: 'Playwright Chromium is not available',
      },
    });

    assert.equal(summary.overallStatus, 'incomplete');
    assert.equal(summary.releaseReady, false);
    assert.ok(summary.missingCheckIds.includes('aiIntegrationArtifacts'));
    assert.ok(summary.missingCheckIds.includes('libraryArtifacts'));
    assert.ok(summary.missingCheckIds.includes('aiSiteAnalyzerArtifacts'));
    const check = summary.checks.find((item) => item.id === 'aiIntegrationArtifacts');
    assert.equal(check?.status, 'missing');
    assert.match(check?.summary ?? '', /required_missing=3/);
    assert.equal(resolveAiIrbistechReleaseReadinessExitCode(summary, { requireReady: true }), 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('buildAiIrbistechReleaseReadinessSnapshot fails when a required monitoring artifact is unhealthy', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-readiness-artifacts-fail-'));

  try {
    const aiIntegrationEnvFile = path.join(tmpDir, 'ai-integration.env');
    const libraryEnvFile = path.join(tmpDir, 'library.env');
    const aiSiteAnalyzerEnvFile = path.join(tmpDir, 'ai-site-analyzer.env');

    writeFile(
      aiIntegrationEnvFile,
      [
        'ANALYSIS_SCORE_SYNC_ARTIFACT_PATH=' + path.join(tmpDir, 'ai-integration', 'analysis-score-sync-health'),
        'ANALYSIS_SCORE_SQL_READINESS_ARTIFACT_PATH=' + path.join(tmpDir, 'ai-integration', 'analysis-score-sql-readiness'),
        'EQUIPMENT_SCORE_ACCEPTANCE_ARTIFACT_PATH=' + path.join(tmpDir, 'ai-integration', 'equipment-score-acceptance'),
        'ANALYSIS_SCORE_SYNC_ALERT_WEBHOOK_URL=https://alerts.example.test/sync',
      ].join('\n'),
    );
    writeFile(
      libraryEnvFile,
      [
        'LIBRARY_SYSTEM_HEALTH_ARTIFACT_DIR=' + path.join(tmpDir, 'library', 'library-system-health'),
        'AI_ANALYSIS_ACCEPTANCE_HEALTH_ARTIFACT_DIR=' + path.join(tmpDir, 'library', 'ai-analysis-acceptance-health'),
        'LIBRARY_SYSTEM_HEALTH_ALERT_WEBHOOK_URL=https://alerts.example.test/library',
      ].join('\n'),
    );
    writeFile(
      aiSiteAnalyzerEnvFile,
      [
        'AI_SITE_ANALYZER_HEALTHCHECK_ARTIFACT_DIR=' + path.join(tmpDir, 'ai-site-analyzer', 'system-health'),
        'AI_SITE_ANALYZER_HEALTHCHECK_ALERT_WEBHOOK_URL=https://alerts.example.test/site',
        'OPENAI_ADMIN_KEY=sk-test',
      ].join('\n'),
    );

    writeJson(path.join(tmpDir, 'ai-integration', 'analysis-score-sync-health', 'latest.json'), {
      checked_at: '2026-04-24T08:01:00.000Z',
      ok: false,
      reason: 'bitrix target is stale',
    });
    writeJson(path.join(tmpDir, 'ai-integration', 'analysis-score-sql-readiness', 'latest.json'), {
      checked_at: '2026-04-24T08:02:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'ai-integration', 'equipment-score-acceptance', 'latest.json'), {
      checked_at: '2026-04-24T08:03:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'library', 'library-system-health', 'latest.json'), {
      checkedAt: '2026-04-24T08:04:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'library', 'ai-analysis-acceptance-health', 'latest.json'), {
      checkedAt: '2026-04-24T08:05:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'ai-site-analyzer', 'system-health', 'latest.json'), {
      checked_at: '2026-04-24T08:06:00.000Z',
      ok: true,
      reason: 'ok',
    });

    const summary = await buildAiIrbistechReleaseReadinessSnapshot({
      cwd: tmpDir,
      generatedAt: '2026-04-24T08:10:00.000Z',
      aiIntegrationEnvFile,
      libraryEnvFile,
      aiSiteAnalyzerEnvFile,
      useSystemctl: false,
      playwrightChromiumStatus: {
        ok: false,
        reason: 'Playwright Chromium is not available',
      },
    });

    assert.equal(summary.overallStatus, 'not_ready');
    assert.equal(summary.releaseReady, false);
    assert.ok(summary.failedCheckIds.includes('aiIntegrationArtifacts'));
    const check = summary.checks.find((item) => item.id === 'aiIntegrationArtifacts');
    assert.equal(check?.status, 'fail');
    assert.match(check?.summary ?? '', /required_unhealthy=1/);
    assert.equal(resolveAiIrbistechReleaseReadinessExitCode(summary, { requireReady: true }), 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('buildAiIrbistechReleaseReadinessSnapshot marks stale required monitoring artifacts as incomplete', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-readiness-artifacts-stale-'));

  try {
    const aiIntegrationEnvFile = path.join(tmpDir, 'ai-integration.env');
    const libraryEnvFile = path.join(tmpDir, 'library.env');
    const aiSiteAnalyzerEnvFile = path.join(tmpDir, 'ai-site-analyzer.env');

    writeFile(
      aiIntegrationEnvFile,
      [
        'ANALYSIS_SCORE_SYNC_ARTIFACT_PATH=' + path.join(tmpDir, 'ai-integration', 'analysis-score-sync-health'),
        'ANALYSIS_SCORE_SQL_READINESS_ARTIFACT_PATH=' + path.join(tmpDir, 'ai-integration', 'analysis-score-sql-readiness'),
        'EQUIPMENT_SCORE_ACCEPTANCE_ARTIFACT_PATH=' + path.join(tmpDir, 'ai-integration', 'equipment-score-acceptance'),
        'ANALYSIS_SCORE_SYNC_ALERT_WEBHOOK_URL=https://alerts.example.test/sync',
      ].join('\n'),
    );
    writeFile(
      libraryEnvFile,
      [
        'LIBRARY_SYSTEM_HEALTH_ARTIFACT_DIR=' + path.join(tmpDir, 'library', 'library-system-health'),
        'AI_ANALYSIS_ACCEPTANCE_HEALTH_ARTIFACT_DIR=' + path.join(tmpDir, 'library', 'ai-analysis-acceptance-health'),
        'LIBRARY_SYSTEM_HEALTH_ALERT_WEBHOOK_URL=https://alerts.example.test/library',
      ].join('\n'),
    );
    writeFile(
      aiSiteAnalyzerEnvFile,
      [
        'AI_SITE_ANALYZER_HEALTHCHECK_ARTIFACT_DIR=' + path.join(tmpDir, 'ai-site-analyzer', 'system-health'),
        'AI_SITE_ANALYZER_HEALTHCHECK_ALERT_WEBHOOK_URL=https://alerts.example.test/site',
        'OPENAI_ADMIN_KEY=sk-test',
      ].join('\n'),
    );

    writeJson(path.join(tmpDir, 'ai-integration', 'analysis-score-sync-health', 'latest.json'), {
      checked_at: '2026-04-24T06:30:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'ai-integration', 'analysis-score-sql-readiness', 'latest.json'), {
      checked_at: '2026-04-24T08:00:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'ai-integration', 'equipment-score-acceptance', 'latest.json'), {
      checked_at: '2026-04-24T08:00:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'library', 'library-system-health', 'latest.json'), {
      checkedAt: '2026-04-24T08:05:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'library', 'ai-analysis-acceptance-health', 'latest.json'), {
      checkedAt: '2026-04-24T08:05:00.000Z',
      ok: true,
      reason: 'ok',
    });
    writeJson(path.join(tmpDir, 'ai-site-analyzer', 'system-health', 'latest.json'), {
      checked_at: '2026-04-24T08:05:00.000Z',
      ok: true,
      reason: 'ok',
    });

    const summary = await buildAiIrbistechReleaseReadinessSnapshot({
      cwd: tmpDir,
      generatedAt: '2026-04-24T08:10:00.000Z',
      aiIntegrationEnvFile,
      libraryEnvFile,
      aiSiteAnalyzerEnvFile,
      useSystemctl: false,
      playwrightChromiumStatus: {
        ok: false,
        reason: 'Playwright Chromium is not available',
      },
    });

    assert.equal(summary.overallStatus, 'incomplete');
    assert.equal(summary.releaseReady, false);
    assert.ok(summary.missingCheckIds.includes('aiIntegrationArtifacts'));
    const check = summary.checks.find((item) => item.id === 'aiIntegrationArtifacts');
    assert.equal(check?.status, 'missing');
    assert.match(check?.summary ?? '', /required_stale=1/);
    assert.match(check?.details.join('\n') ?? '', /age=1\.7h|max_age=20m/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('renderAiIrbistechReleaseReadinessMarkdown includes summary and failed checks', async () => {
  const summary = await buildAiIrbistechReleaseReadinessSnapshot({
    cwd: process.cwd(),
    aiIntegrationEnvFile: path.join(process.cwd(), 'missing-ai-integration.env'),
    libraryEnvFile: path.join(process.cwd(), 'missing-library.env'),
    aiSiteAnalyzerEnvFile: path.join(process.cwd(), 'missing-ai-site.env'),
    useSystemctl: false,
    playwrightChromiumStatus: {
      ok: false,
      reason: 'Playwright Chromium is not available',
    },
  });

  const markdown = renderAiIrbistechReleaseReadinessMarkdown(summary);

  assert.match(markdown, /^# AI IRBISTECH 1.1 Release Readiness/m);
  assert.match(markdown, /overall status: `not_ready`/);
  assert.match(markdown, /### ai-integration: monitoring env file/);
  assert.match(markdown, /### library: webhook destinations/);
});

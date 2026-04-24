import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  discoverAiIrbistechAcceptanceReportInputPaths,
  loadAiIrbistechAcceptanceReportSource,
  resolveAiIrbistechAcceptanceReportInputJsonPath,
  type AiIrbistechAcceptanceReportDiscoveryRoots,
} from '../lib/ai-irbistech-acceptance-report-discovery';

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

test('resolveAiIrbistechAcceptanceReportInputJsonPath prefers latest.json inside artifact directories', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-report-discovery-'));

  try {
    const artifactDir = path.join(tmpDir, 'artifacts', 'library-system-health');
    const latestPath = path.join(artifactDir, 'latest.json');
    const summaryPath = path.join(artifactDir, 'summary.json');
    writeJson(latestPath, { ok: true, source: 'latest' });
    writeJson(summaryPath, { ok: true, source: 'summary' });

    const resolved = resolveAiIrbistechAcceptanceReportInputJsonPath(artifactDir, tmpDir);
    assert.equal(resolved, latestPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveAiIrbistechAcceptanceReportInputJsonPath falls back to newest run summary.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-report-runs-'));

  try {
    const artifactDir = path.join(tmpDir, 'artifacts', 'ai-analysis-ui-smoke');
    const olderRun = path.join(artifactDir, '2026-04-23T10-00-00-000Z', 'summary.json');
    const newerRun = path.join(artifactDir, '2026-04-24T10-00-00-000Z', 'summary.json');
    writeJson(olderRun, { checkedAt: '2026-04-23T10:00:00.000Z' });
    writeJson(newerRun, { checkedAt: '2026-04-24T10:00:00.000Z' });

    const resolved = resolveAiIrbistechAcceptanceReportInputJsonPath(artifactDir, tmpDir);
    assert.equal(resolved, newerRun);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('discoverAiIrbistechAcceptanceReportInputPaths finds standard workspace artifacts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-report-workspace-'));

  try {
    const roots: AiIrbistechAcceptanceReportDiscoveryRoots = {
      workspaceRoot: tmpDir,
      libraryRoot: path.join(tmpDir, 'library'),
    };

    writeJson(
      path.join(tmpDir, 'ai-integration', 'artifacts', 'equipment-score-acceptance', 'latest.json'),
      { ok: true },
    );
    writeJson(
      path.join(tmpDir, 'ai-integration', 'artifacts', 'analysis-score-sql-readiness', 'latest.json'),
      { ok: true },
    );
    writeJson(
      path.join(tmpDir, 'ai-integration', 'artifacts', 'analysis-score-sync-health', 'latest.json'),
      { ok: true },
    );
    writeJson(
      path.join(tmpDir, 'library', 'artifacts', 'library-system-health', 'latest.json'),
      { ok: true },
    );
    writeJson(
      path.join(tmpDir, 'library', 'artifacts', 'ai-analysis-acceptance-qa', '2026-04-24T10-00-00-000Z', 'summary.json'),
      { ok: true },
    );
    writeJson(
      path.join(tmpDir, 'library', 'artifacts', 'ai-analysis-ui-smoke', '2026-04-24T10-10-00-000Z', 'summary.json'),
      { ok: true },
    );
    writeJson(
      path.join(tmpDir, 'library', 'artifacts', 'ai-analysis-ui-qa', '2026-04-24T10-20-00-000Z', 'summary.json'),
      { ok: true },
    );
    writeJson(
      path.join(tmpDir, 'ai-site-analyzer', 'artifacts', 'system-health', 'latest.json'),
      { ok: true },
    );

    const discovered = discoverAiIrbistechAcceptanceReportInputPaths(roots);

    assert.equal(
      discovered.aiIntegrationAcceptance,
      path.join(tmpDir, 'ai-integration', 'artifacts', 'equipment-score-acceptance', 'latest.json'),
    );
    assert.equal(
      discovered.aiIntegrationSqlReadiness,
      path.join(tmpDir, 'ai-integration', 'artifacts', 'analysis-score-sql-readiness', 'latest.json'),
    );
    assert.equal(
      discovered.aiIntegrationSyncHealth,
      path.join(tmpDir, 'ai-integration', 'artifacts', 'analysis-score-sync-health', 'latest.json'),
    );
    assert.equal(
      discovered.libraryHealth,
      path.join(tmpDir, 'library', 'artifacts', 'library-system-health', 'latest.json'),
    );
    assert.equal(
      discovered.libraryAcceptance,
      path.join(tmpDir, 'library', 'artifacts', 'ai-analysis-acceptance-qa', '2026-04-24T10-00-00-000Z', 'summary.json'),
    );
    assert.equal(
      discovered.libraryUiSmoke,
      path.join(tmpDir, 'library', 'artifacts', 'ai-analysis-ui-smoke', '2026-04-24T10-10-00-000Z', 'summary.json'),
    );
    assert.equal(
      discovered.libraryUiQa,
      path.join(tmpDir, 'library', 'artifacts', 'ai-analysis-ui-qa', '2026-04-24T10-20-00-000Z', 'summary.json'),
    );
    assert.equal(
      discovered.aiSiteAnalyzerHealth,
      path.join(tmpDir, 'ai-site-analyzer', 'artifacts', 'system-health', 'latest.json'),
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('discoverAiIrbistechAcceptanceReportInputPaths falls back to smoke-style artifact folders', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-report-fallback-'));

  try {
    const roots: AiIrbistechAcceptanceReportDiscoveryRoots = {
      workspaceRoot: tmpDir,
      libraryRoot: path.join(tmpDir, 'library'),
    };

    writeJson(
      path.join(
        tmpDir,
        'ai-integration',
        'artifacts',
        'analysis-score-sql-readiness-smoke',
        'latest.json',
      ),
      { ok: true },
    );
    writeJson(
      path.join(
        tmpDir,
        'ai-integration',
        'artifacts',
        'equipment-score-acceptance-healthcheck-smoke',
        'latest.json',
      ),
      { ok: true },
    );
    writeJson(
      path.join(
        tmpDir,
        'ai-site-analyzer',
        'artifacts',
        'system-healthcheck-smoke',
        'latest.json',
      ),
      { ok: true },
    );

    const discovered = discoverAiIrbistechAcceptanceReportInputPaths(roots);

    assert.equal(
      discovered.aiIntegrationSqlReadiness,
      path.join(
        tmpDir,
        'ai-integration',
        'artifacts',
        'analysis-score-sql-readiness-smoke',
        'latest.json',
      ),
    );
    assert.equal(
      discovered.aiIntegrationAcceptance,
      path.join(
        tmpDir,
        'ai-integration',
        'artifacts',
        'equipment-score-acceptance-healthcheck-smoke',
        'latest.json',
      ),
    );
    assert.equal(
      discovered.aiSiteAnalyzerHealth,
      path.join(
        tmpDir,
        'ai-site-analyzer',
        'artifacts',
        'system-healthcheck-smoke',
        'latest.json',
      ),
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('loadAiIrbistechAcceptanceReportSource parses the resolved JSON payload', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-report-source-'));

  try {
    const artifactPath = path.join(tmpDir, 'summary.json');
    writeJson(artifactPath, {
      checkedAt: '2026-04-24T11:00:00.000Z',
      ok: true,
    });

    const source = loadAiIrbistechAcceptanceReportSource(artifactPath, tmpDir);
    assert.equal(source.inputPath, artifactPath);
    assert.deepEqual(source.payload, {
      checkedAt: '2026-04-24T11:00:00.000Z',
      ok: true,
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

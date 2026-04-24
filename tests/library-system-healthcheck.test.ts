import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildLibrarySystemHealthAlertText,
  currentLibraryHealthState,
  normalizeLibrarySystemHealthPayload,
  runLibrarySystemHealthcheck,
  shouldSendLibraryHealthAlert,
  summaryToJson,
} from '../lib/library-system-healthcheck';

test('normalizeLibrarySystemHealthPayload accepts healthy /api/health payload', () => {
  const summary = normalizeLibrarySystemHealthPayload({
    url: 'https://ai.irbistech.com/api/health',
    httpStatus: 200,
    payload: {
      ok: true,
      severity: 'ok',
      failedServices: [],
      degradedServices: [],
      services: {
        main_db: { required: true, status: 'ok', latencyMs: 12 },
        bitrix_db: { required: true, status: 'ok', latencyMs: 18 },
      },
    },
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.reason, 'ok');
  assert.equal(summary.severity, 'ok');
  assert.deepEqual(summary.failedServices, []);
  assert.equal(summary.services.main_db.status, 'ok');
});

test('normalizeLibrarySystemHealthPayload marks required failures as unhealthy', () => {
  const summary = normalizeLibrarySystemHealthPayload({
    url: 'https://ai.irbistech.com/api/health',
    httpStatus: 503,
    payload: {
      ok: false,
      severity: 'failed',
      services: {
        main_db: { required: true, status: 'error', detail: 'timeout' },
        analysis_score_sync: { required: false, status: 'ok' },
      },
    },
    reason: 'http_status:503',
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.reason, 'http_status:503');
  assert.equal(summary.severity, 'failed');
  assert.deepEqual(summary.failedServices, ['main_db']);
});

test('normalizeLibrarySystemHealthPayload rejects invalid payloads', () => {
  const summary = normalizeLibrarySystemHealthPayload({
    url: 'https://ai.irbistech.com/api/health',
    httpStatus: 200,
    payload: null,
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.reason, 'invalid_payload');
  assert.equal(summary.severity, 'failed');
});

test('shouldSendLibraryHealthAlert deduplicates unhealthy alerts and can alert on recovery', () => {
  assert.equal(currentLibraryHealthState(true), 'healthy');
  assert.equal(currentLibraryHealthState(false), 'unhealthy');

  assert.equal(
    shouldSendLibraryHealthAlert({
      previousStatus: undefined,
      currentStatus: 'unhealthy',
      alertOnRecovery: true,
    }),
    true,
  );
  assert.equal(
    shouldSendLibraryHealthAlert({
      previousStatus: 'unhealthy',
      currentStatus: 'unhealthy',
      alertOnRecovery: true,
    }),
    false,
  );
  assert.equal(
    shouldSendLibraryHealthAlert({
      previousStatus: 'unhealthy',
      currentStatus: 'healthy',
      alertOnRecovery: true,
    }),
    true,
  );
  assert.equal(
    shouldSendLibraryHealthAlert({
      previousStatus: 'unhealthy',
      currentStatus: 'healthy',
      alertOnRecovery: false,
    }),
    false,
  );
});

test('buildLibrarySystemHealthAlertText includes compact failure context', () => {
  const summary = normalizeLibrarySystemHealthPayload({
    url: 'https://ai.irbistech.com/api/health',
    httpStatus: 503,
    payload: {
      ok: false,
      severity: 'failed',
      failedServices: ['ai_integration'],
      services: {
        ai_integration: { required: true, status: 'error', detail: 'connect timeout' },
      },
    },
    reason: 'http_status:503',
  });

  const text = buildLibrarySystemHealthAlertText(summary);

  assert.match(text, /library health is NOT OK/);
  assert.match(text, /failed=ai_integration/);
  assert.match(text, /ai_integration:error:connect timeout/);
});

test('summaryToJson exposes artifact path for monitoring consumers', () => {
  const payload = summaryToJson({
    checkedAt: '2026-04-24T10:00:00.000Z',
    url: 'https://ai.irbistech.com/api/health',
    ok: true,
    httpStatus: 200,
    severity: 'ok',
    reason: 'ok',
    failedServices: [],
    degradedServices: [],
    services: {},
    artifactPath: '/tmp/library-system-health/latest.json',
  });

  assert.equal(payload.artifactPath, '/tmp/library-system-health/latest.json');
});

test('runLibrarySystemHealthcheck writes latest artifact and prunes old timestamped files', async () => {
  const originalFetch = globalThis.fetch;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-system-health-'));
  const artifactDir = path.join(tmpDir, 'artifacts');
  const stateFile = path.join(tmpDir, 'state.json');

  fs.mkdirSync(artifactDir, { recursive: true });
  const oldArtifactA = path.join(artifactDir, 'library-system-health-2026-04-20T10-00-00-000Z.json');
  const oldArtifactB = path.join(artifactDir, 'library-system-health-2026-04-21T10-00-00-000Z.json');
  fs.writeFileSync(oldArtifactA, '{}\n', 'utf8');
  fs.writeFileSync(oldArtifactB, '{}\n', 'utf8');
  fs.utimesSync(oldArtifactA, new Date('2026-04-20T10:00:00.000Z'), new Date('2026-04-20T10:00:00.000Z'));
  fs.utimesSync(oldArtifactB, new Date('2026-04-21T10:00:00.000Z'), new Date('2026-04-21T10:00:00.000Z'));

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        severity: 'ok',
        failedServices: [],
        degradedServices: [],
        services: {
          main_db: { required: true, status: 'ok' },
          bitrix_db: { required: true, status: 'ok' },
          ai_integration: { required: true, status: 'ok' },
          analysis_score_sync: { required: false, status: 'ok' },
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

  try {
    const summary = await runLibrarySystemHealthcheck({
      url: 'https://ai.irbistech.com/api/health',
      timeoutMs: 1_000,
      webhookUrl: null,
      stateFile,
      artifactDir,
      artifactRetentionCount: 1,
      alertOnRecovery: false,
    });

    assert.equal(summary.ok, true);
    assert.equal(typeof summary.artifactPath, 'string');
    assert.equal(fs.existsSync(summary.artifactPath ?? ''), true);
    assert.equal(fs.existsSync(path.join(artifactDir, 'latest.json')), true);
    assert.equal(fs.existsSync(oldArtifactA), false);
    assert.equal(fs.existsSync(oldArtifactB), false);

    const artifactFiles = fs
      .readdirSync(artifactDir)
      .filter((item) => item !== 'latest.json' && item.endsWith('.json'));
    assert.equal(artifactFiles.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

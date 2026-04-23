import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLibrarySystemHealthAlertText,
  currentLibraryHealthState,
  normalizeLibrarySystemHealthPayload,
  shouldSendLibraryHealthAlert,
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

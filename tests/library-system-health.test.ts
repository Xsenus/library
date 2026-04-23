import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeLibrarySystemHealth } from '../lib/library-system-health';

test('summarizeLibrarySystemHealth reports ok when all required services are healthy', () => {
  const summary = summarizeLibrarySystemHealth(
    {
      main_db: { required: true, status: 'ok' },
      bitrix_db: { required: true, status: 'ok' },
      ai_integration: { required: true, status: 'ok' },
      analysis_score_sync: { required: false, status: 'ok' },
    },
    '2026-04-23T00:00:00.000Z',
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.severity, 'ok');
  assert.deepEqual(summary.failedServices, []);
  assert.deepEqual(summary.degradedServices, []);
});

test('summarizeLibrarySystemHealth reports degraded when only optional diagnostics fail', () => {
  const summary = summarizeLibrarySystemHealth(
    {
      main_db: { required: true, status: 'ok' },
      bitrix_db: { required: true, status: 'ok' },
      ai_integration: { required: true, status: 'ok' },
      analysis_score_sync: { required: false, status: 'error', detail: 'sync endpoint timed out' },
    },
    '2026-04-23T00:00:00.000Z',
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.severity, 'degraded');
  assert.deepEqual(summary.failedServices, []);
  assert.deepEqual(summary.degradedServices, ['analysis_score_sync']);
});

test('summarizeLibrarySystemHealth reports failed when a required dependency is unhealthy', () => {
  const summary = summarizeLibrarySystemHealth(
    {
      main_db: { required: true, status: 'error', detail: 'timeout' },
      bitrix_db: { required: true, status: 'ok' },
      ai_integration: { required: true, status: 'ok' },
      analysis_score_sync: { required: false, status: 'disabled' },
    },
    '2026-04-23T00:00:00.000Z',
  );

  assert.equal(summary.ok, false);
  assert.equal(summary.severity, 'failed');
  assert.deepEqual(summary.failedServices, ['main_db']);
  assert.deepEqual(summary.degradedServices, []);
});

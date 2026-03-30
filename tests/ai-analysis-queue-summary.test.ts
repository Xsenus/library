import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAiAnalysisQueueSummary } from '../lib/ai-analysis-queue-summary';

test('buildAiAnalysisQueueSummary counts queued running and stop requested items', () => {
  const summary = buildAiAnalysisQueueSummary([
    {
      analysis_status: 'queued',
      queue_priority: 10,
      queue_state: 'queued',
      queue_source: 'manual-play',
      source: 'manual-play',
    },
    {
      analysis_status: 'running',
      queue_priority: 60,
      queue_state: 'running',
      lease_expires_at: '2026-03-30T10:00:00.000Z',
      queue_source: 'manual-bulk',
      source: 'manual-bulk',
    },
    {
      analysis_status: 'stop_requested',
      queue_priority: 80,
      queue_state: 'running',
      queue_source: 'manual-queue',
      source: 'manual-queue',
    },
  ]);

  assert.deepEqual(summary, {
    total: 3,
    queued: 1,
    running: 1,
    stop_requested: 1,
    expedited: 1,
    leased: 1,
    source_counts: [
      { source: 'manual-bulk', count: 1 },
      { source: 'manual-play', count: 1 },
      { source: 'manual-queue', count: 1 },
    ],
  });
});

test('buildAiAnalysisQueueSummary falls back to unknown source when source is empty', () => {
  const summary = buildAiAnalysisQueueSummary([
    {
      analysis_status: 'queued',
      queue_priority: 50,
      queue_state: 'queued',
      queue_source: '',
      source: '',
    },
  ]);

  assert.equal(summary.total, 1);
  assert.equal(summary.queued, 1);
  assert.deepEqual(summary.source_counts, [{ source: 'unknown', count: 1 }]);
});

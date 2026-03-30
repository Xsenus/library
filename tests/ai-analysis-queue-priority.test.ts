import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAiAnalysisQueuePriority } from '../lib/ai-analysis-queue-priority';

test('resolveAiAnalysisQueuePriority assigns highest priority to manual play', () => {
  assert.equal(resolveAiAnalysisQueuePriority('manual-play', 1), 10);
  assert.equal(resolveAiAnalysisQueuePriority('play', 1), 10);
});

test('resolveAiAnalysisQueuePriority distinguishes queue single from queue batch', () => {
  assert.equal(resolveAiAnalysisQueuePriority('manual-queue', 1), 80);
  assert.equal(resolveAiAnalysisQueuePriority('manual-queue', 3), 90);
  assert.equal(resolveAiAnalysisQueuePriority('queue-single', 1), 80);
});

test('resolveAiAnalysisQueuePriority keeps bulk and filter below manual play', () => {
  assert.equal(resolveAiAnalysisQueuePriority('manual-bulk', 2), 60);
  assert.equal(resolveAiAnalysisQueuePriority('bulk', 10), 60);
  assert.equal(resolveAiAnalysisQueuePriority('filter', 25), 100);
});

test('resolveAiAnalysisQueuePriority falls back by batch size for unknown source', () => {
  assert.equal(resolveAiAnalysisQueuePriority('custom', 1), 40);
  assert.equal(resolveAiAnalysisQueuePriority('custom', 2), 60);
  assert.equal(resolveAiAnalysisQueuePriority(undefined, 0), 40);
});

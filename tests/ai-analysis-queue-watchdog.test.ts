import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QUEUE_WATCHDOG_GRACE_MS,
  QUEUE_WATCHDOG_MIN_DELAY_MS,
  QUEUE_WATCHDOG_RETRY_MS,
  resolveAiAnalysisQueueWatchdogDelay,
  shouldReuseAiAnalysisQueueWatchdog,
} from '../lib/ai-analysis-queue-watchdog';

test('resolveAiAnalysisQueueWatchdogDelay returns retry delay when queued items exist', () => {
  assert.equal(
    resolveAiAnalysisQueueWatchdogDelay({
      runnerActive: false,
      queuedCount: 2,
      nextLeaseMs: null,
    }),
    QUEUE_WATCHDOG_RETRY_MS,
  );
});

test('resolveAiAnalysisQueueWatchdogDelay returns null while runner is active', () => {
  assert.equal(
    resolveAiAnalysisQueueWatchdogDelay({
      runnerActive: true,
      queuedCount: 5,
      nextLeaseMs: 0,
    }),
    null,
  );
});

test('resolveAiAnalysisQueueWatchdogDelay delays until next lease expiration plus grace', () => {
  assert.equal(
    resolveAiAnalysisQueueWatchdogDelay({
      runnerActive: false,
      queuedCount: 0,
      nextLeaseMs: 3000,
    }),
    3000 + QUEUE_WATCHDOG_GRACE_MS,
  );

  assert.equal(
    resolveAiAnalysisQueueWatchdogDelay({
      runnerActive: false,
      queuedCount: 0,
      nextLeaseMs: 0,
    }),
    Math.max(QUEUE_WATCHDOG_MIN_DELAY_MS, QUEUE_WATCHDOG_GRACE_MS),
  );
});

test('shouldReuseAiAnalysisQueueWatchdog only reuses earlier or close due timers', () => {
  assert.equal(shouldReuseAiAnalysisQueueWatchdog(10_000, 10_100), true);
  assert.equal(shouldReuseAiAnalysisQueueWatchdog(10_000, 10_000), true);
  assert.equal(shouldReuseAiAnalysisQueueWatchdog(10_500, 10_000), false);
  assert.equal(shouldReuseAiAnalysisQueueWatchdog(null, 10_000), false);
});

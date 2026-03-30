import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AI_ANALYSIS_RETRY_BACKOFF_MS,
  classifyAiAnalysisRetry,
  resolveAiAnalysisRetryDelay,
} from '../lib/ai-analysis-queue-retry';

test('resolveAiAnalysisRetryDelay uses configured backoff schedule', () => {
  assert.equal(resolveAiAnalysisRetryDelay(1), AI_ANALYSIS_RETRY_BACKOFF_MS[0]);
  assert.equal(resolveAiAnalysisRetryDelay(2), AI_ANALYSIS_RETRY_BACKOFF_MS[1]);
  assert.equal(resolveAiAnalysisRetryDelay(10), AI_ANALYSIS_RETRY_BACKOFF_MS[AI_ANALYSIS_RETRY_BACKOFF_MS.length - 1]);
});

test('classifyAiAnalysisRetry marks upstream timeouts as retryable', () => {
  const decision = classifyAiAnalysisRetry({
    status: 504,
    error: 'AI integration timed out',
    outcome: 'failed',
    attempt: 1,
    maxAttempts: 3,
  });

  assert.equal(decision.retryable, true);
  assert.equal(decision.kind, 'timeout');
  assert.equal(decision.nextDelayMs, AI_ANALYSIS_RETRY_BACKOFF_MS[0]);
});

test('classifyAiAnalysisRetry marks health and network failures as retryable', () => {
  const health = classifyAiAnalysisRetry({
    status: 503,
    error: 'AI integration health check failed',
    outcome: 'failed',
    attempt: 2,
    maxAttempts: 3,
  });
  assert.equal(health.retryable, true);
  assert.equal(health.kind, 'health');
  assert.equal(health.nextDelayMs, AI_ANALYSIS_RETRY_BACKOFF_MS[1]);

  const network = classifyAiAnalysisRetry({
    status: 500,
    error: 'fetch failed: ECONNRESET',
    outcome: 'failed',
    attempt: 1,
    maxAttempts: 3,
  });
  assert.equal(network.retryable, true);
  assert.equal(network.kind, 'network');
});

test('classifyAiAnalysisRetry does not retry partial or terminal failures', () => {
  const partial = classifyAiAnalysisRetry({
    status: 200,
    error: 'Pipeline finished with partial status',
    outcome: 'partial',
    attempt: 1,
    maxAttempts: 3,
  });
  assert.equal(partial.retryable, false);
  assert.equal(partial.kind, 'partial');
  assert.equal(partial.nextDelayMs, null);

  const terminal = classifyAiAnalysisRetry({
    status: 422,
    error: 'Validation failed',
    outcome: 'failed',
    attempt: 1,
    maxAttempts: 3,
  });
  assert.equal(terminal.retryable, false);
  assert.equal(terminal.kind, 'terminal');
  assert.equal(terminal.nextDelayMs, null);
});

test('classifyAiAnalysisRetry stops scheduling after the last allowed attempt', () => {
  const decision = classifyAiAnalysisRetry({
    status: 503,
    error: 'Service unavailable',
    outcome: 'failed',
    attempt: 3,
    maxAttempts: 3,
  });

  assert.equal(decision.retryable, true);
  assert.equal(decision.kind, 'upstream_unavailable');
  assert.equal(decision.nextDelayMs, null);
});

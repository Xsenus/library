export const AI_ANALYSIS_RETRY_BACKOFF_MS = [30_000, 120_000, 300_000] as const;

export type AiAnalysisRetryKind =
  | 'timeout'
  | 'rate_limited'
  | 'health'
  | 'network'
  | 'upstream_unavailable'
  | 'upstream_error'
  | 'partial'
  | 'terminal';

export type AiAnalysisRetryDecision = {
  retryable: boolean;
  kind: AiAnalysisRetryKind;
  reason: string;
  nextDelayMs: number | null;
};

type RetryInput = {
  status?: number | null;
  error?: string | null;
  outcome?: string | null;
  attempt: number;
  maxAttempts: number;
};

const TIMEOUT_TOKENS = ['timed out', 'timeout', 'aborted', 'aborterror'];
const HEALTH_TOKENS = ['health check failed', '/health', 'integration health', 'service unavailable before step'];
const NETWORK_TOKENS = [
  'econnreset',
  'econnrefused',
  'enotfound',
  'socket hang up',
  'network',
  'fetch failed',
  'connect',
  'connection reset',
  'connection refused',
];

function includesAny(value: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

export function resolveAiAnalysisRetryDelay(
  attempt: number,
  scheduleMs: readonly number[] = AI_ANALYSIS_RETRY_BACKOFF_MS,
): number {
  const normalizedAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1;
  const index = Math.max(0, normalizedAttempt - 1);
  return scheduleMs[index] ?? scheduleMs[scheduleMs.length - 1] ?? 30_000;
}

export function classifyAiAnalysisRetry(input: RetryInput): AiAnalysisRetryDecision {
  const status = Number.isFinite(input.status) ? Number(input.status) : 0;
  const error = String(input.error ?? '').trim();
  const normalizedError = error.toLowerCase();
  const normalizedOutcome = String(input.outcome ?? '').trim().toLowerCase();

  let kind: AiAnalysisRetryKind = 'terminal';
  let retryable = false;
  let reason = error || `AI analysis failed with status ${status || 'unknown'}`;

  if (normalizedOutcome === 'partial') {
    kind = 'partial';
    reason = error || 'Pipeline finished with partial result';
  } else if (status === 429) {
    kind = 'rate_limited';
    retryable = true;
    reason = error || 'AI analysis was rate limited';
  } else if (status === 408 || status === 504 || includesAny(normalizedError, TIMEOUT_TOKENS)) {
    kind = 'timeout';
    retryable = true;
    reason = error || 'AI analysis timed out';
  } else if (includesAny(normalizedError, HEALTH_TOKENS)) {
    kind = 'health';
    retryable = true;
    reason = error || 'AI integration health check failed';
  } else if (includesAny(normalizedError, NETWORK_TOKENS)) {
    kind = 'network';
    retryable = true;
    reason = error || 'AI analysis failed due to a network error';
  } else if (status === 502 || status === 503) {
    kind = 'upstream_unavailable';
    retryable = true;
    reason = error || `AI upstream is temporarily unavailable (${status})`;
  } else if (status >= 500) {
    kind = 'upstream_error';
    retryable = true;
    reason = error || `AI upstream failed with ${status}`;
  }

  const nextDelayMs =
    retryable && input.attempt < input.maxAttempts ? resolveAiAnalysisRetryDelay(input.attempt) : null;

  return {
    retryable,
    kind,
    reason,
    nextDelayMs,
  };
}

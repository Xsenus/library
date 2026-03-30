export const QUEUE_WATCHDOG_RETRY_MS = 1500;
export const QUEUE_WATCHDOG_GRACE_MS = 1500;
export const QUEUE_WATCHDOG_MIN_DELAY_MS = 1000;
export const QUEUE_WATCHDOG_REUSE_TOLERANCE_MS = 250;

export type AiAnalysisQueueWatchdogSnapshot = {
  runnerActive?: boolean;
  queuedCount: number;
  nextLeaseMs?: number | null;
};

export function resolveAiAnalysisQueueWatchdogDelay(
  snapshot: AiAnalysisQueueWatchdogSnapshot,
  options?: {
    retryMs?: number;
    graceMs?: number;
    minDelayMs?: number;
  },
): number | null {
  const retryMs = options?.retryMs ?? QUEUE_WATCHDOG_RETRY_MS;
  const graceMs = options?.graceMs ?? QUEUE_WATCHDOG_GRACE_MS;
  const minDelayMs = options?.minDelayMs ?? QUEUE_WATCHDOG_MIN_DELAY_MS;

  if (snapshot.runnerActive) {
    return null;
  }

  if (snapshot.queuedCount > 0) {
    return retryMs;
  }

  if (snapshot.nextLeaseMs != null && Number.isFinite(Number(snapshot.nextLeaseMs))) {
    return Math.max(minDelayMs, Math.floor(Number(snapshot.nextLeaseMs)) + graceMs);
  }

  return null;
}

export function shouldReuseAiAnalysisQueueWatchdog(
  currentDueAtMs: number | null,
  targetDueAtMs: number,
  toleranceMs = QUEUE_WATCHDOG_REUSE_TOLERANCE_MS,
): boolean {
  return currentDueAtMs != null && currentDueAtMs <= targetDueAtMs + toleranceMs;
}

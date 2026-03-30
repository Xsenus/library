const PRIORITY_PLAY = 10;
const PRIORITY_MANUAL_SINGLE = 40;
const PRIORITY_MANUAL_BATCH = 60;
const PRIORITY_QUEUE_SINGLE = 80;
const PRIORITY_QUEUE_BATCH = 90;
const PRIORITY_FILTER = 100;

export function resolveAiAnalysisQueuePriority(source: unknown, count: number): number {
  const normalizedSource = String(source ?? '')
    .trim()
    .toLowerCase();
  const normalizedCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;

  if (normalizedSource === 'manual-play' || normalizedSource === 'play') {
    return PRIORITY_PLAY;
  }

  if (normalizedSource === 'manual-queue' || normalizedSource === 'queue-single') {
    return normalizedCount <= 1 ? PRIORITY_QUEUE_SINGLE : PRIORITY_QUEUE_BATCH;
  }

  if (normalizedSource === 'filter') {
    return PRIORITY_FILTER;
  }

  if (normalizedSource === 'manual-bulk' || normalizedSource === 'bulk') {
    return PRIORITY_MANUAL_BATCH;
  }

  return normalizedCount <= 1 ? PRIORITY_MANUAL_SINGLE : PRIORITY_MANUAL_BATCH;
}

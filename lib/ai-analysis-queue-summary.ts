export const EXPEDITED_QUEUE_PRIORITY = 20;

export type AiAnalysisQueueSummaryItem = {
  analysis_status?: string | null;
  queue_priority?: number | null;
  queue_state?: string | null;
  next_retry_at?: string | null;
  lease_expires_at?: string | null;
  queue_source?: string | null;
  source?: string | null;
};

export type AiAnalysisQueueSourceCount = {
  source: string;
  count: number;
};

export type AiAnalysisQueueSummary = {
  total: number;
  queued: number;
  running: number;
  stop_requested: number;
  expedited: number;
  leased: number;
  retry_scheduled: number;
  source_counts: AiAnalysisQueueSourceCount[];
};

export function buildAiAnalysisQueueSummary(
  items: AiAnalysisQueueSummaryItem[],
  expeditedPriority = EXPEDITED_QUEUE_PRIORITY,
): AiAnalysisQueueSummary {
  const sourceCounts = new Map<string, number>();
  const summary = {
    total: 0,
    queued: 0,
    running: 0,
    stop_requested: 0,
    expedited: 0,
    leased: 0,
    retry_scheduled: 0,
  };

  for (const item of items) {
    const status = String(item.analysis_status ?? '').trim().toLowerCase();
    const source = String(item.queue_source ?? item.source ?? 'unknown').trim() || 'unknown';

    summary.total += 1;
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);

    if (status.includes('stop_requested')) {
      summary.stop_requested += 1;
    } else if (status.includes('running')) {
      summary.running += 1;
    } else {
      summary.queued += 1;
    }

    if (Number.isFinite(item.queue_priority) && Number(item.queue_priority) <= expeditedPriority) {
      summary.expedited += 1;
    }

    if (item.queue_state === 'queued' && item.next_retry_at) {
      const nextRetryMs = Date.parse(item.next_retry_at);
      if (Number.isFinite(nextRetryMs) && nextRetryMs > Date.now()) {
        summary.retry_scheduled += 1;
      }
    }

    if (item.queue_state === 'running' && item.lease_expires_at) {
      summary.leased += 1;
    }
  }

  return {
    ...summary,
    source_counts: Array.from(sourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => a.source.localeCompare(b.source, 'ru')),
  };
}

declare global {
  var __aiAnalysisQueueTrigger: (() => Promise<void>) | undefined;
}

export function setAiAnalysisQueueTrigger(trigger: () => Promise<void>) {
  globalThis.__aiAnalysisQueueTrigger = trigger;
}

export async function triggerAiAnalysisQueueProcessing() {
  if (typeof globalThis.__aiAnalysisQueueTrigger !== 'function') {
    await import('@/app/api/ai-analysis/run/route');
  }

  const trigger = globalThis.__aiAnalysisQueueTrigger;
  if (typeof trigger !== 'function') {
    console.warn('AI analysis queue trigger is not registered');
    return;
  }

  return trigger();
}

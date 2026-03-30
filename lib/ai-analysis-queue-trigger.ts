declare global {
  var __aiAnalysisQueueTrigger: (() => Promise<void>) | undefined;
  var __aiAnalysisQueueWatchdogSync: (() => Promise<void>) | undefined;
}

export function setAiAnalysisQueueTrigger(trigger: () => Promise<void>) {
  globalThis.__aiAnalysisQueueTrigger = trigger;
}

export function setAiAnalysisQueueWatchdogSync(sync: () => Promise<void>) {
  globalThis.__aiAnalysisQueueWatchdogSync = sync;
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

export async function syncAiAnalysisQueueWatchdog() {
  if (typeof globalThis.__aiAnalysisQueueWatchdogSync !== 'function') {
    await import('@/app/api/ai-analysis/run/route');
  }

  const sync = globalThis.__aiAnalysisQueueWatchdogSync;
  if (typeof sync !== 'function') {
    console.warn('AI analysis queue watchdog sync is not registered');
    return;
  }

  return sync();
}

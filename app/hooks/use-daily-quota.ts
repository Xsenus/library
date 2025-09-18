// hooks/use-daily-quota.ts
'use client';
import { useCallback, useRef, useState } from 'react';

type Quota = { limit: number; used: number; remaining: number };

type Options = {
  /** если true — поднимать loading при запросе; если false — обновлять тихо без мерцаний */
  showLoading?: boolean;
};

export function useDailyQuota(opts: Options = {}) {
  const { showLoading = false } = opts;

  const [quota, setQuota] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // защита от параллельных вызовов + «дребезга»
  const inFlight = useRef(false);
  const lastTs = useRef(0);

  const refetch = useCallback(async () => {
    const now = Date.now();
    if (inFlight.current) return;
    if (now - lastTs.current < 400) return; // троттлим от повторов

    inFlight.current = true;
    lastTs.current = now;
    try {
      if (showLoading) setLoading(true);
      const res = await fetch('/api/user/quota', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Quota;

      // обновляем только если реально что-то поменялось, чтобы не дёргать рендер
      setQuota((prev) =>
        !prev ||
        prev.limit !== data.limit ||
        prev.used !== data.used ||
        prev.remaining !== data.remaining
          ? data
          : prev,
      );
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load quota');
    } finally {
      if (showLoading) setLoading(false);
      inFlight.current = false;
    }
  }, [showLoading]);

  /** Оптимистично проставить новое remaining (например, прочитали заголовок X-Views-Remaining) */
  const setRemaining = useCallback((remaining: number) => {
    setQuota((prev) =>
      prev ? { ...prev, remaining } : { limit: 10, used: 10 - remaining, remaining },
    );
  }, []);

  return { quota, loading, error, refetch, setRemaining };
}

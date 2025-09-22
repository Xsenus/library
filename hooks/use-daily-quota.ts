// hooks/use-daily-quota.ts
'use client';

import { useCallback, useRef, useState } from 'react';

export type Quota = {
  /** true — безлимит (обычно для irbis_worker при limits<=0) */
  unlimited: boolean;
  /** дневной лимит; null при безлимите */
  limit: number | null;
  /** фактически потрачено за сегодня (COUNT DISTINCT equipment_id) */
  used: number;
  /** остаток на сегодня; null при безлимите */
  remaining: number | null;
};

type Options = {
  showLoading?: boolean;
  endpoint?: string;
};

export function useDailyQuota(opts: Options = {}) {
  const { showLoading = false, endpoint = '/api/user/quota' } = opts;

  const [quota, setQuota] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlight = useRef(false);
  const lastTs = useRef(0);

  const normalize = (raw: any): Quota => {
    if (typeof raw?.unlimited === 'boolean') return raw as Quota;
    const limit = Number(raw?.limit ?? 10);
    const used = Number(raw?.used ?? 0);
    const remaining = Number.isFinite(raw?.remaining)
      ? Number(raw.remaining)
      : Math.max(0, limit - used);
    return { unlimited: false, limit, used, remaining };
  };

  const refetch = useCallback(async () => {
    const now = Date.now();
    if (inFlight.current) return;
    if (now - lastTs.current < 400) return;

    inFlight.current = true;
    lastTs.current = now;
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(endpoint, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const data = normalize(raw);

      setQuota((prev) =>
        !prev ||
        prev.unlimited !== data.unlimited ||
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
  }, [endpoint, showLoading]);

  // Оптимистичное изменение остатка — оставить можно, но лучше не использовать,
  // если сервер считает DISTINCT и мы не знаем, списывается ли сегодня новая сущность.
  const setRemaining = useCallback((remaining: number) => {
    setQuota((prev) => {
      if (!prev) return { unlimited: false, limit: 10, used: 10 - remaining, remaining };
      if (prev.unlimited) return prev;
      const limit = prev.limit ?? 0;
      const used = Math.max(0, limit - remaining);
      return { ...prev, remaining, used };
    });
  }, []);

  return { quota, loading, error, refetch, setRemaining };
}

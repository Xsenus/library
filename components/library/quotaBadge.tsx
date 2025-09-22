// components/quotaBadge.tsx
'use client';

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useDailyQuota } from '@/hooks/use-daily-quota';

type Props = { className?: string };

export default function QuotaBadge({ className }: Props) {
  const { quota, loading, error, refetch } = useDailyQuota({ showLoading: false });

  useEffect(() => {
    refetch();
  }, [refetch]);

  if (loading && !quota) {
    return (
      <span className={`inline-flex items-center gap-2 text-sm ${className ?? ''}`}>
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка квоты…
      </span>
    );
  }

  if (error && !quota) {
    return <span className={`text-sm text-red-600 ${className ?? ''}`}>Ошибка квоты</span>;
  }

  if (!quota) return null;

  if (quota.unlimited) {
    return (
      <span
        title="Безлимит для сотрудника"
        className={`inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-xs font-medium ring-1 ring-emerald-200 ${
          className ?? ''
        }`}>
        Безлимит
      </span>
    );
  }

  const limit = quota.limit ?? 0;
  const used = quota.used ?? 0;
  const remaining = quota.remaining ?? Math.max(0, limit - used);

  return (
    <span
      title={`Использовано: ${used} из ${limit}`}
      className={`inline-flex items-center rounded-full bg-slate-50 text-slate-700 px-2 py-0.5 text-xs font-medium ring-1 ring-slate-200 ${
        className ?? ''
      }`}>
      Квота: {remaining}/{limit}
    </span>
  );
}

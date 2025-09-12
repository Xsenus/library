'use client';

import { cn } from '@/lib/utils';

export function CsBadge({ score, className }: { score?: number | null; className?: string }) {
  const s = Number.isFinite(score as number) ? (score as number) : null;

  // 1) Нет значения — ничего не рендерим
  if (s === null) return null;

  // 3) Подсветка только при >= 0.95
  const highlight = s >= 0.95;

  if (highlight) {
    return (
      <span
        className={cn(
          'inline-block rounded-full px-2 py-0.5 text-[10px] font-medium leading-4',
          'bg-emerald-50 text-emerald-700 border border-emerald-200',
          className,
        )}
        title={`CS = ${s.toFixed(3)}`}>
        CS: {s.toFixed(2)}
      </span>
    );
  }

  // Нейтральный вид (без подложки)
  return (
    <span
      className={cn('inline-block text-[10px] leading-4 text-muted-foreground', className)}
      title={`CS = ${s.toFixed(3)}`}>
      CS: {s.toFixed(2)}
    </span>
  );
}

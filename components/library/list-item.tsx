'use client';

import { cn } from '@/lib/utils';
import { CsBadge } from './cs-badge';

export interface ListItemProps {
  title: string;
  subtitle?: string;
  cs?: number | null;
  isSelected?: boolean;
  onClick?: () => void;
}

export function ListItem({ title, subtitle, cs, isSelected, onClick }: ListItemProps) {
  const hasCs = Number.isFinite(cs as number);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={cn(
        'group relative w-full text-left rounded-md px-3 py-2 transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        isSelected
          ? 'bg-primary/10 ring-2 ring-primary/40 shadow-sm'
          : 'hover:bg-accent/70 active:bg-accent',
      )}>
      {/* Левая цветная полоса-индикатор */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1 bottom-1 w-1 rounded-full transition-colors',
          isSelected ? 'bg-primary' : 'bg-transparent group-hover:bg-muted-foreground/30',
        )}
      />

      {/* Текст */}
      <div className="font-medium leading-5 text-[11px]">{title}</div>
      {subtitle && (
        <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{subtitle}</div>
      )}

      {/* CS — показываем только если есть значение */}
      {hasCs && (
        <div className="mt-1">
          <CsBadge score={cs!} />
        </div>
      )}
    </button>
  );
}

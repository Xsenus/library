'use client';

import { cn } from '@/lib/utils';

export interface ListItemProps {
  title: string;
  subtitle?: string;
  cs?: number | null;
  isSelected?: boolean;
  onClick?: () => void;
}

/** Новая шкала цвета для CS: 0.80–1.00 (серый → зелёный) */
function csColor(score: number) {
  if (!Number.isFinite(score)) return 'text-muted-foreground';
  if (score < 0.8) return 'text-muted-foreground';
  if (score < 0.86) return 'text-zinc-500';
  if (score < 0.9) return 'text-emerald-500';
  if (score < 0.95) return 'text-emerald-600';
  return 'text-emerald-700';
}

export function ListItem({ title, subtitle, cs, isSelected, onClick }: ListItemProps) {
  const showCs = typeof cs === 'number';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-2 py-1 rounded-md transition-colors',
        'hover:bg-accent/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40',
        isSelected && 'bg-accent/70',
      )}>
      <div className="font-medium leading-4 text-[11px] whitespace-normal break-words">
        {title}
        {showCs && (
          <span className={cn('ml-1 font-extrabold tabular-nums', csColor(cs as number))}>
            {(cs as number).toFixed(2)}
          </span>
        )}
      </div>

      {subtitle && (
        <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground whitespace-normal break-words">
          {subtitle}
        </div>
      )}
    </button>
  );
}

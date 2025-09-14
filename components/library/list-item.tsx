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
      className={cn(
        'w-full text-left px-2 py-2 rounded-md transition-colors',
        'hover:bg-accent/60 focus:outline-none',
        isSelected && 'bg-accent/70',
      )}>
      <div className="font-medium leading-5 text-[12px] whitespace-normal break-words">{title}</div>

      {subtitle && (
        <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground whitespace-normal break-words">
          {subtitle}
        </div>
      )}

      {hasCs && (
        <div className="mt-1">
          <CsBadge score={cs as number} className="scale-90 origin-left" />
        </div>
      )}
    </button>
  );
}

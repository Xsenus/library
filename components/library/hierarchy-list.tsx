'use client';

import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';

type Props<T> = {
  title: string;
  items: T[];
  selectedId: number | null;
  loading: boolean;
  hasNextPage: boolean;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  onItemSelect: (item: T) => void;
  onLoadMore?: () => void;
  getItemId: (item: T) => number;
  getItemTitle: (item: T) => string;
  getItemCs?: (item: T) => number | null | undefined;
  emptyMessage?: string;
  enabled?: boolean;
};

function csColor(score: number) {
  if (score >= 0.95) return 'text-emerald-700';
  // if (score >= 0.94) return 'text-emerald-600';
  // if (score >= 0.90) return 'text-amber-700';
  return 'text-muted-foreground';
}

export function HierarchyList<T>(props: Props<T>) {
  const {
    title,
    items,
    selectedId,
    loading,
    hasNextPage,
    searchQuery,
    onSearchChange,
    onItemSelect,
    onLoadMore,
    getItemId,
    getItemTitle,
    getItemCs,
    emptyMessage = 'Нет данных',
    enabled = true,
  } = props;

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled || !onLoadMore || !hasNextPage || loading) return;
    const el = sentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && onLoadMore()),
      { root: el.parentElement, rootMargin: '200px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, hasNextPage, loading, onLoadMore]);

  const showFooterManual = useMemo(
    () => enabled && hasNextPage && !loading && onLoadMore && items.length > 0,
    [enabled, hasNextPage, loading, onLoadMore, items.length],
  );

  return (
    <div className="flex h-full flex-col rounded-lg bg-background">
      {/* компактный header */}
      <div className="sticky top-0 z-10 bg-background px-2 py-1.5 text-[12px] font-medium border-b">
        {title}
      </div>

      {/* компактный поиск */}
      {typeof onSearchChange === 'function' && (
        <div className="px-2 py-1.5 border-b">
          <input
            className="w-full rounded-md border px-2 py-1 text-[11px] disabled:opacity-50"
            placeholder="Поиск…"
            value={searchQuery ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            disabled={!enabled}
          />
        </div>
      )}

      {/* список — только горизонтальные разделители */}
      <div className="flex-1 overflow-auto divide-y">
        {items.length === 0 && !loading ? (
          <div className="px-2 py-2 text-[11px] text-muted-foreground">{emptyMessage}</div>
        ) : (
          items.map((it) => {
            const id = getItemId(it);
            const selected = selectedId === id;
            const csVal = getItemCs?.(it);
            const hasCs = Number.isFinite(csVal as number);

            return (
              <button
                key={id}
                type="button"
                onClick={() => onItemSelect(it)}
                className={cn(
                  'w-full text-left px-2 py-1 text-[11px] leading-4',
                  'hover:bg-accent/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40',
                  selected && 'bg-accent/80 ring-1 ring-primary/30',
                )}>
                <div className="font-medium">
                  {getItemTitle(it)}
                  {/* CS в конце названия: жирный и только цвет текста */}
                  {hasCs && (
                    <span
                      className={cn(
                        'ml-1 font-extrabold tabular-nums',
                        csColor((csVal as number) ?? 0),
                      )}
                      title="Clean Score">
                      {(csVal as number).toFixed(2)}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}

        {loading && <div className="px-2 py-1.5 text-[11px] text-muted-foreground">Загрузка…</div>}

        {enabled && <div ref={sentinelRef} />}

        {showFooterManual && (
          <div className="px-2 py-1.5">
            <button
              type="button"
              onClick={onLoadMore!}
              className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2">
              Показать ещё
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

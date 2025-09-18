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
  showSearch?: boolean;
  onItemSelect: (item: T) => void;
  onLoadMore?: () => void;
  getItemId: (item: T) => number;
  getItemTitle: (item: T) => string;
  getItemCs?: (item: T) => number | null | undefined;
  titleClassName?: string;
  headerClassName?: string;
  listClassName?: string;
  emptyMessage?: string;
  enabled?: boolean;
};

function csColor(score: number) {
  if (score >= 0.95) return 'text-emerald-700';
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
    showSearch = true,
    onItemSelect,
    onLoadMore,
    getItemId,
    getItemTitle,
    getItemCs,
    emptyMessage = 'Нет данных',
    enabled = true,
    titleClassName,
    headerClassName,
    listClassName,
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
      <div
        className={cn(
          'sticky top-0 z-10 border-b px-2 py-1.5 bg-muted',
          'text-base md:text-[12px]',
          headerClassName,
        )}>
        <span className={cn('font-semibold', titleClassName)}>{title}</span>
      </div>
      {showSearch && typeof onSearchChange === 'function' && (
        <div className="px-2 py-1.5 border-b bg-background">
          <input
            className={cn(
              'w-full rounded-md border px-2 py-1 disabled:opacity-50',
              'text-sm md:text-[11px]',
            )}
            placeholder="Поиск…"
            value={searchQuery ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            disabled={!enabled}
          />
        </div>
      )}

      <div className={cn('flex-1 overflow-auto divide-y', listClassName)}>
        {items.length === 0 && !loading ? (
          <div className={cn('px-2 py-2 text-muted-foreground', 'text-sm md:text-[11px]')}>
            {emptyMessage}
          </div>
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
                  'w-full text-left px-2 py-1 leading-4',
                  'text-base md:text-[11px]',
                  'hover:bg-accent/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40',
                  selected && 'bg-accent/80 ring-1 ring-primary/30',
                )}>
                <div className="font-medium">
                  {getItemTitle(it)}
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

        {loading && (
          <div className={cn('px-2 py-1.5 text-muted-foreground', 'text-sm md:text-[11px]')}>
            Загрузка…
          </div>
        )}

        {enabled && <div ref={sentinelRef} />}

        {showFooterManual && (
          <div className="px-2 py-1.5">
            <button
              type="button"
              onClick={onLoadMore!}
              className={cn(
                'underline underline-offset-2 text-muted-foreground hover:text-foreground',
                'text-sm md:text-[11px]',
              )}>
              Показать ещё
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

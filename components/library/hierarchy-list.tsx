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
  getItemConfirmed?: (item: T) => boolean | null | undefined;
  titleClassName?: string;
  headerClassName?: string;
  listClassName?: string;
  emptyMessage?: string;
  enabled?: boolean;
};

/** Новая шкала цвета для CS: 0.80–1.00 (серый → зелёный) */
function csColor(score: number) {
  if (!Number.isFinite(score)) return 'text-muted-foreground';
  if (score < 0.8) return 'text-muted-foreground';
  if (score < 0.86) return 'text-zinc-500';
  if (score < 0.9) return 'text-emerald-500';
  if (score < 0.95) return 'text-emerald-600';
  return 'text-emerald-700';
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
    getItemConfirmed,
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
          'sticky top-0 z-10 bg-[#efefef] px-2 py-1.5',
          'border-b-[3px] border-black/60',
          'text-base md:text-[12px]',
          headerClassName,
        )}>
        <span className={cn('font-semibold', titleClassName)}>{title}</span>
      </div>

      {showSearch && typeof onSearchChange === 'function' && (
        <div className="px-2 py-1.5 bg-[#efefef] border-b-[3px] border-black/60">
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

      {/* Список с толстыми и тёмными разделителями */}
      <div className={cn('flex-1 overflow-auto divide-y-[3px] divide-black/60', listClassName)}>
        {items.length === 0 && !loading ? (
          <div className={cn('px-2 py-2 text-muted-foreground', 'text-sm md:text-[11px]')}>
            {emptyMessage}
          </div>
        ) : (
          items.map((it) => {
            const id = getItemId(it);
            const selected = selectedId === id;
            const csVal = getItemCs?.(it);
            const showCs = typeof csVal === 'number';
            const isConfirmed = !!getItemConfirmed?.(it);

            return (
              <button
                key={id}
                type="button"
                onClick={() => onItemSelect(it)}
                className={cn(
                  'w-full text-left px-2 py-1 leading-4 transition-colors',
                  'text-base md:text-[11px] font-medium',
                  'focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40',
                  selected ? 'bg-[#6f7074] text-white hover:bg-[#5f6165]' : 'hover:bg-[#f4f4f5]',
                )}>
                <div className="font-medium">
                  {getItemTitle(it)}
                  {showCs && (
                    <span
                      className={cn(
                        'ml-1 font-extrabold tabular-nums',
                        selected ? 'text-pink-400' : csColor(csVal as number),
                      )}
                      title="Clean Score">
                      {isConfirmed
                        ? `[${(csVal as number).toFixed(2)}]`
                        : (csVal as number).toFixed(2)}
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

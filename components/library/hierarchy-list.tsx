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
  enabled?: boolean; // <- активен ли список (выбран ли предыдущий уровень)
};

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

  // Автодогрузка при прокрутке к низу — только если список активен
  useEffect(() => {
    if (!enabled) return;
    if (!onLoadMore) return;
    if (!hasNextPage || loading) return;

    const el = sentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) onLoadMore();
        }
      },
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
      {/* header (только горизонтальная линия) */}
      <div className="sticky top-0 z-10 bg-background px-3 py-2 text-sm font-medium border-b">
        {title}
      </div>

      {/* optional search */}
      {typeof onSearchChange === 'function' && (
        <div className="px-3 py-2 border-b">
          <input
            className="w-full rounded-md border px-2 py-1 text-xs disabled:opacity-50"
            placeholder="Поиск…"
            value={searchQuery ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            disabled={!enabled}
          />
        </div>
      )}

      {/* list (только горизонтальные разделители) */}
      <div className="flex-1 overflow-auto divide-y">
        {items.length === 0 && !loading ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">{emptyMessage}</div>
        ) : (
          items.map((it) => {
            const id = getItemId(it);
            const selected = selectedId === id;
            const cs = getItemCs?.(it);
            return (
              <button
                key={id}
                type="button"
                onClick={() => onItemSelect(it)}
                className={cn(
                  'w-full text-left px-3 py-2 text-[12px] leading-5',
                  'hover:bg-accent/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40',
                  selected && 'bg-accent/80 ring-1 ring-primary/30',
                )}>
                <div className="font-medium">{getItemTitle(it)}</div>
                {Number.isFinite(cs as number) && (
                  <div className="mt-1 inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                    CS: {(cs as number).toFixed(2)}
                  </div>
                )}
              </button>
            );
          })
        )}

        {/* скелетоны во время загрузки */}
        {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Загрузка…</div>}

        {/* наблюдатель — только когда список активен */}
        {enabled && <div ref={sentinelRef} />}

        {/* компактная ручная догрузка */}
        {showFooterManual && (
          <div className="px-3 py-2">
            <button
              type="button"
              onClick={onLoadMore!}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
              Показать ещё
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

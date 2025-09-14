'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type ImgItem = {
  link: string;
  thumbnail?: string;
  context?: string;
  title?: string;
};

type Props = {
  query: string;
  height?: number;
  visible?: number;
  className?: string;
};

export function GoogleImagesCarousel({ query, height = 180, visible = 3, className }: Props) {
  const [items, setItems] = useState<ImgItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [idx, setIdx] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);

  useEffect(() => {
    if (!query) return;
    const ctrl = new AbortController();
    setLoading(true);
    setIdx(0);
    setLoadedCount(0);

    fetch(`/api/images/google?q=${encodeURIComponent(query)}&num=10`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => (Array.isArray(j.items) ? setItems(j.items) : setItems([])))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [query]);

  useEffect(() => {
    if (!items.length) return;
    const first = items.slice(0, Math.min(visible, items.length));
    let cancelled = false;
    Promise.all(
      first.map(
        (it) =>
          new Promise<void>((res) => {
            const i = new Image();
            i.onload = () => res();
            i.onerror = () => res();
            i.referrerPolicy = 'no-referrer';
            i.src = it.thumbnail || it.link;
          }),
      ),
    ).then(() => !cancelled && setLoadedCount(first.length));
    return () => {
      cancelled = true;
    };
  }, [items, visible]);

  const maxIdx = Math.max(0, items.length - visible);
  const clampedIdx = Math.min(idx, maxIdx);
  const slideW = 100 / visible; // %

  const canPrev = clampedIdx > 0;
  const canNext = clampedIdx < maxIdx;

  const showSkeleton = loading || loadedCount < Math.min(visible, items.length);

  if (!query) return null;

  return (
    <div className={cn('w-full', className)}>
      <div className="relative overflow-hidden rounded-lg border">
        <div
          className="flex transition-transform duration-300 will-change-transform"
          style={{
            transform: `translateX(-${clampedIdx * slideW}%)`,
            height,
            gap: 8,
            padding: 8,
          }}>
          {showSkeleton
            ? Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  style={{ height: height - 16, width: `${slideW}%` }}
                  className="shrink-0 rounded-md bg-muted animate-pulse"
                />
              ))
            : items.map((it, i) => (
                <a
                  key={i}
                  href={it.context || it.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block shrink-0 rounded-md overflow-hidden border bg-background"
                  style={{ width: `${slideW}%` }}
                  title={it.title || 'Открыть источник'}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={it.thumbnail || it.link}
                    alt={it.title || 'image'}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    draggable={false}
                    style={{ height: height - 16, width: '100%' }}
                    className="object-cover"
                  />
                </a>
              ))}
        </div>

        <button
          type="button"
          onClick={() => setIdx((v) => Math.max(0, v - 1))}
          className={cn(
            'absolute left-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 bg-background/90 border shadow',
            !canPrev && 'opacity-40 pointer-events-none',
          )}
          aria-label="Предыдущие">
          <ChevronLeft className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => setIdx((v) => Math.min(maxIdx, v + 1))}
          className={cn(
            'absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 bg-background/90 border shadow',
            !canNext && 'opacity-40 pointer-events-none',
          )}
          aria-label="Следующие">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

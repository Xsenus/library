'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type ImgItem = { link: string; thumbnail?: string; context?: string; title?: string };
type ResolvedItem = ImgItem & { src: string };

type Props = {
  query: string;
  height?: number;
  visible?: number;
  className?: string;
  preferOriginal?: boolean;
  clickable?: boolean;
};

function ProgressiveImg({ src, alt, onFail }: { src: string; alt: string; onFail?: () => void }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [src]);

  return (
    <div className="relative h-full w-full">
      {!loaded && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="absolute inset-0 animate-pulse bg-muted" />
          <div className="relative z-10 h-5 w-5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={
          'h-full w-full object-cover rounded-md transition duration-300 ' +
          (loaded ? 'opacity-100 blur-0 scale-100' : 'opacity-0 blur-sm scale-[1.02]')
        }
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(true);
          onFail?.();
        }}
      />
    </div>
  );
}

function probe(src: string, timeoutMs = 4000): Promise<boolean> {
  if (!src) return Promise.resolve(false);
  const attempt = (policy?: 'no-referrer') =>
    new Promise<boolean>((res) => {
      const img = new Image();
      if (policy) img.referrerPolicy = policy;
      let done = false;
      const finish = (ok: boolean) => {
        if (!done) {
          done = true;
          res(ok);
        }
      };
      const to = setTimeout(() => finish(false), timeoutMs);
      img.onload = () => {
        clearTimeout(to);
        finish(img.naturalWidth >= 64 && img.naturalHeight >= 64);
      };
      img.onerror = () => {
        clearTimeout(to);
        finish(false);
      };
      img.src = src;
    });
  return attempt('no-referrer').then((ok) => (ok ? true : attempt()));
}

async function resolveItems(raw: ImgItem[], preferOriginal: boolean): Promise<ResolvedItem[]> {
  const tasks = raw.map(async (it) => {
    const primary = preferOriginal && it.link ? it.link : it.thumbnail || it.link;
    const fallback = !preferOriginal && it.link ? it.link : it.thumbnail;
    const candidates = [primary, fallback].filter(Boolean) as string[];
    for (const src of candidates) {
      if (await probe(src)) return { ...it, src };
    }
    return null;
  });
  const results = await Promise.all(tasks);
  return results.filter(Boolean) as ResolvedItem[];
}

export function GoogleImagesCarousel({
  query,
  height = 180,
  visible = 3,
  className,
  preferOriginal = true,
  clickable = false,
}: Props) {
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [idx, setIdx] = useState(0);

  const reqRef = useRef(0);

  useEffect(() => {
    if (!query) return;
    const id = ++reqRef.current;

    // сразу показываем скелетоны и сбрасываем индекс
    setLoading(true);
    setItems([]);
    setIdx(0);

    const ctrl = new AbortController();

    fetch(`/api/images/google?q=${encodeURIComponent(query)}&num=12`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => (Array.isArray(j.items) ? j.items : []))
      .then((raw: ImgItem[]) => resolveItems(raw, preferOriginal))
      .then((resolved) => {
        if (reqRef.current !== id) return; // устаревший ответ
        setItems(resolved);
      })
      .catch(() => {
        if (reqRef.current !== id) return;
        setItems([]);
      })
      .finally(() => {
        if (reqRef.current !== id) return;
        setLoading(false);
      });

    return () => ctrl.abort();
  }, [query, preferOriginal]);

  const maxIdx = Math.max(0, items.length - visible);
  const clampedIdx = Math.min(idx, maxIdx);
  const slideW = 100 / Math.max(1, visible);

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
          {(loading && items.length === 0 ? Array.from({ length: 10 }) : items).map(
            (it: any, i: number) => {
              if (loading && items.length === 0) {
                return (
                  <div
                    key={`sk-${i}`}
                    style={{ height: height - 16, width: `${slideW}%` }}
                    className="shrink-0 rounded-md bg-muted animate-pulse"
                  />
                );
              }

              const containerProps = {
                className:
                  'block shrink-0 rounded-md overflow-hidden border bg-background select-none',
                style: { width: `${slideW}%`, height: height - 16 },
                title: it.title || 'Изображение',
              } as const;

              const content = (
                <ProgressiveImg
                  src={it.src}
                  alt={it.title || 'image'}
                  onFail={() => setItems((prev) => prev.filter((p) => p.src !== it.src))}
                />
              );

              return clickable ? (
                <a
                  key={it.src}
                  href={it.context || it.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  {...containerProps}>
                  {content}
                </a>
              ) : (
                <div key={it.src} role="img" aria-label={it.title || 'image'} {...containerProps}>
                  {content}
                </div>
              );
            },
          )}
        </div>

        <button
          type="button"
          onClick={() => setIdx((v) => Math.max(0, v - 1))}
          className={cn(
            'absolute left-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 bg-background/90 border shadow',
            clampedIdx <= 0 && 'opacity-40 pointer-events-none',
          )}
          aria-label="Предыдущие">
          <ChevronLeft className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => setIdx((v) => Math.min(maxIdx, v + 1))}
          className={cn(
            'absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 bg-background/90 border shadow',
            clampedIdx >= maxIdx && 'opacity-40 pointer-events-none',
          )}
          aria-label="Следующие">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

type ImgItem = {
  link: string;
  thumbnail?: string;
  context?: string;
  title?: string;
  width?: number;
  height?: number;
  mime?: string;
};
type ResolvedItem = ImgItem & { src: string };

type Props = {
  query: string;
  preferOriginal?: boolean;
  clickable?: boolean;
  itemHeight?: number;
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
          'h-full w-full object-cover rounded-md border transition duration-300 ' +
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
        res(img.naturalWidth >= 64 && img.naturalHeight >= 64);
      };
      img.onerror = () => {
        clearTimeout(to);
        res(false);
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

export function GoogleImagesStrip({
  query,
  preferOriginal = true,
  clickable = false,
  itemHeight = 96,
}: Props) {
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!query) return;
    const id = ++reqRef.current;

    setLoading(true);
    setItems([]);

    const ctrl = new AbortController();

    fetch(`/api/images/google?q=${encodeURIComponent(query)}&num=12`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((j) => (Array.isArray(j.items) ? j.items : []))
      .then((raw: ImgItem[]) => resolveItems(raw, preferOriginal))
      .then((resolved) => {
        if (reqRef.current !== id) return;
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

  if (!query) return null;

  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground">
        Картинки по запросу: <span className="font-medium">{query}</span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {loading &&
          items.length === 0 &&
          Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              style={{ width: 128, height: itemHeight }}
              className="shrink-0 rounded-md bg-muted animate-pulse"
            />
          ))}

        {items.map((it) => {
          const wrapperStyle: React.CSSProperties = { height: itemHeight, width: 128 };
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
              className="group block shrink-0"
              title={it.title || 'Открыть источник'}
              style={wrapperStyle}>
              {content}
            </a>
          ) : (
            <div
              key={it.src}
              role="img"
              aria-label={it.title || 'image'}
              className="group block shrink-0"
              style={wrapperStyle}>
              {content}
            </div>
          );
        })}

        {!loading && items.length === 0 && (
          <div className="text-xs text-muted-foreground">Ничего не найдено</div>
        )}
      </div>
    </div>
  );
}

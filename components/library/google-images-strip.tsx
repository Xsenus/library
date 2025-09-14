// components/library/google-images-strip.tsx
'use client';

import { useEffect, useState } from 'react';

type ImgItem = {
  link: string;
  thumbnail?: string;
  context?: string;
  title?: string;
  width?: number;
  height?: number;
  mime?: string;
};

export function GoogleImagesStrip({ query }: { query: string }) {
  const [items, setItems] = useState<ImgItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query) return;
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/images/google?q=${encodeURIComponent(query)}&num=10`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((j) => setItems(j.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [query]);

  if (!query) return null;

  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground">
        Картинки по запросу: <span className="font-medium">{query}</span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {loading &&
          Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="w-32 h-24 shrink-0 rounded-md bg-muted animate-pulse" />
          ))}

        {!loading &&
          items.map((it, i) => (
            <a
              key={i}
              href={it.context || it.link}
              target="_blank"
              rel="noopener noreferrer"
              className="group block w-32 shrink-0"
              title={it.title || 'Открыть источник'}>
              {/* Используем <img>, т.к. домены непредсказуемы (без прописывания в next.config). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={it.thumbnail || it.link}
                alt={it.title || 'image'}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-24 w-32 object-cover rounded-md border transition-transform group-hover:scale-[1.02]"
              />
            </a>
          ))}

        {!loading && items.length === 0 && (
          <div className="text-xs text-muted-foreground">Ничего не найдено</div>
        )}
      </div>
    </div>
  );
}

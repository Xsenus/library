'use client';

import { useEffect, useState } from 'react';
import NextImage from 'next/image';
import { cn } from '@/lib/utils';

type Key = 'old' | 'cryo';

const GPT_IMAGES_BASE = process.env.NEXT_PUBLIC_GPT_IMAGES_BASE ?? '/static/';

const LABELS: Record<Key, string> = {
  old: 'Традиционная очистка',
  cryo: 'Крио-очистка',
};

const ALTS: Record<Key, string> = {
  old: 'Изображение традиционной очистки',
  cryo: 'Изображение крио-очистки',
};

type Props = {
  equipmentId?: number | null;
  onSelect?: (url: string) => void;
  className?: string;
};

export function GptImagePair({ equipmentId, onSelect, className }: Props) {
  const id = equipmentId ? String(equipmentId) : null;
  const [exists, setExists] = useState<Record<Key, boolean | null>>({ old: null, cryo: null });

  const items: Array<{ key: Key; url: string }> = id
    ? [
        { key: 'old', url: `${GPT_IMAGES_BASE}${id}_old.jpg` },
        { key: 'cryo', url: `${GPT_IMAGES_BASE}${id}_cryo.jpg` },
      ]
    : [];

  useEffect(() => {
    let cancelled = false;

    async function probe(url: string): Promise<boolean> {
      try {
        const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (r.ok) return true;
        if (r.status === 404) return false;
      } catch {
        /* ignore */
      }
      return new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth >= 32 && img.naturalHeight >= 32);
        img.onerror = () => resolve(false);
        const sep = url.includes('?') ? '&' : '?';
        img.src = `${url}${sep}cb=${Date.now()}`;
      });
    }

    (async () => {
      if (!id) {
        if (!cancelled) setExists({ old: false, cryo: false });
        return;
      }
      const [oldUrl, cryoUrl] = [`${GPT_IMAGES_BASE}${id}_old.jpg`, `${GPT_IMAGES_BASE}${id}_cryo.jpg`];
      const [oldOk, cryoOk] = await Promise.all([probe(oldUrl), probe(cryoUrl)]);
      if (!cancelled) setExists({ old: oldOk, cryo: cryoOk });
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const renderTile = (key: Key, url: string) => {
    const status = exists[key];
    const label = LABELS[key];
    const alt = ALTS[key];

    const wrapperCls = 'relative h-[300px] w-full rounded-md overflow-hidden bg-muted';
    const content = (
      <div className={wrapperCls}>
        <NextImage src={url} alt={alt} fill sizes="50vw" className="object-contain" unoptimized />
      </div>
    );

    if (status === null) {
      return (
        <div className="space-y-2" key={key}>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</div>
          <div className={cn(wrapperCls, 'animate-pulse')} />
        </div>
      );
    }

    if (status === false) {
      return (
        <div className="space-y-2" key={key}>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</div>
          <div className="grid h-[150px] place-items-center rounded-md border bg-muted/60 text-xs text-muted-foreground">
            Нет изображения
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-2" key={key}>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</div>
        {onSelect ? (
          <button
            type="button"
            className="w-full transition hover:ring-1 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            onClick={() => onSelect(url)}
            title={label}>
            {content}
          </button>
        ) : (
          content
        )}
      </div>
    );
  };

  return <div className={cn('grid gap-3 sm:grid-cols-2', className)}>{items.map(({ key, url }) => renderTile(key, url))}</div>;
}

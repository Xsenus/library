'use client';

import { useEffect, useState } from 'react';
import NextImage from 'next/image';
import { cn } from '@/lib/utils';
import {
  buildGptImageUrl,
  GPT_IMAGE_EXTENSIONS,
  GPT_IMAGE_KEYS,
  type GptImageKey,
} from '@/lib/gpt-images';

type Key = GptImageKey;

type StatusMap = Record<Key, boolean>;

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
  labelTone?: Partial<Record<Key, string>>;
  onStatusChange?: (status: StatusMap) => void;
  prefetchedUrls?: Partial<Record<Key, string | null>>;
};

export function GptImagePair({
  equipmentId,
  onSelect,
  className,
  labelTone,
  onStatusChange,
  prefetchedUrls,
}: Props) {
  const id = equipmentId ? String(equipmentId) : null;
  const [exists, setExists] = useState<Record<Key, boolean | null>>({ old: null, cryo: null });
  const [resolvedUrls, setResolvedUrls] = useState<Record<Key, string | null>>({
    old: null,
    cryo: null,
  });

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
        if (!cancelled) {
          setExists({ old: false, cryo: false });
          setResolvedUrls({ old: null, cryo: null });
        }
        return;
      }
      setExists({ old: null, cryo: null });
      setResolvedUrls({ old: null, cryo: null });

      async function resolveKey(key: Key): Promise<string | null> {
        const prefetched = prefetchedUrls?.[key];
        if (prefetched !== undefined) {
          return prefetched;
        }
        for (const ext of GPT_IMAGE_EXTENSIONS) {
          const candidate = buildGptImageUrl(id, key, ext);
          const ok = await probe(candidate);
          if (cancelled) return null;
          if (ok) return candidate;
        }
        return null;
      }

      const results = await Promise.all(
        GPT_IMAGE_KEYS.map(async (key) => ({ key, url: await resolveKey(key) })),
      );
      if (cancelled) return;

      const nextUrls: Record<Key, string | null> = { old: null, cryo: null };
      const nextExists: Record<Key, boolean> = { old: false, cryo: false };
      for (const { key, url } of results) {
        nextUrls[key] = url ?? null;
        nextExists[key] = Boolean(url);
      }

      setResolvedUrls(nextUrls);
      setExists({ old: nextExists.old, cryo: nextExists.cryo });
    })();

    return () => {
      cancelled = true;
    };
  }, [id, prefetchedUrls]);

  useEffect(() => {
    if (!onStatusChange) return;
    const { old, cryo } = exists;
    if (old === null || cryo === null) return;
    onStatusChange({ old, cryo });
  }, [exists, onStatusChange]);

  const renderTile = (key: Key) => {
    const status = exists[key];
    const label = LABELS[key];
    const alt = ALTS[key];
    const tone = labelTone?.[key];
    const url = resolvedUrls[key];
    const labelClassName = cn(
      'text-xs font-semibold uppercase tracking-wide',
      tone ?? 'text-muted-foreground',
    );

    const wrapperCls = 'relative h-[300px] w-full rounded-md overflow-hidden bg-muted';

    if (status === null) {
      return (
        <div className="space-y-2" key={key}>
          <div className={labelClassName}>{label}</div>
          <div className={cn(wrapperCls, 'animate-pulse')} />
        </div>
      );
    }

    if (!status || !url) {
      return (
        <div className="space-y-2" key={key}>
          <div className={labelClassName}>{label}</div>
          <div className="grid h-[150px] place-items-center rounded-md border bg-muted/60 text-xs text-muted-foreground">
            Нет изображения
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-2" key={key}>
        <div className={labelClassName}>{label}</div>
        {onSelect ? (
          <button
            type="button"
            className="w-full transition hover:ring-1 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            onClick={() => onSelect(url)}
            title={label}>
            <div className={wrapperCls}>
              <NextImage src={url} alt={alt} fill sizes="50vw" className="object-contain" unoptimized />
            </div>
          </button>
        ) : (
          <div className={wrapperCls}>
            <NextImage src={url} alt={alt} fill sizes="50vw" className="object-contain" unoptimized />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', className)}>
      {id ? GPT_IMAGE_KEYS.map((key) => renderTile(key)) : null}
    </div>
  );
}

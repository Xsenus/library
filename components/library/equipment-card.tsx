'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ExternalLink, X, Copy } from 'lucide-react';
import { EquipmentDetail } from '@/lib/validators';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import NextImage from 'next/image';
import { cn } from '@/lib/utils';
import { GoogleImagesCarousel } from './google-images-carousel';

interface EquipmentCardProps {
  equipment: EquipmentDetail;
}

const GPT_IMAGES_BASE = process.env.NEXT_PUBLIC_GPT_IMAGES_BASE ?? '/static/';
type ImgSection = 'google-images' | 'gpt-images';
const OPEN_KEY = 'lib:img-accordion-open';
const IMG_SECTIONS: ImgSection[] = ['google-images', 'gpt-images'];

/** Единая логика хранения/восстановления состояния аккордеона */
function useImgAccordionState(equipmentId?: number | null) {
  const [open, setOpen] = useState<ImgSection[] | null>(null); // null — пока не гидратнули

  // Гидратация при маунте и при смене записи
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const filtered = arr.filter((x: unknown): x is ImgSection =>
            IMG_SECTIONS.includes(x as ImgSection),
          );
          setOpen(filtered);
          return;
        }
      }
      // Бэкомпат со старыми ключами
      const legacy =
        localStorage.getItem('lib:img-section') ??
        (localStorage.getItem('lib:gpt-open') === '1' ? 'gpt-images' : null);

      setOpen(
        legacy === 'google-images' || legacy === 'gpt-images' ? [legacy] : ([] as ImgSection[]), // по умолчанию всё закрыто
      );
    } catch {
      setOpen([]);
    }
  }, [equipmentId]);

  // Сохранение
  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch {
      /* ignore */
    }
  }, [open]);

  // Синхронизация между вкладками
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== OPEN_KEY || !e.newValue) return;
      try {
        const arr = JSON.parse(e.newValue);
        if (Array.isArray(arr)) {
          const filtered = arr.filter((x: unknown): x is ImgSection =>
            IMG_SECTIONS.includes(x as ImgSection),
          );
          setOpen(filtered);
        }
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return [open, setOpen] as const;
}

export function EquipmentCard({ equipment }: EquipmentCardProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showUtp, setShowUtp] = useState(false);
  const [showMail, setShowMail] = useState(false);

  // Храним/восстанавливаем массив открытых секций для каждой записи
  const [openSections, setOpenSections] = useImgAccordionState(equipment?.id);

  /** Доступность GPT-картинок: null = проверяем, false = нет, true = есть */
  const [gptAvailable, setGptAvailable] = useState<boolean | null>(null);
  /** Флаг «мы уже один раз авто-раскрыли GPT» для этой карточки */
  const [autoOpenedGPT, setAutoOpenedGPT] = useState(false);

  /** НОВОЕ: хотим держать GPT открытой с первого рендера, если в памяти была открыта */
  const wantGptFromMemoryRef = useRef(false);
  useEffect(() => {
    wantGptFromMemoryRef.current = !!openSections?.includes('gpt-images');
  }, [openSections, equipment?.id]);

  // Сброс на смену карточки
  useEffect(() => {
    setGptAvailable(null);
    setAutoOpenedGPT(false);
  }, [equipment?.id]);

  const imageUrls = equipment.images_url
    ? equipment.images_url
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean)
    : [];

  const cs = equipment.clean_score ?? null;
  const es = equipment.equipment_score ?? null;

  const fmt = (v: number | null) => (v == null ? 'N/A' : v.toFixed(2));
  const Sep = () => <div className="h-px bg-border my-2" />;

  const ScorePill = ({
    label,
    value,
    tone,
  }: {
    label: 'CS' | 'ES';
    value: number | null;
    tone: 'cs' | 'es';
  }) => {
    const base =
      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium tabular-nums';
    const cls =
      tone === 'es'
        ? 'bg-zinc-600 text-white'
        : value != null && value >= 0.95
        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-900/40'
        : 'bg-muted text-muted-foreground';
    return (
      <span className={cn(base, cls)} title={`${label}: ${fmt(value)}`}>
        {label}: {fmt(value)}
      </span>
    );
  };

  const q = equipment.equipment_name?.trim() ?? '';
  const googleImagesUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
  const googleTextUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;

  const blueBtn =
    'shrink-0 border border-blue-500 text-blue-600 bg-blue-50 hover:bg-blue-100 active:scale-[.98] transition';

  /** ===== Проверка наличия GPT-картинок — до открытия секции ===== */
  useEffect(() => {
    let cancelled = false;
    setGptAvailable(null);

    const id = equipment?.id ? String(equipment.id) : null;
    if (!id) {
      setGptAvailable(false);
      return;
    }

    const urls = [`${GPT_IMAGES_BASE}${id}_old.jpg`, `${GPT_IMAGES_BASE}${id}_cryo.jpg`];

    async function probe(url: string): Promise<boolean> {
      // 1) HEAD
      try {
        const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (r.ok) return true;
        if (r.status === 404) return false;
      } catch {
        /* ignore */
      }
      // 2) <img> fallback
      return new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth >= 32 && img.naturalHeight >= 32);
        img.onerror = () => resolve(false);
        const sep = url.includes('?') ? '&' : '?';
        img.src = `${url}${sep}cb=${Date.now()}`;
      });
    }

    (async () => {
      const [a, b] = await Promise.all(urls.map((u) => probe(u)));
      if (cancelled) return;
      setGptAvailable(!!(a || b));
    })();

    return () => {
      cancelled = true;
    };
  }, [equipment?.id]);

  /** Реакция на изменение доступности: один раз авто-раскрываем GPT, но не навязываем дальше */
  useEffect(() => {
    if (!openSections) return;
    if (gptAvailable === true && !autoOpenedGPT) {
      if (!openSections.includes('gpt-images')) {
        setOpenSections((prev) => [...(prev || []), 'gpt-images']);
      }
      setAutoOpenedGPT(true);
    }
    if (gptAvailable === false || gptAvailable === null) {
      if (openSections.includes('gpt-images')) {
        setOpenSections((prev) => (prev || []).filter((x) => x !== 'gpt-images'));
      }
    }
  }, [gptAvailable, autoOpenedGPT, openSections, setOpenSections]);

  /** Значение для аккордеона:
   * - GPT видна только когда доступна
   * - ЛИБО когда идёт проверка и «по памяти» была открыта — сразу держим её в value,
   *   чтобы не было повторной анимации раскрытия.
   */
  const accordionValue =
    (openSections?.filter((s) => {
      if (s !== 'gpt-images') return true;
      if (gptAvailable === true) return true;
      if (gptAvailable === null && wantGptFromMemoryRef.current) return true;
      return false;
    }) as ImgSection[]) ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-3 sm:p-4 pb-2">
          <CardTitle className="text-base font-semibold leading-6">
            {equipment.equipment_name}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <ScorePill label="CS" value={cs} tone="cs" />
            <ScorePill label="ES" value={es} tone="es" />
            {equipment?.id != null && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium border">
                ID: {equipment.id}
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-3 sm:p-4 pt-2 space-y-3">
          {/* Описание устройства */}
          {equipment.description && (
            <div className="space-y-1.5">
              <div className="text-sm font-semibold">Описание устройства</div>
              <p className="text-xs leading-5 text-muted-foreground">{equipment.description}</p>
              {equipment.description_url && (
                <a
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  href={equipment.description_url}
                  target="_blank"
                  rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3" />
                  Источник
                </a>
              )}
            </div>
          )}

          {/* Аккордеон с изображениями */}
          {openSections !== null ? (
            <Accordion
              type="multiple"
              value={accordionValue}
              onValueChange={(v) => {
                const arr = (Array.isArray(v) ? v : []) as ImgSection[];
                let filtered = arr.filter((x) => x === 'google-images' || x === 'gpt-images');
                // Блокируем «gpt-images», пока доступность НЕ подтверждена true
                if (gptAvailable !== true) {
                  filtered = filtered.filter((x) => x !== 'gpt-images');
                }
                setOpenSections(filtered); // допускаем пустой массив — всё закрыто
              }}
              className="w-full">
              <AccordionItem value="google-images">
                <AccordionTrigger className="text-sm font-medium">Картинки Google</AccordionTrigger>
                <AccordionContent>
                  {q ? (
                    <div className="pt-2">
                      <GoogleImagesCarousel query={q} height={180} visible={3} />
                      <div className="mt-2 flex items-center gap-1.5"></div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">Нет названия для поиска.</div>
                  )}
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="gpt-images">
                <AccordionTrigger
                  className={cn(
                    'text-sm font-medium',
                    gptAvailable !== true && 'opacity-50 pointer-events-none select-none',
                  )}
                  onClick={gptAvailable !== true ? (e) => e.preventDefault() : undefined}
                  aria-disabled={gptAvailable !== true}>
                  Картинки GPT
                </AccordionTrigger>

                {/* Отключаем видимую анимацию при проверке/авто-открытии */}
                <AccordionContent
                  className={cn(
                    (gptAvailable === null || autoOpenedGPT) &&
                      'data-[state=open]:!animate-none data-[state=closed]:!animate-none',
                  )}>
                  <div className="pt-2">
                    {gptAvailable === null && wantGptFromMemoryRef.current && (
                      <div className="h-[300px] rounded-md border bg-muted/50 animate-pulse" />
                    )}

                    {gptAvailable === true && (
                      <GptImages
                        equipmentId={equipment.id}
                        onSelect={(url) => setSelectedImage(url)}
                      />
                    )}

                    {gptAvailable === false && (
                      <div className="rounded-md border bg-muted/50 grid place-items-center h-[120px]">
                        <span className="text-xs text-muted-foreground">Нет картинки</span>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : (
            // маленький плейсхолдер на время гидратации
            <div className="h-8 rounded bg-muted/50 animate-pulse" />
          )}

          {/* Изображения из базы */}
          {imageUrls.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {imageUrls.map((url, idx) => (
                <button
                  key={idx}
                  className="relative aspect-[4/3] bg-muted rounded-md overflow-hidden hover:ring-1 hover:ring-primary/40"
                  onClick={() => setSelectedImage(url)}>
                  <NextImage
                    src={url}
                    alt={`${equipment.equipment_name} ${idx + 1}`}
                    fill
                    sizes="33vw"
                    className="object-cover"
                    unoptimized
                  />
                </button>
              ))}
            </div>
          )}

          <Sep />

          {/* Проблемы оборудования — 3 колонки */}
          <div className="space-y-1.5">
            <div className="text-sm font-semibold">Проблемы оборудования</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <ColColored title="Загрязнения" text={equipment.contamination} />
              <ColColored title="Поверхности" text={equipment.surface} />
              <ColColored title="Проблемы от загрязнений" text={equipment.problems} />
            </div>
          </div>

          <Sep />

          {/* Традиционная очистка и криобластинг — 3 колонки */}
          <div className="space-y-1.5">
            <div className="text-sm font-semibold">
              Традиционная очистка и <span className="underline">криобластинг</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <ColColored title="Традиционная очистка" text={equipment.old_method} />
              <ColColored title="Недостатки от традиционной очистки" text={equipment.old_problem} />
              <ColColored
                title="Преимущества от криобластинга"
                text={equipment.benefit}
                emphasize
              />
            </div>
          </div>

          <Sep />

          {/* Ряд действий */}
          <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-1">
            <Button size="sm" onClick={() => setShowUtp(true)} className={blueBtn}>
              📣 УТП
            </Button>
            <Button size="sm" onClick={() => setShowMail(true)} className={blueBtn}>
              ✉ Письмо
            </Button>
            <Button size="sm" asChild className={blueBtn}>
              <a href={googleImagesUrl} target="_blank" rel="noopener noreferrer">
                Картинки Google
              </a>
            </Button>
            <Button size="sm" asChild className={blueBtn}>
              <a href={googleTextUrl} target="_blank" rel="noopener noreferrer">
                Описание Google
              </a>
            </Button>
            <Button size="sm" className={blueBtn} disabled={!equipment.company_id}>
              Компания
            </Button>
          </div>

          <Sep />

          {/* Центр принятия решений */}
          {(equipment.decision_pr ||
            equipment.decision_prs ||
            equipment.decision_operator ||
            equipment.decision_proc) && (
            <div className="space-y-1.5">
              <div className="text-sm font-semibold">Центр принятия решений</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <BadgeBlock label="ЛПР" value={equipment.decision_pr} />
                <BadgeBlock label="Прескриптор" value={equipment.decision_prs} />
                <BadgeBlock label="Эксплуатация" value={equipment.decision_operator} />
                <BadgeBlock label="Закупка" value={equipment.decision_proc} />
              </div>
            </div>
          )}

          {/* Примеры товаров */}
          {equipment.goods_examples?.length ? (
            <div className="space-y-1.5">
              <div className="text-sm font-semibold">Примеры товаров</div>
              <p className="text-xs text-muted-foreground">{equipment.goods_examples.join(', ')}</p>
            </div>
          ) : null}

          {/* Пример компании */}
          {(equipment.company_name || equipment.site_description) && (
            <div className="space-y-1.5">
              <div className="text-sm font-semibold">Пример компании</div>
              {equipment.company_name && (
                <div className="text-xs font-medium">{equipment.company_name}</div>
              )}
              {equipment.site_description && (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {equipment.site_description}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Лайтбокс */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}>
          <div className="relative w-[90vw] h-[90vh]">
            <NextImage
              src={selectedImage}
              alt="Equipment detail"
              fill
              sizes="100vw"
              className="object-contain"
              unoptimized
            />
            <Button
              variant="secondary"
              size="sm"
              className="absolute top-2 right-2"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedImage(null);
              }}>
              ✕
            </Button>
          </div>
        </div>
      )}

      {/* УТП */}
      {showUtp && (
        <BigModal
          title="УТП"
          onClose={() => setShowUtp(false)}
          contentText={equipment.utp_post ?? '—'}
        />
      )}

      {/* Письмо */}
      {showMail && (
        <BigModal
          title="Письмо"
          onClose={() => setShowMail(false)}
          contentText={equipment.utp_mail ?? equipment.benefit ?? '—'}
        />
      )}
    </div>
  );
}

function GptImages({
  equipmentId,
  onSelect,
}: {
  equipmentId?: number | null;
  onSelect: (url: string) => void;
}) {
  const id = equipmentId?.toString() ?? null;

  const [exists, setExists] = useState<Record<'old' | 'cryo', boolean | null>>({
    old: null,
    cryo: null,
  });

  const items: Array<{ key: 'old' | 'cryo'; url: string; alt: string }> = id
    ? [
        { key: 'old', url: `${GPT_IMAGES_BASE}${id}_old.jpg`, alt: 'GPT image (old)' },
        { key: 'cryo', url: `${GPT_IMAGES_BASE}${id}_cryo.jpg`, alt: 'GPT image (cryo)' },
      ]
    : [];

  useEffect(() => {
    let cancelled = false;

    async function probe(url: string): Promise<boolean> {
      // 1) HEAD
      try {
        const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (r.ok) return true;
        if (r.status === 404) return false;
      } catch {
        /* ignore */
      }
      // 2) <img> fallback
      return new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth >= 32 && img.naturalHeight >= 32);
        img.onerror = () => resolve(false);
        const sep = url.includes('?') ? '&' : '?';
        img.src = `${url}${sep}cb=${Date.now()}`;
      });
    }

    (async () => {
      if (!id || items.length === 0) {
        if (!cancelled) setExists({ old: false, cryo: false });
        return;
      }
      const [oldOk, cryoOk] = await Promise.all([probe(items[0].url), probe(items[1].url)]);
      if (!cancelled) setExists({ old: oldOk, cryo: cryoOk });
    })();

    return () => {
      cancelled = true;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tileBase =
    'relative h-[300px] w-full rounded-md overflow-hidden text-left border bg-muted/50 grid place-items-center';

  if (!id) {
    return <div className="text-xs text-muted-foreground">ID оборудования не задан.</div>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {items.map(({ key, url, alt }) => {
        const ok = exists[key];
        if (ok === null) {
          return (
            <div key={key} className={cn(tileBase, 'animate-pulse')}>
              <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 border-t-transparent animate-spin" />
            </div>
          );
        }
        if (ok) {
          return (
            <button
              type="button"
              key={key}
              className="relative h-[300px] w-full rounded-md overflow-hidden bg-muted hover:ring-1 hover:ring-primary/40"
              onClick={() => onSelect(url)}
              title={alt}>
              <NextImage
                src={url}
                alt={alt}
                fill
                sizes="50vw"
                className="object-contain"
                unoptimized
              />
            </button>
          );
        }
        return (
          <div key={key} className={tileBase}>
            <div className="text-xs text-muted-foreground">Нет картинки</div>
          </div>
        );
      })}
    </div>
  );
}

/** Колонка с выделением фоном */
function ColColored({
  title,
  text,
  emphasize,
}: {
  title: string;
  text?: string | null;
  emphasize?: boolean;
}) {
  if (!text) return null;
  return (
    <div
      className={cn(
        'rounded-md border p-3',
        emphasize ? 'bg-emerald-50 dark:bg-emerald-900/10' : 'bg-muted/60',
      )}>
      <div className="text-xs font-semibold mb-1">{title}</div>
      <p className="text-xs text-muted-foreground leading-5">{text}</p>
    </div>
  );
}

function BadgeBlock({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-md border bg-background px-2 py-1">
      <div className="text-[11px] font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{value}</div>
    </div>
  );
}

function normalizeForDisplay(raw: string): string {
  if (!raw) return '';
  let s = raw
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/ {2}\n/g, '\n')
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/([,;:.!?])(?!\s|$)/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  s = s
    .split('\n')
    .map((line) => {
      const sc = (line.match(/;/g) || []).length;
      if (sc >= 3 && line.length > 80) return line.replace(/;\s*/g, ';\n');
      return line;
    })
    .join('\n');

  return s.trim();
}

function BigModal({
  title,
  onClose,
  children,
  contentText,
  copyText,
}: {
  title: string;
  onClose: () => void;
  children?: ReactNode;
  contentText?: string;
  copyText?: string;
}) {
  const [copied, setCopied] = useState(false);

  const normalizedDisplay = useMemo(() => {
    const src = contentText ?? (typeof children === 'string' ? children : '');
    return src ? normalizeForDisplay(src) : '';
  }, [contentText, children]);

  const normalizedCopy = useMemo(() => {
    const src = copyText ?? contentText ?? (typeof children === 'string' ? children : '');
    return src ? normalizeForDisplay(src) : '';
  }, [copyText, contentText, children]);

  async function copyToClipboard() {
    const text = normalizedCopy;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="absolute left-1/2 top-1/2 w-[min(1100px,100vw-32px)] maxхана-[calc(100vh-32px)]
                      -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border
                      bg-background shadow-2xl flex flex-col min-h-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyToClipboard}
              title="Скопировать"
              aria-label="Скопировать"
              disabled={!normalizedCopy}
              className={cn(
                'rounded-md border border-blue-500 text-blue-600 bg-blue-50 p-1.5',
                'hover:bg-blue-100 active:scale-[.98] transition',
                !normalizedCopy && 'opacity-50 cursor-not-allowed',
              )}>
              <Copy className="h-5 w-5" />
            </button>
            <div className="text-lg font-semibold">{title}</div>
            {copied && (
              <span className="ml-1 text-xs text-emerald-600 select-none">Скопировано</span>
            )}
          </div>

          <button
            type="button"
            className="inline-flex items-center rounded-md border bg-background p-1.5 hover:bg-accent"
            onClick={onClose}
            aria-label="Закрыть">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-5 py-4 text-[13px] leading-6 whitespace-pre-wrap">
          {normalizedDisplay ? normalizedDisplay : typeof children !== 'string' ? children : null}
        </div>
      </div>
    </div>
  );
}

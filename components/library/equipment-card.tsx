'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ExternalLink, X, Copy, ArrowUpRight } from 'lucide-react';
import { EquipmentDetail } from '@/lib/validators';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import NextImage from 'next/image';
import { cn } from '@/lib/utils';
import { GoogleImagesCarousel } from './google-images-carousel';
import type { OkvedByEquipment } from '@/lib/validators';

interface EquipmentCardProps {
  equipment: EquipmentDetail;
  onEsConfirmChange?: (equipmentId: number, confirmed: boolean) => void;
}

const GPT_IMAGES_BASE = process.env.NEXT_PUBLIC_GPT_IMAGES_BASE ?? '/static/';
type ImgSection = 'google-images' | 'gpt-images';
const OPEN_KEY = 'lib:img-accordion-open';
const IMG_SECTIONS: ImgSection[] = ['google-images', 'gpt-images'];

/** Градация цвета под шкалу 0.80–1.00 (серый → зелёный) */
function scoreToneClass(score?: number | null) {
  if (score == null || Number.isNaN(score)) return 'text-muted-foreground';
  if (score < 0.8) return 'text-muted-foreground';
  if (score < 0.86) return 'text-zinc-500';
  if (score < 0.9) return 'text-emerald-500';
  if (score < 0.95) return 'text-emerald-600';
  return 'text-emerald-700';
}

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
        legacy === 'google-images' || legacy === 'gpt-images' ? [legacy] : ([] as ImgSection[]),
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

/** Бейдж подтверждения ES с поддержкой клика для админа */
const EsBadge = ({
  researched,
  isAdmin,
  onToggle,
  saving,
}: {
  researched: boolean;
  isAdmin: boolean;
  onToggle: () => void;
  saving: boolean;
}) => {
  const baseCls =
    'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium border';

  const toneCls = researched
    ? 'bg-blue-600 text-white border-blue-600'
    : 'bg-muted text-muted-foreground border-muted-foreground/30';

  const title = researched ? 'Подтверждено ИРБИСТЕХ' : 'Еще не подтверждено';
  const asButton = isAdmin && !saving ? 'cursor-pointer hover:opacity-90' : 'cursor-default';

  return (
    <button
      type="button"
      disabled={!isAdmin || saving}
      onClick={isAdmin ? onToggle : undefined}
      className={cn(baseCls, toneCls, asButton)}
      title={title}
      aria-pressed={researched}>
      {saving ? 'Сохранение…' : researched ? 'Подтверждено ИРБИСТЕХ' : 'Еще не подтверждено'}
    </button>
  );
};

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

  /** Держим GPT открытой с первого рендера, если в памяти была открыта */
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

  // CS — «Эффективность очистки (GPT)»
  const cs = equipment.clean_score ?? null;

  // ES — числовое значение и флаг «подтверждено»
  const es: number | null = equipment.equipment_score ?? null;
  const esRealRaw: number | null =
    typeof equipment.equipment_score_real === 'number' ? equipment.equipment_score_real : 0;

  // локальный флаг подтверждения (0 -> false, 1 -> true)
  const [esConfirmed, setEsConfirmed] = useState<boolean>(esRealRaw !== 0);
  useEffect(() => setEsConfirmed(esRealRaw !== 0), [esRealRaw, equipment?.id]);

  // Проверка админа
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setIsAdmin(!!data?.user?.is_admin);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { onEsConfirmChange } = arguments[0] as EquipmentCardProps;
  // Оптимистичный тоггл + подстраховка ответом
  const [savingEs, setSavingEs] = useState(false);
  const toggleEsConfirm = async () => {
    if (!equipment?.id || savingEs) return;
    const want = !esConfirmed;

    // 1) оптимистично меняем локально
    setEsConfirmed(want);
    setSavingEs(true);

    try {
      const r = await fetch(`/api/equipment/${equipment.id}/es-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ confirmed: want }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${r.status}`);
      }
      const data = await r.json();
      // 2) сервер возвращает 0/1 — приводим к boolean
      const confirmedServer = !!Number(data?.equipment_score_real);
      setEsConfirmed(confirmedServer);
      onEsConfirmChange?.(equipment.id, confirmedServer);
    } catch (e) {
      console.error('Failed to toggle ES confirm:', e);
      // 3) откат оптимистичного апдейта
      setEsConfirmed((prev) => !prev);
    } finally {
      setSavingEs(false);
    }
  };

  const fmt = (v: number | null) => (v == null ? 'N/A' : v.toFixed(2));
  const Sep = () => <div className="h-px bg-border my-2" />;

  // Заголовок окрашиваем по CS (новая шкала 0.80–1.00)
  const titleToneCls = scoreToneClass(cs);

  const q = equipment.equipment_name?.trim() ?? '';
  const googleImagesUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
  const googleTextUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;

  const blueBtn =
    'border border-blue-500 text-blue-600 bg-blue-50 hover:bg-blue-100 active:scale-[.98] transition justify-center';

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
      const [a, b] = await Promise.all(urls.map((u) => probe(u)));
      if (cancelled) return;
      setGptAvailable(!!(a || b));
    })();

    return () => {
      cancelled = true;
    };
  }, [equipment?.id]);

  /** Реакция на изменение доступности GPT */
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

  /** Значение для аккордеона */
  const accordionValue =
    (openSections?.filter((s) => {
      if (s !== 'gpt-images') return true;
      if (gptAvailable === true) return true;
      if (gptAvailable === null && wantGptFromMemoryRef.current) return true;
      return false;
    }) as ImgSection[]) ?? [];

  const [showText, setShowText] = useState(false);

  const TextModalBody = () => {
    const has = (s?: string | null) => typeof s === 'string' && s.trim().length > 0;

    const Block = ({ title, value }: { title: string; value?: string | null }) =>
      has(value) ? (
        <div className="">
          <div className="font-bold">{title}</div>
          <div className="whitespace-pre-wrap break-words">{(value as string).trim()}</div>
        </div>
      ) : null;

    const ListBlock = ({ title, items }: { title: string; items?: string[] | null }) => {
      const arr = (items ?? []).map((x) => (x ?? '').trim()).filter(Boolean);
      if (arr.length === 0) return null;
      return (
        <div className="">
          <div className="font-bold">{title}</div>
          <ul className="list-disc pl-4 space-y-0.5">
            {arr.map((g, i) => (
              <li key={`${g}-${i}`} className="break-words">
                {g}
              </li>
            ))}
          </ul>
        </div>
      );
    };

    // >>> УЖАТЫЙ список ОКВЭД в модальном тексте
    const OkvedBlock = () => {
      if (!Array.isArray(okvedList) || okvedList.length === 0) return null;
      return (
        <div className="space-y-0.5 text-[11px] leading-4">
          <div className="font-bold">Примеры основных ОКВЭД в исследуемой отрасли</div>
          <ul className="list-disc pl-4 space-y-0.5">
            {okvedList.map((row) => (
              <li key={row.id} className="break-words">
                {row.okved_code} — {row.okved_main}
              </li>
            ))}
          </ul>
        </div>
      );
    };

    return (
      <div className="text-[13px] leading-6">
        {has(equipment.equipment_name) && (
          <div className="font-bold">{equipment.equipment_name!.trim()}</div>
        )}

        <Block title="Описание устройства" value={equipment.description} />

        {/* Проблемы оборудования */}
        <Block title="Загрязнения" value={equipment.contamination} />
        <Block title="Поверхности" value={equipment.surface} />
        <Block title="Проблемы от загрязнений" value={equipment.problems} />

        {/* Традиционная очистка и криобластинг */}
        <Block title="Традиционная очистка" value={equipment.old_method} />
        <Block title="Недостатки от традиционной очистки" value={equipment.old_problem} />
        <Block title="Преимущества от криобластинга" value={equipment.benefit} />

        {(has(equipment.decision_pr) ||
          has(equipment.decision_prs) ||
          has(equipment.decision_operator) ||
          has(equipment.decision_proc)) && (
          <div className="space-y-1">
            <div className="font-bold">Центр принятия решений</div>
            <Block title="ЛПР" value={equipment.decision_pr} />
            <Block title="Прескриптор" value={equipment.decision_prs} />
            <Block title="Эксплуатация" value={equipment.decision_operator} />
            <Block title="Закупка" value={equipment.decision_proc} />
          </div>
        )}

        <OkvedBlock />

        <ListBlock title="Примеры товаров" items={equipment.goods_examples} />

        {(has(equipment.company_name) || has(equipment.site_description)) && (
          <div className="space-y-1">
            <div className="font-bold">Пример компании</div>
            {has(equipment.company_name) && (
              <div className="break-words">{equipment.company_name!.trim()}</div>
            )}
            {has(equipment.site_description) && (
              <div className="whitespace-pre-wrap break-words">
                {equipment.site_description!.trim()}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ==== ЗАГРУЗКА ОКВЭД по оборудованию ====
  const [okvedList, setOkvedList] = useState<OkvedByEquipment[]>([]);
  const [okvedLoading, setOkvedLoading] = useState(false);

  /** Текст для копирования (plain text), совпадает по структуре с визуалом */
  const buildCopyText = (): string => {
    const lines: string[] = [];

    const add = (label: string, value?: string | null) => {
      if (!value) return;
      const l = label.trim();
      const v = value.trim();
      if (!v) return;
      lines.push(l);
      lines.push(v);
    };

    const addList = (label: string, arr?: string[] | null) => {
      if (!arr || arr.length === 0) return;
      lines.push(label.trim());
      for (const it of arr) {
        const s = String(it ?? '').trim();
        if (s) lines.push(`- ${s}`);
      }
    };

    // Заголовок
    if (equipment.equipment_name?.trim()) {
      lines.push(equipment.equipment_name.trim());
    }

    // Блоки "в строку", без пустых разделителей
    add('Описание устройства', equipment.description);

    add('Загрязнения', equipment.contamination);
    add('Поверхности', equipment.surface);
    add('Проблемы от загрязнений', equipment.problems);

    add('Традиционная очистка', equipment.old_method);
    add('Недостатки от традиционной очистки', equipment.old_problem);
    add('Преимущества от криобластинга', equipment.benefit);

    if (
      equipment.decision_pr ||
      equipment.decision_prs ||
      equipment.decision_operator ||
      equipment.decision_proc
    ) {
      // Заголовок секции
      lines.push('Центр принятия решений');
      add('ЛПР', equipment.decision_pr);
      add('Прескриптор', equipment.decision_prs);
      add('Эксплуатация', equipment.decision_operator);
      add('Закупка', equipment.decision_proc);
    }

    if (Array.isArray(okvedList) && okvedList.length > 0) {
      lines.push('Примеры основных ОКВЭД в исследуемой отрасли');
      for (const row of okvedList) {
        const code = row.okved_code?.trim();
        const name = row.okved_main?.trim();
        if (code && name) lines.push(`- ${code} — ${name}`);
        else if (code) lines.push(`- ${code}`);
        else if (name) lines.push(`- ${name}`);
      }
    }

    addList('Примеры товаров', equipment.goods_examples || undefined);

    if (equipment.company_name || equipment.site_description) {
      lines.push('Пример компании');
      if (equipment.company_name?.trim()) lines.push(equipment.company_name.trim());
      if (equipment.site_description?.trim()) lines.push(equipment.site_description.trim());
    }

    // Финальная чистка
    return lines
      .map((l) =>
        l
          .replace(/\u00A0/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .trim(),
      )
      .filter((l) => l.length > 0)
      .join('\n');
  };

  useEffect(() => {
    const id = equipment?.id;
    if (!id) {
      setOkvedList([]);
      return;
    }
    let cancelled = false;
    setOkvedLoading(true);
    fetch(`/api/equipment/${id}/okved`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setOkvedList(Array.isArray(d.items) ? d.items : []);
      })
      .finally(() => {
        if (!cancelled) setOkvedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [equipment?.id]);

  return (
    <div className="space-y-4 pb-[1cm]">
      <Card>
        <CardHeader className="p-3 sm:p-4 pb-2">
          <CardTitle
            className={cn('text-base font-semibold leading-6 transition-colors', titleToneCls)}>
            {equipment.equipment_name}
          </CardTitle>

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium border',
                scoreToneClass(cs),
              )}
              title={`Эффективность очистки (GPT): ${fmt(cs)}`}>
              Эффективность очистки (GPT): {fmt(cs)}
            </span>

            <EsBadge
              researched={esConfirmed}
              isAdmin={isAdmin}
              onToggle={toggleEsConfirm}
              saving={savingEs}
            />

            {/* ID */}
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
                if (gptAvailable !== true) {
                  filtered = filtered.filter((x) => x !== 'gpt-images');
                }
                setOpenSections(filtered);
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
          <div className="flex flex-wrap items-center gap-1.5 pb-1">
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
            </Button>{' '}
            <Button size="sm" onClick={() => setShowText(true)} className={blueBtn}>
              ТЕКСТ
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

          <Sep />

          {/* ==== ОКВЭД: компактная таблица ==== */}
          <div className="space-y-1.5">
            <div className="text-sm font-semibold">
              Примеры основных ОКВЭД в исследуемой отрасли
            </div>

            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-[11px] leading-4">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-1 py-0.5 w-[30px] "></th>
                    <th className="px-1 py-0.5 w-[40px]">Код</th>
                    <th className="px-1 py-0.5">Наименование</th>
                  </tr>
                </thead>
                <tbody>
                  {okvedLoading && (
                    <tr>
                      <td colSpan={3} className="px-2 py-3 text-center text-muted-foreground">
                        Загрузка…
                      </td>
                    </tr>
                  )}

                  {!okvedLoading && okvedList.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-2 py-3 text-center text-muted-foreground">
                        Нет данных
                      </td>
                    </tr>
                  )}

                  {!okvedLoading &&
                    okvedList.map((row) => (
                      <tr key={row.id} className="border-t hover:bg-muted/40 leading-4">
                        <td className="px-0.5 py-0">
                          {/* Переход на вкладку ОКВЭД с выбранным кодом */}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Открыть вкладку ОКВЭД"
                            onClick={() =>
                              window.open(
                                `/library?tab=okved&okved=${encodeURIComponent(row.okved_code)}`,
                                '_blank',
                              )
                            }>
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                        <td className="px-1 py-0.5 font-medium whitespace-nowrap">
                          {row.okved_code}
                        </td>
                        <td className="px-1 py-0.5">{row.okved_main}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <Sep />

          {/* Примеры товаров */}
          {Array.isArray(equipment.goods_examples) && equipment.goods_examples.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-sm font-semibold">Примеры товаров</div>
              <div className="flex flex-wrap gap-1.5">
                {equipment.goods_examples.map((g, i) => (
                  <span
                    key={`${g}-${i}`}
                    className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-4 text-muted-foreground bg-background"
                    title={g}>
                    {g}
                  </span>
                ))}
              </div>
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

      {/* ТЕКСТ  */}
      {showText && (
        <BigModal title="Текст" onClose={() => setShowText(false)} copyText={buildCopyText()}>
          <TextModalBody />
        </BigModal>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
    if (copyText != null) return copyText.trim();
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
        className="absolute left-1/2 top-1/2 w-[min(1100px,100vw-32px)] max-h-[calc(100vh-32px)]
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

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 text-[13px] leading-6 whitespace-pre-wrap break-words">
          {normalizedDisplay ? normalizedDisplay : typeof children !== 'string' ? children : null}
        </div>
      </div>
    </div>
  );
}

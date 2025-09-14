'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink, X, Copy, Clipboard } from 'lucide-react';
import { EquipmentDetail } from '@/lib/validators';
import { useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { GoogleImagesCarousel } from './google-images-carousel';

interface EquipmentCardProps {
  equipment: EquipmentDetail;
}

export function EquipmentCard({ equipment }: EquipmentCardProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showUtp, setShowUtp] = useState(false);
  const [showMail, setShowMail] = useState(false);
  const [copied, setCopied] = useState<'utp' | 'mail' | null>(null);

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

  const copy = async (text: string | null | undefined, kind: 'utp' | 'mail') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1200);
    } catch {}
  };

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

          {/* Картинки из Google — без текста, с предзагрузкой */}
          {q && <GoogleImagesCarousel query={q} height={180} visible={3} />}

          {/* Изображения из базы (если есть) */}
          {imageUrls.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {imageUrls.map((url, idx) => (
                <button
                  key={idx}
                  className="relative aspect-[4/3] bg-muted rounded-md overflow-hidden hover:ring-1 hover:ring-primary/40"
                  onClick={() => setSelectedImage(url)}>
                  <Image
                    src={url}
                    alt={`${equipment.equipment_name} ${idx + 1}`}
                    fill
                    sizes="33vw"
                    className="object-cover"
                    unoptimized
                    onError={(e) => ((e.target as any).style = 'display:none')}
                  />
                </button>
              ))}
            </div>
          )}

          <Sep />

          {/* Проблемы оборудования — 3 колонки с фоном как на скрине */}
          <div className="space-y-1.5">
            <div className="text-sm font-semibold">Проблемы оборудования</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <ColColored title="Загрязнения" text={equipment.contamination} />
              <ColColored title="Поверхности" text={equipment.surface} />
              <ColColored title="Проблемы от загрязнений" text={equipment.problems} />
            </div>
          </div>

          <Sep />

          {/* Традиционная очистка и криобластинг — 3 колонки с фоном */}
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

          {/* Ряд 1 — только УТП и Письмо */}
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setShowUtp(true)}>
              📣 УТП
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowMail(true)}>
              ✉ Письмо
            </Button>
          </div>

          {/* Ряд 2 — остальные кнопки */}
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" asChild>
              <a href={googleImagesUrl} target="_blank" rel="noopener noreferrer">
                Картинки Google
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={googleTextUrl} target="_blank" rel="noopener noreferrer">
                Описание Google
              </a>
            </Button>
            {/* Компания — кнопка без ссылки */}
            <Button variant="outline" size="sm" disabled={!equipment.company_id}>
              Компания
            </Button>
          </div>

          <Sep />

          {/* Центр принятия решений — 4 колонки */}
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

      {/* Лайтбокс изображений */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}>
          <div className="relative w-[90vw] h-[90vh]">
            <Image
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

      {/* Модалка УТП */}
      {showUtp && (
        <BigModal title="УТП" onClose={() => setShowUtp(false)}>
          <div className="prose prose-sm max-w-none">
            <p className="whitespace-pre-wrap leading-7">{equipment.utp_post ?? '—'}</p>
          </div>
        </BigModal>
      )}

      {/* Модалка Письмо */}
      {showMail && (
        <BigModal title="Письмо" onClose={() => setShowMail(false)}>
          <div className="prose prose-sm max-w-none">
            <p className="whitespace-pre-wrap leading-7">
              {equipment.utp_mail ?? equipment.benefit ?? '—'}
            </p>
          </div>
        </BigModal>
      )}
    </div>
  );
}

/** Колонка с выделением фоном (как на скрине) */
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

function BigModal({
  title,
  onClose,
  children,
  copyText,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  copyText?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    const text = copyText?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // безопасный фоллбэк без https/без clipboard API
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
                      bg-background shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyToClipboard}
              title="Скопировать"
              aria-label="Скопировать"
              className="rounded-md border border-blue-500 text-blue-600 bg-blue-50 p-1.5
                         hover:bg-blue-100 active:scale-[.98] transition">
              <Copy className="h-5 w-5" />
            </button>
            <div className="text-lg font-semibold">{title}</div>
            {copied && (
              <span className="ml-1 text-xs text-emerald-600 select-none">Скопировано</span>
            )}
          </div>

          <button
            type="button"
            className="inline-flex items-center rounded-md border bg-background p-1.5
                       hover:bg-accent"
            onClick={onClose}
            aria-label="Закрыть">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

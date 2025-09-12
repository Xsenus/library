'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ExternalLink, Image as ImageIcon, Globe } from 'lucide-react'; // ← добавили Globe
import { EquipmentDetail } from '@/lib/validators';
import { useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface EquipmentCardProps {
  equipment: EquipmentDetail;
}

export function EquipmentCard({ equipment }: EquipmentCardProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const imageUrls = equipment.images_url
    ? equipment.images_url
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean)
    : [];

  const cs = equipment.clean_score ?? null;
  const es = equipment.equipment_score ?? null;
  const esr = equipment.equipment_score_real ?? es ?? null;

  const fmt = (v: number | null) => (v == null ? 'N/A' : v.toFixed(2));

  const ScorePill = ({
    label,
    value,
    tone,
  }: {
    label: 'CS' | 'ES' | 'ESR';
    value: number | null;
    tone: 'cs' | 'es' | 'esr';
  }) => {
    const base =
      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium tabular-nums';
    const cls =
      tone === 'es'
        ? 'bg-zinc-600 text-white border border-transparent hover:bg-zinc-700'
        : tone === 'cs' && value != null && value >= 0.95
        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-900/40'
        : 'bg-muted text-muted-foreground border border-transparent';
    return (
      <span
        className={cn(base, cls)}
        title={`${label}: ${value != null ? value.toFixed(2) : 'N/A'}`}>
        {label}: {fmt(value)}
      </span>
    );
  };

  // Google search links
  const q = encodeURIComponent(equipment.equipment_name);
  const googleImagesUrl = `https://www.google.com/search?tbm=isch&q=${q}`;
  const googleTextUrl = `https://www.google.com/search?q=${q}`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{equipment.equipment_name}</CardTitle>

          {/* Scores */}
          <div className="flex flex-wrap items-center gap-1.5">
            <ScorePill label="CS" value={cs} tone="cs" />
            <ScorePill label="ES" value={es} tone="es" />
            <ScorePill label="ESR" value={esr} tone="esr" />
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Images Gallery */}
          {imageUrls.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-semibold flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                Изображения
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {imageUrls.map((url, index) => (
                  <button
                    key={index}
                    className="relative aspect-square bg-gray-100 rounded-md overflow-hidden hover:shadow-md transition-shadow"
                    onClick={() => setSelectedImage(url)}
                    title="Открыть изображение">
                    <Image
                      src={url}
                      alt={`${equipment.equipment_name} ${index + 1}`}
                      fill
                      sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 25vw"
                      className="object-cover"
                      unoptimized
                      onError={(e) => {
                        (e.target as any).style = 'display:none';
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          <div className="space-y-2">
            <h3 className="font-semibold">Описание устройства</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{equipment.description}</p>
            {equipment.description_url && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={equipment.description_url ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Источник
                </a>
              </Button>
            )}
          </div>

          <Separator />

          {/* Contamination */}
          <div className="space-y-2">
            <h3 className="font-semibold">Загрязнения</h3>
            <p className="text-sm text-muted-foreground">{equipment.contamination}</p>
          </div>

          <Separator />

          {/* Surface */}
          <div className="space-y-2">
            <h3 className="font-semibold">Поверхности</h3>
            <p className="text-sm text-muted-foreground">{equipment.surface}</p>
          </div>

          <Separator />

          {/* Problems */}
          <div className="space-y-2">
            <h3 className="font-semibold">Проблемы от загрязнений</h3>
            <p className="text-sm text-muted-foreground">{equipment.problems}</p>
          </div>

          <Separator />

          {/* Traditional cleaning */}
          <div className="space-y-2">
            <h3 className="font-semibold">Традиционная очистка</h3>
            <p className="text-sm text-muted-foreground">{equipment.old_method}</p>
          </div>

          <Separator />

          {/* Traditional drawbacks */}
          <div className="space-y-2">
            <h3 className="font-semibold">Недостатки от традиционной очистки</h3>
            <p className="text-sm text-muted-foreground">{equipment.old_problem}</p>
          </div>

          <Separator />

          {/* Benefits */}
          <div className="space-y-2">
            <h3 className="font-semibold">Преимущества от криобластинга</h3>
            <p className="text-sm text-muted-foreground">{equipment.benefit}</p>
          </div>

          <Separator />

          {/* УТП */}
          <div className="space-y-3">
            <h3 className="font-semibold">УТП</h3>

            {/* Опционально показываем utp_post, если есть */}
            {equipment.utp_post && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {equipment.utp_post}
              </p>
            )}

            <div className="space-y-2">
              <div>
                <h4 className="text-sm font-medium">Русские синонимы:</h4>
                <p className="text-sm text-muted-foreground">{equipment.synonyms_ru}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium">Английские синонимы:</h4>
                <p className="text-sm text-muted-foreground">{equipment.synonyms_en}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Письмо — из utp_mail, fallback на benefit */}
          <div className="space-y-2">
            <h3 className="font-semibold">Письмо</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {equipment.utp_mail ?? equipment.benefit ?? '—'}
            </p>
          </div>

          <Separator />

          {/* Кнопки */}
          <div className="flex flex-wrap gap-2">
            {/* Картинки Google */}
            <Button variant="outline" size="sm" asChild>
              <a href={googleImagesUrl} target="_blank" rel="noopener noreferrer">
                <Globe className="h-3 w-3 mr-1" />
                Картинки Google
              </a>
            </Button>

            {/* Описание Google */}
            <Button variant="outline" size="sm" asChild>
              <a href={googleTextUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3 mr-1" />
                Описание Google
              </a>
            </Button>

            {/* Компания */}
            <Button variant="outline" size="sm" asChild disabled={!equipment.company_id}>
              <a href={equipment.company_id ? `/companies/${equipment}` : undefined}>Компания</a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Лайтбокс изображений — как было */}
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
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { GptImagePair } from './gpt-image-pair';

const TONES = {
  old: 'text-[#ef944d]',
  cryo: 'text-[#ef944d]',
} as const;

type Props = {
  equipmentId?: number | null;
  imagesFromDb: string[];
};

export function EmbedImagesSection({ equipmentId, imagesFromDb }: Props) {
  const [open, setOpen] = useState<string | undefined>('gpt');
  const [gptAvailable, setGptAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    setOpen('gpt');
    setGptAvailable(null);
  }, [equipmentId]);

  const normalizedImages = useMemo(
    () => imagesFromDb.filter((url) => url.trim().length > 0),
    [imagesFromDb],
  );

  const hasDbImages = normalizedImages.length > 0;

  return (
    <div className="space-y-2">
      <Accordion
        type="single"
        collapsible
        value={gptAvailable === false ? undefined : open}
        onValueChange={(value) => setOpen(typeof value === 'string' ? value : undefined)}
        className="rounded-md border border-slate-200"
      >
        <AccordionItem value="gpt" className="border-0">
          <AccordionTrigger
            className={cn(
              'px-4 text-sm font-medium',
              gptAvailable === false && 'opacity-50 pointer-events-none select-none',
            )}
            onClick={gptAvailable === false ? (event) => event.preventDefault() : undefined}
            aria-disabled={gptAvailable === false}
          >
            Картинки
          </AccordionTrigger>
          <AccordionContent className="px-4">
            <div className="space-y-4 pt-2">
              <GptImagePair
                equipmentId={equipmentId}
                labelTone={TONES}
                className="md:grid-cols-2"
                onStatusChange={(status) => {
                  const available = status.old || status.cryo;
                  setGptAvailable(available);
                  if (!available) {
                    setOpen(undefined);
                  }
                }}
              />

              {hasDbImages && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {normalizedImages.map((url, idx) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`${url}-${idx}`}
                      src={url}
                      alt={`Изображение оборудования ${idx + 1}`}
                      className="h-40 w-full rounded-md border border-slate-200 object-cover"
                      loading="lazy"
                    />
                  ))}
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {gptAvailable === false && !hasDbImages && (
        <div className="text-xs text-muted-foreground">Нет доступных изображений.</div>
      )}
    </div>
  );
}

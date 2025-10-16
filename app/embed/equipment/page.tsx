import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getEquipmentDetailByPublicHash,
  getOkvedForEquipment,
} from '@/lib/equipment';
import { equipmentPublicHashSchema, type EquipmentDetail } from '@/lib/validators';
import { cn } from '@/lib/utils';
import { EmbedImagesSection } from '@/components/library/embed-images-section';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function toParam(value?: string | string[] | null): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

function Section({ title, children }: { title: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {children}
    </div>
  );
}

function TextBlock({ value }: { value?: string | null }) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return <p className="text-sm leading-6 text-slate-600 whitespace-pre-wrap">{trimmed}</p>;
}

function ColoredTile({ title, text, emphasize }: { title: string; text?: string | null; emphasize?: boolean }) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    <div
      className={cn(
        'rounded-md border p-3 bg-slate-100',
        emphasize ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200',
      )}>
      <div className="text-xs font-semibold text-slate-800">{title}</div>
      <p className="mt-1 text-xs leading-5 text-slate-600 whitespace-pre-wrap">{trimmed}</p>
    </div>
  );
}

function DecisionRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-xs text-slate-700 mt-0.5">{trimmed}</div>
    </div>
  );
}

function GoodsList({ items }: { items?: string[] | null }) {
  const normalized = (items ?? [])
    .map((item) => (item ?? '').trim())
    .filter((item) => item.length > 0);
  if (normalized.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {normalized.map((item, idx) => (
        <span
          key={`${item}-${idx}`}
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-4 text-muted-foreground bg-background"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function OkvedList({
  items,
}: {
  items: { id: number; okved_code: string; okved_main: string }[];
}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <table className="w-full text-[11px] leading-4">
        <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-2 py-1 w-[70px] font-medium">Код</th>
            <th className="px-2 py-1 font-medium">Наименование</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id} className="border-t border-slate-200/80 hover:bg-muted/40">
              <td className="px-2 py-1 font-medium text-slate-900 whitespace-nowrap">{row.okved_code}</td>
              <td className="px-2 py-1 text-slate-700">{row.okved_main}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatImages(raw?: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

function SimpleMessage({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardContent className="py-10 text-center text-slate-600">{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}

export default async function EquipmentEmbedPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const hashParam =
    toParam(searchParams?.hash_equipment) ??
    toParam(searchParams?.equipment_hash) ??
    toParam(searchParams?.hash);

  if (!hashParam) {
    return <SimpleMessage>Укажите параметр hash_equipment в запросе.</SimpleMessage>;
  }

  const parsedHash = equipmentPublicHashSchema.safeParse({ hash: hashParam });
  if (!parsedHash.success) {
    return <SimpleMessage>Некорректный идентификатор оборудования.</SimpleMessage>;
  }

  const equipment: EquipmentDetail | null = await getEquipmentDetailByPublicHash(parsedHash.data.hash);

  if (!equipment) {
    return <SimpleMessage>Оборудование не найдено.</SimpleMessage>;
  }

  const okvedItems = await getOkvedForEquipment(equipment.id);
  const imagesFromDb = formatImages(equipment.images_url);

  return (
    <main className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="space-y-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-xl font-semibold text-slate-900">
              <span className="leading-tight">
                {equipment.equipment_name ?? 'Карточка оборудования'}
              </span>
              {equipment.id ? (
                <span className="text-sm font-normal text-slate-400">ID {equipment.id}</span>
              ) : null}
            </CardTitle>
            {equipment.description_url && (
              <Link
                href={equipment.description_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline">
                Перейти к источнику описания
              </Link>
            )}
          </CardHeader>

          <CardContent className="space-y-8">
            <Section title="Описание устройства">
              <TextBlock value={equipment.description} />
            </Section>

            {/*
              В оригинальной карточке здесь есть аккордеон с картинками Google.
              Для встраиваемого фрейма его временно отключаем, чтобы отличаться от основной версии.
              При необходимости вернуть можно раскомментировать секцию ниже и подключить тот же компонент.

            <Section title="Картинки Google">
              <GoogleImagesAccordion equipment={equipment} />
            </Section>
            */}

            <EmbedImagesSection equipmentId={equipment.id ?? undefined} imagesFromDb={imagesFromDb} />

            <Section title="Проблемы оборудования">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <ColoredTile title="Загрязнения" text={equipment.contamination} />
                <ColoredTile title="Поверхности" text={equipment.surface} />
                <ColoredTile title="Проблемы от загрязнений" text={equipment.problems} />
              </div>
            </Section>

            <Section title="Традиционная очистка vs крио-очистка">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <ColoredTile title="Традиционная очистка" text={equipment.old_method} />
                <ColoredTile title="Недостатки традиционной очистки" text={equipment.old_problem} />
                <ColoredTile title="Преимущества крио-очистки" text={equipment.benefit} emphasize />
              </div>
            </Section>

            {/**
             * Дополнительные секции временно скрыты из встраиваемой версии.
             * При необходимости можно вернуть, раскомментировав блоки ниже.
             */}
            {/**
            <Section title="Центр принятия решений">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DecisionRow label="ЛПР" value={equipment.decision_pr} />
                <DecisionRow label="Прескриптор" value={equipment.decision_prs} />
                <DecisionRow label="Эксплуатация" value={equipment.decision_operator} />
                <DecisionRow label="Закупка" value={equipment.decision_proc} />
              </div>
            </Section>

            <Section title="Примеры основных ОКВЭД в исследуемой отрасли">
              <OkvedList items={okvedItems} />
            </Section>

            <Section title="Примеры товаров">
              <GoodsList items={equipment.goods_examples ?? undefined} />
            </Section>

            <Section title="Пример компании">
              <div className="space-y-1 text-sm text-slate-700">
                {equipment.company_name && <div className="font-medium text-slate-900">{equipment.company_name}</div>}
                <TextBlock value={equipment.site_description} />
              </div>
            </Section>
            */}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

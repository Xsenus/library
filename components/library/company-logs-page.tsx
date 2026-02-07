'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Download, FileText, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import type { AiDebugEventRecord } from '@/lib/ai-debug';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';

function formatLogDate(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return { date: '—', time: '—' };
  return {
    date: dt.toLocaleDateString('ru-RU'),
    time: dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

function formatCompanyDisplayName(name?: string | null, companyId?: number | null) {
  const prefix = companyId != null && Number.isFinite(companyId) ? `[${companyId}] ` : '';
  return `${prefix}${name ?? 'Компания'}`;
}

function describeLogEvent(event: AiDebugEventRecord): string {
  if (event.event_type === 'error') return 'Ошибка';
  if (event.event_type === 'notification') return 'Уведомление';
  if (event.event_type === 'request') return event.direction === 'response' ? 'Ответ' : 'Запрос';
  return 'Ответ';
}

function summarizePayload(payload: any): string[] {
  if (!payload) return [];
  if (typeof payload === 'string') return [payload];

  const summary: string[] = [];
  const maybeNumber = (value: any) => (Number.isFinite(Number(value)) ? Number(value) : null);

  if (Array.isArray(payload.inns) && payload.inns.length) summary.push(`ИНН: ${payload.inns.join(', ')}`);
  if (payload.error) summary.push(`Ошибка: ${String(payload.error)}`);
  if (payload.status != null) summary.push(`Статус: ${payload.status}`);
  if (payload.stopRequested) summary.push('Запрошена остановка');
  if (payload.defer_count != null) summary.push(`Попытка: ${payload.defer_count}`);
  if (payload.progress != null) {
    const pct = maybeNumber(payload.progress);
    summary.push(`Прогресс: ${pct != null ? Math.round(pct * 100) + '%' : payload.progress}`);
  }
  if (payload.durationMs != null) {
    const seconds = maybeNumber(payload.durationMs) ? maybeNumber(payload.durationMs)! / 1000 : null;
    summary.push(`Длительность: ${seconds != null ? seconds.toFixed(1) + ' c' : payload.durationMs}`);
  }
  if (Array.isArray(payload.results)) summary.push(`Результаты: ${payload.results.length}`);
  if (payload.request) summary.push(`Запрос: ${String(payload.request).slice(0, 80)}`);

  if (!summary.length) {
    const json = JSON.stringify(payload);
    if (json) summary.push(json.length > 180 ? `${json.slice(0, 180)}…` : json);
  }

  return summary;
}

type JsonState = { open: boolean; title: string; payload: any };
type FileSplitMode = 'single' | 'separate';
type ArchiveMode = 'none' | 'single' | 'per-file';

function downloadJsonFile(payload: any, fileName: string) {
  const json = JSON.stringify(payload ?? {}, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function encodeTarString(value: string, length: number) {
  const bytes = new Uint8Array(length);
  const encoded = new TextEncoder().encode(value);
  bytes.set(encoded.slice(0, length - 1), 0);
  return bytes;
}

function encodeTarOctal(value: number, length: number, withTrailingSpace = false) {
  const contentLength = withTrailingSpace ? length - 2 : length - 1;
  const octal = Math.max(0, value).toString(8);
  const normalized = octal.slice(-contentLength).padStart(contentLength, '0');
  return withTrailingSpace ? `${normalized}\0 ` : `${normalized}\0`;
}

function createTarArchive(files: Array<{ name: string; content: string }>): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  files.forEach((file) => {
    const contentBytes = encoder.encode(file.content);
    const header = new Uint8Array(512);

    header.set(encodeTarString(file.name, 100), 0);
    header.set(encodeTarString(encodeTarOctal(0o644, 8), 8), 100);
    header.set(encodeTarString(encodeTarOctal(0, 8), 8), 108);
    header.set(encodeTarString(encodeTarOctal(0, 8), 8), 116);
    header.set(encodeTarString(encodeTarOctal(contentBytes.length, 12), 12), 124);
    header.set(encodeTarString(encodeTarOctal(Math.floor(Date.now() / 1000), 12), 12), 136);

    for (let i = 148; i < 156; i += 1) {
      header[i] = 0x20;
    }

    header[156] = '0'.charCodeAt(0);
    header.set(encodeTarString('ustar', 6), 257);
    header.set(encodeTarString('00', 2), 263);

    let checksum = 0;
    for (let i = 0; i < 512; i += 1) checksum += header[i];
    header.set(encodeTarString(encodeTarOctal(checksum, 8, true), 8), 148);

    chunks.push(header, contentBytes);

    const remainder = contentBytes.length % 512;
    if (remainder !== 0) {
      chunks.push(new Uint8Array(512 - remainder));
    }
  });

  chunks.push(new Uint8Array(1024));
  return new Blob(chunks, { type: 'application/x-tar' });
}

function isNumericVector(value: any): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function hasNumericValuesVector(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const maybeValues = (value as { values?: unknown }).values;
  return isNumericVector(maybeValues);
}

function stripVectorFields(payload: any): any {
  if (Array.isArray(payload)) return payload.map(stripVectorFields);
  if (!payload || typeof payload !== 'object') return payload;

  return Object.entries(payload).reduce<Record<string, any>>((acc, [key, value]) => {
    const normalizedKey = key.toLowerCase();
    const isVectorKey = normalizedKey.includes('vector');
    const isEmbeddingVector = normalizedKey.includes('embedding') && (isNumericVector(value) || hasNumericValuesVector(value));

    if (isVectorKey || isEmbeddingVector) {
      return acc;
    }

    acc[key] = stripVectorFields(value);
    return acc;
  }, {});
}

export default function CompanyLogsPage() {
  const params = useSearchParams();
  const inn = params.get('inn') ?? '';
  const name = params.get('name') ?? '';
  const companyIdRaw = params.get('companyId');
  const companyId = companyIdRaw && Number.isFinite(Number(companyIdRaw)) ? Number(companyIdRaw) : null;

  const [logs, setLogs] = useState<AiDebugEventRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonState, setJsonState] = useState<JsonState>({ open: false, title: '', payload: null });
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [includeVectors, setIncludeVectors] = useState(true);
  const [fileSplitMode, setFileSplitMode] = useState<FileSplitMode>('single');
  const [archiveMode, setArchiveMode] = useState<ArchiveMode>('none');
  const [exporting, setExporting] = useState(false);

  const displayName = useMemo(() => formatCompanyDisplayName(name, companyId), [name, companyId]);

  const createExportPayload = useCallback(
    (items: AiDebugEventRecord[]) => {
      const now = new Date();
      return {
        now,
        payload: {
          exportedAt: now.toISOString(),
          company: {
            name: name || null,
            displayName,
            inn: inn || null,
            companyId,
          },
          total: items.length,
          items,
        },
      };
    },
    [companyId, displayName, inn, name]
  );

  const exportLogs = useCallback(async () => {
    if (!logs.length || exporting) return;

    setExporting(true);
    try {
      const preparedLogs = includeVectors
        ? logs
        : logs.map((log) => ({
            ...log,
            payload: stripVectorFields(log.payload),
          }));

      const now = new Date();
      const datePart = now.toISOString().replace(/[:.]/g, '-');
      const vectorSuffix = includeVectors ? '' : '-without-vectors';
      const baseName = `company-logs-${inn || 'unknown'}-${datePart}${vectorSuffix}`;

      const files =
        fileSplitMode === 'single'
          ? [{ name: `${baseName}.json`, payload: createExportPayload(preparedLogs).payload }]
          : preparedLogs.map((log, index) => {
              const logDate = log.created_at ? log.created_at.replace(/[:.]/g, '-') : `${index + 1}`;
              return {
                name: `${baseName}-${index + 1}-${logDate}.json`,
                payload: {
                  exportedAt: now.toISOString(),
                  company: { name: name || null, displayName, inn: inn || null, companyId },
                  index: index + 1,
                  total: preparedLogs.length,
                  item: log,
                },
              };
            });

      if (archiveMode === 'none') {
        files.forEach((file) => downloadJsonFile(file.payload, file.name));
      } else if (archiveMode === 'single') {
        const tarBlob = createTarArchive(files.map((file) => ({ name: file.name, content: JSON.stringify(file.payload, null, 2) })));
        downloadBlob(tarBlob, `${baseName}.tar`);
      } else {
        files.forEach((file) => {
          const tarBlob = createTarArchive([{ name: file.name, content: JSON.stringify(file.payload, null, 2) }]);
          downloadBlob(tarBlob, file.name.replace(/\.json$/, '.tar'));
        });
      }

      setDownloadDialogOpen(false);
    } finally {
      setExporting(false);
    }
  }, [archiveMode, companyId, createExportPayload, displayName, exporting, fileSplitMode, includeVectors, inn, logs, name]);

  const fetchLogs = useCallback(async () => {
    if (!inn) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai-debug/events?companyId=${encodeURIComponent(inn)}&pageSize=200`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Не удалось загрузить логи компании');
      const data = await res.json();
      setLogs(Array.isArray(data.items) ? data.items : []);
    } catch (err: any) {
      setError(err?.message ?? 'Не удалось загрузить логи компании');
    } finally {
      setLoading(false);
    }
  }, [inn]);

  useEffect(() => {
    if (inn) {
      fetchLogs();
    }
  }, [fetchLogs, inn]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link href="/library" className="inline-flex items-center gap-1">
              <ArrowLeft className="h-3.5 w-3.5" />
              Назад к списку
            </Link>
          </div>
          <h1 className="text-xl font-semibold">Логи компании</h1>
          <div className="text-sm text-muted-foreground">
            {displayName}
            {inn ? ` · ИНН ${inn}` : ''}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setDownloadDialogOpen(true)} disabled={!logs.length}>
            <Settings2 className="h-3.5 w-3.5" />
            <span className="ml-1">Настройки скачивания</span>
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={fetchLogs} disabled={!inn || loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1">Обновить</span>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="uppercase text-muted-foreground">Логи задачи</span>
            {logs.length > 0 && (
              <span className="text-xs text-muted-foreground">Показано {logs.length} последних записей</span>
            )}
            {error && <span className="text-xs text-destructive">{error}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!inn ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Не удалось определить ИНН компании. Откройте страницу из карточки компании.
            </div>
          ) : loading && !logs.length ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем логи…
            </div>
          ) : logs.length ? (
            <div className="max-h-[70vh] divide-y overflow-y-auto rounded-lg border bg-muted/30">
              {logs.map((log) => {
                const dt = formatLogDate(log.created_at);
                const summary = summarizePayload(log.payload);
                const fileDate = log.created_at ? log.created_at.replace(/[:.]/g, '-') : 'log';
                return (
                  <div key={log.id} className="space-y-1 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge variant="outline" className="border-border/60 bg-background text-foreground">
                        {describeLogEvent(log)}
                      </Badge>
                      <span>
                        {dt.date} · {dt.time}
                      </span>
                      {log.source && <span className="text-[11px]">{log.source}</span>}
                      {log.request_id && <span className="text-[11px]">req: {log.request_id}</span>}
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="flex-1 space-y-1">
                        {log.message && <div className="text-sm text-foreground">{log.message}</div>}
                        {summary.length > 0 && (
                          <div className="text-xs text-muted-foreground">{summary.join(' · ')}</div>
                        )}
                      </div>
                      {log.payload ? (
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            aria-label="Открыть JSON"
                            title="Открыть JSON"
                            onClick={() =>
                              setJsonState({
                                open: true,
                                title: `${describeLogEvent(log)} · ${dt.date} ${dt.time}`,
                                payload: log.payload,
                              })
                            }
                          >
                            <FileText className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            aria-label="Скачать JSON"
                            title="Скачать JSON"
                            onClick={() => downloadJsonFile(log.payload, `company-log-${log.id}-${fileDate}.json`)}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Логи пока отсутствуют.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={jsonState.open} onOpenChange={(open) => !open && setJsonState({ open: false, title: '', payload: null })}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{jsonState.title || 'Детали лога'}</DialogTitle>
          </DialogHeader>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!jsonState.payload}
              onClick={() => downloadJsonFile(jsonState.payload, `company-log-${Date.now()}.json`)}
            >
              <Download className="mr-1 h-4 w-4" />
              Скачать JSON
            </Button>
          </div>
          <pre className="max-h-[70vh] overflow-auto rounded-md bg-muted/50 p-3 text-xs">
            {jsonState.payload ? JSON.stringify(jsonState.payload, null, 2) : 'Нет данных'}
          </pre>
        </DialogContent>
      </Dialog>

      <Dialog open={downloadDialogOpen} onOpenChange={(open) => !exporting && setDownloadDialogOpen(open)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Настройки скачивания логов</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 text-sm">
            <div className="rounded-lg border p-4">
              <div className="mb-2 font-medium">Содержимое</div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div>Включить векторы</div>
                  <div className="text-xs text-muted-foreground">Отключите, чтобы исключить vector/embedding поля из выгрузки.</div>
                </div>
                <Switch checked={includeVectors} onCheckedChange={setIncludeVectors} />
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="mb-2 font-medium">Формат файлов</div>
              <RadioGroup value={fileSplitMode} onValueChange={(value) => setFileSplitMode(value as FileSplitMode)} className="gap-3">
                <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2">
                  <RadioGroupItem value="single" className="mt-0.5" />
                  <span>
                    Один JSON файл
                    <div className="text-xs text-muted-foreground">Все логи собираются в единый файл.</div>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2">
                  <RadioGroupItem value="separate" className="mt-0.5" />
                  <span>
                    Разные JSON файлы
                    <div className="text-xs text-muted-foreground">Каждый лог выгружается в отдельный файл.</div>
                  </span>
                </label>
              </RadioGroup>
            </div>

            <div className="rounded-lg border p-4">
              <div className="mb-2 font-medium">Архивация</div>
              <RadioGroup value={archiveMode} onValueChange={(value) => setArchiveMode(value as ArchiveMode)} className="gap-3">
                <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2">
                  <RadioGroupItem value="none" className="mt-0.5" />
                  <span>
                    Без архива
                    <div className="text-xs text-muted-foreground">Скачивание сразу JSON файлов.</div>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2">
                  <RadioGroupItem value="single" className="mt-0.5" />
                  <span>
                    Один архив (.tar)
                    <div className="text-xs text-muted-foreground">Все JSON файлы попадут в общий архив.</div>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2">
                  <RadioGroupItem value="per-file" className="mt-0.5" />
                  <span>
                    Каждый файл в отдельный архив (.tar)
                    <div className="text-xs text-muted-foreground">Для каждого JSON создается свой архив.</div>
                  </span>
                </label>
              </RadioGroup>
            </div>

            <div className="flex justify-end">
              <Button type="button" onClick={() => void exportLogs()} disabled={!logs.length || exporting}>
                {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Скачать с выбранными настройками
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

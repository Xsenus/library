'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Download, FileText, Loader2, RefreshCw } from 'lucide-react';
import type { AiDebugEventRecord } from '@/lib/ai-debug';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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

  const displayName = useMemo(() => formatCompanyDisplayName(name, companyId), [name, companyId]);

  const downloadAllLogs = useCallback(() => {
    if (!logs.length) return;
    const now = new Date();
    const datePart = now.toISOString().replace(/[:.]/g, '-');
    downloadJsonFile(
      {
        exportedAt: now.toISOString(),
        company: {
          name: name || null,
          displayName,
          inn: inn || null,
          companyId,
        },
        total: logs.length,
        items: logs,
      },
      `company-logs-${inn || 'unknown'}-${datePart}.json`
    );
  }, [companyId, displayName, inn, logs, name]);

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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadAllLogs}
            disabled={!logs.length}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="ml-1">Скачать все логи</span>
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
    </div>
  );
}

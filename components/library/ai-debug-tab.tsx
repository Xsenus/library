'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Code2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { AiDebugEventRecord } from '@/lib/ai-debug';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type FilterKey = 'traffic' | 'error' | 'notification';

const filterOptions: { key: FilterKey; label: string }[] = [
  { key: 'traffic', label: 'Запросы/ответы' },
  { key: 'error', label: 'Ошибки' },
  { key: 'notification', label: 'Уведомления' },
];

type JsonState = { open: boolean; title: string; payload: any };

function formatDate(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return { date: '—', time: '—' };
  return {
    date: dt.toLocaleDateString('ru-RU'),
    time: dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

function iconForEvent(ev: AiDebugEventRecord) {
  if (ev.event_type === 'error') return <AlertTriangle className="h-4 w-4 text-destructive" />;
  if (ev.event_type === 'notification') return <Bell className="h-4 w-4 text-amber-500" />;
  if (ev.event_type === 'request') return <ArrowUpRight className="h-4 w-4 text-sky-600" />;
  return <ArrowDownLeft className="h-4 w-4 text-emerald-600" />;
}

function describeEventType(ev: AiDebugEventRecord): string {
  if (ev.event_type === 'error') return 'Ошибка';
  if (ev.event_type === 'notification') return 'Уведомление';
  if (ev.event_type === 'request') return ev.direction === 'response' ? 'Ответ' : 'Запрос';
  return 'Ответ';
}

function extractText(payload: any): string | undefined {
  if (!payload) return undefined;
  if (typeof payload === 'string') return payload;
  if (typeof payload?.text === 'string') return payload.text;
  if (typeof payload?.response === 'string') return payload.response;
  return undefined;
}

function summarizePayload(payload: any): string[] {
  if (!payload) return [];
  if (typeof payload === 'string') return [payload];

  const summary: string[] = [];

  const maybeNumber = (value: any) => (Number.isFinite(Number(value)) ? Number(value) : null);

  if (Array.isArray(payload.inns) && payload.inns.length) {
    summary.push(`ИНН: ${payload.inns.join(', ')}`);
  }
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
  if (Array.isArray(payload.results)) {
    summary.push(`Результаты: ${payload.results.length}`);
  }
  if (payload.request) summary.push(`Запрос: ${String(payload.request).slice(0, 80)}`);

  if (!summary.length) {
    const json = JSON.stringify(payload);
    if (json) summary.push(json.length > 180 ? `${json.slice(0, 180)}…` : json);
  }

  return summary;
}

function openText(text: string | undefined) {
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type AiDebugTabProps = { isAdmin?: boolean };

export default function AiDebugTab({ isAdmin = false }: AiDebugTabProps) {
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    traffic: true,
    error: true,
    notification: true,
  });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [items, setItems] = useState<AiDebugEventRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonState, setJsonState] = useState<JsonState>({ open: false, payload: null, title: '' });

  const activeCategories = useMemo(
    () =>
      (Object.entries(filters) as [FilterKey, boolean][]) // keep the filter order
        .filter(([, enabled]) => enabled)
        .map(([key]) => key),
    [filters],
  );

  const fetchData = useCallback(async (pageOverride?: number) => {
    const pageToLoad = pageOverride ?? page;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(pageToLoad), pageSize: String(pageSize) });
      activeCategories.forEach((cat) => params.append('category', cat));
      const res = await fetch(`/api/ai-debug/events?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: AiDebugEventRecord[]; total: number; page: number; pageSize: number };
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total ?? 0));
      setPage(data.page ?? pageToLoad);
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось загрузить логи');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [activeCategories, page, pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleClear = useCallback(async () => {
    if (!isAdmin) return;
    if (!window.confirm('Удалить все логи AI-отладки?')) return;
    setClearing(true);
    setError(null);
    try {
      const res = await fetch('/api/ai-debug/events', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchData(1);
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось удалить логи');
    } finally {
      setClearing(false);
    }
  }, [fetchData, isAdmin]);

  const toggleFilter = (key: FilterKey) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = total ? Math.min(page * pageSize, total) : 0;

  return (
    <div className="py-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          {filterOptions.map((opt) => (
            <label key={opt.key} className="flex items-center gap-2 text-sm">
              <Checkbox checked={filters[opt.key]} onCheckedChange={() => toggleFilter(opt.key)} />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Badge variant="outline" className="px-2 py-1 text-xs">
            Всего записей: {total}
          </Badge>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Обновить</span>
          </Button>
          {isAdmin && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClear}
              disabled={loading || clearing}
              title="Доступно только администратору">
              {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              <span className="ml-2">Очистить логи</span>
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border shadow-sm bg-card overflow-hidden">
        <div className="px-3 py-2 border-b bg-card text-sm font-semibold flex items-center justify-between">
          <span>Лента AI-отладки</span>
          <span className="text-xs text-muted-foreground">{total ? `Стр. ${page} из ${totalPages}` : 'Нет данных'}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-muted border-b">
              <tr className="[&>th]:px-2 [&>th]:py-2 text-left align-middle">
                <th className="w-[40px] text-center">№</th>
                <th className="w-[48px]">Тип</th>
                <th className="w-[120px]">Источник</th>
                <th className="w-[90px]">Направление</th>
                <th className="w-[110px]">Дата</th>
                <th className="w-[100px]">Время</th>
                <th className="w-[150px]">ID request</th>
                <th className="w-[140px]">ИНН</th>
                <th className="w-[240px]">Название компании</th>
                <th className="w-[260px]">Сообщение</th>
                <th className="w-[260px]">Детали</th>
                <th className="w-[160px] text-center">Действия</th>
              </tr>
            </thead>
            <tbody className="[&>tr>td]:px-2 [&>tr>td]:py-2 align-top">
              {items.map((item, idx) => {
                const { date, time } = formatDate(item.created_at);
                const text = extractText(item.payload);
                const payloadSummary = summarizePayload(item.payload);
                const rowClasses = item.event_type === 'error' ? 'bg-destructive/5' : '';
                return (
                  <tr key={item.id} className={`border-b last:border-0 ${rowClasses}`}>
                    <td className="text-center text-muted-foreground">{(page - 1) * pageSize + idx + 1}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger className="inline-flex items-center justify-center rounded-full bg-muted p-1">
                              {iconForEvent(item)}
                            </TooltipTrigger>
                            <TooltipContent>{describeEventType(item)}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <span className="whitespace-nowrap text-muted-foreground">{describeEventType(item)}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap">{item.source || '—'}</td>
                    <td className="whitespace-nowrap">{item.direction ? (item.direction === 'request' ? 'Запрос' : 'Ответ') : '—'}</td>
                    <td className="whitespace-nowrap">{date}</td>
                    <td className="whitespace-nowrap">{time}</td>
                    <td className="font-mono text-[11px] break-all" title={item.request_id || undefined}>
                      {item.request_id || '—'}
                    </td>
                    <td className="font-mono text-[11px] break-all">{item.company_id || '—'}</td>
                    <td className="max-w-[240px] truncate" title={item.company_name || undefined}>
                      {item.company_name || '—'}
                    </td>
                    <td className={`whitespace-pre-wrap leading-5 ${item.event_type === 'error' ? 'text-destructive font-medium' : ''}`} title={item.message || undefined}>
                      {item.message || '—'}
                    </td>
                    <td className="space-y-1">
                      {payloadSummary.length ? (
                        payloadSummary.map((line, lineIdx) => (
                          <div key={lineIdx} className="whitespace-pre-wrap break-words leading-5">
                            {line}
                          </div>
                        ))
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1 justify-center">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => setJsonState({ open: true, payload: item.payload, title: `JSON записи #${item.id}` })}>
                          <Code2 className="h-4 w-4" />
                          <span className="ml-1">JSON</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2"
                          disabled={!text}
                          onClick={() => openText(text)}>
                          <ExternalLink className="h-4 w-4" />
                          <span className="ml-1">Текст</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={12} className="text-center py-6 text-muted-foreground text-sm">
                    Нет записей для выбранных фильтров
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Загрузка логов…
          </div>
        )}

        {error && !loading && (
          <div className="px-3 py-2 text-sm text-destructive border-t bg-red-50/60">{error}</div>
        )}

        <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/40 text-xs">
          <span className="text-muted-foreground">
            Показано {rangeStart}–{rangeEnd} из {total}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Назад
            </Button>
            <span>
              Страница {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              Вперед
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={jsonState.open} onOpenChange={(open) => setJsonState((prev) => ({ ...prev, open }))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{jsonState.title || 'JSON'}</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
            {jsonState.payload == null ? '—' : JSON.stringify(jsonState.payload, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}

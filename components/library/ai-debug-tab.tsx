'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Code2,
  Filter,
  ExternalLink,
  Loader2,
  PanelRight,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { AiDebugEventRecord } from '@/lib/ai-debug';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type FilterKey = 'traffic' | 'error' | 'notification';

const filterOptions: { key: FilterKey; label: string }[] = [
  { key: 'traffic', label: 'Запросы/ответы' },
  { key: 'error', label: 'Ошибки' },
  { key: 'notification', label: 'Уведомления' },
];

type JsonState = { open: boolean; title: string; payload: any };

type ColumnKey =
  | 'index'
  | 'type'
  | 'source'
  | 'direction'
  | 'date'
  | 'time'
  | 'requestId'
  | 'inn'
  | 'company'
  | 'message'
  | 'details'
  | 'actions';

type ColumnSettings = Record<ColumnKey, { width: number; visible: boolean }>;

type ColumnConfig = {
  key: ColumnKey;
  label: string;
  minWidth: number;
  defaultWidth: number;
};

const columnConfigs: ColumnConfig[] = [
  { key: 'index', label: '№', minWidth: 60, defaultWidth: 70 },
  { key: 'type', label: 'Тип', minWidth: 120, defaultWidth: 130 },
  { key: 'source', label: 'Источник', minWidth: 120, defaultWidth: 140 },
  { key: 'direction', label: 'Направление', minWidth: 120, defaultWidth: 140 },
  { key: 'date', label: 'Дата', minWidth: 110, defaultWidth: 120 },
  { key: 'time', label: 'Время', minWidth: 110, defaultWidth: 120 },
  { key: 'requestId', label: 'ID request', minWidth: 180, defaultWidth: 220 },
  { key: 'inn', label: 'ИНН', minWidth: 140, defaultWidth: 170 },
  { key: 'company', label: 'Название компании', minWidth: 220, defaultWidth: 260 },
  { key: 'message', label: 'Сообщение', minWidth: 320, defaultWidth: 420 },
  { key: 'details', label: 'Детали', minWidth: 280, defaultWidth: 360 },
  { key: 'actions', label: 'Действия', minWidth: 150, defaultWidth: 170 },
];

const allowedPageSizes = [10, 20, 35, 50, 100];

const createDefaultColumnSettings = (): ColumnSettings =>
  columnConfigs.reduce((acc, col) => {
    acc[col.key] = {
      width: col.defaultWidth,
      visible: col.key === 'requestId' || col.key === 'direction' ? false : true,
    };
    return acc;
  }, {} as ColumnSettings);

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
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window === 'undefined') return 50;
    const saved = Number(localStorage.getItem('ai-debug-page-size'));
    return allowedPageSizes.includes(saved) ? saved : 50;
  });
  const [items, setItems] = useState<AiDebugEventRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonState, setJsonState] = useState<JsonState>({ open: false, payload: null, title: '' });
  const [source, setSource] = useState('');
  const [direction, setDirection] = useState<string>('all');
  const [type, setType] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [inn, setInn] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debouncedSearch = useDebounce(search, 400);
  const resizeState = useRef<{ key: ColumnKey; startX: number; startWidth: number } | null>(null);

  const [columnSettings, setColumnSettings] = useState<ColumnSettings>(() => {
    const defaults = createDefaultColumnSettings();

    if (typeof window === 'undefined') return defaults;

    const saved = localStorage.getItem('ai-debug-columns');
    const parsed = saved ? (JSON.parse(saved) as Partial<ColumnSettings>) : {};
    return { ...defaults, ...parsed } as ColumnSettings;
  });

  const activeCategories = useMemo(
    () =>
      (Object.entries(filters) as [FilterKey, boolean][]) // keep the filter order
        .filter(([, enabled]) => enabled)
        .map(([key]) => key),
    [filters],
  );

  const visibleColumns = useMemo(() => columnConfigs.filter((col) => columnSettings[col.key]?.visible !== false), [columnSettings]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!resizeState.current) return;
    const { key, startWidth, startX } = resizeState.current;
    const delta = event.clientX - startX;
    setColumnSettings((prev) => {
      const config = columnConfigs.find((c) => c.key === key);
      const minWidth = config?.minWidth ?? 80;
      const nextWidth = Math.max(minWidth, startWidth + delta);
      return {
        ...prev,
        [key]: { ...prev[key], width: nextWidth },
      } as ColumnSettings;
    });
  }, []);

  const stopResize = useCallback(() => {
    resizeState.current = null;
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', stopResize);
  }, [handleMouseMove]);

  const handleResizeStart = useCallback(
    (key: ColumnKey, event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const currentWidth = columnSettings[key]?.width ?? columnConfigs.find((c) => c.key === key)?.defaultWidth ?? 120;
      resizeState.current = { key, startWidth: currentWidth, startX: event.clientX };
      document.body.style.cursor = 'col-resize';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', stopResize);
    },
    [columnSettings, handleMouseMove, stopResize],
  );

  const toggleColumnVisibility = useCallback((key: ColumnKey) => {
    setColumnSettings((prev) => ({
      ...prev,
      [key]: { ...prev[key], visible: !prev[key]?.visible },
    }));
  }, []);

  const resetColumns = useCallback(() => {
    setColumnSettings(createDefaultColumnSettings());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('ai-debug-columns', JSON.stringify(columnSettings));
  }, [columnSettings]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('ai-debug-page-size', String(pageSize));
  }, [pageSize]);

  useEffect(() => () => stopResize(), [stopResize]);

  const fetchData = useCallback(
    async (pageOverride?: number) => {
      const pageToLoad = pageOverride ?? page;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(pageToLoad), pageSize: String(pageSize) });
        activeCategories.forEach((cat) => params.append('category', cat));
        if (source.trim()) params.set('source', source.trim());
        if (direction !== 'all') params.set('direction', direction);
        if (type !== 'all') params.set('type', type);
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo) params.set('dateTo', dateTo);
        if (inn.trim()) params.set('inn', inn.trim());
        if (companyName.trim()) params.set('name', companyName.trim());
        if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());

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
    },
    [activeCategories, companyName, dateFrom, dateTo, debouncedSearch, direction, inn, page, pageSize, source, type],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [source, direction, type, dateFrom, dateTo, inn, companyName, debouncedSearch, filters]);

  useEffect(() => {
    setPage(1);
  }, [pageSize]);

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

  const resetFilters = useCallback(() => {
    setFilters({ traffic: true, error: true, notification: true });
    setSource('');
    setDirection('all');
    setType('all');
    setDateFrom('');
    setDateTo('');
    setInn('');
    setCompanyName('');
    setSearch('');
    setPage(1);
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = total ? Math.min(page * pageSize, total) : 0;
  const activeFiltersCount = useMemo(() => {
    const base = [
      source.trim(),
      direction !== 'all' ? direction : '',
      type !== 'all' ? type : '',
      dateFrom,
      dateTo,
      inn.trim(),
      companyName.trim(),
      debouncedSearch.trim(),
    ].filter(Boolean).length;

    const disabledCategories = filterOptions.length - activeCategories.length;
    return base + disabledCategories;
  }, [activeCategories.length, companyName, dateFrom, dateTo, debouncedSearch, direction, inn, source, type]);

  const hasActiveFilters = activeFiltersCount > 0;

  return (
    <div className="py-4 space-y-4">
      <Collapsible
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        className="rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <Badge variant="outline" className="px-2 py-1 text-xs">
            Всего записей: {total}
          </Badge>
          <Badge variant={activeFiltersCount ? 'secondary' : 'outline'} className="px-2 py-1 text-xs">
            Активные фильтры: {activeFiltersCount}
          </Badge>
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={resetFilters} disabled={loading}>
                <Trash2 className="h-4 w-4 mr-2" /> Сбросить фильтры
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={loading}>
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
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 px-3">
                <Filter className="h-4 w-4 mr-2" />
                {filtersOpen ? 'Скрыть фильтры' : 'Показать фильтры'}
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent className="border-t px-3 py-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {filterOptions.map((opt) => (
              <Button
                key={opt.key}
                variant={filters[opt.key] ? 'secondary' : 'outline'}
                size="sm"
                className="h-8 rounded-full"
                onClick={() => toggleFilter(opt.key)}>
                {opt.label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start">
            <div className="flex flex-col gap-1">
              <Label htmlFor="source" className="text-xs text-muted-foreground">
                Источник
              </Label>
              <Input
                id="source"
                value={source}
                placeholder="ai-integration, worker, ui"
                className="h-9"
                onChange={(e) => setSource(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="search" className="text-xs text-muted-foreground">
                Поиск по сообщению/ответу
              </Label>
              <Input
                id="search"
                value={search}
                placeholder="Текст, source, requestId"
                className="h-9"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="direction" className="text-xs text-muted-foreground">
                Направление
              </Label>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger id="direction" className="h-9 w-full">
                  <SelectValue placeholder="Все" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="request">Запрос</SelectItem>
                  <SelectItem value="response">Ответ</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="type" className="text-xs text-muted-foreground">
                Тип
              </Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="type" className="h-9 w-full">
                  <SelectValue placeholder="Все" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="request">Запрос</SelectItem>
                  <SelectItem value="response">Ответ</SelectItem>
                  <SelectItem value="error">Ошибка</SelectItem>
                  <SelectItem value="notification">Уведомление</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="inn" className="text-xs text-muted-foreground">
                ИНН
              </Label>
              <Input
                id="inn"
                value={inn}
                placeholder="7712345678"
                className="h-9"
                onChange={(e) => setInn(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="companyName" className="text-xs text-muted-foreground">
                Компания
              </Label>
              <Input
                id="companyName"
                value={companyName}
                placeholder="Название компании"
                className="h-9"
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Период с</Label>
              <Input
                type="date"
                value={dateFrom}
                className="h-9"
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Период по</Label>
              <Input
                type="date"
                value={dateTo}
                className="h-9"
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="rounded-xl border shadow-sm bg-card overflow-hidden">
        <div className="px-3 py-2 border-b bg-card text-sm font-semibold flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-2">
            <span>Лента AI-отладки</span>
            <span className="text-xs text-muted-foreground">{total ? `Стр. ${page} из ${totalPages}` : 'Нет данных'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-2">
                  <PanelRight className="h-4 w-4 mr-2" /> Колонки
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Отображение столбцов</DropdownMenuLabel>
                {columnConfigs.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={columnSettings[col.key]?.visible !== false}
                    onCheckedChange={() => toggleColumnVisibility(col.key)}>
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    resetColumns();
                  }}
                  className="text-xs text-muted-foreground">
                  Сбросить размеры и видимость
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="relative max-h-[72vh] overflow-auto">
          <table className="min-w-[1200px] w-full text-xs table-fixed">
            <thead className="sticky top-0 bg-muted border-b z-10">
              <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-center align-middle">
                {visibleColumns.map((col) => {
                  const width = columnSettings[col.key]?.width ?? col.defaultWidth;
                  return (
                    <th
                      key={col.key}
                      style={{ width, minWidth: col.minWidth }}
                      className="relative select-none">
                      <div className="flex items-center justify-center gap-2 pr-3">
                        <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">{col.label}</span>
                      </div>
                      <div
                        className="absolute inset-y-0 right-0 w-1 cursor-col-resize group"
                        onMouseDown={(e) => handleResizeStart(col.key, e)}>
                        <div className="mx-auto h-full w-px bg-border group-hover:bg-foreground/50" />
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="[&>tr>td]:px-2 [&>tr>td]:py-2 align-top">
              {items.map((item, idx) => {
                const { date, time } = formatDate(item.created_at);
                const text = extractText(item.payload);
                const payloadSummary = summarizePayload(item.payload);
                const statusCode = Number.isFinite(Number((item.payload as any)?.status))
                  ? Number((item.payload as any)?.status)
                  : null;
                const payloadOk = (item.payload as any)?.ok;
                const isErrorEvent =
                  item.event_type === 'error' ||
                  payloadOk === false ||
                  (statusCode != null && statusCode >= 400);
                const isSuccessEvent =
                  !isErrorEvent &&
                  (payloadOk === true || (statusCode != null ? statusCode < 400 : item.event_type !== 'error'));

                const rowClasses = isErrorEvent
                  ? 'bg-destructive/10'
                  : isSuccessEvent
                    ? 'bg-emerald-50'
                    : '';
                const hasPayload = item.payload != null;

                return (
                  <tr key={item.id} className={`border-b last:border-0 ${rowClasses}`}>
                    {visibleColumns.map((col) => {
                      const width = columnSettings[col.key]?.width ?? col.defaultWidth;
                      const commonProps = {
                        style: { width, minWidth: col.minWidth },
                        className: 'align-top',
                      } as const;

                      if (col.key === 'index') {
                        return (
                          <td
                            key={col.key}
                            {...commonProps}
                            className={`${commonProps.className} text-center text-muted-foreground`}>
                            {(page - 1) * pageSize + idx + 1}
                          </td>
                        );
                      }

                      if (col.key === 'type') {
                        return (
                          <td key={col.key} {...commonProps}>
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
                        );
                      }

                      if (col.key === 'source') {
                        return (
                          <td key={col.key} {...commonProps} className={`${commonProps.className} whitespace-nowrap`}>
                            {item.source || '—'}
                          </td>
                        );
                      }

                      if (col.key === 'direction') {
                        return (
                          <td key={col.key} {...commonProps} className={`${commonProps.className} whitespace-nowrap`}>
                            {item.direction ? (item.direction === 'request' ? 'Запрос' : 'Ответ') : '—'}
                          </td>
                        );
                      }

                      if (col.key === 'date') {
                        return (
                          <td
                            key={col.key}
                            {...commonProps}
                            className={`${commonProps.className} whitespace-nowrap text-center align-middle`}>
                            {date}
                          </td>
                        );
                      }

                      if (col.key === 'time') {
                        return (
                          <td key={col.key} {...commonProps} className={`${commonProps.className} whitespace-nowrap`}>
                            {time}
                          </td>
                        );
                      }

                      if (col.key === 'requestId') {
                        return (
                          <td
                            key={col.key}
                            {...commonProps}
                            className={`${commonProps.className} whitespace-nowrap font-mono text-[11px]`}
                            title={item.request_id || undefined}>
                            {item.request_id || '—'}
                          </td>
                        );
                      }

                      if (col.key === 'inn') {
                        return (
                          <td
                            key={col.key}
                            {...commonProps}
                            className={`${commonProps.className} whitespace-nowrap font-mono text-[11px] text-center align-middle`}>
                            {item.company_id || '—'}
                          </td>
                        );
                      }

                      if (col.key === 'company') {
                        return (
                          <td
                            key={col.key}
                            {...commonProps}
                            className={`${commonProps.className} whitespace-nowrap text-center align-middle`}
                            title={item.company_name || undefined}>
                            {item.company_name || '—'}
                          </td>
                        );
                      }

                      if (col.key === 'message') {
                        return (
                          <td
                            key={col.key}
                            {...commonProps}
                            className={`${commonProps.className} whitespace-pre-wrap break-words leading-5 max-h-32 overflow-y-auto overflow-x-hidden pr-1 ${item.event_type === 'error' ? 'text-destructive font-medium' : ''}`}
                            title={item.message || undefined}>
                            {item.message || '—'}
                          </td>
                        );
                      }

                      if (col.key === 'details') {
                        return (
                          <td key={col.key} {...commonProps}>
                            <div className="space-y-1 max-h-32 overflow-y-auto overflow-x-hidden pr-1">
                              {payloadSummary.length ? (
                                payloadSummary.map((line, lineIdx) => (
                                  <div key={lineIdx} className="whitespace-pre-wrap break-words leading-5">
                                    {line}
                                  </div>
                                ))
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </div>
                          </td>
                        );
                      }

                      if (col.key === 'actions') {
                        return (
                          <td key={col.key} {...commonProps}>
                            <div className="flex flex-wrap gap-1 justify-center">
                              {hasPayload && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-2"
                                  onClick={() =>
                                    setJsonState({ open: true, payload: item.payload, title: `JSON записи #${item.id}` })}>
                                  <Code2 className="h-4 w-4" />
                                  <span className="ml-1">JSON</span>
                                </Button>
                              )}
                              {text && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-2"
                                  onClick={() => openText(text)}>
                                  <ExternalLink className="h-4 w-4" />
                                  <span className="ml-1">Текст</span>
                                </Button>
                              )}
                              {!hasPayload && !text && <span className="text-muted-foreground">—</span>}
                            </div>
                          </td>
                        );
                      }

                      return null;
                    })}
                  </tr>
                );
              })}

              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={visibleColumns.length} className="text-center py-6 text-muted-foreground text-sm">
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

        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 border-t bg-muted/40 text-xs">
          <span className="text-muted-foreground">
            Показано {rangeStart}–{rangeEnd} из {total}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="pageSize" className="text-muted-foreground">Записей на страницу</Label>
              <Select
                value={String(pageSize)}
                onValueChange={(val) => setPageSize(Number(val))}
                defaultValue={String(pageSize)}>
                <SelectTrigger id="pageSize" className="h-8 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedPageSizes.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}>
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

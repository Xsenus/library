'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { Industry } from '@/lib/validators';

const statusOptions = [
  { key: 'success', label: 'Успешные анализы', field: 'analysis_ok' as const },
  { key: 'server_error', label: 'Сервер был недоступен', field: 'server_error' as const },
  { key: 'no_valid_site', label: 'Не было доступных доменов', field: 'no_valid_site' as const },
];

type PipelineStep = { label: string; status?: string | null };

type AiCompany = {
  inn: string;
  short_name: string;
  address: string | null;
  branch_count: number | null;
  year: number | null;
  revenue: number | null;
  employee_count?: number | null;
  sites?: string[] | null;
  emails?: string[] | null;
  analysis_status?: string | null;
  analysis_progress?: number | null;
  analysis_started_at?: string | null;
  analysis_finished_at?: string | null;
  analysis_duration_ms?: number | null;
  analysis_attempts?: number | null;
  analysis_score?: number | null;
  analysis_ok?: number | null;
  server_error?: number | null;
  no_valid_site?: number | null;
  analysis_domain?: string | null;
  analysis_match_level?: string | null;
  analysis_class?: string | null;
  analysis_equipment?: any;
  analysis_okved_match?: string | null;
  analysis_description?: string | null;
  analysis_tnved?: any;
  analysis_info?: any;
  analysis_pipeline?: any;
  main_okved?: string | null;
};

type FetchResponse = {
  items: AiCompany[];
  total: number;
  page: number;
  pageSize: number;
  available?: Partial<Record<'analysis_ok' | 'server_error' | 'no_valid_site' | 'analysis_progress', boolean>>;
};

function formatRevenue(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return '—';
  return Math.round(value / 1_000_000).toLocaleString('ru-RU');
}

function formatEmployees(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return '—';
  return value.toLocaleString('ru-RU');
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('ru-RU');
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [hours, minutes, seconds].map((n) => n.toString().padStart(2, '0'));
  return parts.join(':');
}

function toStringArray(value: any): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((v) => (v == null ? '' : String(v).trim()))
          .filter((v) => v.length > 0),
      ),
    );
  }
  if (typeof value === 'string') {
    return value
      .split(/[\s,;]+/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  return [];
}

function toPipelineSteps(raw: any): PipelineStep[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((step) => {
        if (!step) return null;
        if (typeof step === 'string') return { label: step };
        if (typeof step === 'object') {
          const label = String(step?.label ?? step?.name ?? step?.stage ?? step?.title ?? '').trim();
          const status = String(step?.status ?? step?.state ?? step?.result ?? '').trim();
          if (!label && !status) return null;
          return { label: label || status, status: status || null };
        }
        return { label: String(step) };
      })
      .filter((s): s is PipelineStep => !!s && !!s.label);
  }
  if (typeof raw === 'string') {
    const parts = raw.split(/\s*[>|→»]+\s*/).map((p) => p.trim()).filter(Boolean);
    return parts.map((p) => ({ label: p }));
  }
  return [];
}

function getCurrentStage(steps: PipelineStep[], statusText?: string | null): string | null {
  if (!steps.length) return statusText ?? null;
  const active = steps.find((step) => {
    if (!step.status) return false;
    const normalized = step.status.toLowerCase();
    return ['active', 'running', 'processing', 'in_progress', 'current'].some((key) =>
      normalized.includes(key),
    );
  });
  if (active) return active.label;
  const incomplete = steps.find((step) => !step.status || step.status.toLowerCase() !== 'done');
  if (incomplete) return incomplete.label;
  return steps[steps.length - 1]?.label ?? statusText ?? null;
}

function isRunning(company: AiCompany): boolean {
  const status = (company.analysis_status ?? '').toLowerCase();
  const progress = company.analysis_progress ?? null;
  if (status) {
    if (['running', 'processing', 'in_progress', 'queued', 'starting'].some((s) => status.includes(s))) {
      return true;
    }
  }
  if (progress != null && progress > 0 && progress < 0.999) return true;
  return false;
}

function getStatusBadge(company: AiCompany): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
  if (isRunning(company)) {
    return { label: 'В процессе', variant: 'default' };
  }
  if (company.analysis_ok === 1) {
    return { label: 'Успех', variant: 'secondary' };
  }
  if (company.server_error) {
    return { label: 'Сервер недоступен', variant: 'destructive' };
  }
  if (company.no_valid_site) {
    return { label: 'Нет доменов', variant: 'destructive' };
  }
  if (company.analysis_finished_at) {
    return { label: 'Завершено', variant: 'outline' };
  }
  return { label: 'Не запускался', variant: 'outline' };
}

type AvailableMap = FetchResponse['available'];

export default function AiCompanyAnalysisTab() {
  const [companies, setCompanies] = useState<AiCompany[]>([]);
  const [available, setAvailable] = useState<AvailableMap>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [industryId, setIndustryId] = useState<string>('all');
  const [okvedCode, setOkvedCode] = useState<string | undefined>(undefined);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industriesLoading, setIndustriesLoading] = useState(false);
  const [okvedOptions, setOkvedOptions] = useState<Array<{ id: number; okved_code: string; okved_main: string }>>([]);
  const [infoCompany, setInfoCompany] = useState<AiCompany | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [runInn, setRunInn] = useState<string | null>(null);
  const [stopLoading, setStopLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshDeadlineRef = useRef<number>(0);

  const debouncedSearch = useDebounce(search, 400);
  const { toast } = useToast();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const isAnyRunning = useMemo(() => companies.some((c) => isRunning(c)), [companies]);

  const fetchCompanies = useCallback(
    async (pageParam: number, pageSizeParam: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('page', String(pageParam));
        params.set('pageSize', String(pageSizeParam));
        if (debouncedSearch) params.set('q', debouncedSearch);
        if (okvedCode) params.set('okved', okvedCode);
        if (industryId !== 'all') params.set('industryId', industryId);
        statusFilters.forEach((status) => params.append('status', status));

        const res = await fetch(`/api/ai-analysis/companies?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Request failed with ${res.status}`);
        const data = (await res.json()) as FetchResponse;
        setCompanies(Array.isArray(data.items) ? data.items : []);
        setTotal(typeof data.total === 'number' ? data.total : 0);
        setAvailable(data.available ?? {});
      } catch (error) {
        console.error('Failed to load AI analysis companies:', error);
        toast({
          title: 'Не удалось загрузить компании',
          description: 'Попробуйте обновить страницу или повторите попытку позже.',
          variant: 'destructive',
        });
        setCompanies([]);
        setTotal(0);
        setAvailable({});
      } finally {
        setLoading(false);
      }
    },
    [debouncedSearch, okvedCode, industryId, statusFilters, toast],
  );

  useEffect(() => {
    fetchCompanies(page, pageSize);
  }, [fetchCompanies, page, pageSize]);

  const scheduleAutoRefresh = useCallback(() => {
    autoRefreshDeadlineRef.current = Date.now() + 2 * 60 * 1000;
    setAutoRefresh(true);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, okvedCode, industryId, statusFilters]);

  useEffect(() => {
    async function loadIndustries() {
      try {
        setIndustriesLoading(true);
        const res = await fetch('/api/industries?pageSize=200', { cache: 'no-store' });
        const data = await res.json();
        if (Array.isArray(data.items)) setIndustries(data.items as Industry[]);
      } catch (error) {
        console.error('Failed to load industries:', error);
      } finally {
        setIndustriesLoading(false);
      }
    }
    loadIndustries();
  }, []);

  useEffect(() => {
    async function loadOkveds() {
      try {
        const params = new URLSearchParams();
        if (industryId !== 'all') params.set('industryId', industryId);
        const res = await fetch(`/api/okved?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        setOkvedOptions(items);
      } catch (error) {
        console.error('Failed to load OKВЭД list:', error);
      }
    }
    loadOkveds();
  }, [industryId]);

  const setSelectedValue = useCallback((inn: string, value: boolean | 'indeterminate') => {
    const shouldSelect = value === 'indeterminate' ? true : Boolean(value);
    setSelected((prev) => {
      const next = new Set(prev);
      if (shouldSelect) next.add(inn);
      else next.delete(inn);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        companies.forEach((c) => next.add(c.inn));
      } else {
        companies.forEach((c) => next.delete(c.inn));
      }
      return next;
    });
  }, [companies]);

  useEffect(() => {
    // remove selections that are not in dataset anymore
    setSelected((prev) => {
      const currentInns = new Set(companies.map((c) => c.inn));
      const next = new Set<string>();
      prev.forEach((inn) => {
        if (currentInns.has(inn)) next.add(inn);
      });
      return next;
    });
  }, [companies]);

  useEffect(() => {
    if (!autoRefresh && !isAnyRunning) return;
    const interval = setInterval(() => {
      if (loading) return;
      fetchCompanies(page, pageSize);
      if (autoRefreshDeadlineRef.current && Date.now() > autoRefreshDeadlineRef.current) {
        autoRefreshDeadlineRef.current = 0;
        setAutoRefresh(false);
      }
      if (!isAnyRunning && autoRefreshDeadlineRef.current === 0) {
        setAutoRefresh(false);
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [autoRefresh, isAnyRunning, fetchCompanies, page, pageSize, loading]);

  useEffect(() => {
    if (!isAnyRunning && autoRefreshDeadlineRef.current === 0) {
      setAutoRefresh(false);
    }
  }, [isAnyRunning]);

  const handleRunSelected = useCallback(async () => {
    const inns = Array.from(selected);
    if (!inns.length) return;
    setBulkLoading(true);
    try {
      const res = await fetch('/api/ai-analysis/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inns }),
      });
      if (!res.ok) throw new Error(`Request failed with ${res.status}`);
      toast({ title: 'Запуск анализа', description: `Компаний в очереди: ${inns.length}` });
      fetchCompanies(page, pageSize);
      scheduleAutoRefresh();
      setSelected(new Set<string>());
    } catch (error) {
      console.error('Failed to start analysis for selected companies:', error);
      toast({
        title: 'Ошибка запуска анализа',
        description: 'Не удалось поставить компании в очередь. Попробуйте позже.',
        variant: 'destructive',
      });
    } finally {
      setBulkLoading(false);
    }
  }, [selected, toast, fetchCompanies, page, pageSize, scheduleAutoRefresh]);

  const handleRunSingle = useCallback(
    async (inn: string) => {
      setRunInn(inn);
      try {
        const res = await fetch('/api/ai-analysis/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inns: [inn] }),
        });
        if (!res.ok) throw new Error(`Request failed with ${res.status}`);
        toast({ title: 'Анализ поставлен в очередь', description: `Компания ${inn}` });
        fetchCompanies(page, pageSize);
        scheduleAutoRefresh();
      } catch (error) {
        console.error('Failed to run analysis', error);
        toast({
          title: 'Ошибка запуска',
          description: 'Не удалось поставить компанию в очередь. Попробуйте позже.',
          variant: 'destructive',
        });
      } finally {
        setRunInn(null);
      }
    },
    [toast, fetchCompanies, page, pageSize, scheduleAutoRefresh],
  );

  const handleStop = useCallback(async () => {
    setStopLoading(true);
    try {
      const res = await fetch('/api/ai-analysis/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Request failed with ${res.status}`);
      toast({ title: 'Отправлен сигнал остановки анализа' });
      fetchCompanies(page, pageSize);
      scheduleAutoRefresh();
    } catch (error) {
      console.error('Failed to stop analysis', error);
      toast({
        title: 'Не удалось остановить анализ',
        description: 'Попробуйте повторить попытку позже.',
        variant: 'destructive',
      });
    } finally {
      setStopLoading(false);
    }
  }, [toast, fetchCompanies, page, pageSize, scheduleAutoRefresh]);

  const headerCheckedState = useMemo(() => {
    if (!companies.length) return false;
    const selectedOnPage = companies.filter((c) => selected.has(c.inn)).length;
    if (selectedOnPage === 0) return false;
    if (selectedOnPage === companies.length) return true;
    return 'indeterminate' as const;
  }, [companies, selected]);

  const topEquipment = (company: AiCompany): string[] => {
    const raw = company.analysis_equipment;
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw
        .map((item) => {
          if (!item) return null;
          if (typeof item === 'string') return item.trim();
          if (typeof item === 'object') {
            const label = String(item?.name ?? item?.label ?? item?.equipment ?? item?.title ?? '').trim();
            return label || null;
          }
          return String(item);
        })
        .filter((s): s is string => !!s);
    }
    return [];
  };

  const tnvedProducts = (company: AiCompany): Array<{ name: string; code?: string }> => {
    const raw = company.analysis_tnved;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr
      .map((item: any) => {
        if (!item) return null;
        if (typeof item === 'string') return { name: item };
        if (typeof item === 'object') {
          const name = String(item?.name ?? item?.title ?? item?.product ?? '').trim();
          const code = String(item?.tnved ?? item?.code ?? item?.tn_ved ?? '').trim();
          if (!name && !code) return null;
          return { name: name || code, code: code || undefined };
        }
        return { name: String(item) };
      })
      .filter((item): item is { name: string; code?: string } => !!item && !!item.name);
  };

  return (
    <div className="space-y-4 py-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between p-3">
          <CardTitle className="text-sm">AI-анализ компаний</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-[280px] h-9 text-sm"
              placeholder="Поиск по названию или ИНН"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Отрасль:</span>
              <select
                className="h-9 min-w-[180px] rounded-md border px-2 text-sm"
                value={industryId}
                onChange={(e) => setIndustryId(e.target.value)}
                disabled={industriesLoading}>
                <option value="all">Все отрасли</option>
                {industries.map((item) => (
                  <option key={item.id} value={String(item.id)}>
                    {item.industry}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">ОКВЭД:</span>
              <Select
                value={okvedCode}
                onValueChange={(value) =>
                  setOkvedCode(value === '__all__' ? undefined : value)
                }>
                <SelectTrigger className="h-9 min-w-[200px] text-sm">
                  <SelectValue placeholder="Все коды" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Все коды</SelectItem>
                  {okvedOptions.map((item) => (
                    <SelectItem key={item.id} value={item.okved_code}>
                      {item.okved_code} — {item.okved_main}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {statusOptions.map((opt) => {
                const disabled = !available?.[opt.field];
                const checked = statusFilters.includes(opt.key);
                return (
                  <label
                    key={opt.key}
                    className={cn(
                      'inline-flex items-center gap-2 rounded border px-2 py-1 text-xs',
                      disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-muted',
                    )}>
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(value) => {
                        const boolValue = value === 'indeterminate' ? true : Boolean(value);
                        setStatusFilters((prev) => {
                          const next = new Set(prev);
                          if (boolValue) next.add(opt.key);
                          else next.delete(opt.key);
                          return Array.from(next);
                        });
                      }}
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className="h-9"
              onClick={handleRunSelected}
              disabled={bulkLoading || selected.size === 0}>
              {bulkLoading ? 'Запуск…' : 'ЗАПУСК АНАЛИЗА ДЛЯ ВЫБРАННЫХ КОМПАНИЙ'}
            </Button>
            <Button
              type="button"
              className="h-9"
              variant="destructive"
              onClick={handleStop}
              disabled={stopLoading || !isAnyRunning}>
              {stopLoading ? 'Остановка…' : 'ОСТАНОВИТЬ АНАЛИЗ'}
            </Button>
            {selected.size > 0 && (
              <span className="text-xs text-muted-foreground">
                Выбрано компаний: <strong>{selected.size}</strong>
              </span>
            )}
          </div>

          <div className="relative w-full overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr className="border-b bg-muted/50">
                  <th className="px-2 py-2 text-left">
                    <Checkbox
                      checked={headerCheckedState}
                      onCheckedChange={(value) => toggleSelectAll(Boolean(value))}
                      aria-label="Выбрать все"
                    />
                  </th>
                  <th className="px-2 py-2 text-left">ИНН</th>
                  <th className="px-2 py-2 text-left">Название</th>
                  <th className="px-2 py-2 text-center">Выручка, млн</th>
                  <th className="px-2 py-2 text-center">Штат</th>
                  <th className="px-2 py-2 text-left">Сайты</th>
                  <th className="px-2 py-2 text-left">E-mail</th>
                  <th className="px-2 py-2 text-left">Статус</th>
                  <th className="px-2 py-2 text-left">Дата запуска</th>
                  <th className="px-2 py-2 text-left">Время запуска</th>
                  <th className="px-2 py-2 text-left">Продолжительность</th>
                  <th className="px-2 py-2 text-center">Попыток</th>
                  <th className="px-2 py-2 text-center">Оценка</th>
                  <th className="px-2 py-2 text-center">Пайплайн</th>
                  <th className="px-2 py-2 text-center">Инфо</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={15} className="py-8 text-center text-sm text-muted-foreground">
                      Загрузка…
                    </td>
                  </tr>
                )}
                {!loading && companies.length === 0 && (
                  <tr>
                    <td colSpan={15} className="py-8 text-center text-sm text-muted-foreground">
                      Нет данных
                    </td>
                  </tr>
                )}
                {!loading &&
                  companies.map((company) => {
                    const steps = toPipelineSteps(company.analysis_pipeline);
                    const currentStage = getCurrentStage(steps, company.analysis_status);
                    const running = isRunning(company);
                    const statusBadge = getStatusBadge(company);
                    const companySelected = selected.has(company.inn);
                    const sites = toStringArray(company.sites);
                    const emails = toStringArray(company.emails);
                    const revenue = formatRevenue(company.revenue);
                    const employees = formatEmployees(company.employee_count ?? null);

                    const highlight = !running && company.analysis_finished_at;

                    return (
                      <tr key={company.inn} className="border-b align-top">
                        <td className="px-2 py-2">
                          <Checkbox
                            checked={companySelected}
                            onCheckedChange={(value) => setSelectedValue(company.inn, value)}
                            aria-label={`Выбрать компанию ${company.short_name}`}
                          />
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap text-xs text-muted-foreground">{company.inn}</td>
                        <td className={cn('px-2 py-2 font-medium', highlight && 'text-red-600')}>
                          {company.short_name}
                        </td>
                        <td className="px-2 py-2 text-center tabular-nums">{revenue}</td>
                        <td className="px-2 py-2 text-center tabular-nums">{employees}</td>
                        <td className="px-2 py-2 text-xs">
                          {sites.length ? (
                            <div className="space-y-1">
                              {sites.slice(0, 2).map((site) => (
                                <div key={site} className="truncate">
                                  <a href={site.startsWith('http') ? site : `https://${site}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline">
                                    {site}
                                  </a>
                                </div>
                              ))}
                              {sites.length > 2 && (
                                <div className="text-muted-foreground text-[11px]">ещё {sites.length - 2}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {emails.length ? (
                            <div className="space-y-1">
                              {emails.slice(0, 2).map((email) => (
                                <div key={email} className="truncate">
                                  <a href={`mailto:${email}`} className="text-blue-600 hover:underline">
                                    {email}
                                  </a>
                                </div>
                              ))}
                              {emails.length > 2 && (
                                <div className="text-muted-foreground text-[11px]">ещё {emails.length - 2}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                        </td>
                        <td className="px-2 py-2 text-xs">{formatDate(company.analysis_started_at ?? null)}</td>
                        <td className="px-2 py-2 text-xs">{formatTime(company.analysis_started_at ?? null)}</td>
                        <td className="px-2 py-2 text-xs">{formatDuration(company.analysis_duration_ms ?? null)}</td>
                        <td className="px-2 py-2 text-center tabular-nums">
                          {company.analysis_attempts != null ? company.analysis_attempts : '—'}
                        </td>
                        <td className="px-2 py-2 text-center tabular-nums">
                          {company.analysis_score != null && Number.isFinite(company.analysis_score)
                            ? company.analysis_score.toFixed(2)
                            : '—'}
                        </td>
                        <td className="px-2 py-2">
                          {running ? (
                            <div className="space-y-2 min-w-[160px]">
                              <Progress value={Math.round((company.analysis_progress ?? 0) * 100)} className="h-2" />
                              <div className="text-[11px] text-muted-foreground">
                                {currentStage || 'Выполняется…'}
                              </div>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleRunSingle(company.inn)}
                              disabled={runInn === company.inn}>
                              {runInn === company.inn ? '…' : <Play className="h-4 w-4" />}
                            </Button>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setInfoCompany(company)}>
                            Подробнее
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">На странице:</span>
              <select
                className="h-8 rounded-md border px-2"
                value={pageSize}
                onChange={(e) => {
                  const value = Number(e.target.value) || 20;
                  setPageSize(value);
                  setPage(1);
                }}>
                {[10, 20, 30, 50, 75, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page <= 1}>
                Назад
              </Button>
              <span>
                Страница {page} / {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page >= totalPages}>
                Вперёд
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!infoCompany} onOpenChange={(open) => !open && setInfoCompany(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {infoCompany?.short_name ?? 'Компания'} · ИНН {infoCompany?.inn ?? ''}
            </DialogTitle>
          </DialogHeader>
          {infoCompany && (
            <div className="space-y-4 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">Уровень соответствия и найденный класс предприятия</div>
                  <div className="font-medium">
                    {infoCompany.analysis_match_level || '—'}
                    {infoCompany.analysis_class ? ` · ${infoCompany.analysis_class}` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Основной ОКВЭД (DaData)</div>
                  <div className="font-medium">{infoCompany.main_okved || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Домен для парсинга</div>
                  <div className="font-medium">{infoCompany.analysis_domain || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Соответствие ИИ-описания сайта и ОКВЭД
                  </div>
                  <div className="font-medium">{infoCompany.analysis_okved_match || '—'}</div>
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">ИИ-описание сайта</div>
                <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                  {infoCompany.analysis_description || '—'}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-2">Топ-10 оборудования</div>
                {topEquipment(infoCompany).length ? (
                  <ol className="list-decimal space-y-1 pl-5">
                    {topEquipment(infoCompany).slice(0, 10).map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))}
                  </ol>
                ) : (
                  <div className="text-muted-foreground">Данные отсутствуют</div>
                )}
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Виды найденной продукции на сайте и ТНВЭД
                </div>
                {tnvedProducts(infoCompany).length ? (
                  <ul className="space-y-1">
                    {tnvedProducts(infoCompany).map((item, idx) => (
                      <li key={`${item.name}-${idx}`} className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                        <span>{item.name}</span>
                        {item.code && (
                          <span className="text-muted-foreground text-xs">{item.code}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-muted-foreground">Нет данных</div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

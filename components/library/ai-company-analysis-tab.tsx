'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ChevronDown, ChevronUp, Filter, Info, Loader2, Play } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { Industry } from '@/lib/validators';

const statusOptions = [
  { key: 'success', label: 'Успешные анализы', field: 'analysis_ok' as const },
  { key: 'server_error', label: 'Сервер был недоступен', field: 'server_error' as const },
  { key: 'no_valid_site', label: 'Не было доступных доменов', field: 'no_valid_site' as const },
];

type PipelineStep = { label: string; status?: string | null };

const QUEUE_STALE_MS = 10 * 60 * 1000;

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
  queued_at?: string | null;
  queued_by?: string | null;
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

function truncateText(value: string | null | undefined, max = 120): string {
  if (!value) return '';
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
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

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

type CompanyState = { running: boolean; queued: boolean };

function computeCompanyState(company: AiCompany): CompanyState {
  const status = (company.analysis_status ?? '').toLowerCase();
  const progress = company.analysis_progress ?? null;
  const startedTs = toTimestamp(company.analysis_started_at);
  const finishedTs = toTimestamp(company.analysis_finished_at);
  const queuedTs = toTimestamp(company.queued_at);

  const runningByStatus = status
    ? ['running', 'processing', 'in_progress', 'starting'].some((s) => status.includes(s))
    : false;
  const runningByProgress = progress != null && progress > 0 && progress < 0.999;
  const runningByTimeline =
    startedTs != null && (finishedTs == null || startedTs > finishedTs || Date.now() - startedTs < QUEUE_STALE_MS);
  const running = runningByStatus || runningByProgress || runningByTimeline;

  const queuedByStatus = status
    ? ['queued', 'waiting', 'pending', 'scheduled'].some((s) => status.includes(s))
    : false;
  const queuedByQueue = queuedTs != null && (!finishedTs || queuedTs > finishedTs);
  const queuedByTimeline =
    queuedTs != null && startedTs != null ? queuedTs >= startedTs && !finishedTs : false;
  const queueFresh = queuedTs != null ? Date.now() - queuedTs < QUEUE_STALE_MS : false;

  const queued =
    !running && ((queuedByStatus && queueFresh) || (queueFresh && (queuedByQueue || queuedByTimeline)));

  return { running, queued };
}

function getStatusBadge(company: AiCompany): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  const state = computeCompanyState(company);
  if (state.running) {
    return { label: 'В процессе', variant: 'default' };
  }
  if (state.queued) {
    return { label: 'В очереди', variant: 'outline' };
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
  const [autoRefreshRemaining, setAutoRefreshRemaining] = useState<number | null>(null);
  const autoRefreshDeadlineRef = useRef<number>(0);
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set());
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [stopSignalAt, setStopSignalAt] = useState<number | null>(null);

  const debouncedSearch = useDebounce(search, 400);
  const { toast } = useToast();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const isAnyActive = useMemo(
    () => companies.some((c) => {
      const state = computeCompanyState(c);
      return state.running || state.queued;
    }),
    [companies],
  );

  const activeCount = useMemo(
    () =>
      companies.reduce((acc, company) => {
        const state = computeCompanyState(company);
        return state.running || state.queued ? acc + 1 : acc;
      }, 0),
    [companies],
  );

  const isRefreshing = loading || isPending;
  const okvedSelectValue = okvedCode ?? '__all__';
  const autoRefreshLabel = useMemo(() => {
    if (autoRefreshRemaining == null) return 'Автообновление';
    const totalSeconds = Math.max(0, Math.ceil(autoRefreshRemaining / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `Автообновление · ${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, [autoRefreshRemaining]);

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
        const items = Array.isArray(data.items) ? (data.items as AiCompany[]) : [];
        const hasActive = items.some((item) => {
          const state = computeCompanyState(item);
          return state.running || state.queued;
        });

        startTransition(() => {
          setCompanies(items);
          setTotal(typeof data.total === 'number' ? data.total : 0);
          setAvailable(data.available ?? {});
          setLastLoadedAt(new Date().toISOString());
        });

        if (!hasActive) {
          autoRefreshDeadlineRef.current = 0;
          setAutoRefresh(false);
          setAutoRefreshRemaining(null);
        }
      } catch (error) {
        console.error('Failed to load AI analysis companies:', error);
        toast({
          title: 'Не удалось загрузить компании',
          description: 'Попробуйте обновить страницу или повторите попытку позже.',
          variant: 'destructive',
        });
        startTransition(() => {
          setCompanies([]);
          setTotal(0);
          setAvailable({});
          setLastLoadedAt(null);
        });
        autoRefreshDeadlineRef.current = 0;
        setAutoRefresh(false);
        setAutoRefreshRemaining(null);
      } finally {
        setLoading(false);
      }
    },
    [debouncedSearch, okvedCode, industryId, statusFilters, toast, startTransition],
  );

  useEffect(() => {
    fetchCompanies(page, pageSize);
  }, [fetchCompanies, page, pageSize]);

  const scheduleAutoRefresh = useCallback(() => {
    const deadline = Date.now() + 2 * 60 * 1000;
    autoRefreshDeadlineRef.current = deadline;
    setAutoRefreshRemaining(deadline - Date.now());
    setAutoRefresh(true);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, okvedCode, industryId, statusFilters]);

  useEffect(() => {
    async function loadIndustries() {
      try {
        setIndustriesLoading(true);
        const pageSize = 100;
        let pageNumber = 1;
        const collected: Industry[] = [];
        let expectedTotal = Infinity;

        while (collected.length < expectedTotal && pageNumber <= 10) {
          const params = new URLSearchParams({
            page: String(pageNumber),
            pageSize: String(pageSize),
          });
          const res = await fetch(`/api/industries?${params.toString()}`, { cache: 'no-store' });
          if (!res.ok) {
            throw new Error(`Failed with ${res.status}`);
          }
          const data = await res.json();
          const items = Array.isArray(data.items) ? (data.items as Industry[]) : [];
          collected.push(...items);
          const totalFromApi = typeof data.total === 'number' ? data.total : collected.length;
          expectedTotal = Number.isFinite(totalFromApi) && totalFromApi > 0 ? totalFromApi : collected.length;
          if (items.length < pageSize) break;
          pageNumber += 1;
        }

        setIndustries(collected);
      } catch (error) {
        console.error('Failed to load industries:', error);
        setIndustries([]);
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
        if (!res.ok) {
          throw new Error(`Failed with ${res.status}`);
        }
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        setOkvedOptions(items);
      } catch (error) {
        console.error('Failed to load OKВЭД list:', error);
        setOkvedOptions([]);
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

  const toggleEmailExpansion = useCallback((inn: string) => {
    setExpandedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(inn)) {
        next.delete(inn);
      } else {
        next.add(inn);
      }
      return next;
    });
  }, []);

  const markQueued = useCallback((inns: string[]) => {
    if (!inns.length) return;
    const timestamp = new Date().toISOString();
    const innSet = new Set(inns);
    setCompanies((prev) =>
      prev.map((company) => {
        if (!innSet.has(company.inn)) return company;
        return {
          ...company,
          analysis_status: 'queued',
          analysis_progress: 0,
          analysis_started_at: null,
          analysis_finished_at: null,
          analysis_duration_ms: null,
          analysis_ok: null,
          server_error: null,
          no_valid_site: null,
          queued_at: timestamp,
        };
      }),
    );
  }, []);

  const clearQueued = useCallback((inns: string[]) => {
    if (!inns.length) return;
    const innSet = new Set(inns);
    setCompanies((prev) =>
      prev.map((company) => {
        if (!innSet.has(company.inn)) return company;
        const nextStatus = company.analysis_status === 'queued' ? null : company.analysis_status;
        return {
          ...company,
          analysis_status: nextStatus,
          queued_at: null,
        };
      }),
    );
  }, []);

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
    setExpandedEmails((prev) => {
      if (prev.size === 0) return prev;
      const currentInns = new Set(companies.map((c) => c.inn));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((inn) => {
        if (currentInns.has(inn)) {
          next.add(inn);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [companies]);

  useEffect(() => {
    if (!autoRefresh && !isAnyActive) return;
    const interval = setInterval(() => {
      if (loading) return;
      fetchCompanies(page, pageSize);
      if (autoRefreshDeadlineRef.current && Date.now() > autoRefreshDeadlineRef.current) {
        autoRefreshDeadlineRef.current = 0;
        setAutoRefresh(false);
        setAutoRefreshRemaining(null);
      }
      if (!isAnyActive && autoRefreshDeadlineRef.current === 0) {
        setAutoRefresh(false);
        setAutoRefreshRemaining(null);
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [autoRefresh, isAnyActive, fetchCompanies, page, pageSize, loading]);

  useEffect(() => {
    if (!isAnyActive && autoRefreshDeadlineRef.current === 0) {
      setAutoRefresh(false);
      setAutoRefreshRemaining(null);
    }
  }, [isAnyActive]);

  useEffect(() => {
    if (!autoRefresh) {
      setAutoRefreshRemaining(null);
      return;
    }

    const updateRemaining = () => {
      if (!autoRefreshDeadlineRef.current) {
        setAutoRefresh(false);
        setAutoRefreshRemaining(null);
        return;
      }
      const remaining = autoRefreshDeadlineRef.current - Date.now();
      if (remaining <= 0) {
        autoRefreshDeadlineRef.current = 0;
        setAutoRefresh(false);
        setAutoRefreshRemaining(null);
      } else {
        setAutoRefreshRemaining(remaining);
      }
    };

    updateRemaining();
    const timer = setInterval(updateRemaining, 1000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  useEffect(() => {
    if (!stopSignalAt) return;
    const timeout = setTimeout(() => setStopSignalAt(null), 15000);
    return () => clearTimeout(timeout);
  }, [stopSignalAt]);

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
      markQueued(inns);
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
  }, [selected, toast, fetchCompanies, page, pageSize, scheduleAutoRefresh, markQueued]);

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
        markQueued([inn]);
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
    [toast, fetchCompanies, page, pageSize, scheduleAutoRefresh, markQueued],
  );

  const handleStop = useCallback(async () => {
    const activeInns = companies
      .filter((company) => {
        const state = computeCompanyState(company);
        return state.running || state.queued;
      })
      .map((company) => company.inn);

    setStopLoading(true);
    try {
      const res = await fetch('/api/ai-analysis/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inns: activeInns }),
      });
      if (!res.ok) throw new Error(`Request failed with ${res.status}`);
      const data = (await res.json().catch(() => null)) as { removed?: number } | null;
      const removed = typeof data?.removed === 'number' ? data.removed : null;
      const description =
        removed != null
          ? `Из очереди снято: ${removed}`
          : activeInns.length > 0
          ? `Для ${activeInns.length} ${activeInns.length === 1 ? 'компании' : 'компаний'}`
          : undefined;
      toast({ title: 'Отправлен сигнал остановки анализа', description });
      clearQueued(activeInns);
      setStopSignalAt(Date.now());
      autoRefreshDeadlineRef.current = 0;
      setAutoRefresh(false);
      setAutoRefreshRemaining(null);
      fetchCompanies(page, pageSize);
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
  }, [companies, toast, clearQueued, fetchCompanies, page, pageSize]);

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
    <TooltipProvider>
      <div className="space-y-4 py-4">
        <Card className="border border-border/60 shadow-sm">
          <CardHeader className="space-y-4 border-b bg-muted/30 p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <CardTitle className="text-base font-semibold tracking-tight">
                AI-анализ компаний
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="bg-background text-foreground">
                  Всего: {total.toLocaleString('ru-RU')}
                </Badge>
                {activeCount > 0 && (
                  <Badge variant="secondary" className="gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Активных: {activeCount}
                  </Badge>
                )}
                {autoRefresh && (
                  <Badge variant="default" className="gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {autoRefreshLabel}
                  </Badge>
                )}
                {stopSignalAt && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-destructive/40 bg-destructive/10 text-destructive"
                  >
                    Остановка запрошена
                  </Badge>
                )}
                {lastLoadedAt && (
                  <span>
                    Обновлено:{' '}
                    {new Date(lastLoadedAt).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <Input
                  className="h-9 min-w-[220px] flex-1 text-sm md:w-[260px] xl:w-[280px]"
                  placeholder="Поиск по названию или ИНН"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Отрасль</span>
                  <Select value={industryId} onValueChange={(value) => setIndustryId(value)}>
                    <SelectTrigger
                      className="h-9 min-w-[180px] text-sm"
                      disabled={industriesLoading && industries.length === 0}>
                      <SelectValue placeholder="Все отрасли" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все отрасли</SelectItem>
                      {industries.map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>
                          {item.industry}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {industriesLoading && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">ОКВЭД</span>
                  <Select
                    value={okvedSelectValue}
                    onValueChange={(value) => setOkvedCode(value === '__all__' ? undefined : value)}
                  >
                    <SelectTrigger className="h-9 min-w-[220px] max-w-[360px] text-left text-sm">
                      <SelectValue placeholder="Все коды" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Все коды</SelectItem>
                      {okvedOptions.map((item) => (
                        <SelectItem key={item.id} value={item.okved_code} title={item.okved_main}>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-foreground">{item.okved_code}</span>
                            <span className="text-xs text-muted-foreground whitespace-normal break-words">
                              {truncateText(item.okved_main, 140)}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant={statusFilters.length ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-9 gap-2"
                    >
                      <Filter className="h-4 w-4" />
                      Статусы
                      {statusFilters.length > 0 && (
                        <span className="rounded-full bg-background/80 px-2 py-0.5 text-xs text-foreground">
                          {statusFilters.length}
                        </span>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60">
                    <DropdownMenuLabel>Фильтр статусов</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {statusOptions.map((option) => (
                      <DropdownMenuCheckboxItem
                        key={option.key}
                        checked={statusFilters.includes(option.key)}
                        disabled={available?.[option.field] === false}
                        onCheckedChange={(checked) => {
                          setStatusFilters((prev) => {
                            if (checked) {
                              if (prev.includes(option.key)) return prev;
                              return [...prev, option.key];
                            }
                            return prev.filter((value) => value !== option.key);
                          });
                        }}
                      >
                        {option.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                    {statusFilters.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={(event) => {
                            event.preventDefault();
                            setStatusFilters([]);
                          }}
                        >
                          Сбросить фильтры
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      className="h-9"
                      onClick={handleRunSelected}
                      disabled={bulkLoading || selected.size === 0}
                    >
                      {bulkLoading ? 'Запуск…' : 'Запустить выбранные'}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Поставить в очередь выбранные компании
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="destructive"
                      className="h-9"
                      onClick={handleStop}
                      disabled={stopLoading || (!isAnyActive && !autoRefresh)}
                    >
                      {stopLoading ? 'Остановка…' : 'Остановить анализ'}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Отправить сигнал остановки пайплайна
                  </TooltipContent>
                </Tooltip>
                {selected.size > 0 && (
                  <Badge variant="outline" className="px-2 text-xs">
                    Выбрано: {selected.size}
                  </Badge>
                )}
              </div>
            </div>
            {statusFilters.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {statusFilters.map((key) => {
                  const option = statusOptions.find((item) => item.key === key);
                  if (!option) return null;
                  return (
                    <Badge key={key} variant="secondary" className="gap-1">
                      {option.label}
                      <button
                        type="button"
                        className="rounded-full p-0.5 text-[10px] text-muted-foreground transition hover:bg-background/60 hover:text-foreground"
                        onClick={() =>
                          setStatusFilters((prev) => prev.filter((value) => value !== key))
                        }
                      >
                        ×
                      </button>
                    </Badge>
                  );
                })}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setStatusFilters([])}
                >
                  Очистить
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Страница {page} / {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <span>На странице:</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      const num = Number(value) || 20;
                      setPageSize(num);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[90px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 20, 30, 50, 75, 100].map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                      disabled={page <= 1}
                    >
                      Назад
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                      disabled={page >= totalPages}
                    >
                      Вперёд
                    </Button>
                  </div>
                </div>
              </div>
              <Separator />
              <div className="relative rounded-lg border border-border/60 bg-background">
                {isRefreshing && (
                  <div className="pointer-events-none absolute right-4 top-3 z-10 flex items-center gap-2 rounded-full bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Обновляем данные…
                  </div>
                )}
                <div className="overflow-hidden">
                  <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="w-12 px-4 py-3 align-middle">
                          <Checkbox
                            checked={headerCheckedState}
                            onCheckedChange={(value) => toggleSelectAll(Boolean(value))}
                            aria-label="Выбрать все"
                          />
                        </th>
                        <th className="w-[25%] px-4 py-3 text-left">Компания</th>
                        <th className="w-[23%] px-4 py-3 text-left">Контакты</th>
                        <th className="w-[24%] px-4 py-3 text-left">Запуски и статус</th>
                        <th className="w-[20%] px-4 py-3 text-left">Пайплайн</th>
                        <th className="w-[8%] px-4 py-3 text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companies.map((company) => {
                        const steps = toPipelineSteps(company.analysis_pipeline);
                        const currentStage = getCurrentStage(steps, company.analysis_status);
                        const state = computeCompanyState(company);
                        const active = state.running || state.queued;
                        const statusBadge = getStatusBadge(company);
                        const companySelected = selected.has(company.inn);
                        const sites = toStringArray(company.sites);
                        const emails = toStringArray(company.emails);
                        const revenue = formatRevenue(company.revenue);
                        const employees = formatEmployees(company.employee_count ?? null);
                        const rowFinished = !active && !!company.analysis_finished_at;
                        const isEmailExpanded = expandedEmails.has(company.inn);
                        const displayEmails = isEmailExpanded ? emails : emails.slice(0, 5);
                        const showEmailToggle = emails.length > 5;
                        const queuedTimeRaw = company.queued_at ? formatTime(company.queued_at) : '—';
                        const queuedTime = queuedTimeRaw !== '—' ? queuedTimeRaw : null;
                        const startedDate = formatDate(company.analysis_started_at ?? null);
                        const startedTime = formatTime(company.analysis_started_at ?? null);
                        const startedAt =
                          startedDate !== '—'
                            ? startedTime !== '—'
                              ? `${startedDate} · ${startedTime}`
                              : startedDate
                            : '—';
                        const finishedDate = formatDate(company.analysis_finished_at ?? null);
                        const finishedTime = formatTime(company.analysis_finished_at ?? null);
                        const finishedAt =
                          finishedDate !== '—'
                            ? finishedTime !== '—'
                              ? `${finishedDate} · ${finishedTime}`
                              : finishedDate
                            : null;
                        const duration = state.running
                          ? '—'
                          : formatDuration(company.analysis_duration_ms ?? null);
                        const attempts = company.analysis_attempts != null ? company.analysis_attempts : '—';
                        const score =
                          company.analysis_score != null && Number.isFinite(company.analysis_score)
                            ? company.analysis_score.toFixed(2)
                            : '—';
                        const revenueLabel = revenue !== '—' ? `${revenue} млн ₽` : '—';
                        const progressPercent = Math.min(
                          100,
                          Math.max(0, Math.round((company.analysis_progress ?? 0) * 100)),
                        );
                        const runDisabled =
                          runInn === company.inn || bulkLoading || state.running || state.queued;
                        const runTooltip = state.running
                          ? 'Анализ выполняется'
                          : state.queued
                          ? 'Компания уже в очереди'
                          : 'Запустить анализ';

                        return (
                          <tr
                            key={company.inn}
                            className={cn(
                              'border-b border-border/60 align-top transition-colors hover:bg-muted/20',
                              companySelected && 'bg-muted/30',
                              rowFinished && 'bg-destructive/5',
                            )}
                          >
                            <td className="px-4 py-4 align-top">
                              <Checkbox
                                checked={companySelected}
                                onCheckedChange={(value) => setSelectedValue(company.inn, value)}
                                aria-label={`Выбрать компанию ${company.short_name}`}
                              />
                            </td>
                            <td className="px-4 py-4 align-top">
                              <div className="space-y-2">
                                <div className={cn('text-sm font-semibold leading-tight', rowFinished && 'text-destructive')}>
                                  {company.short_name}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                  <span>ИНН {company.inn}</span>
                                  {company.branch_count != null && company.branch_count > 0 && (
                                    <span>Филиалов: {company.branch_count}</span>
                                  )}
                                  {company.employee_count != null && company.employee_count > 0 && (
                                    <span>Штат: {employees}</span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
                                  <span>
                                    Выручка: <span className="text-foreground">{revenueLabel}</span>
                                  </span>
                                  <span>
                                    Оценка: <span className="text-foreground">{score}</span>
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4 align-top text-xs">
                              <div className="space-y-4">
                                <div>
                                  <div className="text-[11px] uppercase text-muted-foreground">Сайты</div>
                                  {sites.length ? (
                                    <div className="mt-1 flex flex-col gap-1">
                                      {sites.slice(0, 3).map((site) => (
                                        <a
                                          key={site}
                                          href={site.startsWith('http') ? site : `https://${site}`}
                                          className="truncate text-blue-600 hover:underline"
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          {site}
                                        </a>
                                      ))}
                                      {sites.length > 3 && (
                                        <span className="text-[11px] text-muted-foreground">
                                          + ещё {sites.length - 3}
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </div>
                                <div>
                                  <div className="text-[11px] uppercase text-muted-foreground">E-mail</div>
                                  {emails.length ? (
                                    <div className="mt-1 flex flex-col gap-1">
                                      {displayEmails.map((email) => (
                                        <a
                                          key={email}
                                          href={`mailto:${email}`}
                                          className="truncate text-blue-600 hover:underline"
                                        >
                                          {email}
                                        </a>
                                      ))}
                                      {showEmailToggle && (
                                        <button
                                          type="button"
                                          className="self-start text-xs font-medium text-primary hover:underline"
                                          onClick={() => toggleEmailExpansion(company.inn)}
                                        >
                                          {isEmailExpanded
                                            ? 'Скрыть'
                                            : `Показать все (${emails.length})`}
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4 align-top text-xs">
                              <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                                  {state.running && (
                                    <span className="text-[11px] text-muted-foreground">{progressPercent}%</span>
                                  )}
                                  {state.queued && queuedTime && (
                                    <span className="text-[11px] text-muted-foreground">с {queuedTime}</span>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                                  <div>
                                    <div className="uppercase">Старт</div>
                                    <div className="text-foreground">{startedAt}</div>
                                  </div>
                                  <div>
                                    <div className="uppercase">Длительность</div>
                                    <div className="text-foreground">{duration}</div>
                                  </div>
                                  <div>
                                    <div className="uppercase">Попыток</div>
                                    <div className="text-foreground">{attempts}</div>
                                  </div>
                                  <div>
                                    <div className="uppercase">Оценка</div>
                                    <div className="text-foreground">{score}</div>
                                  </div>
                                </div>
                                {finishedAt && (
                                  <div className="text-[11px] text-muted-foreground">
                                    Завершено: <span className="text-foreground">{finishedAt}</span>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4 align-top text-xs">
                              {state.running ? (
                                <div className="space-y-2">
                                  <Progress value={progressPercent} className="h-2" />
                                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                    <span>{currentStage || 'Выполняется…'}</span>
                                    <span>{progressPercent}%</span>
                                  </div>
                                </div>
                              ) : steps.length ? (
                                <div className="max-w-[260px] space-y-2">
                                  <ul className="space-y-1 text-xs text-muted-foreground">
                                    {steps.slice(0, 4).map((step, index) => (
                                      <li key={`${company.inn}-step-${index}`} className="flex items-start gap-2">
                                        <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-muted-foreground/60" />
                                        <span className="text-foreground">{step.label}</span>
                                        {step.status && (
                                          <span className="text-muted-foreground">· {step.status}</span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                  {steps.length > 4 && (
                                    <div className="text-[11px] text-muted-foreground">
                                      + ещё {steps.length - 4}
                                    </div>
                                  )}
                                </div>
                              ) : state.queued ? (
                                <div className="space-y-1 text-xs text-muted-foreground">
                                  <Badge variant="outline" className="w-fit">
                                    Ожидает запуска
                                  </Badge>
                                  {queuedTime && <div>с {queuedTime}</div>}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-4 align-top text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => handleRunSingle(company.inn)}
                                      disabled={runDisabled}
                                    >
                                      {runInn === company.inn ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Play className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom">{runTooltip}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => setInfoCompany(company)}
                                      aria-label={`Подробности по компании ${company.short_name}`}
                                    >
                                      <Info className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom">Подробнее</TooltipContent>
                                </Tooltip>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!companies.length && !isRefreshing && (
                        <tr>
                          <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                            Данные не найдены
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

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
    </TooltipProvider>
  );
}


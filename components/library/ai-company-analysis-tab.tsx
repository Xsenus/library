'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock3,
  FileText,
  Filter,
  Info,
  Loader2,
  Play,
  RefreshCw,
  Square,
  XCircle,
} from 'lucide-react';
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
import type { AiIntegrationHealth } from '@/lib/ai-integration';
import type { AiDebugEventRecord } from '@/lib/ai-debug';
import { getDefaultSteps, getForcedLaunchMode, getForcedSteps, isLaunchModeLocked } from '@/lib/ai-analysis-config';
import type { StepKey } from '@/lib/ai-analysis-types';

const statusOptions = [
  { key: 'success', label: 'Успешные анализы', field: 'analysis_ok' as const },
  { key: 'server_error', label: 'Сервер был недоступен', field: 'server_error' as const },
  { key: 'no_valid_site', label: 'Не было доступных доменов', field: 'no_valid_site' as const },
];

const stepOptions: { key: StepKey; label: string }[] = [
  { key: 'lookup', label: 'Lookup' },
  { key: 'parse_site', label: 'Парсинг' },
  { key: 'analyze_json', label: 'AI-анализ' },
  { key: 'ib_match', label: 'Продклассы' },
  { key: 'equipment_selection', label: 'Оборудование' },
];

type PipelineStep = { label: string; status?: string | null };

const QUEUE_STALE_MS = 120 * 60 * 1000;

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
  analysis_outcome?: string | null;
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
  active?: { running: number; queued: number; total: number } | null;
  integration?: AiIntegrationHealth | null;
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

function formatLogDate(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return { date: '—', time: '—' };
  return {
    date: dt.toLocaleDateString('ru-RU'),
    time: dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
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

function normalizeSite(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^[\s'"<>]+|[\s'"<>]+$/g, '')
    .replace(/^[({\[]+/, '')
    .replace(/[)}\]]+$/, '')
    .replace(/[.,;:!]+$/, '');

  if (!cleaned) return null;

  const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

  try {
    const url = new URL(withProtocol);
    if (!url.hostname || !url.hostname.includes('.')) return null;

    const sanitizedHost = url.hostname
      .replace(/^[^a-z0-9]+/i, '')
      .replace(/[^a-z0-9.-]+/gi, '')
      .replace(/^[.-]+|[.-]+$/g, '');

    if (!sanitizedHost || !sanitizedHost.includes('.')) return null;

    return sanitizedHost.toLowerCase();
  } catch {
    return null;
  }
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
    ).sort((a, b) => a.localeCompare(b));
  }
  if (typeof value === 'string') {
    return value
      .split(/[\s,;]+/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .sort((a, b) => a.localeCompare(b));
  }
  return [];
}

type AiAnalyzerInfo = {
  company?: {
    domain1?: string | null;
    domain2?: string | null;
    domain1_site?: string | null;
    domain2_site?: string | null;
  } | null;
  ai?: {
    sites?: string[];
    products?: Array<{ name: string; goods_group?: string | null; url?: string | null; domain?: string | null }>;
    equipment?: Array<{ name: string; equip_group?: string | null; url?: string | null; domain?: string | null }>;
    prodclass?: { id?: string | number | null; name?: string | null; label?: string | null; score?: number | null } | null;
    industry?: string | null;
    utp?: string | null;
    letter?: string | null;
    note?: string | null;
  } | null;
};

function normalizeAnalyzerInfo(raw: any): AiAnalyzerInfo | null {
  if (!raw) return null;
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const company = typeof data.company === 'object' && !Array.isArray(data.company) ? data.company : null;
  const ai = typeof data.ai === 'object' && !Array.isArray(data.ai) ? data.ai : null;

  if (!company && !ai) return null;

  const companyInfo = company
    ? {
        domain1: company.domain1 ?? company.domain_1 ?? null,
        domain2: company.domain2 ?? company.domain_2 ?? null,
        domain1_site: company.domain1_site ?? company.domain_1_site ?? null,
        domain2_site: company.domain2_site ?? company.domain_2_site ?? null,
      }
    : null;

  const aiSites = ai ? toSiteArray(ai.sites ?? ai.domains ?? ai.site_list) : [];

  const mapProducts = (items: any[]): Array<{ name: string; goods_group?: string | null; url?: string | null; domain?: string | null }> =>
    items
      .map((item) => {
        if (!item) return null;
        if (typeof item === 'string') return { name: item };
        if (typeof item === 'object') {
          const name = String(item.name ?? item.product ?? item.title ?? '').trim();
          const goods_group = item.goods_group ?? item.goods_type ?? null;
          const url = item.url ?? item.link ?? null;
          const domain = item.domain ?? normalizeSite(url ?? null);
          if (!name && !goods_group && !url) return null;
          return { name: name || goods_group || url || '—', goods_group, url, domain };
        }
        return { name: String(item) };
      })
      .filter((p): p is { name: string; goods_group?: string | null; url?: string | null; domain?: string | null } => !!p && !!p.name);

  const mapEquipment = (items: any[]): Array<{ name: string; equip_group?: string | null; url?: string | null; domain?: string | null }> =>
    items
      .map((item) => {
        if (!item) return null;
        if (typeof item === 'string') return { name: item };
        if (typeof item === 'object') {
          const name = String(item.name ?? item.equipment ?? item.title ?? '').trim();
          const equip_group = item.equip_group ?? item.group ?? null;
          const url = item.url ?? item.link ?? null;
          const domain = item.domain ?? normalizeSite(url ?? null);
          if (!name && !equip_group && !url) return null;
          return { name: name || equip_group || url || '—', equip_group, url, domain };
        }
        return { name: String(item) };
      })
      .filter((p): p is { name: string; equip_group?: string | null; url?: string | null; domain?: string | null } => !!p && !!p.name);

  const prodclass = ai?.prodclass && typeof ai.prodclass === 'object' ? ai.prodclass : null;

  const aiInfo = ai
    ? {
        sites: aiSites,
        products: Array.isArray(ai.products) ? mapProducts(ai.products) : [],
        equipment: Array.isArray(ai.equipment) ? mapEquipment(ai.equipment) : [],
        prodclass: prodclass
          ? {
              id: prodclass.id ?? prodclass.prodclass_id ?? null,
              name: prodclass.name ?? prodclass.prodclass ?? null,
              label: prodclass.label ?? prodclass.full_name ?? null,
              score: prodclass.score ?? prodclass.prodclass_score ?? null,
            }
          : null,
        industry: ai.industry ?? null,
        utp: ai.utp ?? ai.usp ?? null,
        letter: ai.letter ?? ai.email ?? null,
        note: ai.note ?? null,
      }
    : null;

  if (companyInfo && aiSites.length) {
    if (!companyInfo.domain1_site && aiSites[0]) companyInfo.domain1_site = aiSites[0];
    if (!companyInfo.domain2_site && aiSites[1]) companyInfo.domain2_site = aiSites[1];
  }

  return { company: companyInfo, ai: aiInfo };
}

function toSiteArray(value: any): string[] {
  const normalized = toStringArray(value)
    .map((site) => normalizeSite(site))
    .filter((site): site is string => !!site);

  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
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

type OutcomeKey = 'completed' | 'partial' | 'failed' | 'not_started' | 'pending';

type OutcomeMeta = {
  key: OutcomeKey;
  label: string;
  rowClass: string;
  textClass?: string;
  icon: typeof CheckCircle2;
  iconClass: string;
  badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline';
};

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
    startedTs != null && finishedTs == null && Date.now() - startedTs < QUEUE_STALE_MS;
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

function resolveOutcome(company: AiCompany, state: CompanyState): OutcomeMeta {
  const rawOutcome = (company.analysis_outcome ?? '').toLowerCase();
  let key: OutcomeKey = 'not_started';

  if (state.running || state.queued) {
    key = 'pending';
  } else if (rawOutcome === 'completed') {
    key = 'completed';
  } else if (rawOutcome === 'partial') {
    key = 'partial';
  } else if (rawOutcome === 'failed') {
    key = 'failed';
  } else if (company.analysis_ok === 1) {
    key = 'completed';
  } else if (company.server_error || company.no_valid_site) {
    key = 'failed';
  } else if (company.analysis_finished_at) {
    key = 'partial';
  }

  const config: Record<OutcomeKey, OutcomeMeta> = {
    completed: {
      key: 'completed',
      label: 'Проанализирован',
      rowClass: 'bg-emerald-50',
      textClass: 'text-emerald-900',
      icon: CheckCircle2,
      iconClass: 'text-emerald-600',
      badgeVariant: 'secondary',
    },
    partial: {
      key: 'partial',
      label: 'Выполнен частично',
      rowClass: 'bg-amber-50',
      textClass: 'text-amber-900',
      icon: AlertTriangle,
      iconClass: 'text-amber-600',
      badgeVariant: 'default',
    },
    failed: {
      key: 'failed',
      label: 'Не выполнен',
      rowClass: 'bg-rose-50',
      textClass: 'text-rose-900',
      icon: XCircle,
      iconClass: 'text-rose-600',
      badgeVariant: 'destructive',
    },
    not_started: {
      key: 'not_started',
      label: 'Не запускался',
      rowClass: 'bg-rose-50',
      textClass: 'text-muted-foreground',
      icon: CircleDashed,
      iconClass: 'text-muted-foreground',
      badgeVariant: 'outline',
    },
    pending: {
      key: 'pending',
      label: 'Ожидает запуска',
      rowClass: 'bg-sky-50',
      textClass: 'text-sky-900',
      icon: Clock3,
      iconClass: 'text-sky-600',
      badgeVariant: 'outline',
    },
  };

  return config[key] ?? config.not_started;
}

function getStatusBadge(company: AiCompany, outcome: OutcomeMeta): {
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
  return { label: outcome.label, variant: outcome.badgeVariant };
}

type AvailableMap = FetchResponse['available'];

export default function AiCompanyAnalysisTab() {
  const [companies, setCompanies] = useState<AiCompany[]>([]);
  const [available, setAvailable] = useState<AvailableMap>({});
  const [activeSummary, setActiveSummary] = useState<{ running: number; queued: number; total: number } | null>(null);
  const [integrationHealth, setIntegrationHealth] = useState<AiIntegrationHealth | null>(null);
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
  const [logs, setLogs] = useState<AiDebugEventRecord[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [jsonState, setJsonState] = useState<{ open: boolean; title: string; payload: any }>({
    open: false,
    title: '',
    payload: null,
  });
  const [bulkLoading, setBulkLoading] = useState(false);
  const [runInn, setRunInn] = useState<string | null>(null);
  const [debugStepLoading, setDebugStepLoading] = useState<{ inn: string; step: StepKey } | null>(null);
  const [stopInn, setStopInn] = useState<string | null>(null);
  const [stopLoading, setStopLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoRefreshRemaining, setAutoRefreshRemaining] = useState<number | null>(null);
  const autoRefreshDeadlineRef = useRef<number>(0);
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set());
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [stopSignalAt, setStopSignalAt] = useState<number | null>(null);
  const analyzerInfo = useMemo(() => (infoCompany ? normalizeAnalyzerInfo(infoCompany.analysis_info) : null), [infoCompany]);
  const forcedLaunchMode = useMemo(() => getForcedLaunchMode(true), []);
  const launchModeLocked = useMemo(() => isLaunchModeLocked(true), []);
  const forcedSteps = useMemo(() => getForcedSteps(true), []);
  const launchMode: 'full' | 'steps' = forcedLaunchMode;
  const [stepFlags, setStepFlags] = useState<Record<StepKey, boolean>>(() => {
    const defaults = launchModeLocked ? forcedSteps : getDefaultSteps();
    return stepOptions.reduce(
      (acc, opt) => ({ ...acc, [opt.key]: defaults.includes(opt.key) }),
      {} as Record<StepKey, boolean>,
    );
  });

  const debouncedSearch = useDebounce(search, 400);
  const { toast } = useToast();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const activeTotal = useMemo(() => {
    if (!activeSummary) return 0;
    if (Number.isFinite(activeSummary.total)) return Math.max(0, Math.floor(activeSummary.total));
    return Math.max(0, Math.floor((activeSummary.running ?? 0) + (activeSummary.queued ?? 0)));
  }, [activeSummary]);

  const activeCount = useMemo(
    () =>
      companies.reduce((acc, company) => {
        const state = computeCompanyState(company);
        return state.running || state.queued ? acc + 1 : acc;
      }, 0),
    [companies],
  );

  const activeOffPage = Math.max(0, activeTotal - activeCount);

  const isAnyActive = useMemo(
    () => {
      if (activeTotal > 0) return true;
      return companies.some((c) => {
        const state = computeCompanyState(c);
        return state.running || state.queued;
      });
    },
    [activeTotal, companies],
  );

  const integrationHost = useMemo(() => {
    if (!integrationHealth?.base) return null;
    try {
      return new URL(integrationHealth.base).host;
    } catch {
      return integrationHealth.base;
    }
  }, [integrationHealth]);

  const integrationOffline = useMemo(
    () => integrationHealth != null && !integrationHealth.available,
    [integrationHealth],
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

  const selectedSteps = useMemo(
    () => (launchModeLocked ? forcedSteps : stepOptions.filter((opt) => stepFlags[opt.key]).map((opt) => opt.key)),
    [forcedSteps, launchModeLocked, stepFlags],
  );

  const stepLabelMap = useMemo(
    () => stepOptions.reduce((acc, opt) => ({ ...acc, [opt.key]: opt.label }), {} as Record<StepKey, string>),
    [],
  );

  const integrationSummaryText = useCallback((summary: any): string | null => {
    if (!summary) return null;
    const attempted = Number(summary.attempted ?? 0);
    const succeeded = Number(summary.succeeded ?? 0);
    const failedCount = Array.isArray(summary.failed) ? summary.failed.length : 0;
    const base = typeof summary.base === 'string' ? summary.base : null;
    const stepsRaw = Array.isArray(summary.steps) ? (summary.steps as StepKey[]) : [];

    const parts: string[] = [];
    if (base) {
      try {
        parts.push(`API: ${new URL(base).host}`);
      } catch {
        parts.push(`API: ${base}`);
      }
    }

    if (attempted > 0) {
      parts.push(`успешно ${succeeded} из ${attempted}`);
      if (failedCount > 0) parts.push(`ошибки: ${failedCount}`);
    }

    const modeLabel = summary.mode === 'steps' ? 'режим: по шагам' : 'режим: единый запрос';
    parts.push(summary.modeLocked ? `${modeLabel} (зафиксирован)` : modeLabel);

    if (stepsRaw.length) {
      const stepNames = stepsRaw
        .map((key) => stepLabelMap[key] || key)
        .filter(Boolean)
        .join(' → ');
      if (stepNames.length) parts.push(`шаги: ${stepNames}`);
    }

    return parts.length ? parts.join(' · ') : null;
  }, [stepLabelMap]);

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
        const activeFromApi = data.active
          ? {
              running: Number.isFinite((data.active as any).running)
                ? Math.max(0, Math.floor((data.active as any).running))
                : 0,
              queued: Number.isFinite((data.active as any).queued)
                ? Math.max(0, Math.floor((data.active as any).queued))
                : 0,
            }
          : null;
        const activeTotalFromApi = activeFromApi ? activeFromApi.running + activeFromApi.queued : 0;
        const hasActive =
          activeTotalFromApi > 0 ||
          items.some((item) => {
            const state = computeCompanyState(item);
            return state.running || state.queued;
          });

        startTransition(() => {
          setActiveSummary(
            activeFromApi ? { ...activeFromApi, total: activeTotalFromApi } : null,
          );
          setCompanies(items);
          setTotal(typeof data.total === 'number' ? data.total : 0);
          setAvailable(data.available ?? {});
          setIntegrationHealth(data.integration ?? null);
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
          setActiveSummary(null);
          setCompanies([]);
          setTotal(0);
          setAvailable({});
          setIntegrationHealth(null);
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

  const fetchCompanyLogs = useCallback(
    async (inn?: string | null) => {
      if (!inn) return;
      setLogsLoading(true);
      setLogsError(null);
      try {
        const res = await fetch(`/api/ai-debug/events?companyId=${encodeURIComponent(inn)}&pageSize=100`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`Request failed with ${res.status}`);
        const data = (await res.json()) as { items?: AiDebugEventRecord[] };
        setLogs(Array.isArray(data.items) ? data.items : []);
      } catch (error: any) {
        console.error('Failed to load logs for company', error);
        setLogs([]);
        setLogsError(error?.message ?? 'Не удалось загрузить логи компании');
      } finally {
        setLogsLoading(false);
      }
    },
    [],
  );

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

  const toggleStepFlag = useCallback(
    (key: StepKey) => {
      setStepFlags((prev) => {
        if (launchModeLocked) return prev;
        const enabled = Object.values(prev).filter(Boolean).length;
        const nextValue = !prev[key];
        if (!nextValue && enabled <= 1) return prev; // хотя бы один шаг должен остаться включенным
        return { ...prev, [key]: nextValue };
      });
    },
    [launchModeLocked],
  );

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

  const toggleSiteExpansion = useCallback((inn: string) => {
    setExpandedSites((prev) => {
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

  const markStopped = useCallback((inns: string[]) => {
    if (!inns.length) return;
    const timestamp = new Date().toISOString();
    const innSet = new Set(inns);
    setCompanies((prev) =>
      prev.map((company) => {
        if (!innSet.has(company.inn)) return company;
        return {
          ...company,
          analysis_status: 'stopped',
          analysis_progress: null,
          // Сбрасываем started_at, иначе эвристика computeCompanyState сочтёт задачу активной ещё ~10 минут.
          analysis_started_at: null,
          analysis_finished_at: timestamp,
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

  useEffect(() => {
    if (!infoCompany) {
      setLogs([]);
      setLogsError(null);
      setLogsLoading(false);
      return;
    }
    fetchCompanyLogs(infoCompany.inn);
  }, [fetchCompanyLogs, infoCompany]);

  const handleRunSelected = useCallback(async () => {
    const inns = Array.from(selected);
    if (!inns.length) return;
    if (integrationOffline) {
      toast({
        title: 'AI integration недоступна',
        description: integrationHealth?.detail ?? 'Проверьте соединение с сервисом AI.',
        variant: 'destructive',
      });
      return;
    }
    setBulkLoading(true);
    try {
      const res = await fetch('/api/ai-analysis/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inns, mode: launchMode, steps: launchMode === 'steps' ? selectedSteps : undefined }),
      });
      const data = (await res.json().catch(() => null)) as { integration?: any; error?: string } | null;
      if (!res.ok) {
        const message = data?.error ? `Ошибка запуска: ${data.error}` : `Request failed with ${res.status}`;
        throw new Error(message);
      }
      markQueued(inns);
      const note = integrationSummaryText(data?.integration);
      toast({
        title: 'Запуск анализа',
        description:
          note && note.length > 0
            ? `Компаний в очереди: ${inns.length} · ${note}`
            : `Компаний в очереди: ${inns.length}`,
      });
      fetchCompanies(page, pageSize);
      scheduleAutoRefresh();
      setSelected(new Set<string>());
    } catch (error) {
      console.error('Failed to start analysis for selected companies:', error);
      toast({
        title: 'Ошибка запуска анализа',
        description:
          error instanceof Error && error.message
            ? error.message
            : 'Не удалось поставить компании в очередь. Попробуйте позже.',
        variant: 'destructive',
      });
    } finally {
      setBulkLoading(false);
    }
  }, [
    selected,
    toast,
    fetchCompanies,
    page,
    pageSize,
    scheduleAutoRefresh,
    markQueued,
    integrationSummaryText,
    launchMode,
    selectedSteps,
    integrationOffline,
    integrationHealth,
  ]);

  const handleRunDebugStep = useCallback(
    async (inn: string, step: StepKey) => {
      if (integrationOffline) {
        toast({
          title: 'AI integration недоступна',
          description: integrationHealth?.detail ?? 'Проверьте соединение с сервисом AI.',
          variant: 'destructive',
        });
        return;
      }

      setDebugStepLoading({ inn, step });
      try {
        const res = await fetch('/api/ai-analysis/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inns: [inn], mode: 'steps', steps: [step], source: 'debug-step' }),
        });
        const data = (await res.json().catch(() => null)) as { integration?: any; error?: string } | null;
        if (!res.ok) {
          const message = data?.error ? `Ошибка запуска: ${data.error}` : `Request failed with ${res.status}`;
          throw new Error(message);
        }
        const note = integrationSummaryText(data?.integration);
        toast({
          title: `Шаг «${stepLabelMap[step] ?? step}» выполнен для ИНН ${inn}`,
          description: note && note.length > 0 ? note : undefined,
        });
        fetchCompanies(page, pageSize);
      } catch (error) {
        console.error('Failed to start debug step', error);
        toast({
          title: 'Ошибка запуска шага',
          description:
            error instanceof Error && error.message
              ? error.message
              : 'Не удалось выполнить запрос. Попробуйте позже.',
          variant: 'destructive',
        });
      } finally {
        setDebugStepLoading(null);
      }
    },
    [fetchCompanies, integrationHealth, integrationOffline, integrationSummaryText, page, pageSize, stepLabelMap, toast],
  );

  const handleRunSingle = useCallback(
    async (inn: string) => {
      if (integrationOffline) {
        toast({
          title: 'AI integration недоступна',
          description: integrationHealth?.detail ?? 'Проверьте соединение с сервисом AI.',
          variant: 'destructive',
        });
        return;
      }
      setRunInn(inn);
      try {
        const res = await fetch('/api/ai-analysis/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inns: [inn],
            mode: launchMode,
            steps: launchMode === 'steps' ? selectedSteps : undefined,
          }),
        });
        const data = (await res.json().catch(() => null)) as { integration?: any; error?: string } | null;
        if (!res.ok) {
          const message = data?.error ? `Ошибка запуска: ${data.error}` : `Request failed with ${res.status}`;
          throw new Error(message);
        }
        markQueued([inn]);
        const note = integrationSummaryText(data?.integration);
        toast({
          title: 'Анализ поставлен в очередь',
          description: note && note.length > 0 ? note : `Компания ${inn}`,
        });
        fetchCompanies(page, pageSize);
        scheduleAutoRefresh();
      } catch (error) {
        console.error('Failed to run analysis', error);
        toast({
          title: 'Ошибка запуска',
          description:
            error instanceof Error && error.message
              ? error.message
              : 'Не удалось поставить компанию в очередь. Попробуйте позже.',
          variant: 'destructive',
        });
      } finally {
        setRunInn(null);
      }
    },
    [
      toast,
      fetchCompanies,
      page,
      pageSize,
      scheduleAutoRefresh,
      markQueued,
      integrationSummaryText,
      launchMode,
      selectedSteps,
      integrationOffline,
      integrationHealth,
    ],
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
      markStopped(activeInns);
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
  }, [companies, toast, markStopped, fetchCompanies, page, pageSize]);

  const handleStopSingle = useCallback(
    async (inn: string) => {
      setStopInn(inn);
      try {
        const res = await fetch('/api/ai-analysis/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inns: [inn] }),
        });
        if (!res.ok) throw new Error(`Request failed with ${res.status}`);
        const data = (await res.json().catch(() => null)) as { removed?: number } | null;
        const removed = typeof data?.removed === 'number' ? data.removed : null;
        toast({
          title: 'Отправлен сигнал остановки',
          description:
            removed != null
              ? `Снято из очереди: ${removed}`
              : 'Команда остановки отправлена для выбранной компании.',
        });
        markStopped([inn]);
        fetchCompanies(page, pageSize);
      } catch (error) {
        console.error('Failed to stop single company', error);
        toast({
          title: 'Не удалось остановить компанию',
          description: 'Попробуйте повторить попытку позже.',
          variant: 'destructive',
        });
      } finally {
        setStopInn(null);
      }
    },
    [toast, markStopped, fetchCompanies, page, pageSize],
  );

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
                {activeTotal > 0 && (
                  <Badge variant="secondary" className="gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Активных: {activeTotal}
                    {activeOffPage > 0 ? (
                      <span className="text-[11px] text-muted-foreground">вне страницы: {activeOffPage}</span>
                    ) : null}
                  </Badge>
                )}
                {autoRefresh && (
                  <Badge variant="default" className="gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {autoRefreshLabel}
                  </Badge>
                )}
                {integrationHealth && (
                  <Badge
                    variant={integrationHealth.available ? 'outline' : 'destructive'}
                    className="gap-1"
                    title={integrationHealth.detail ?? undefined}
                  >
                    <span className="font-medium">AI integration</span>
                    <span className="text-[11px] text-muted-foreground">
                      {integrationHealth.available ? 'online' : 'offline'}
                      {integrationHost ? ` · ${integrationHost}` : ''}
                    </span>
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
                      disabled={bulkLoading || selected.size === 0 || integrationOffline}
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
            <div className="flex flex-col gap-2 rounded-lg border bg-background/60 p-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium">Режим запуска</span>
                <Badge variant="secondary" className="font-normal">
                  По шагам (управляется настройками)
                </Badge>
              </div>
              {launchMode === 'steps' && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="text-foreground">Шаги (из файла настроек, меняются через переменные окружения):</span>
                  {stepOptions.map((opt) => (
                    <label key={opt.key} className="flex items-center gap-1 rounded-md border bg-background px-2 py-1">
                      <Checkbox
                        checked={stepFlags[opt.key]}
                        onCheckedChange={() => toggleStepFlag(opt.key)}
                        disabled={launchModeLocked}
                      />
                      <span className="text-foreground">{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}
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
                        const outcome = resolveOutcome(company, state);
                        const active = state.running || state.queued;
                        const statusBadge = getStatusBadge(company, outcome);
                        const companySelected = selected.has(company.inn);
                        const sites = toSiteArray(company.sites);
                        const emails = toStringArray(company.emails);
                        const revenue = formatRevenue(company.revenue);
                        const employees = formatEmployees(company.employee_count ?? null);
                        const rowTone = active ? 'bg-sky-50' : outcome.rowClass;
                        const isEmailExpanded = expandedEmails.has(company.inn);
                        const isSiteExpanded = expandedSites.has(company.inn);
                        const displaySites = isSiteExpanded ? sites : sites.slice(0, 3);
                        const showSiteToggle = sites.length > 3;
                        const displayEmails = isEmailExpanded ? emails : emails.slice(0, 3);
                        const showEmailToggle = emails.length > 3;
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
                          runInn === company.inn ||
                          bulkLoading ||
                          state.running ||
                          state.queued ||
                          integrationOffline;
                        const runTooltip = integrationOffline
                          ? integrationHealth?.detail
                            ? `AI integration недоступна: ${integrationHealth.detail}`
                            : 'AI integration недоступна'
                          : state.running
                          ? 'Анализ выполняется'
                          : state.queued
                          ? 'Компания уже в очереди'
                          : 'Запустить анализ';

                        return (
                          <tr
                            key={company.inn}
                            className={cn(
                              'border-b border-border/60 align-top transition-colors hover:bg-muted/20',
                              companySelected && 'ring-1 ring-primary/40',
                              rowTone,
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
                                <div className="flex items-center gap-2">
                                  <outcome.icon className={cn('h-4 w-4', outcome.iconClass)} />
                                  <div
                                    className={cn(
                                      'text-sm font-semibold leading-tight',
                                      outcome.textClass ?? 'text-foreground',
                                    )}
                                  >
                                    {company.short_name}
                                  </div>
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
                                      {displaySites.map((site) => (
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
                                      {showSiteToggle && (
                                        <button
                                          type="button"
                                          className="self-start text-xs font-medium text-primary hover:underline"
                                          onClick={() => toggleSiteExpansion(company.inn)}
                                        >
                                          {isSiteExpanded ? 'Скрыть' : `Показать все (${sites.length})`}
                                        </button>
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
                              <div className="flex flex-col items-end gap-2">
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
                                  {(state.running || state.queued) && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          type="button"
                                          variant="destructive"
                                          size="icon"
                                          className="h-8 w-8"
                                          onClick={() => handleStopSingle(company.inn)}
                                          disabled={stopInn === company.inn}
                                          aria-label={`Остановить компанию ${company.short_name}`}
                                        >
                                          {stopInn === company.inn ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            <Square className="h-4 w-4" />
                                          )}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="bottom">Отменить запуск</TooltipContent>
                                    </Tooltip>
                                  )}
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
                                <div className="flex flex-wrap items-center justify-end gap-1 rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
                                  <span className="font-medium text-foreground">Шаги:</span>
                                  {stepOptions.map((opt) => {
                                    const loading = debugStepLoading?.inn === company.inn && debugStepLoading.step === opt.key;
                                    return (
                                      <Tooltip key={`${company.inn}-debug-${opt.key}`}>
                                        <TooltipTrigger asChild>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-7"
                                            onClick={() => handleRunDebugStep(company.inn, opt.key)}
                                            disabled={integrationOffline || !!debugStepLoading || state.running || state.queued}
                                          >
                                            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : opt.label}
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">
                                          Запустить только шаг «{opt.label}» для компании {company.short_name}
                                        </TooltipContent>
                                      </Tooltip>
                                    );
                                  })}
                                </div>
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
                {(() => {
                  const steps = toPipelineSteps(infoCompany.analysis_pipeline);
                  const state = computeCompanyState(infoCompany);
                  const outcome = resolveOutcome(infoCompany, state);
                  const status = getStatusBadge(infoCompany, outcome);
                  const progressPercent = Math.min(
                    100,
                    Math.max(0, Math.round((infoCompany.analysis_progress ?? 0) * 100)),
                  );
                  const startedDate = formatDate(infoCompany.analysis_started_at ?? null);
                  const startedTime = formatTime(infoCompany.analysis_started_at ?? null);
                  const startedAt =
                    startedDate !== '—'
                      ? startedTime !== '—'
                        ? `${startedDate} · ${startedTime}`
                        : startedDate
                      : '—';
                  const finishedDate = formatDate(infoCompany.analysis_finished_at ?? null);
                  const finishedTime = formatTime(infoCompany.analysis_finished_at ?? null);
                  const finishedAt =
                    finishedDate !== '—'
                      ? finishedTime !== '—'
                        ? `${finishedDate} · ${finishedTime}`
                        : finishedDate
                      : '—';
                  const queuedDate = formatDate(infoCompany.queued_at ?? null);
                  const queuedTime = formatTime(infoCompany.queued_at ?? null);
                  const queuedAt =
                    queuedDate !== '—'
                      ? queuedTime !== '—'
                        ? `${queuedDate} · ${queuedTime}`
                        : queuedDate
                      : '—';
                  const duration = state.running
                    ? '—'
                    : formatDuration(infoCompany.analysis_duration_ms ?? null);
                  const attempts =
                    infoCompany.analysis_attempts != null ? infoCompany.analysis_attempts : undefined;
                  const score =
                    infoCompany.analysis_score != null && Number.isFinite(infoCompany.analysis_score)
                      ? infoCompany.analysis_score.toFixed(2)
                      : undefined;

                  return (
                    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={status.variant}>{status.label}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {state.running
                            ? 'Анализ выполняется прямо сейчас'
                            : infoCompany.analysis_finished_at || infoCompany.analysis_started_at
                            ? 'Последний запуск завершён или в ожидании завершения'
                            : 'Анализ ещё не запускался'}
                        </span>
                      </div>

                      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <div className="uppercase">Поставлено в очередь</div>
                          <div className="text-foreground">{queuedAt}</div>
                        </div>
                        <div>
                          <div className="uppercase">Начало</div>
                          <div className="text-foreground">{startedAt}</div>
                        </div>
                        <div>
                          <div className="uppercase">Завершение</div>
                          <div className="text-foreground">{finishedAt}</div>
                        </div>
                        <div>
                          <div className="uppercase">Попыток</div>
                          <div className="text-foreground">{attempts ?? '—'}</div>
                        </div>
                        <div>
                          <div className="uppercase">Прогресс</div>
                          <div className="text-foreground">{progressPercent}%</div>
                        </div>
                        <div>
                          <div className="uppercase">Оценка</div>
                          <div className="text-foreground">{score ?? '—'}</div>
                        </div>
                        <div>
                          <div className="uppercase">Длительность</div>
                          <div className="text-foreground">{duration}</div>
                        </div>
                        {infoCompany.queued_by && (
                          <div>
                            <div className="uppercase">Поставил в очередь</div>
                            <div className="text-foreground">{infoCompany.queued_by}</div>
                          </div>
                        )}
                      </div>

                      {state.running && (
                        <div className="space-y-1">
                          <Progress value={progressPercent} className="h-2" />
                          <div className="text-[11px] text-muted-foreground">
                            Выполняется… {progressPercent}%
                          </div>
                        </div>
                      )}

                      {steps.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">Последний пайплайн</div>
                          <ol className="list-decimal space-y-1 pl-4 text-[13px] text-foreground">
                            {steps.map((step, idx) => (
                              <li key={`${infoCompany.inn}-dlg-step-${idx}`}>
                                {step.label}
                                {step.status ? (
                                  <span className="text-muted-foreground"> · {step.status}</span>
                                ) : null}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {analyzerInfo ? (
                  <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                    <div className="text-xs uppercase text-muted-foreground">Данные карточки (AI-анализатор)</div>

                    {analyzerInfo.company &&
                      (analyzerInfo.company.domain1 ||
                        analyzerInfo.company.domain2 ||
                        analyzerInfo.company.domain1_site ||
                        analyzerInfo.company.domain2_site) && (
                        <div className="grid gap-2 text-sm sm:grid-cols-2">
                          {(analyzerInfo.company.domain1 || analyzerInfo.company.domain1_site) && (
                            <div className="space-y-1">
                              <div className="text-[11px] uppercase text-muted-foreground">Описание сайта 1</div>
                              {analyzerInfo.company.domain1 && (
                                <div className="text-foreground">{analyzerInfo.company.domain1}</div>
                              )}
                              {analyzerInfo.company.domain1_site && (
                                <a
                                  href={`https://${analyzerInfo.company.domain1_site}`}
                                  className="inline-flex items-center gap-1 text-[13px] text-blue-600 hover:underline"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {analyzerInfo.company.domain1_site}
                                </a>
                              )}
                            </div>
                          )}
                          {(analyzerInfo.company.domain2 || analyzerInfo.company.domain2_site) && (
                            <div className="space-y-1">
                              <div className="text-[11px] uppercase text-muted-foreground">Описание сайта 2</div>
                              {analyzerInfo.company.domain2 && (
                                <div className="text-foreground">{analyzerInfo.company.domain2}</div>
                              )}
                              {analyzerInfo.company.domain2_site && (
                                <a
                                  href={`https://${analyzerInfo.company.domain2_site}`}
                                  className="inline-flex items-center gap-1 text-[13px] text-blue-600 hover:underline"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {analyzerInfo.company.domain2_site}
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                    {analyzerInfo.ai && (
                      <div className="space-y-3 text-sm">
                        {(analyzerInfo.ai.industry || analyzerInfo.ai.prodclass) && (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {analyzerInfo.ai.industry && (
                              <div>
                                <div className="text-[11px] uppercase text-muted-foreground">Индустрия</div>
                                <div className="text-foreground">{analyzerInfo.ai.industry}</div>
                              </div>
                            )}
                            {analyzerInfo.ai.prodclass && (
                              <div>
                                <div className="text-[11px] uppercase text-muted-foreground">Продкласс</div>
                                <div className="text-foreground">
                                  {analyzerInfo.ai.prodclass.name || analyzerInfo.ai.prodclass.label || '—'}
                                  {analyzerInfo.ai.prodclass.score != null &&
                                    Number.isFinite(analyzerInfo.ai.prodclass.score) &&
                                    ` · ${Number(analyzerInfo.ai.prodclass.score).toFixed(2)}`}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {(analyzerInfo.ai.utp || analyzerInfo.ai.letter) && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {analyzerInfo.ai.utp && (
                              <div>
                                <div className="text-[11px] uppercase text-muted-foreground">UTP</div>
                                <div className="whitespace-pre-wrap rounded-md bg-muted/30 p-2 text-foreground">
                                  {analyzerInfo.ai.utp}
                                </div>
                              </div>
                            )}
                            {analyzerInfo.ai.letter && (
                              <div>
                                <div className="text-[11px] uppercase text-muted-foreground">Письмо</div>
                                <div className="whitespace-pre-wrap rounded-md bg-muted/30 p-2 text-foreground">
                                  {analyzerInfo.ai.letter}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {analyzerInfo.ai.sites && analyzerInfo.ai.sites.length > 0 && (
                          <div>
                            <div className="text-[11px] uppercase text-muted-foreground">Сайты</div>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {analyzerInfo.ai.sites.map((site) => (
                                <a
                                  key={site}
                                  href={site.startsWith('http') ? site : `https://${site}`}
                                  className="truncate rounded-full bg-background px-3 py-1 text-[13px] text-blue-600 hover:underline"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {site}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {analyzerInfo.ai.products && analyzerInfo.ai.products.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-[11px] uppercase text-muted-foreground">Продукция</div>
                            <ul className="space-y-1">
                              {analyzerInfo.ai.products.map((product, idx) => (
                                <li key={`${product.name}-${idx}`} className="rounded-md bg-muted/30 px-3 py-2">
                                  <div className="font-medium text-foreground">{product.name}</div>
                                  <div className="text-[12px] text-muted-foreground">
                                    {product.goods_group || product.domain || product.url || '—'}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {analyzerInfo.ai.equipment && analyzerInfo.ai.equipment.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-[11px] uppercase text-muted-foreground">Оборудование</div>
                            <ul className="space-y-1">
                              {analyzerInfo.ai.equipment.map((item, idx) => (
                                <li key={`${item.name}-${idx}`} className="rounded-md bg-muted/30 px-3 py-2">
                                  <div className="font-medium text-foreground">{item.name}</div>
                                  <div className="text-[12px] text-muted-foreground">
                                    {item.equip_group || item.domain || item.url || '—'}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {analyzerInfo.ai.note && (
                          <div className="text-[11px] text-muted-foreground">{analyzerInfo.ai.note}</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed bg-muted/10 p-3 text-xs text-muted-foreground">
                    Пайплайн ещё не сохранил payload AI-анализатора для этой компании.
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="uppercase">Логи задачи</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => fetchCompanyLogs(infoCompany.inn)}
                      disabled={logsLoading}
                    >
                      {logsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      <span className="ml-1">Обновить</span>
                    </Button>
                    {logs.length > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        Показано {logs.length} последних записей
                      </span>
                    )}
                    {logsError && <span className="text-destructive">{logsError}</span>}
                  </div>

                  <div className="max-h-64 divide-y overflow-y-auto rounded-lg border bg-muted/30">
                    {logsLoading && !logs.length ? (
                      <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Загружаем логи…
                      </div>
                    ) : logs.length ? (
                      logs.map((log) => {
                        const dt = formatLogDate(log.created_at);
                        const summary = summarizePayload(log.payload);
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
                                  <div className="text-xs text-muted-foreground">
                                    {summary.join(' · ')}
                                  </div>
                                )}
                              </div>
                              {log.payload ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 gap-1 text-xs"
                                  onClick={() =>
                                    setJsonState({
                                      open: true,
                                      title: `${describeLogEvent(log)} · ${dt.date} ${dt.time}`,
                                      payload: log.payload,
                                    })
                                  }
                                >
                                  <FileText className="h-4 w-4" />
                                  JSON
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-3 py-4 text-sm text-muted-foreground">Логи пока отсутствуют</div>
                    )}
                  </div>
                </div>

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

        <Dialog open={jsonState.open} onOpenChange={(open) => !open && setJsonState({ open: false, title: '', payload: null })}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{jsonState.title || 'Детали лога'}</DialogTitle>
            </DialogHeader>
            <pre className="max-h-[70vh] overflow-auto rounded-md bg-muted/50 p-3 text-xs">
              {jsonState.payload ? JSON.stringify(jsonState.payload, null, 2) : 'Нет данных'}
            </pre>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}


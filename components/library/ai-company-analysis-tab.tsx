'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock3,
  ClipboardList,
  ExternalLink,
  FileText,
  Filter,
  Info,
  Loader2,
  Plus,
  Play,
  RefreshCw,
  Settings2,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SquareImgButton from '@/components/library/square-img-button';
import InlineRevenueBars from '@/components/library/inline-revenue-bar';
import { cn } from '@/lib/utils';
import { buildEquipmentCardView } from '@/lib/ai-analysis-equipment-card-view';
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

const companySortOptions = [
  { key: 'revenue_desc', label: 'По выручке: сначала крупные' },
  { key: 'revenue_asc', label: 'По выручке: сначала меньшие' },
  { key: 'analysis_started_desc', label: 'По последнему старту' },
  { key: 'analysis_finished_desc', label: 'По последнему завершению' },
  { key: 'analysis_score_desc', label: 'По оценке анализа' },
  { key: 'analysis_attempts_desc', label: 'По числу попыток' },
] as const;

const stepOptions: { key: StepKey; label: string }[] = [
  { key: 'lookup', label: 'Lookup' },
  { key: 'parse_site', label: 'Парсинг' },
  { key: 'analyze_json', label: 'AI-анализ' },
  { key: 'ib_match', label: 'Продклассы' },
  { key: 'equipment_selection', label: 'Оборудование' },
];

const PAGE_SIZE_STORAGE_KEY = 'ai-analysis-page-size';
const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 75, 100];
const SCORE_VALUE_CLASS = 'text-foreground text-xl leading-none font-semibold tabular-nums';
type CompanySortKey = (typeof companySortOptions)[number]['key'];

type ColumnWidthKey = 'company' | 'metrics' | 'sites' | 'emails' | 'status' | 'actions';

const DEFAULT_COLUMN_WIDTHS: Record<ColumnWidthKey, number> = {
  company: 250,
  metrics: 220,
  sites: 170,
  emails: 170,
  status: 300,
  actions: 240,
};

const MIN_COLUMN_WIDTHS: Record<ColumnWidthKey, number> = {
  company: 250,
  metrics: 200,
  sites: 150,
  emails: 150,
  status: 240,
  actions: 220,
};

const COLUMN_ORDER: ColumnWidthKey[] = ['company', 'metrics', 'sites', 'emails', 'status', 'actions'];

const COLUMN_WIDTHS_KEY = 'ai-analysis-column-widths';

type PipelineStep = { label: string; status?: string | null };

type OkvedOption = { id: number; okved_code: string; okved_main: string };

const QUEUE_STALE_MS = 120 * 60 * 1000;
const OKVED_FALLBACK_DOMAIN = 'okved-fallback.local';

type AiCompany = {
  inn: string;
  short_name: string;
  address: string | null;
  branch_count: number | null;
  year: number | null;
  revenue: number | null;
  revenue_1?: number | null;
  revenue_2?: number | null;
  revenue_3?: number | null;
  income_1?: number | null;
  income_2?: number | null;
  income_3?: number | null;
  employee_count?: number | null;
  sites?: string[] | null;
  emails?: string[] | null;
  analysis_status?: string | null;
  analysis_outcome?: string | null;
  company_id?: number | null;
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
  description_score?: number | null;
  description_okved_score?: number | null;
  okved_score?: number | null;
  prodclass_by_okved?: number | null;
  prodclass_name?: string | null;
  analysis_okved_match?: string | null;
  analysis_description?: string | null;
  score_source?: string | null;
  analysis_tnved?: any;
  analysis_info?: any;
  analysis_pipeline?: any;
  main_okved?: string | null;
  queued_at?: string | null;
  queued_by?: string | null;
  responsible?: string | null;
  tokens_total?: number | null;
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  output_tokens?: number | null;
  cost_total_usd?: number | null;
  queue_state?: string | null;
  queue_priority?: number | null;
  queue_attempt_count?: number | null;
  queue_started_at?: string | null;
  queue_source?: string | null;
  queue_last_error?: string | null;
  queue_last_error_kind?: string | null;
  queue_defer_count?: number | null;
  next_retry_at?: string | null;
  lease_expires_at?: string | null;
  analysis_cost?: {
    tokens_total?: number | null;
    cost_usd?: number | null;
  } | null;
  breakdown?: {
    input_tokens?: number | null;
    cached_input_tokens?: number | null;
    output_tokens?: number | null;
  } | null;
};

type QueueSourceCount = {
  source: string;
  count: number;
};

type QueueSummary = {
  total: number;
  queued: number;
  running: number;
  stop_requested: number;
  expedited: number;
  leased: number;
  retry_scheduled: number;
  source_counts: QueueSourceCount[];
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

type BillingResponse = {
  spend_month_to_date_usd?: number | null;
  limit_usd?: number | null;
  remaining_usd?: number | null;
  configured?: boolean | null;
  error?: string | null;
  source?: string | null;
  last_snapshot_at?: string | null;
};

type EquipmentScoreTrace = {
  equipment_id: string;
  equipment_name?: string | null;
  final_score?: number | null;
  final_source?: string | null;
  calculation_path?: string | null;
  bd_score?: number | null;
  vector_score?: number | null;
  gen_score?: number | null;
  factor?: number | null;
  matched_site_equipment?: string | null;
  matched_site_equipment_score?: number | null;
  matched_product_name?: string | null;
  origin_kind?: 'site' | 'okved' | 'product' | null;
  origin_name?: string | null;
};

type ProductTraceEquipmentLink = {
  equipment_id: string;
  equipment_name?: string | null;
  final_score?: number | null;
  db_score?: number | null;
  factor?: number | null;
};

type ProductTraceItem = {
  lookup_key: string;
  goods_type_id?: string | null;
  goods_type_name?: string | null;
  goods_types_score?: number | null;
  goods_type_source?: string | null;
  factor?: number | null;
  linked_equipment_count: number;
  top_equipment_name?: string | null;
  top_equipment_score?: number | null;
  linked_equipment: ProductTraceEquipmentLink[];
};

type EquipmentSelectionSettings = {
  version: number;
  okved_threshold: number;
  e1_direct_factor: number;
  e1_fallback_factor: number;
  e2_factor: number;
  e3_factor: number;
  top_equipment_limit: number;
  min_equipment_score: number;
  min_product_score: number;
  updated_by?: string | null;
  updated_at?: string | null;
  is_default?: boolean;
};

type EquipmentTraceResponse = {
  items?: EquipmentScoreTrace[];
  selection_strategy?: string | null;
  selection_reason?: string | null;
};

type ProductTraceResponse = {
  items?: ProductTraceItem[];
};

function formatEmployees(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return '—';
  return value.toLocaleString('ru-RU');
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${value.toFixed(4)}`;
}

function formatTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '0';
  return Math.max(0, Math.floor(value)).toLocaleString('ru-RU');
}

function formatOptionalTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return Math.max(0, Math.floor(value)).toLocaleString('ru-RU');
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

function formatCompanyDisplayName(name?: string | null, companyId?: number | null) {
  return `${name ?? 'Компания'}`;
}

function translatePipelineStatus(status?: string | null): string {
  if (!status) return '';
  const normalized = status.trim().toLowerCase();
  if (!normalized) return '';
  if (['done', 'completed', 'success', 'finished'].some((token) => normalized.includes(token))) {
    return 'завершён';
  }
  if (['running', 'processing', 'in_progress', 'active', 'current'].some((token) => normalized.includes(token))) {
    return 'выполняется';
  }
  if (['queued', 'queue', 'pending', 'waiting'].some((token) => normalized.includes(token))) {
    return 'в очереди';
  }
  if (['failed', 'error'].some((token) => normalized.includes(token))) {
    return 'ошибка';
  }
  if (['skipped'].some((token) => normalized.includes(token))) {
    return 'пропущен';
  }
  return status;
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

function toFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveAnalysisScoreValue(company: Partial<AiCompany> | null | undefined): number | null {
  if (!company) return null;

  const analyzerInfo = normalizeAnalyzerInfo(company.analysis_info);
  const candidates = [
    company.analysis_score,
    company.analysis_match_level,
    company.description_score,
    company.description_okved_score,
    company.okved_score,
    analyzerInfo?.ai?.prodclass?.score,
    analyzerInfo?.ai?.description_okved_score,
    analyzerInfo?.ai?.okved_score,
  ];

  for (const candidate of candidates) {
    const parsed = toFiniteNumber(candidate);
    if (parsed != null) return parsed;
  }

  return null;
}

function formatAnalysisScore(value: number | string | null | undefined): string {
  const parsed = toFiniteNumber(value);
  if (parsed == null) return '—';
  return parsed.toFixed(2);
}

function formatQueuePriorityLabel(priority: number | null | undefined): string {
  if (priority == null || !Number.isFinite(priority)) return 'P?';
  return `P${Math.max(0, Math.floor(priority))}`;
}

function formatQueueSourceLabel(source: string | null | undefined): string {
  const normalized = String(source ?? '').trim().toLowerCase();
  if (!normalized) return '\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A';
  if (normalized === 'manual-play' || normalized === 'play') return '\u0411\u044B\u0441\u0442\u0440\u044B\u0439 \u0437\u0430\u043F\u0443\u0441\u043A';
  if (normalized === 'manual-queue' || normalized === 'queue-single') return '\u0420\u0443\u0447\u043D\u0430\u044F \u043E\u0447\u0435\u0440\u0435\u0434\u044C';
  if (normalized === 'manual-bulk' || normalized === 'bulk') return '\u041C\u0430\u0441\u0441\u043E\u0432\u044B\u0439 \u0437\u0430\u043F\u0443\u0441\u043A';
  if (normalized === 'filter') return '\u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043F\u043E \u0444\u0438\u043B\u044C\u0442\u0440\u0443';
  if (normalized === 'debug-step') return '\u041E\u0442\u043B\u0430\u0434\u043E\u0447\u043D\u044B\u0439 \u0448\u0430\u0433';
  if (normalized === '1way') return 'Через prodclass';
  if (normalized === '2way') return 'Через продукцию';
  if (normalized === '3way') return 'С сайта';
  return normalized;
}

function formatCompanySortLabel(sort: CompanySortKey): string {
  return companySortOptions.find((item) => item.key === sort)?.label ?? companySortOptions[0].label;
}

function formatQueueRetryKind(kind: string | null | undefined): string | null {
  const normalized = String(kind ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'timeout') return 'таймаут';
  if (normalized === 'rate_limited') return 'лимит запросов';
  if (normalized === 'health') return 'health-check';
  if (normalized === 'network') return 'сеть';
  if (normalized === 'upstream_unavailable') return 'upstream недоступен';
  if (normalized === 'upstream_error') return 'ошибка upstream';
  if (normalized === 'partial') return 'частичный результат';
  if (normalized === 'terminal') return 'неретраимая ошибка';
  return normalized;
}

function formatEquipmentCalcPath(path: string | null | undefined): string | null {
  const normalized = String(path ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === '1way') return 'Через prodclass';
  if (normalized === '2way') return 'Через продукцию';
  if (normalized === '3way') return 'Через сайт';
  if (normalized === 'direct') return 'Прямой путь';
  if (normalized === 'fallback') return 'Фолбэк по отрасли';
  if (normalized === 'fallback_missing_industry') return 'Фолбэк без отрасли';
  if (normalized === 'fallback_no_workshops') return 'Фолбэк без цехов';
  return normalized;
}

function formatEquipmentSource(source: string | null | undefined): string | null {
  const normalized = String(source ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === '1way') return 'SCORE_E1';
  if (normalized === '2way') return 'SCORE_E2';
  if (normalized === '3way') return 'SCORE_E3';
  return normalized.toUpperCase();
}

function formatEquipmentOrigin(origin: EquipmentScoreTrace['origin_kind']): string | null {
  if (origin === 'site') return 'Источник: сайт';
  if (origin === 'okved') return 'Источник: ОКВЭД';
  if (origin === 'product') return 'Источник: продукция';
  return null;
}

function buildProductTraceLookupKey(goodsTypeId: string | null | undefined, goodsTypeName: string | null | undefined): string | null {
  const normalizedId = String(goodsTypeId ?? '').trim();
  if (normalizedId) return `id:${normalizedId}`;
  const normalizedName = String(goodsTypeName ?? '').trim().toLowerCase();
  return normalizedName ? `name:${normalizedName}` : null;
}

function formatGoodsTypeSource(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === 'GOODS_TYPE') return 'Извлечение: GOODS_TYPE';
  if (normalized === 'GOODS') return 'Извлечение: GOODS';
  return `Извлечение: ${normalized}`;
}

function createDefaultEquipmentSelectionSettings(): EquipmentSelectionSettings {
  return {
    version: 0,
    okved_threshold: 0.5,
    e1_direct_factor: 1,
    e1_fallback_factor: 0.75,
    e2_factor: 1,
    e3_factor: 1,
    top_equipment_limit: 10,
    min_equipment_score: 0,
    min_product_score: 0,
    updated_by: null,
    updated_at: null,
    is_default: true,
  };
}

function formatBillingValue(value: number | null | undefined, fallback = '—'): string {
  const formatted = formatUsd(value);
  return formatted === '—' ? fallback : formatted;
}

function formatBillingBalanceLabel(billing?: BillingResponse | null): string {
  if (!billing) return '\u2014';
  if (billing.remaining_usd != null && Number.isFinite(billing.remaining_usd)) {
    return formatUsd(billing.remaining_usd);
  }
  return '\u2014';
}

function formatBillingSourceLabel(source: string | null | undefined): string | null {
  const parts = String(source ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return null;

  const labels = parts.map((part) => {
    if (part === 'live') return 'live API';
    if (part === 'snapshot') return '\u0421\u043D\u0438\u043C\u043E\u043A \u0438\u0437 \u0411\u0414';
    if (part === 'db-month') return '\u0420\u0430\u0441\u0445\u043E\u0434\u044B \u0437\u0430 \u043C\u0435\u0441\u044F\u0446';
    if (part === 'derived') return '\u0420\u0430\u0441\u0447\u0435\u0442\u043D\u044B\u0439 \u043E\u0441\u0442\u0430\u0442\u043E\u043A';
    return part;
  });

  return labels.join(' + ');
}

function getActiveElapsedMs(company: AiCompany, nowMs: number): number | null {
  const startedTs = toTimestamp(company.analysis_started_at);
  if (startedTs == null) return null;
  return Math.max(0, nowMs - startedTs);
}


type DurationSyncPoint = {
  baseDurationMs: number;
  syncedAtMs: number;
};

function getSyncedDurationMs(
  company: AiCompany,
  isRunning: boolean,
  nowMs: number,
  syncPoint?: DurationSyncPoint,
): number | null {
  if (!isRunning) return company.analysis_duration_ms ?? null;

  const elapsedByTimeline = getActiveElapsedMs(company, nowMs);
  const elapsedBySync = syncPoint ? syncPoint.baseDurationMs + Math.max(0, nowMs - syncPoint.syncedAtMs) : null;

  if (elapsedBySync != null && elapsedByTimeline != null) {
    return Math.max(elapsedBySync, elapsedByTimeline);
  }

  return elapsedBySync ?? elapsedByTimeline ?? company.analysis_duration_ms ?? null;
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
    score_source?: string | null;
    sites?: string[];
    products?: Array<{
      name: string;
      goods_group?: string | null;
      url?: string | null;
      domain?: string | null;
      tnved_code?: string | null;
      id?: string | number | null;
      goods_type_id?: string | number | null;
      match_id?: string | number | null;
      score?: number | null;
      goods_type_source?: string | null;
    }>;
    equipment?: Array<{
      name: string;
      equip_group?: string | null;
      url?: string | null;
      domain?: string | null;
      score?: number | null;
    }>;
    description_okved_score?: number | null;
    prodclass?: {
      id?: string | number | null;
      name?: string | null;
      label?: string | null;
      score?: number | null;
      description_okved_score?: number | null;
      okved_score?: number | null;
      score_source?: string | null;
    } | null;
    prodclass_by_okved?: string | number | null;
    okved_score?: number | null;
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

  const parseSimilarity = (item: any): number | null => {
    const candidates = [
      item?.bigdata_similarity,
      item?.big_data_similarity,
      item?.bigdata_score,
      item?.vector_similarity,
      item?.similarity,
      item?.score,
      item?.match_score,
      item?.goods_types_score,
      item?.equipment_score,
    ];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value)) return value;
    }
    return null;
  };

  const mapProducts = (
    items: any[],
  ): Array<{
    name: string;
    goods_group?: string | null;
    url?: string | null;
    domain?: string | null;
    tnved_code?: string | null;
    id?: string | number | null;
    goods_type_id?: string | number | null;
    match_id?: string | number | null;
    score?: number | null;
    goods_type_source?: string | null;
  }> =>
    items.reduce<
      Array<{
        name: string;
        goods_group?: string | null;
        url?: string | null;
        domain?: string | null;
        tnved_code?: string | null;
        id?: string | number | null;
        goods_type_id?: string | number | null;
        match_id?: string | number | null;
        score?: number | null;
        goods_type_source?: string | null;
      }>
    >(
      (acc, item) => {
        if (!item) return acc;
        if (typeof item === 'string') {
          acc.push({ name: item });
          return acc;
        }
        if (typeof item === 'object') {
          const name = String(item.name ?? item.product ?? item.title ?? '').trim();
          const goods_group = item.goods_group ?? item.goods_type ?? null;
          const url = item.url ?? item.link ?? null;
          const domain = item.domain ?? normalizeSite(url ?? null);
          const score = parseSimilarity(item);
          const tnved_code =
            item.tnved_code ??
            item.goods_type_id ??
            item.goods_type_ID ??
            item.tnved ??
            item.tn_ved ??
            item.code ??
            null;
          const id = item.id ?? null;
          const goods_type_id = item.goods_type_id ?? item.goods_type_ID ?? null;
          const match_id = item.match_id ?? item.matchID ?? null;
          const goods_type_source =
            typeof item.goods_type_source === 'string'
              ? item.goods_type_source
              : typeof item.goods_source === 'string'
                ? item.goods_source
                : typeof item.source === 'string'
                  ? item.source
                  : null;
          if (!name && !goods_group && !url) return acc;
          acc.push({ name: name || goods_group || url || '—', goods_group, url, domain, tnved_code, id, goods_type_id, match_id, score, goods_type_source });
          return acc;
        }

        acc.push({ name: String(item) });
        return acc;
      },
      [],
    );

  const mapEquipment = (
    items: any[],
  ): Array<{ name: string; equip_group?: string | null; url?: string | null; domain?: string | null; score?: number | null }> =>
    items.reduce<Array<{ name: string; equip_group?: string | null; url?: string | null; domain?: string | null; score?: number | null }>>((acc, item) => {
      if (!item) return acc;
      if (typeof item === 'string') {
        acc.push({ name: item });
        return acc;
      }
      if (typeof item === 'object') {
        const name =
          String(item.name ?? item.equipment ?? item.equipment_name ?? item.title ?? item.id ?? '').trim();
        const equip_group = item.equip_group ?? item.group ?? null;
        const url = item.url ?? item.link ?? null;
        const domain = item.domain ?? normalizeSite(url ?? null);
        const score = parseSimilarity(item);

        if (!name && !equip_group && !url) return acc;

        acc.push({ name: name || equip_group || url || '—', equip_group, url, domain, score });
        return acc;
      }

      acc.push({ name: String(item) });
      return acc;
    }, []);

  const prodclass = ai?.prodclass && typeof ai.prodclass === 'object' ? ai.prodclass : null;
  const prodclassByOkved = ai?.prodclass_by_okved ?? null;
  const okvedScore = ai?.okved_score ?? prodclass?.okved_score ?? null;

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
              description_okved_score:
                prodclass.description_okved_score ?? prodclass.okved_match_score ?? prodclass.okved_score ?? null,
              okved_score: prodclass.okved_score ?? null,
              score_source: prodclass.score_source ?? ai.score_source ?? null,
            }
          : null,
        prodclass_by_okved: prodclassByOkved,
        okved_score: okvedScore,
        industry: ai.industry ?? null,
        utp: ai.utp ?? ai.usp ?? null,
        letter: ai.letter ?? ai.email ?? null,
        note: ai.note ?? null,
        score_source: ai.score_source ?? null,
      }
    : null;

  const fallbackCompany = !companyInfo
    ? {
        domain1: data.domain1 ?? data.domain_1 ?? data.site_1_description ?? null,
        domain2: data.domain2 ?? data.domain_2 ?? data.site_2_description ?? null,
        domain1_site:
          normalizeSite(
            data.domain1_site ??
              data.domain_1_site ??
              data.domain_1 ??
              data.domain1 ??
              (Array.isArray(data.domains) ? data.domains[0] : null),
          ) ?? null,
        domain2_site:
          normalizeSite(
            data.domain2_site ??
              data.domain_2_site ??
              data.domain_2 ??
              data.domain2 ??
              (Array.isArray(data.domains) ? data.domains[1] : null),
          ) ?? null,
      }
    : null;

  const fallbackSites = aiSites.length
    ? aiSites
    : toSiteArray(
        data.sites ??
          data.domains ??
          data.site_list ??
          [data.domain, data.domain1_site, data.domain2_site, data.domain_1, data.domain_2].filter(Boolean),
      );

  const fallbackProducts = !aiInfo || !aiInfo.products?.length
    ? (() => {
        const rawProducts =
          (Array.isArray((data as any).products) ? (data as any).products : null) ??
          (Array.isArray((data as any).goods) ? (data as any).goods : null) ??
          (Array.isArray((data as any).goods_type) ? (data as any).goods_type : null) ??
          (Array.isArray((data as any).tnved) ? (data as any).tnved : null) ??
          (Array.isArray((data as any).analysis_products) ? (data as any).analysis_products : null);
        return rawProducts ? mapProducts(rawProducts) : [];
      })()
    : aiInfo.products;

  const fallbackEquipment = !aiInfo || !aiInfo.equipment?.length
    ? (() => {
        const rawEquipment =
          (Array.isArray((data as any).equipment) ? (data as any).equipment : null) ??
          (Array.isArray((data as any).equipment_site) ? (data as any).equipment_site : null) ??
          (Array.isArray((data as any).top_equipment) ? (data as any).top_equipment : null) ??
          (Array.isArray((data as any).analysis_equipment) ? (data as any).analysis_equipment : null);
        return rawEquipment ? mapEquipment(rawEquipment) : [];
      })()
    : aiInfo.equipment;

  const fallbackProdclass = !aiInfo || !aiInfo.prodclass
    ? (() => {
        const rawProdclass = (data as any).prodclass ?? (data as any).found_class ?? null;
        const rawScore = (data as any).prodclass_score ?? (data as any).analysis_match_level ?? null;
        const rawOkvedMatch =
          (data as any).description_okved_score ?? (data as any).okved_match_score ?? (data as any).analysis_okved_match ?? null;
        const rawOkvedScore =
          (data as any).okved_score ??
          (prodclass && typeof prodclass === 'object' ? (prodclass as any).okved_score : null) ??
          null;
        const rawProdclassByOkved =
          prodclassByOkved ?? (data as any).prodclass_by_okved ?? (data as any).prodclassByOkved ?? null;
        const rawScoreSource =
          (data as any).score_source ??
          (prodclass && typeof prodclass === 'object' ? (prodclass as any).score_source : null) ??
          null;

        if (
          !rawProdclass &&
          rawProdclassByOkved == null &&
          rawScore == null &&
          rawOkvedMatch == null &&
          rawOkvedScore == null
        )
          return null;

        if (rawProdclass && typeof rawProdclass === 'object') {
          return {
            id: rawProdclass.id ?? rawProdclass.prodclass_id ?? null,
            name: rawProdclass.name ?? rawProdclass.prodclass ?? rawProdclass.label ?? null,
            label: rawProdclass.label ?? rawProdclass.name ?? rawProdclass.prodclass ?? null,
            score: rawProdclass.score ?? rawProdclass.prodclass_score ?? (rawScore != null ? Number(rawScore) : null),
            description_okved_score:
              rawProdclass.description_okved_score ??
              rawProdclass.okved_match_score ??
              rawProdclass.okved_score ??
              (rawOkvedMatch != null ? Number(rawOkvedMatch) : null),
            okved_score: rawProdclass.okved_score ?? (rawOkvedScore != null ? Number(rawOkvedScore) : null),
            score_source: rawProdclass.score_source ?? rawScoreSource ?? null,
          };
        }

        return {
          id: null,
          name: rawProdclass ?? (rawProdclassByOkved ? String(rawProdclassByOkved) : null),
          label: rawProdclass ?? (rawProdclassByOkved ? String(rawProdclassByOkved) : null),
          score: rawScore != null ? Number(rawScore) : rawOkvedScore != null ? Number(rawOkvedScore) : null,
          description_okved_score: rawOkvedMatch != null ? Number(rawOkvedMatch) : null,
          okved_score: rawOkvedScore != null ? Number(rawOkvedScore) : null,
          score_source: rawScoreSource,
        };
      })()
    : aiInfo.prodclass;

  const mergedCompanyInfo = companyInfo || (fallbackCompany && Object.values(fallbackCompany).some(Boolean) ? fallbackCompany : null);

  const mergedAiInfo = aiInfo ||
    ((fallbackSites.length || fallbackProducts.length || fallbackEquipment.length || fallbackProdclass) && {
      sites: fallbackSites,
      products: fallbackProducts,
      equipment: fallbackEquipment,
      prodclass: fallbackProdclass,
      industry: (data as any).industry ?? null,
      utp: (data as any).utp ?? (data as any).usp ?? null,
      letter: (data as any).letter ?? (data as any).email ?? null,
      note: (data as any).note ?? null,
    });

  const resolvedCompany = mergedCompanyInfo ? { ...mergedCompanyInfo } : null;
  const resolvedAi = mergedAiInfo ? { ...mergedAiInfo } : null;

  if (resolvedCompany && (resolvedAi?.sites?.length ?? 0) > 0) {
    if (!resolvedCompany.domain1_site && resolvedAi?.sites?.[0]) resolvedCompany.domain1_site = resolvedAi.sites[0];
    if (!resolvedCompany.domain2_site && resolvedAi?.sites?.[1]) resolvedCompany.domain2_site = resolvedAi.sites[1];
  }

  if (!resolvedCompany && !resolvedAi) return null;

  return { company: resolvedCompany, ai: resolvedAi };
}

function toSiteArray(value: any): string[] {
  const normalized = toStringArray(value)
    .map((site) => normalizeSite(site))
    .filter((site): site is string => !!site && site.toLowerCase() !== OKVED_FALLBACK_DOMAIN);

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
  if (!steps.length) return formatStatusLabel(statusText ?? null);
  const active = steps.find((step) => {
    if (!step.status) return false;
    const normalized = step.status.toLowerCase();
    return ['active', 'running', 'processing', 'in_progress', 'current'].some((key) =>
      normalized.includes(key),
    );
  });
  if (active) return active.label || formatStatusLabel(active.status ?? statusText ?? null);
  const incomplete = steps.find((step) => !step.status || step.status.toLowerCase() !== 'done');
  if (incomplete) return incomplete.label;
  return steps[steps.length - 1]?.label ?? formatStatusLabel(statusText ?? null);
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

function formatMatchScore(score: number | string | null | undefined): string | null {
  if (score == null) return null;
  const value = Number(score);
  if (!Number.isFinite(value)) return null;
  if (value === 0) return '0%';
  if (value > 0 && value <= 1) return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(2);
}

function formatRawScore(score: number | string | null | undefined): string | null {
  if (score == null) return null;
  const value = Number(score);
  if (!Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return value.toFixed(3);
  return value.toFixed(2);
}

function formatSimilarityScore(score: number | string | null | undefined): string | null {
  if (score == null) return null;
  const value = Number(score);
  if (!Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return `${(value * 100).toFixed(1)}%`;
  if (value > 1 && value <= 100) return `${value.toFixed(1)}%`;
  return value.toFixed(2);
}

function normalizeDetectionSource(value: unknown): 'site' | 'okved' | null {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('okved') || normalized.includes('оквэд')) return 'okved';
  if (
    normalized.includes('site') ||
    normalized.includes('сайт') ||
    normalized.includes('web') ||
    normalized.includes('url') ||
    normalized.includes('domain')
  )
    return 'site';
  return null;
}

type CompanyState = { running: boolean; queued: boolean };

type OutcomeKey = 'completed' | 'partial' | 'failed' | 'not_started' | 'pending';

type OutcomeMeta = {
  key: OutcomeKey;
  label: string;
  rowClass: string;
  rowHoverBorderClass: string;
  textClass?: string;
  icon: typeof CheckCircle2;
  iconClass: string;
  badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline';
};

function isStopRequestedStatus(status?: string | null): boolean {
  const normalized = (status ?? '').toLowerCase();
  return ['stop_requested', 'stop-requested', 'stopping'].some((token) => normalized.includes(token));
}

function computeCompanyState(company: AiCompany): CompanyState {
  const status = (company.analysis_status ?? '').toLowerCase();
  const outcome = (company.analysis_outcome ?? '').toLowerCase();
  const progress = company.analysis_progress ?? null;
  const startedTs = toTimestamp(company.analysis_started_at);
  const finishedTs = toTimestamp(company.analysis_finished_at);
  const queuedTs = toTimestamp(company.queued_at);
  const hasTerminalOutcome =
    ['failed', 'completed', 'partial', 'stopped', 'cancelled', 'canceled', 'done', 'finished', 'success'].some((s) =>
      outcome.includes(s),
    ) ||
    ['failed', 'error', 'partial', 'complete', 'completed', 'stopped', 'cancelled', 'canceled', 'done', 'finished', 'success'].some((s) =>
      status.includes(s),
    ) ||
    company.analysis_ok === 1 ||
    !!company.server_error ||
    !!company.no_valid_site;
  const hasFinished = finishedTs != null;
  const isTerminal = hasFinished || hasTerminalOutcome;

  const runningByStatus = status
    ? ['running', 'processing', 'in_progress', 'starting', 'stop_requested', 'stopping'].some((s) => status.includes(s))
    : false;
  const runningByProgress = progress != null && progress > 0 && progress < 0.999 && !hasFinished;
  const runningByTimeline =
    startedTs != null && finishedTs == null && Date.now() - startedTs < QUEUE_STALE_MS;
  const running = !isTerminal && (runningByStatus || runningByProgress || runningByTimeline);

  const queuedByStatus = status
    ? ['queued', 'waiting', 'pending', 'scheduled'].some((s) => status.includes(s))
    : false;
  const queuedByQueue = queuedTs != null && (!finishedTs || queuedTs > finishedTs);
  const queuedByTimeline =
    queuedTs != null && startedTs != null ? queuedTs >= startedTs && !finishedTs : false;
  const queueFresh = queuedTs != null ? Date.now() - queuedTs < QUEUE_STALE_MS : false;

  const queued =
    !isTerminal &&
    !running && ((queuedByStatus && queueFresh) || (queueFresh && (queuedByQueue || queuedByTimeline)));

  return { running, queued };
}

function resolveOutcome(company: AiCompany, state: CompanyState): OutcomeMeta {
  const rawOutcome = (company.analysis_outcome ?? '').toLowerCase();
  const status = (company.analysis_status ?? '').toLowerCase();
  const hasOutcomeToken = (tokens: string[]) => tokens.some((token) => rawOutcome.includes(token));
  const hasStatusToken = (tokens: string[]) => tokens.some((token) => status.includes(token));
  let key: OutcomeKey = 'not_started';

  if (state.running || state.queued) {
    key = 'pending';
  } else if (hasOutcomeToken(['completed', 'success', 'ok', 'успеш', 'прошел'])) {
    key = 'completed';
  } else if (hasOutcomeToken(['partial', 'частич'])) {
    key = 'partial';
  } else if (hasOutcomeToken(['failed', 'error', 'не уда', 'ошиб'])) {
    key = 'failed';
  } else if (company.analysis_ok === 1) {
    key = 'completed';
  } else if (company.server_error || company.no_valid_site) {
    key = 'failed';
  } else if (hasStatusToken(['done', 'finish', 'complete', 'success', 'успеш'])) {
    key = 'completed';
  } else if (hasStatusToken(['partial', 'частич'])) {
    key = 'partial';
  } else if (hasStatusToken(['fail', 'error', 'не уда', 'ошиб'])) {
    key = 'failed';
  } else if (company.analysis_finished_at) {
    key = 'partial';
  }

  const config: Record<OutcomeKey, OutcomeMeta> = {
    completed: {
      key: 'completed',
      label: 'Проанализирован',
      rowClass: 'bg-emerald-50',
      rowHoverBorderClass: 'hover:outline-emerald-500/70',
      textClass: 'text-emerald-900',
      icon: CheckCircle2,
      iconClass: 'text-emerald-600',
      badgeVariant: 'secondary',
    },
    partial: {
      key: 'partial',
      label: 'Выполнен частично',
      rowClass: 'bg-amber-50',
      rowHoverBorderClass: 'hover:outline-amber-500/70',
      textClass: 'text-amber-900',
      icon: AlertTriangle,
      iconClass: 'text-amber-600',
      badgeVariant: 'default',
    },
    failed: {
      key: 'failed',
      label: 'Не выполнен',
      rowClass: 'bg-rose-50',
      rowHoverBorderClass: 'hover:outline-rose-500/70',
      textClass: 'text-rose-900',
      icon: XCircle,
      iconClass: 'text-rose-600',
      badgeVariant: 'destructive',
    },
    not_started: {
      key: 'not_started',
      label: 'Не запускался',
      rowClass: 'bg-white',
      rowHoverBorderClass: 'hover:outline-slate-300',
      textClass: 'text-muted-foreground',
      icon: CircleDashed,
      iconClass: 'text-muted-foreground',
      badgeVariant: 'outline',
    },
    pending: {
      key: 'pending',
      label: 'Ожидает запуска',
      rowClass: 'bg-sky-50',
      rowHoverBorderClass: 'hover:outline-sky-500/70',
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
  if (isStopRequestedStatus(company.analysis_status)) {
    return { label: 'Остановка запрошена', variant: 'outline' };
  }
  if (['stopped', 'cancelled', 'canceled'].some((token) => (company.analysis_status ?? '').toLowerCase().includes(token))) {
    return { label: 'Остановлено', variant: 'outline' };
  }
  if (state.running) {
    return { label: 'В процессе', variant: 'default' };
  }
  if (state.queued) {
    return { label: 'В очереди', variant: 'outline' };
  }
  return { label: outcome.label, variant: outcome.badgeVariant };
}

function isOkvedFallbackUsed(company: AiCompany, sites: string[]): boolean {
  if (sites.length > 0) return false;
  if (company.no_valid_site) return true;
  if (company.main_okved && company.main_okved.trim().length > 0) return true;
  return false;
}

function formatStatusLabel(status?: string | null): string {
  if (!status) return '—';
  const normalized = status.toLowerCase();
  if (normalized.includes('retry')) {
    return 'Ожидает retry';
  }
  if (['stop_requested', 'stop-requested', 'stopping'].some((s) => normalized.includes(s))) {
    return 'Остановка запрошена';
  }
  if (['running', 'processing', 'in_progress', 'starting', 'active'].some((s) => normalized.includes(s))) {
    return 'Выполняется';
  }
  if (['queued', 'queue', 'pending', 'waiting'].some((s) => normalized.includes(s))) {
    return 'В очереди';
  }
  if (['stopped', 'stop', 'cancel'].some((s) => normalized.includes(s))) {
    return 'Остановлено';
  }
  if (['fail', 'error'].some((s) => normalized.includes(s))) {
    return 'Ошибка';
  }
  if (['done', 'finish', 'complete', 'success'].some((s) => normalized.includes(s))) {
    return 'Завершено';
  }
  return status;
}

type AvailableMap = FetchResponse['available'];

export default function AiCompanyAnalysisTab() {
  const [companies, setCompanies] = useState<AiCompany[]>([]);
  const [available, setAvailable] = useState<AvailableMap>({});
  const [activeSummary, setActiveSummary] = useState<{ running: number; queued: number; total: number } | null>(null);
  const [integrationHealth, setIntegrationHealth] = useState<AiIntegrationHealth | null>(null);
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [equipmentTraceById, setEquipmentTraceById] = useState<Record<string, EquipmentScoreTrace>>({});
  const [equipmentTraceStrategy, setEquipmentTraceStrategy] = useState<string | null>(null);
  const [equipmentTraceReason, setEquipmentTraceReason] = useState<string | null>(null);
  const [equipmentTraceLoading, setEquipmentTraceLoading] = useState(false);
  const [equipmentTraceError, setEquipmentTraceError] = useState<string | null>(null);
  const [productTraceByKey, setProductTraceByKey] = useState<Record<string, ProductTraceItem>>({});
  const [productTraceLoading, setProductTraceLoading] = useState(false);
  const [productTraceError, setProductTraceError] = useState<string | null>(null);
  const [equipmentSettingsDialogOpen, setEquipmentSettingsDialogOpen] = useState(false);
  const [equipmentSettings, setEquipmentSettings] = useState<EquipmentSelectionSettings>(createDefaultEquipmentSelectionSettings);
  const [equipmentSettingsDraft, setEquipmentSettingsDraft] = useState<EquipmentSelectionSettings>(createDefaultEquipmentSelectionSettings);
  const [equipmentSettingsLoading, setEquipmentSettingsLoading] = useState(false);
  const [equipmentSettingsSaving, setEquipmentSettingsSaving] = useState(false);
  const [equipmentSettingsError, setEquipmentSettingsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectionAnchorInnRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window === 'undefined') return 20;
    const stored = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    if (Number.isFinite(stored) && PAGE_SIZE_OPTIONS.includes(stored)) return stored;
    return 20;
  });
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [responsibleFilter, setResponsibleFilter] = useState('');
  const [sortBy, setSortBy] = useState<CompanySortKey>('revenue_desc');
  const [industryId, setIndustryId] = useState<string>('all');
  const [okvedCode, setOkvedCode] = useState<string | undefined>(undefined);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industriesLoading, setIndustriesLoading] = useState(false);
  const [okvedOptions, setOkvedOptions] = useState<OkvedOption[]>([]);
  const [infoCompany, setInfoCompany] = useState<AiCompany | null>(null);
  const [infoRefreshing, setInfoRefreshing] = useState(false);
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
  const [queueInn, setQueueInn] = useState<string | null>(null);
  const [debugStepLoading, setDebugStepLoading] = useState<{ inn: string; step: StepKey } | null>(null);
  const [stopInn, setStopInn] = useState<string | null>(null);
  const [removeInn, setRemoveInn] = useState<string | null>(null);
  const [stopLoading, setStopLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoRefreshRemaining, setAutoRefreshRemaining] = useState<number | null>(null);
  const autoRefreshDeadlineRef = useRef<number>(0);
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set());
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [stopSignalAt, setStopSignalAt] = useState<number | null>(null);
  const [queueDialogOpen, setQueueDialogOpen] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueItems, setQueueItems] = useState<AiCompany[]>([]);
  const [queueSummary, setQueueSummary] = useState<QueueSummary | null>(null);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [filterPreview, setFilterPreview] = useState<{ total: number; inns: string[] } | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [filterStatuses, setFilterStatuses] = useState<string[]>(['not_started', 'failed', 'partial']);
  const [filterQuery, setFilterQuery] = useState('');
  const [filterStartsWith, setFilterStartsWith] = useState('');
  const [filterLimit, setFilterLimit] = useState(200);
  const [filterIncludeQueued, setFilterIncludeQueued] = useState(false);
  const [filterIncludeRunning, setFilterIncludeRunning] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<ColumnWidthKey, number>>(() => {
    if (typeof window === 'undefined') return DEFAULT_COLUMN_WIDTHS;

    try {
      const raw = localStorage.getItem(COLUMN_WIDTHS_KEY);
      if (!raw) return DEFAULT_COLUMN_WIDTHS;
      const parsed = JSON.parse(raw) as Partial<Record<ColumnWidthKey, number>>;

      const sanitized = Object.entries(parsed ?? {}).reduce(
        (acc, [key, value]) => {
          const colKey = key as ColumnWidthKey;
          if (typeof value === 'number' && Number.isFinite(value)) {
            acc[colKey] = Math.max(MIN_COLUMN_WIDTHS[colKey], value);
          }
          return acc;
        },
        {} as Partial<Record<ColumnWidthKey, number>>,
      );

      return { ...DEFAULT_COLUMN_WIDTHS, ...sanitized } as Record<ColumnWidthKey, number>;
    } catch (err) {
      console.error('Failed to parse AI analysis column widths from storage', err);
      return DEFAULT_COLUMN_WIDTHS;
    }
  });
  const analyzerInfo = useMemo(() => (infoCompany ? normalizeAnalyzerInfo(infoCompany.analysis_info) : null), [infoCompany]);

  const analyzerSites = analyzerInfo?.ai?.sites ?? [];
  const analyzerProdclass = analyzerInfo?.ai?.prodclass ?? null;
  const analyzerProdclassByOkved = analyzerInfo?.ai?.prodclass_by_okved ?? null;
  const analyzerOkvedScore =
    analyzerProdclass?.okved_score ?? analyzerInfo?.ai?.okved_score ?? infoCompany?.okved_score ?? null;
  const analyzerDescriptionScore = infoCompany?.description_score ?? null;
  const analyzerDescriptionOkvedScore =
    analyzerProdclass?.description_okved_score ??
    analyzerInfo?.ai?.description_okved_score ??
    infoCompany?.description_okved_score ??
    null;
  const [filtersDialogOpen, setFiltersDialogOpen] = useState(false);
  const forcedLaunchMode = useMemo(() => getForcedLaunchMode(true), []);
  const launchModeLocked = useMemo(() => isLaunchModeLocked(true), []);
  const forcedSteps = useMemo(() => getForcedSteps(true), []);
  const launchMode: 'full' | 'steps' = forcedLaunchMode;
  const showDebugStepButtons = false;
  const showRunModePanel = false;
  const [stepFlags, setStepFlags] = useState<Record<StepKey, boolean>>(() => {
    const defaults = launchModeLocked ? forcedSteps : getDefaultSteps();
    return stepOptions.reduce(
      (acc, opt) => ({ ...acc, [opt.key]: defaults.includes(opt.key) }),
      {} as Record<StepKey, boolean>,
    );
  });
  const lastInfoRefreshInn = useRef<string | null>(null);
  const lastEquipmentTraceInn = useRef<string | null>(null);
  const lastProductTraceInn = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  const debouncedSearch = useDebounce(search, 400);
  const { toast } = useToast();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search.trim()) count += 1;
    if (industryId !== 'all') count += 1;
    if (responsibleFilter.trim()) count += 1;
    if (okvedCode) count += 1;
    if (sortBy !== 'revenue_desc') count += 1;
    count += statusFilters.length;
    return count;
  }, [industryId, okvedCode, responsibleFilter, search, sortBy, statusFilters]);

  const hasFilters = activeFilterCount > 0;

  const resetFilters = useCallback(() => {
    setSearch('');
    setIndustryId('all');
    setResponsibleFilter('');
    setOkvedCode(undefined);
    setSortBy('revenue_desc');
    setStatusFilters([]);
    setPage(1);
  }, []);

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

  const resizeStateRef = useRef<{ key: ColumnWidthKey; startX: number; baseWidth: number } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleMove = (event: PointerEvent) => {
      const state = resizeStateRef.current;
      if (!state) return;

      event.preventDefault();

      const delta = event.clientX - state.startX;
      setColumnWidths((prev) => ({
        ...prev,
        [state.key]: Math.max(MIN_COLUMN_WIDTHS[state.key], state.baseWidth + delta),
      }));
    };

    const handleUp = () => {
      if (!resizeStateRef.current) return;
      resizeStateRef.current = null;
      document.body.style.cursor = '';
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, []);

  const startColumnResize = useCallback(
    (key: ColumnWidthKey, e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      resizeStateRef.current = {
        key,
        startX: e.clientX,
        baseWidth: columnWidths[key] ?? DEFAULT_COLUMN_WIDTHS[key],
      };

      (e.target as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
      document.body.style.cursor = 'col-resize';
    },
    [columnWidths],
  );

  const renderResizeHandle = (key: ColumnWidthKey) => (
    <span className="group relative block h-full w-4 cursor-col-resize select-none">
      <span
        className="absolute right-0 top-1/2 h-7 w-0.5 -translate-y-1/2 rounded-full bg-border transition-colors group-hover:bg-primary"
        aria-hidden
      />
      <span
        className="absolute inset-y-0 right-[-6px] block w-4"
        onPointerDown={(e) => startColumnResize(key, e)}
        onDoubleClick={() =>
          setColumnWidths((prev) => ({ ...prev, [key]: DEFAULT_COLUMN_WIDTHS[key] }))
        }
        role="presentation"
      />
    </span>
  );

  const columnStyle = useCallback(
    (key: ColumnWidthKey) => ({ width: columnWidths[key], minWidth: MIN_COLUMN_WIDTHS[key] }),
    [columnWidths],
  );

  const tableMinWidth = useMemo(
    () => COLUMN_ORDER.reduce((acc, key) => acc + (columnWidths[key] ?? DEFAULT_COLUMN_WIDTHS[key]), 80),
    [columnWidths],
  );

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

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [durationSyncByInn, setDurationSyncByInn] = useState<Record<string, DurationSyncPoint>>({});
  const [lastFetchErrorAt, setLastFetchErrorAt] = useState<number | null>(null);
  const fetchErrorNotifiedRef = useRef(false);

  useEffect(() => {
    if (!isAnyActive) return undefined;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isAnyActive]);

  const integrationHost = useMemo(() => {
    if (!integrationHealth?.base) return null;
    try {
      const url = new URL(integrationHealth.base);
      return url.hostname || url.host;
    } catch {
      return integrationHealth.base.split(':')[0] || integrationHealth.base;
    }
  }, [integrationHealth]);

  const integrationOffline = useMemo(
    () => integrationHealth != null && !integrationHealth.available,
    [integrationHealth],
  );

  const isRefreshing = loading || isPending;
  const okvedSelectValue = okvedCode ?? '__all__';
  const selectedOkved = useMemo(
    () => okvedOptions.find((item) => item.okved_code === okvedCode) ?? null,
    [okvedCode, okvedOptions],
  );
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

  const refreshCompanyDetails = useCallback(
    async (inn: string) => {
      if (!inn) return;
      lastInfoRefreshInn.current = inn;
      setInfoRefreshing(true);

      try {
        const params = new URLSearchParams({ page: '1', pageSize: '1', q: inn });
        const res = await fetch(`/api/ai-analysis/companies?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Request failed with ${res.status}`);

        const data = (await res.json().catch(() => null)) as FetchResponse | null;
        const updated = data?.items?.find((item) => String(item.inn) === String(inn)) ?? data?.items?.[0];

        if (updated && lastInfoRefreshInn.current === inn) {
          setInfoCompany((prev) =>
            prev && prev.inn === inn ? { ...prev, ...updated } : prev ?? updated ?? prev,
          );

          setCompanies((prev) =>
            prev.map((item) => (String(item.inn) === String(inn) ? { ...item, ...updated } : item)),
          );
        }
      } catch (error) {
        console.error('Failed to refresh company details', error);
      } finally {
        if (lastInfoRefreshInn.current === inn) {
          setInfoRefreshing(false);
        }
      }
    },
    [setCompanies],
  );

  const fetchBilling = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-analysis/billing', { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as BillingResponse | null;
      if (!data) return;
      setBilling(data);
    } catch (error) {
      console.error('Failed to load billing balance', error);
    }
  }, []);

  const fetchEquipmentSettings = useCallback(async () => {
    setEquipmentSettingsLoading(true);
    setEquipmentSettingsError(null);

    try {
      const res = await fetch('/api/ai-analysis/settings', { cache: 'no-store' });
      const data = (await res.json().catch(() => null)) as Partial<EquipmentSelectionSettings> | { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : `Request failed with ${res.status}`,
        );
      }

      const defaults = createDefaultEquipmentSelectionSettings();
      const next: EquipmentSelectionSettings = {
        version: Number.isFinite(Number((data as any)?.version)) ? Number((data as any)?.version) : defaults.version,
        okved_threshold: Number.isFinite(Number((data as any)?.okved_threshold)) ? Number((data as any)?.okved_threshold) : defaults.okved_threshold,
        e1_direct_factor: Number.isFinite(Number((data as any)?.e1_direct_factor)) ? Number((data as any)?.e1_direct_factor) : defaults.e1_direct_factor,
        e1_fallback_factor: Number.isFinite(Number((data as any)?.e1_fallback_factor)) ? Number((data as any)?.e1_fallback_factor) : defaults.e1_fallback_factor,
        e2_factor: Number.isFinite(Number((data as any)?.e2_factor)) ? Number((data as any)?.e2_factor) : defaults.e2_factor,
        e3_factor: Number.isFinite(Number((data as any)?.e3_factor)) ? Number((data as any)?.e3_factor) : defaults.e3_factor,
        top_equipment_limit: Number.isFinite(Number((data as any)?.top_equipment_limit)) ? Number((data as any)?.top_equipment_limit) : defaults.top_equipment_limit,
        min_equipment_score: Number.isFinite(Number((data as any)?.min_equipment_score)) ? Number((data as any)?.min_equipment_score) : defaults.min_equipment_score,
        min_product_score: Number.isFinite(Number((data as any)?.min_product_score)) ? Number((data as any)?.min_product_score) : defaults.min_product_score,
        updated_by: typeof (data as any)?.updated_by === 'string' ? (data as any).updated_by : null,
        updated_at: typeof (data as any)?.updated_at === 'string' ? (data as any).updated_at : null,
        is_default: Boolean((data as any)?.is_default),
      };

      setEquipmentSettings(next);
      setEquipmentSettingsDraft(next);
    } catch (error) {
      console.error('Failed to load equipment settings', error);
      setEquipmentSettingsError(
        error instanceof Error && error.message
          ? error.message
          : 'Не удалось загрузить настройки расчёта оборудования.',
      );
    } finally {
      setEquipmentSettingsLoading(false);
    }
  }, []);

  const fetchEquipmentTrace = useCallback(async (inn: string) => {
    if (!inn) return;

    lastEquipmentTraceInn.current = inn;
    setEquipmentTraceLoading(true);
    setEquipmentTraceError(null);
    setEquipmentTraceStrategy(null);
    setEquipmentTraceReason(null);

    try {
      const res = await fetch(`/api/ai-analysis/equipment-trace/${encodeURIComponent(inn)}`, {
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => null)) as EquipmentTraceResponse | { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : `Request failed with ${res.status}`,
        );
      }

      const items = Array.isArray((data as EquipmentTraceResponse | null)?.items)
        ? ((data as EquipmentTraceResponse).items as EquipmentScoreTrace[])
        : [];
      const next = items.reduce<Record<string, EquipmentScoreTrace>>((acc, item) => {
        const equipmentId = String(item?.equipment_id ?? '').trim();
        if (!equipmentId) return acc;
        acc[equipmentId] = item;
        return acc;
      }, {});

      if (lastEquipmentTraceInn.current === inn) {
        setEquipmentTraceById(next);
        setEquipmentTraceStrategy(
          typeof (data as EquipmentTraceResponse | null)?.selection_strategy === 'string'
            ? ((data as EquipmentTraceResponse).selection_strategy ?? null)
            : null,
        );
        setEquipmentTraceReason(
          typeof (data as EquipmentTraceResponse | null)?.selection_reason === 'string'
            ? ((data as EquipmentTraceResponse).selection_reason ?? null)
            : null,
        );
      }
    } catch (error) {
      console.error('Failed to load equipment trace', error);
      if (lastEquipmentTraceInn.current === inn) {
        setEquipmentTraceById({});
        setEquipmentTraceStrategy(null);
        setEquipmentTraceReason(null);
        setEquipmentTraceError(
          error instanceof Error && error.message
            ? error.message
            : 'Не удалось загрузить историю расчета оборудования.',
        );
      }
    } finally {
      if (lastEquipmentTraceInn.current === inn) {
        setEquipmentTraceLoading(false);
      }
    }
  }, []);

  const fetchProductTrace = useCallback(async (inn: string) => {
    if (!inn) return;

    lastProductTraceInn.current = inn;
    setProductTraceLoading(true);
    setProductTraceError(null);

    try {
      const res = await fetch(`/api/ai-analysis/product-trace/${encodeURIComponent(inn)}`, {
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => null)) as ProductTraceResponse | { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : `Request failed with ${res.status}`,
        );
      }

      const items = Array.isArray((data as ProductTraceResponse | null)?.items)
        ? ((data as ProductTraceResponse).items as ProductTraceItem[])
        : [];
      const next = items.reduce<Record<string, ProductTraceItem>>((acc, item) => {
        const lookupKey = String(item?.lookup_key ?? '').trim();
        if (!lookupKey) return acc;
        acc[lookupKey] = item;
        return acc;
      }, {});

      if (lastProductTraceInn.current === inn) {
        setProductTraceByKey(next);
      }
    } catch (error) {
      console.error('Failed to load product trace', error);
      if (lastProductTraceInn.current === inn) {
        setProductTraceByKey({});
        setProductTraceError(
          error instanceof Error && error.message
            ? error.message
            : 'Не удалось загрузить историю по найденной продукции.',
        );
      }
    } finally {
      if (lastProductTraceInn.current === inn) {
        setProductTraceLoading(false);
      }
    }
  }, []);

  const saveEquipmentSettings = useCallback(async () => {
    setEquipmentSettingsSaving(true);
    setEquipmentSettingsError(null);

    const payload = {
      okved_threshold: Math.min(1, Math.max(0, Number(equipmentSettingsDraft.okved_threshold) || 0)),
      e1_direct_factor: Math.max(0, Number(equipmentSettingsDraft.e1_direct_factor) || 0),
      e1_fallback_factor: Math.max(0, Number(equipmentSettingsDraft.e1_fallback_factor) || 0),
      e2_factor: Math.max(0, Number(equipmentSettingsDraft.e2_factor) || 0),
      e3_factor: Math.max(0, Number(equipmentSettingsDraft.e3_factor) || 0),
      top_equipment_limit: Math.min(100, Math.max(1, Math.round(Number(equipmentSettingsDraft.top_equipment_limit) || 10))),
      min_equipment_score: Math.min(1, Math.max(0, Number(equipmentSettingsDraft.min_equipment_score) || 0)),
      min_product_score: Math.min(1, Math.max(0, Number(equipmentSettingsDraft.min_product_score) || 0)),
      updated_by: 'library-ui',
    };

    try {
      const res = await fetch('/api/ai-analysis/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as Partial<EquipmentSelectionSettings> | { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error
            : `Request failed with ${res.status}`,
        );
      }

      const next = {
        ...createDefaultEquipmentSelectionSettings(),
        ...payload,
        ...((data && typeof data === 'object') ? data : null),
      } as EquipmentSelectionSettings;
      setEquipmentSettings(next);
      setEquipmentSettingsDraft(next);
      setEquipmentSettingsDialogOpen(false);

      if (infoCompany?.inn) {
        await fetch(`/api/ai-analysis/recompute/${encodeURIComponent(infoCompany.inn)}`, {
          method: 'POST',
          cache: 'no-store',
        }).catch((error) => console.warn('Failed to recompute current company after settings update', error));
        await Promise.allSettled([
          fetchEquipmentTrace(infoCompany.inn),
          fetchProductTrace(infoCompany.inn),
          refreshCompanyDetails(infoCompany.inn),
        ]);
      }

      toast({
        title: 'Настройки сохранены',
        description: infoCompany?.inn
          ? 'Текущая карточка пересчитана с новыми коэффициентами.'
          : 'Новые коэффициенты будут применяться к пересчитанным карточкам.',
      });
    } catch (error) {
      console.error('Failed to save equipment settings', error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Не удалось сохранить настройки расчёта оборудования.';
      setEquipmentSettingsError(message);
      toast({
        title: 'Ошибка сохранения',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setEquipmentSettingsSaving(false);
    }
  }, [equipmentSettingsDraft, fetchEquipmentTrace, fetchProductTrace, infoCompany?.inn, refreshCompanyDetails, toast]);

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
        if (responsibleFilter.trim()) params.set('responsible', responsibleFilter.trim());
        if (sortBy) params.set('sort', sortBy);
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
        const syncNowMs = Date.now();

        startTransition(() => {
          setActiveSummary(
            activeFromApi ? { ...activeFromApi, total: activeTotalFromApi } : null,
          );
          setCompanies(items);
          setDurationSyncByInn((prev) => {
            const next: Record<string, DurationSyncPoint> = {};
            for (const item of items) {
              const state = computeCompanyState(item);
              if (!state.running) continue;

              const durationRaw = Number(item.analysis_duration_ms);
              const apiDurationMs =
                Number.isFinite(durationRaw) && durationRaw >= 0 ? Math.floor(durationRaw) : null;

              if (apiDurationMs != null) {
                next[item.inn] = { baseDurationMs: apiDurationMs, syncedAtMs: syncNowMs };
                continue;
              }

              const prevSync = prev[item.inn];
              if (prevSync) {
                next[item.inn] = prevSync;
                continue;
              }

              const timelineElapsed = getActiveElapsedMs(item, syncNowMs);
              if (timelineElapsed != null) {
                next[item.inn] = { baseDurationMs: timelineElapsed, syncedAtMs: syncNowMs };
              }
            }
            return next;
          });
          setTotal(typeof data.total === 'number' ? data.total : 0);
          setAvailable(data.available ?? {});
          setIntegrationHealth(data.integration ?? null);
          setLastLoadedAt(new Date(syncNowMs).toISOString());
        });
        setLastFetchErrorAt(null);
        fetchErrorNotifiedRef.current = false;

        if (!hasActive) {
          autoRefreshDeadlineRef.current = 0;
          setAutoRefresh(false);
          setAutoRefreshRemaining(null);
        }
      } catch (error) {
        console.error('Failed to load AI analysis companies:', error);
        setLastFetchErrorAt(Date.now());
        if (!fetchErrorNotifiedRef.current) {
          toast({
            title: 'API временно недоступен',
            description:
              'Показываем последние полученные данные. При восстановлении API таблица синхронизируется автоматически.',
            variant: 'destructive',
          });
          fetchErrorNotifiedRef.current = true;
        }
      } finally {
        setLoading(false);
      }
    },
    [debouncedSearch, okvedCode, industryId, responsibleFilter, sortBy, statusFilters, toast, startTransition],
  );

  useEffect(() => {
    fetchCompanies(page, pageSize);
  }, [fetchCompanies, page, pageSize]);

  useEffect(() => {
    fetchBilling();
    const billingTimer = window.setInterval(() => {
      fetchBilling();
    }, 60000);
    return () => window.clearInterval(billingTimer);
  }, [fetchBilling]);

  useEffect(() => {
    fetchEquipmentSettings();
  }, [fetchEquipmentSettings]);

  useEffect(() => {
    if (!equipmentSettingsDialogOpen) return;
    fetchEquipmentSettings();
  }, [equipmentSettingsDialogOpen, fetchEquipmentSettings]);

  useEffect(() => {
    if (lastFetchErrorAt == null) return undefined;
    if (loading) return undefined;

    const retryTimer = setTimeout(() => {
      fetchCompanies(page, pageSize);
    }, 10000);

    return () => clearTimeout(retryTimer);
  }, [lastFetchErrorAt, loading, fetchCompanies, page, pageSize]);

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

  const openCompanyLogs = useCallback((company: AiCompany) => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams();
    if (company.inn) params.set('inn', company.inn);
    if (company.short_name) params.set('name', company.short_name);
    if (company.company_id != null && Number.isFinite(company.company_id)) {
      params.set('companyId', String(company.company_id));
    }
    const suffix = params.toString();
    const url = `/library/company-logs${suffix ? `?${suffix}` : ''}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const openCompanyInfo = useCallback(
    (company: AiCompany, options?: { fromQueue?: boolean }) => {
      setInfoCompany(company);
      if (options?.fromQueue) {
        setQueueDialogOpen(false);
      }
    },
    [],
  );

  const fetchQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const res = await fetch('/api/ai-analysis/queue');
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        items?: AiCompany[];
        summary?: QueueSummary | null;
        error?: string;
      } | null;
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `Request failed with status ${res.status}`);
      }
      const queueDataItems = data?.items;
      const queueItems = Array.isArray(queueDataItems) ? queueDataItems : [];
      setQueueItems(queueItems);
      setQueueSummary(data?.summary ?? null);
    } catch (error) {
      console.error('Failed to fetch queue', error);
      setQueueSummary(null);
      setQueueError(
        error instanceof Error && error.message ? error.message : 'Не удалось загрузить очередь. Попробуйте позже.',
      );
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (queueDialogOpen) {
      fetchQueue();
    }
  }, [fetchQueue, queueDialogOpen]);

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
        const items = Array.isArray(data.items) ? (data.items as OkvedOption[]) : [];

        const deduped = items
          .map((item: OkvedOption) => {
            const code = typeof item.okved_code === 'string' ? item.okved_code.trim() : String(item.okved_code ?? '');
            const main = typeof item.okved_main === 'string' ? item.okved_main.trim() : '';
            if (!code) return null;
            return { ...item, okved_code: code, okved_main: main } as OkvedOption;
          })
          .filter(Boolean) as OkvedOption[];

        const uniqueByCode = Array.from(
          deduped.reduce((acc, item) => {
            const existing = acc.get(item.okved_code);
            if (!existing) {
              acc.set(item.okved_code, item);
              return acc;
            }

            if (item.okved_main && item.okved_main.length > existing.okved_main.length) {
              acc.set(item.okved_code, item);
            }

            return acc;
          }, new Map<string, OkvedOption>()),
        ).map(([, value]) => value);

        setOkvedOptions(uniqueByCode);
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
    selectionAnchorInnRef.current = inn;
  }, []);

  const setSelectedRangeValue = useCallback(
    (inn: string, value: boolean | 'indeterminate', withShift: boolean) => {
      const shouldSelect = value === 'indeterminate' ? true : Boolean(value);
      const anchorInn = selectionAnchorInnRef.current;
      const currentIndex = companies.findIndex((c) => c.inn === inn);
      const anchorIndex = anchorInn ? companies.findIndex((c) => c.inn === anchorInn) : -1;

      if (!withShift || currentIndex < 0 || anchorIndex < 0) {
        setSelectedValue(inn, value);
        return;
      }

      const [start, end] = currentIndex > anchorIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex];

      setSelected((prev) => {
        const next = new Set(prev);
        for (let idx = start; idx <= end; idx += 1) {
          const rangeInn = companies[idx]?.inn;
          if (!rangeInn) continue;
          if (shouldSelect) next.add(rangeInn);
          else next.delete(rangeInn);
        }
        return next;
      });

      selectionAnchorInnRef.current = inn;
    },
    [companies, setSelectedValue],
  );

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
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
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
          analysis_duration_ms: 0,
          analysis_ok: null,
          server_error: null,
          no_valid_site: null,
          queued_at: timestamp,
        };
      }),
    );
    setDurationSyncByInn((prev) => {
      const next = { ...prev };
      inns.forEach((inn) => {
        delete next[inn];
      });
      return next;
    });
  }, []);

  const markRunning = useCallback((inns: string[]) => {
    if (!inns.length) return;
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const innSet = new Set(inns);
    setCompanies((prev) =>
      prev.map((company) => {
        if (!innSet.has(company.inn)) return company;
        return {
          ...company,
          analysis_status: 'running',
          analysis_progress: company.analysis_progress ?? 0,
          analysis_started_at: timestamp,
          analysis_finished_at: null,
          analysis_duration_ms: 0,
          analysis_ok: null,
          server_error: null,
          no_valid_site: null,
          queued_at: timestamp,
        };
      }),
    );
    setDurationSyncByInn((prev) => {
      const next = { ...prev };
      inns.forEach((inn) => {
        next[inn] = { baseDurationMs: 0, syncedAtMs: now };
      });
      return next;
    });
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
    setDurationSyncByInn((prev) => {
      const next = { ...prev };
      inns.forEach((inn) => {
        delete next[inn];
      });
      return next;
    });
  }, []);

  const markStopRequested = useCallback((inns: string[]) => {
    if (!inns.length) return;
    const innSet = new Set(inns);
    setCompanies((prev) =>
      prev.map((company) => {
        if (!innSet.has(company.inn)) return company;
        return {
          ...company,
          analysis_status: 'stop_requested',
          analysis_outcome: 'pending',
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
      lastInfoRefreshInn.current = null;
      lastEquipmentTraceInn.current = null;
      lastProductTraceInn.current = null;
      setInfoRefreshing(false);
      setEquipmentTraceById({});
      setEquipmentTraceStrategy(null);
      setEquipmentTraceReason(null);
      setEquipmentTraceLoading(false);
      setEquipmentTraceError(null);
      setProductTraceByKey({});
      setProductTraceLoading(false);
      setProductTraceError(null);
      return;
    }

    const inn = String(infoCompany.inn ?? '').trim();
    if (!inn) return;
    const shouldRefreshCompany = lastInfoRefreshInn.current !== inn;
    const shouldRefreshTrace = lastEquipmentTraceInn.current !== inn;
    const shouldRefreshProductTrace = lastProductTraceInn.current !== inn;

    if (shouldRefreshCompany) {
      refreshCompanyDetails(inn);
    }
    if (shouldRefreshTrace) {
      fetchEquipmentTrace(inn);
    }
    if (shouldRefreshProductTrace) {
      fetchProductTrace(inn);
    }
  }, [fetchEquipmentTrace, fetchProductTrace, infoCompany, refreshCompanyDetails]);

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
        body: JSON.stringify({
          inns,
          mode: launchMode,
          steps: launchMode === 'steps' ? selectedSteps : undefined,
          source: 'manual-bulk',
        }),
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

  const handleRunImmediate = useCallback(
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
      markQueued([inn]);
      try {
        const res = await fetch('/api/ai-analysis/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inns: [inn],
            mode: launchMode,
            steps: launchMode === 'steps' ? selectedSteps : undefined,
            source: 'manual-play',
          }),
        });
        const data = (await res.json().catch(() => null)) as { integration?: any; error?: string } | null;
        if (!res.ok) {
          const message = data?.error ? `Ошибка запуска: ${data.error}` : `Request failed with ${res.status}`;
          throw new Error(message);
        }
        const note = integrationSummaryText(data?.integration);
        toast({
          title: 'Анализ поставлен в очередь запуска',
          description: note && note.length > 0 ? note : `Компания ${inn}`,
        });
        fetchCompanies(page, pageSize);
        scheduleAutoRefresh();
      } catch (error) {
        console.error('Failed to run analysis', error);
        fetchCompanies(page, pageSize);
        toast({
          title: 'Ошибка запуска',
          description:
            error instanceof Error && error.message
              ? error.message
              : 'Не удалось запустить анализ. Попробуйте позже.',
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

  const handleQueueSingle = useCallback(
    async (inn: string) => {
      if (integrationOffline) {
        toast({
          title: 'AI integration недоступна',
          description: integrationHealth?.detail ?? 'Проверьте соединение с сервисом AI.',
          variant: 'destructive',
        });
        return;
      }
      setQueueInn(inn);
      try {
        const res = await fetch('/api/ai-analysis/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inns: [inn],
            mode: launchMode,
            steps: launchMode === 'steps' ? selectedSteps : undefined,
            source: 'manual-queue',
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
          title: 'Компания поставлена в очередь',
          description: note && note.length > 0 ? note : `Компания ${inn}`,
        });
        fetchCompanies(page, pageSize);
        scheduleAutoRefresh();
      } catch (error) {
        console.error('Failed to queue analysis', error);
        toast({
          title: 'Ошибка постановки в очередь',
          description:
            error instanceof Error && error.message
              ? error.message
              : 'Не удалось поставить компанию в очередь. Попробуйте позже.',
          variant: 'destructive',
        });
      } finally {
        setQueueInn(null);
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
      const data = (await res.json().catch(() => null)) as {
        removed?: number;
        running?: number;
        removedInns?: string[];
        runningInns?: string[];
      } | null;
      const removed = typeof data?.removed === 'number' ? data.removed : null;
      const running = typeof data?.running === 'number' ? data.running : null;
      const removedInns = Array.isArray(data?.removedInns)
        ? data?.removedInns?.map((inn) => String(inn ?? '').trim()).filter(Boolean) ?? []
        : [];
      const runningInns = Array.isArray(data?.runningInns)
        ? data?.runningInns?.map((inn) => String(inn ?? '').trim()).filter(Boolean) ?? []
        : [];
      const description =
        removed != null || running != null
          ? `Из очереди снято: ${removed}`
          : activeInns.length > 0
          ? `Для ${activeInns.length} ${activeInns.length === 1 ? 'компании' : 'компаний'}`
          : undefined;
      toast({ title: 'Отправлен сигнал остановки анализа', description });
      markStopped(removedInns);
      markStopRequested(runningInns);
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
  }, [companies, toast, markStopped, markStopRequested, fetchCompanies, page, pageSize]);

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
        const data = (await res.json().catch(() => null)) as {
          removed?: number;
          running?: number;
          removedInns?: string[];
          runningInns?: string[];
        } | null;
        const removed = typeof data?.removed === 'number' ? data.removed : null;
        const running = typeof data?.running === 'number' ? data.running : null;
        const removedInns = Array.isArray(data?.removedInns)
          ? data?.removedInns?.map((value) => String(value ?? '').trim()).filter(Boolean) ?? []
          : [];
        const runningInns = Array.isArray(data?.runningInns)
          ? data?.runningInns?.map((value) => String(value ?? '').trim()).filter(Boolean) ?? []
          : [];
        toast({
          title: 'Отправлен сигнал остановки',
          description:
            removed != null || running != null
              ? `Снято из очереди: ${removed}`
              : 'Команда остановки отправлена для выбранной компании.',
        });
        markStopped(removedInns);
        markStopRequested(runningInns);
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
    [toast, markStopped, markStopRequested, fetchCompanies, page, pageSize],
  );

  const handleRemoveFromQueue = useCallback(
    async (inn: string) => {
      setRemoveInn(inn);
      try {
        const res = await fetch('/api/ai-analysis/queue', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inns: [inn] }),
        });
        if (!res.ok) throw new Error(`Request failed with ${res.status}`);
        const data = (await res.json().catch(() => null)) as { removed?: number } | null;
        const removed = typeof data?.removed === 'number' ? data.removed : null;
        toast({
          title: 'Компания убрана из очереди',
          description: removed != null ? `Удалено из очереди: ${removed}` : undefined,
        });
        fetchCompanies(page, pageSize);
      } catch (error) {
        console.error('Failed to remove from queue', error);
        toast({
          title: 'Не удалось убрать из очереди',
          description: 'Попробуйте повторить попытку позже.',
          variant: 'destructive',
        });
      } finally {
        setRemoveInn(null);
      }
    },
    [fetchCompanies, page, pageSize, toast],
  );

  const handleFilterPreview = useCallback(
    async (enqueue: boolean) => {
      setFilterLoading(true);
      setFilterError(null);
      try {
        const res = await fetch('/api/ai-analysis/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: filterQuery,
            startsWith: filterStartsWith,
            statuses: filterStatuses,
            limit: filterLimit,
            includeQueued: filterIncludeQueued,
            includeRunning: filterIncludeRunning,
            dryRun: !enqueue,
          }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; total?: number; inns?: string[]; queued?: number; error?: string }
          | null;

        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || `Request failed with ${res.status}`);
        }

        if (!enqueue) {
          setFilterPreview({ total: data?.total ?? 0, inns: data?.inns ?? [] });
          toast({ title: 'Предпросмотр очереди', description: `Подобрано компаний: ${data?.total ?? 0}` });
          return;
        }

        toast({
          title: 'Компании поставлены в очередь',
          description: `Добавлено: ${data?.queued ?? 0}${
            data?.total && data.total > (data?.queued ?? 0) ? ` из ${data.total}` : ''
          }`,
        });
        setFilterDialogOpen(false);
        fetchCompanies(page, pageSize);
        scheduleAutoRefresh();
      } catch (error) {
        console.error('Queue filter action failed', error);
        setFilterError(
          error instanceof Error && error.message ? error.message : 'Не удалось обработать запрос. Попробуйте позже.',
        );
        toast({
          title: 'Ошибка очереди',
          description:
            error instanceof Error && error.message
              ? error.message
              : 'Не удалось обработать фильтр для очереди. Попробуйте позже.',
          variant: 'destructive',
        });
      } finally {
        setFilterLoading(false);
      }
    },
    [
      filterQuery,
      filterStartsWith,
      filterStatuses,
      filterLimit,
      filterIncludeQueued,
      filterIncludeRunning,
      toast,
      fetchCompanies,
      page,
      pageSize,
      scheduleAutoRefresh,
    ],
  );

  const headerCheckedState = useMemo(() => {
    if (!companies.length) return false;
    const selectedOnPage = companies.filter((c) => selected.has(c.inn)).length;
    if (selectedOnPage === 0) return false;
    if (selectedOnPage === companies.length) return true;
    return 'indeterminate' as const;
  }, [companies, selected]);

  const topEquipment = (
    company: AiCompany,
    analyzer?: AiAnalyzerInfo | null,
  ): Array<{
    name: string;
    id?: string;
    score?: number | null;
    hash_equipment?: string | null;
    industryId?: string;
    prodclassId?: string;
    workshopId?: string;
    href?: string | null;
    trace?: EquipmentScoreTrace;
  }> => {
    type EquipmentItem = {
      name: string;
      id?: string;
      score?: number | null;
      hash_equipment?: string | null;
      industryId?: string;
      prodclassId?: string;
      workshopId?: string;
      href?: string | null;
      trace?: EquipmentScoreTrace;
    };

    const normalizeEquipmentItem = (item: any): EquipmentItem | null => {
      if (!item) return null;
      if (typeof item === 'string') {
        const name = item.trim();
        return name ? { name } : null;
      }

      if (typeof item === 'object') {
        const name = String(
          item?.name ?? item?.label ?? item?.equipment ?? item?.equipment_name ?? item?.title ?? '',
        ).trim();
        const id =
          item?.id ??
          item?.equipment_id ??
          item?.equipmentId ??
          item?.equipment_ID ??
          item?.match_id ??
          item?.code ??
          item?.goods_type_id ??
          null;
        const score =
          item?.equipment_score ?? item?.score ?? item?.match_score ?? item?.goods_types_score ?? undefined;
        const hashEquipment = item?.hash_equipment ?? null;

        if (!name && id == null) return null;
        return {
          name: name || String(id),
          id: id != null ? String(id) : undefined,
          score: score ?? undefined,
          hash_equipment: hashEquipment ? String(hashEquipment) : undefined,
          industryId:
            item?.industry_id != null ? String(item.industry_id) : item?.industryId != null ? String(item.industryId) : undefined,
          prodclassId:
            item?.prodclass_id != null ? String(item.prodclass_id) : item?.prodclassId != null ? String(item.prodclassId) : undefined,
          workshopId:
            item?.workshop_id != null ? String(item.workshop_id) : item?.workshopId != null ? String(item.workshopId) : undefined,
        };
      }

      const value = String(item).trim();
      return value ? { name: value } : null;
    };

    const pushItem = (item: EquipmentItem | null, acc: EquipmentItem[]) => {
      if (!item?.name) return;
      acc.push({
        name: item.name.trim(),
        id: item.id?.trim() || undefined,
        score: item.score,
        hash_equipment: item.hash_equipment?.trim() || undefined,
        industryId: item.industryId?.trim() || undefined,
        prodclassId: item.prodclassId?.trim() || undefined,
        workshopId: item.workshopId?.trim() || undefined,
      });
    };

    const items: EquipmentItem[] = [];
    const raw = company.analysis_equipment;

    if (Array.isArray(raw)) {
      raw.forEach((item) => pushItem(normalizeEquipmentItem(item), items));
    }

    if (analyzer?.ai?.equipment?.length) {
      analyzer.ai.equipment.forEach((item) => pushItem(normalizeEquipmentItem(item), items));
    }

    const uniqueByName = items.reduce<EquipmentItem[]>((acc, item) => {
      const key = item.name.trim().toLowerCase();
      const existingIndex = acc.findIndex((entry) => entry.name.trim().toLowerCase() === key);
      if (existingIndex === -1) {
        acc.push(item);
        return acc;
      }

      const existing = acc[existingIndex];
      const existingHasLinkData = Boolean(existing.id);
      const nextHasLinkData = Boolean(item.id);
      const existingScore = typeof existing.score === 'number' && Number.isFinite(existing.score) ? existing.score : -1;
      const nextScore = typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : -1;

      if ((!existingHasLinkData && nextHasLinkData) || (existingHasLinkData === nextHasLinkData && nextScore > existingScore)) {
        acc[existingIndex] = item;
      }

      return acc;
    }, []);

    const mergedItems: EquipmentItem[] = [];
    const mergedById = new Map<string, number>();
    const mergedByName = new Map<string, number>();

    const normalizeItemId = (value: string | null | undefined): string | null => {
      const normalized = String(value ?? '').trim();
      return normalized ? normalized.toLowerCase() : null;
    };

    const normalizeItemName = (value: string | null | undefined): string | null => {
      const normalized = String(value ?? '').trim();
      return normalized ? normalized.toLowerCase() : null;
    };

    const upsertMergedItem = (candidate: EquipmentItem) => {
      const normalizedId = normalizeItemId(candidate.id);
      const normalizedName = normalizeItemName(candidate.name);
      const existingIndex =
        (normalizedId != null ? mergedById.get(normalizedId) : undefined) ??
        (normalizedName != null ? mergedByName.get(normalizedName) : undefined) ??
        -1;

      if (existingIndex === -1) {
        const nextIndex = mergedItems.push(candidate) - 1;
        if (normalizedId != null) mergedById.set(normalizedId, nextIndex);
        if (normalizedName != null) mergedByName.set(normalizedName, nextIndex);
        return;
      }

      const existing = mergedItems[existingIndex];
      const mergedTrace = candidate.trace ?? existing.trace;
      const mergedName = candidate.name || existing.name;
      const mergedId = candidate.id ?? existing.id;
      const mergedScore =
        mergedTrace?.final_score ??
        candidate.score ??
        existing.trace?.final_score ??
        existing.score;

      mergedItems[existingIndex] = {
        ...existing,
        ...candidate,
        name: mergedName,
        id: mergedId,
        score: mergedScore,
        hash_equipment: candidate.hash_equipment ?? existing.hash_equipment,
        industryId: candidate.industryId ?? existing.industryId,
        prodclassId: candidate.prodclassId ?? existing.prodclassId,
        workshopId: candidate.workshopId ?? existing.workshopId,
        href: candidate.href ?? existing.href,
        trace: mergedTrace,
      };

      const nextId = normalizeItemId(mergedId);
      const nextName = normalizeItemName(mergedName);
      if (nextId != null) mergedById.set(nextId, existingIndex);
      if (nextName != null) mergedByName.set(nextName, existingIndex);
    };

    uniqueByName.forEach((item) => {
      upsertMergedItem({
        ...item,
        href: buildEquipmentCardHref(item),
      });
    });

    Object.values(equipmentTraceById).forEach((trace) => {
      const equipmentId = trace.equipment_id?.trim();
      const equipmentName = trace.equipment_name?.trim() || equipmentId || '';
      if (!equipmentName) return;
      upsertMergedItem({
        name: equipmentName,
        id: equipmentId || undefined,
        score: trace.final_score ?? undefined,
        href: buildEquipmentCardHref({ id: equipmentId || undefined }),
        trace,
      });
    });

    const topLimit = Math.min(100, Math.max(1, Math.round(Number(equipmentSettings.top_equipment_limit) || 10)));
    const minScore = Math.min(1, Math.max(0, Number(equipmentSettings.min_equipment_score) || 0));

    return mergedItems
      .sort((a, b) => {
        const scoreA = a.trace?.final_score ?? a.score;
        const scoreB = b.trace?.final_score ?? b.score;
        const hasScoreA = typeof scoreA === 'number' && Number.isFinite(scoreA);
        const hasScoreB = typeof scoreB === 'number' && Number.isFinite(scoreB);

        if (hasScoreA && hasScoreB) return scoreB - scoreA;
        if (hasScoreA) return -1;
        if (hasScoreB) return 1;
        return a.name.localeCompare(b.name, 'ru');
      })
      .filter((item) => {
        const scoreValue = item.trace?.final_score ?? item.score;
        const score = typeof scoreValue === 'number' && Number.isFinite(scoreValue) ? scoreValue : null;
        return score == null || score >= minScore;
      })
      .slice(0, topLimit);
  };

  const isObjectObjectPlaceholder = (value: string): boolean => value.trim().toLowerCase() === '[object object]';

  const isMeaningfulTnvedName = (value: string): boolean => {
    const normalized = value.trim();
    if (!normalized) return false;
    return !/^\d+(?:[.,]\d+)?$/.test(normalized);
  };

  const normalizeTnvedValue = (value: unknown): string => {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const normalized = String(value).trim();
      return isObjectObjectPlaceholder(normalized) ? '' : normalized;
    }
    if (Array.isArray(value)) {
      return value
        .map((entry) => normalizeTnvedValue(entry))
        .filter(Boolean)
        .join(', ')
        .trim();
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const candidate =
        record.name ??
        record.title ??
        record.product ??
        record.goods ??
        record.value ??
        record.label ??
        record.text ??
        '';
      const fromCandidate = normalizeTnvedValue(candidate);
      if (fromCandidate) return fromCandidate;

      return Object.values(record)
        .map((entry) => normalizeTnvedValue(entry))
        .find(Boolean) || '';
    }
    return '';
  };


  const tnvedProducts = (
    company: AiCompany,
    analyzer?: AiAnalyzerInfo | null,
  ): Array<{
    name: string;
    code?: string;
    id?: string;
    score?: number | null;
    source?: 'site' | 'okved' | null;
    goodsTypeSource?: string | null;
  }> => {
    const raw = company.analysis_tnved;
    const items: Array<{
      name: string;
      code?: string;
      id?: string;
      score?: number | null;
      source?: 'site' | 'okved' | null;
      goodsTypeSource?: string | null;
    }> = [];
    const seen = new Set<string>();
    if (raw) {
      const arr = Array.isArray(raw) ? raw : [raw];
      const normalizedRawItems = arr.flatMap(
        (item: any): Array<{
          name: string;
          code?: string;
          id?: string;
          score?: number | null;
          source?: 'site' | 'okved' | null;
          goodsTypeSource?: string | null;
        }> => {
          if (!item) return [];

          if (typeof item === 'string') {
            const name = normalizeTnvedValue(item);
            return isMeaningfulTnvedName(name) ? [{ name }] : [];
          }

          if (typeof item === 'object') {
            const name = normalizeTnvedValue(
              item?.name ??
                item?.title ??
                item?.product ??
                item?.goods ??
                item?.value ??
                item?.product_name ??
                item?.goods_name ??
                item?.description ??
                item?.text ??
                item,
            );
            const code = normalizeTnvedValue(item?.tnved ?? item?.code ?? item?.tn_ved ?? item?.tnved_code ?? item?.tnvedCode ?? '');
            const score = Number(
              item?.bigdata_similarity ?? item?.big_data_similarity ?? item?.vector_similarity ?? item?.score ?? item?.goods_types_score,
            );
            const idValue =
              item?.goods_type_id ??
              item?.match_id ??
              item?.id ??
              item?.goods_id ??
              item?.product_id ??
              null;
            const source =
              normalizeDetectionSource(
                item?.source ??
                  item?.detected_from ??
                  item?.detection_source ??
                  item?.origin ??
                  item?.from,
              ) ??
              (item?.url || item?.domain ? 'site' : null);
            const goodsTypeSource =
              typeof item?.goods_type_source === 'string'
                ? item.goods_type_source
                : typeof item?.goods_source === 'string'
                  ? item.goods_source
                  : null;
            const hasName = isMeaningfulTnvedName(name);
            if (!hasName && !code) return [];
            return [
              {
                name: hasName ? name : code,
                code: code || undefined,
                id: idValue != null ? String(idValue) : undefined,
                score: Number.isFinite(score) ? score : undefined,
                source,
                goodsTypeSource,
              },
            ];
          }

          const name = normalizeTnvedValue(item);
          return name ? [{ name }] : [];
        },
      );

      items.push(...normalizedRawItems);
    }

    if (!items.length && analyzer?.ai?.products?.length) {
      const analyzerProducts = analyzer.ai.products.reduce<Array<{
        name: string;
        code?: string;
        id?: string;
        score?: number | null;
        source?: 'site' | 'okved' | null;
        goodsTypeSource?: string | null;
      }>>((acc, item) => {
        const name = normalizeTnvedValue(item?.name);
        const code = normalizeTnvedValue(item?.tnved_code) || undefined;
        const score = Number(item?.score);
        const id = item?.id ?? item?.goods_type_id ?? item?.match_id ?? null;
        if (!name && !code) return acc;
        acc.push({
          name: name || code || '—',
          code,
          id: id != null ? String(id) : undefined,
          score: Number.isFinite(score) ? score : undefined,
          source: 'site',
          goodsTypeSource: typeof item?.goods_type_source === 'string' ? item.goods_type_source : undefined,
        });
        return acc;
      }, []);

      items.push(...analyzerProducts);
    }

    const minProductScore = Math.min(1, Math.max(0, Number(equipmentSettings.min_product_score) || 0));

    return items.reduce<Array<{
      name: string;
      code?: string;
      id?: string;
      score?: number | null;
      source?: 'site' | 'okved' | null;
      goodsTypeSource?: string | null;
    }>>((acc, item) => {
      const key = `${item.name?.trim().toLowerCase() || ''}|${item.code?.trim().toLowerCase() || ''}|${item.id?.trim().toLowerCase() || ''}`;
      if (!item.name || seen.has(key)) return acc;
      if (typeof item.score === 'number' && Number.isFinite(item.score) && item.score < minProductScore) return acc;
      seen.add(key);
      const source = item.source ?? (item.code && !item.score ? 'okved' : null);
      acc.push({
        name: item.name.trim(),
        code: item.code?.trim() || undefined,
        id: item.id?.trim() || undefined,
        score: item.score ?? undefined,
        source,
        goodsTypeSource: typeof item.goodsTypeSource === 'string' ? item.goodsTypeSource : undefined,
      });
      return acc;
    }, []);
  };

  const topProducts = (
    company: AiCompany,
    analyzer?: AiAnalyzerInfo | null,
  ): Array<{
    name: string;
    code?: string;
    id?: string;
    score?: number | null;
    source?: 'site' | 'okved' | null;
    goodsTypeSource?: string | null;
    trace?: ProductTraceItem;
  }> => {
    const merged = new Map<string, {
      name: string;
      code?: string;
      id?: string;
      score?: number | null;
      source?: 'site' | 'okved' | null;
      goodsTypeSource?: string | null;
      trace?: ProductTraceItem;
    }>();

    const upsert = (candidate: {
      name: string;
      code?: string;
      id?: string;
      score?: number | null;
      source?: 'site' | 'okved' | null;
      goodsTypeSource?: string | null;
      trace?: ProductTraceItem;
    }) => {
      const lookupKey =
        buildProductTraceLookupKey(candidate.id, candidate.name) ??
        buildProductTraceLookupKey(candidate.trace?.goods_type_id, candidate.trace?.goods_type_name);
      if (!lookupKey || !candidate.name?.trim()) return;

      const existing = merged.get(lookupKey);
      if (!existing) {
        merged.set(lookupKey, candidate);
        return;
      }

      const candidateScore = candidate.trace?.goods_types_score ?? candidate.score ?? -1;
      const existingScore = existing.trace?.goods_types_score ?? existing.score ?? -1;
        merged.set(lookupKey, {
          ...existing,
          ...candidate,
          name: candidate.name || existing.name,
          code: candidate.code ?? existing.code,
          id: candidate.id ?? existing.id,
          source: candidate.source ?? existing.source,
          goodsTypeSource: candidate.goodsTypeSource ?? existing.goodsTypeSource,
          trace: candidate.trace ?? existing.trace,
          score: candidateScore > existingScore ? candidate.score : existing.score,
        });
      };

    tnvedProducts(company, analyzer).forEach((item) => {
      upsert(item);
    });

    Object.values(productTraceByKey).forEach((trace) => {
      upsert({
        name: trace.goods_type_name?.trim() || trace.goods_type_id?.trim() || '—',
        id: trace.goods_type_id?.trim() || undefined,
        score: trace.goods_types_score ?? undefined,
        source: null,
        goodsTypeSource: trace.goods_type_source ?? undefined,
        trace,
      });
    });

    const minProductScore = Math.min(1, Math.max(0, Number(equipmentSettings.min_product_score) || 0));

    return Array.from(merged.values())
      .filter((item) => {
        const displayScore = item.trace?.goods_types_score ?? item.score;
        return displayScore == null || displayScore >= minProductScore;
      })
      .sort((left, right) => {
        const leftScore = left.trace?.goods_types_score ?? left.score ?? -1;
        const rightScore = right.trace?.goods_types_score ?? right.score ?? -1;
        if (leftScore !== rightScore) return rightScore - leftScore;
        const leftTop = left.trace?.top_equipment_score ?? -1;
        const rightTop = right.trace?.top_equipment_score ?? -1;
        if (leftTop !== rightTop) return rightTop - leftTop;
        return left.name.localeCompare(right.name, 'ru');
      });
  };

  const prodclassScoreValue =
    analyzerProdclass?.score ??
    toFiniteNumber(infoCompany?.analysis_match_level) ??
    null;
  const scoreSource =
    infoCompany?.score_source ??
    analyzerInfo?.ai?.score_source ??
    analyzerInfo?.ai?.prodclass?.score_source ??
    null;
  const isFallbackBySource = scoreSource === 'okved_fallback';
  const hasFallbackDomain = (infoCompany?.analysis_domain || '').toLowerCase() === OKVED_FALLBACK_DOMAIN;
  const hasSiteScores = [
    analyzerProdclass?.score,
    analyzerDescriptionScore,
    analyzerDescriptionOkvedScore,
    analyzerOkvedScore,
    infoCompany?.description_score,
    infoCompany?.description_okved_score,
    infoCompany?.okved_score,
  ].some((value) => value != null);
  const isFallbackByNullScores = !hasSiteScores;
  const normalizedEquipmentTraceStrategy = equipmentTraceStrategy?.trim().toLowerCase() || null;
  const showOkvedFallbackBadge =
    normalizedEquipmentTraceStrategy === 'okved'
      ? true
      : normalizedEquipmentTraceStrategy === 'site'
        ? false
        : isFallbackBySource || isFallbackByNullScores || hasFallbackDomain;
  const prodclassScoreText = formatMatchScore(prodclassScoreValue);
  const prodclassRawScoreText = formatRawScore(prodclassScoreValue);
  const prodclassDescription =
    analyzerProdclass && analyzerProdclass.name && analyzerProdclass.label && analyzerProdclass.name !== analyzerProdclass.label
      ? analyzerProdclass.name
      : null;
  const okvedMatchText =
    formatMatchScore(analyzerDescriptionOkvedScore ?? null) ||
    formatMatchScore(analyzerOkvedScore ?? infoCompany?.okved_score ?? null);
  const analysisDomainValueRaw =
    infoCompany?.analysis_domain ||
    analyzerInfo?.company?.domain1_site ||
    analyzerInfo?.company?.domain2_site ||
    analyzerSites[0] ||
    null;
  const analysisDomainValue =
    analysisDomainValueRaw?.toLowerCase() === OKVED_FALLBACK_DOMAIN ? null : analysisDomainValueRaw;
  const billingBalanceLabel = formatBillingBalanceLabel(billing);
  const billingSourceLabel = formatBillingSourceLabel(billing?.source);
  const analyzerDescriptionText =
    infoCompany?.analysis_description ||
    [analyzerInfo?.company?.domain1, analyzerInfo?.company?.domain2].filter(Boolean).join('\n') ||
    null;

  const buildEquipmentCardHref = (item: { id?: string; industryId?: string; prodclassId?: string; workshopId?: string }) => {
    if (!item.id) return null;
    const params = new URLSearchParams({ tab: 'library', equipmentId: item.id });
    if (item.industryId) params.set('industryId', item.industryId);
    if (item.prodclassId) params.set('prodclassId', item.prodclassId);
    if (item.workshopId) params.set('workshopId', item.workshopId);
    return `/library?${params.toString()}`;
  };

  return (
    <TooltipProvider>
      <div className="space-y-4 py-4">
        <Card className="border border-border/60 shadow-sm">
          <CardHeader className="space-y-4 border-b bg-muted/30 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-lg font-semibold tracking-tight">
                  AI-анализ компаний
                </CardTitle>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground lg:justify-end">
                {stopSignalAt && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-destructive/40 bg-destructive/10 text-destructive"
                  >
                    Остановка запрошена
                  </Badge>
                )}
                <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <div className="flex items-center gap-1 rounded-md border bg-background px-2 py-1">
                    <span className="text-muted-foreground">Всего компаний</span>
                    <span className="font-semibold">{total.toLocaleString('ru-RU')}</span>
                  </div>
                  <div className="flex items-center gap-1 rounded-md border bg-background px-2 py-1">
                    <span className="text-muted-foreground">Активных сейчас</span>
                    <span className="flex items-center gap-1 font-semibold">
                      {activeTotal.toLocaleString('ru-RU')}
                      {activeTotal > 0 && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 rounded-md border bg-background px-2 py-1">
                    <span className="text-muted-foreground">API:</span>
                    <span className="font-semibold">{billingBalanceLabel}</span>
                  </div>
                </div>
                {(lastLoadedAt || integrationHost) && (
                  <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm text-foreground">
                    <span className="text-muted-foreground">Обновлено:</span>
                    <span className="font-semibold">
                      {lastLoadedAt
                        ? new Date(lastLoadedAt).toLocaleTimeString('ru-RU', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : '—'}
                    </span>
                    {integrationHost && (
                      <span
                        className={cn(
                          'rounded-md px-2 py-1 text-xs font-semibold text-background',
                          integrationHealth?.available ? 'bg-emerald-500' : 'bg-destructive',
                        )}
                        title={integrationHealth?.detail ?? undefined}
                      >
                        IP {integrationHost}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  data-testid="ai-analysis-filters-button"
                  type="button"
                  variant={hasFilters ? 'secondary' : 'outline'}
                  className="h-9 gap-2"
                  onClick={() => setFiltersDialogOpen(true)}
                >
                  <Filter className="h-4 w-4" />
                  Фильтры
                  {hasFilters && (
                    <Badge variant="outline" className="px-1 text-[11px]">
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>
                {hasFilters && (
                  <Button type="button" variant="ghost" size="sm" className="h-9" onClick={resetFilters}>
                    Сбросить
                  </Button>
                )}
                <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5">
                  <span className="text-xs text-muted-foreground">Сортировка</span>
                  <Select
                    value={sortBy}
                    onValueChange={(value) => {
                      setSortBy(value as CompanySortKey);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[260px] border-0 bg-transparent px-0 text-sm shadow-none focus:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {companySortOptions.map((option) => (
                        <SelectItem key={option.key} value={option.key}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
                      variant="outline"
                      className="h-9"
                      onClick={() => setEquipmentSettingsDialogOpen(true)}
                    >
                      <Settings2 className="mr-2 h-4 w-4" /> Настройки
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Коэффициенты путей, пороги и лимит оборудования в рейтинге
                  </TooltipContent>
                </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9"
                    onClick={() => setFilterDialogOpen(true)}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Добавить по фильтру
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Массово поставить в очередь по условиям
                </TooltipContent>
              </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9"
                      onClick={() => setQueueDialogOpen(true)}
                    >
                      <ClipboardList className="mr-2 h-4 w-4" /> Очередь
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Посмотреть и управлять очередью</TooltipContent>
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
            {(search.trim() || industryId !== 'all' || okvedCode || sortBy !== 'revenue_desc') && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {search.trim() && (
                  <Badge variant="secondary" className="max-w-full whitespace-normal">
                    Поиск: {search.trim()}
                  </Badge>
                )}
                {industryId !== 'all' && (
                  <Badge variant="secondary" className="max-w-full whitespace-normal">
                    Отрасль: {industries.find((item) => String(item.id) === industryId)?.industry ?? industryId}
                  </Badge>
                )}
                {okvedCode && (
                  <Badge variant="secondary" className="max-w-full whitespace-normal">
                    ОКВЭД: {okvedCode}
                  </Badge>
                )}
                {sortBy !== 'revenue_desc' && (
                  <Badge variant="secondary" className="max-w-full whitespace-normal">
                    Сортировка: {formatCompanySortLabel(sortBy)}
                  </Badge>
                )}
              </div>
            )}
            <div
              className={cn(
                'flex flex-col gap-2 rounded-lg border bg-background/60 p-3',
                !showRunModePanel && 'hidden',
              )}
              aria-hidden={!showRunModePanel}
            >
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
                      const nextSize = PAGE_SIZE_OPTIONS.includes(num) ? num : 20;
                      setPageSize(nextSize);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[90px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((size) => (
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
              <div className="relative overflow-x-auto rounded-lg border border-border/60 bg-background">
                {isRefreshing && (
                  <div className="pointer-events-none absolute right-4 top-3 z-10 flex items-center gap-2 rounded-full bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Обновляем данные…
                  </div>
                )}
                <table
                  data-testid="ai-analysis-table"
                  className="w-full table-fixed border-separate border-spacing-0 text-sm"
                  style={{ minWidth: tableMinWidth }}
                >
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="w-12 px-4 py-3 align-middle">
                          <Checkbox
                            checked={headerCheckedState}
                            onCheckedChange={(value) => toggleSelectAll(Boolean(value))}
                            aria-label="Выбрать все"
                          />
                        </th>
                        <th className="relative px-4 py-3 text-left" style={columnStyle('company')}>
                          <div className="flex items-center justify-between gap-2">
                            <span>Компания</span>
                            {renderResizeHandle('company')}
                          </div>
                        </th>
                        <th className="relative px-4 py-3 text-left" style={columnStyle('metrics')}>
                          <div className="flex items-center justify-between gap-2">
                            <span>Выручка, млн</span>
                            {renderResizeHandle('metrics')}
                          </div>
                        </th>
                        <th className="relative px-4 py-3 text-left" style={columnStyle('sites')}>
                          <div className="flex items-center justify-between gap-2">
                            <span>Сайты</span>
                            {renderResizeHandle('sites')}
                          </div>
                        </th>
                        <th className="relative px-4 py-3 text-left" style={columnStyle('emails')}>
                          <div className="flex items-center justify-between gap-2">
                            <span>Email</span>
                            {renderResizeHandle('emails')}
                          </div>
                        </th>
                        <th className="relative px-4 py-3 text-left" style={columnStyle('status')}>
                          <div className="flex items-center justify-between gap-2">
                            <span>Запуски и статус</span>
                            {renderResizeHandle('status')}
                          </div>
                        </th>
                        <th className="relative px-4 py-3 text-right" style={columnStyle('actions')}>
                          <div className="flex items-center justify-end gap-2">
                            <span>Действия</span>
                            {renderResizeHandle('actions')}
                          </div>
                        </th>
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
                        const okvedFallbackUsed = isOkvedFallbackUsed(company, sites);
                        const emails = toStringArray(company.emails);
                        const companyLabel = formatCompanyDisplayName(
                          company.short_name,
                          company.company_id,
                        );
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
                        const duration = formatDuration(
                          getSyncedDurationMs(company, state.running, nowMs, durationSyncByInn[company.inn]),
                        );
                        const attempts = company.analysis_attempts != null ? company.analysis_attempts : '—';
                        const score = formatAnalysisScore(resolveAnalysisScoreValue(company));
                        const responsibleLabel = company.responsible?.trim() || '—';
                        const progressPercent = Math.min(
                          100,
                          Math.max(0, Math.round((company.analysis_progress ?? 0) * 100)),
                        );
                        const liveProgress = state.running || state.queued;
                        const liveStageLabel = state.queued
                          ? 'В очереди…'
                          : currentStage || 'Выполняется…';
                        const runDisabled =
                          runInn === company.inn ||
                          bulkLoading ||
                          state.running ||
                          state.queued ||
                          integrationOffline;
                        const queueDisabled =
                          queueInn === company.inn ||
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
                          : 'Поставить в очередь и запустить обработку';
                        const queueTooltip = integrationOffline
                          ? integrationHealth?.detail
                            ? `AI integration недоступна: ${integrationHealth.detail}`
                            : 'AI integration недоступна'
                          : state.running
                          ? 'Анализ выполняется'
                          : state.queued
                          ? 'Компания уже в очереди'
                          : 'Поставить в очередь';
                        const stopIsRemove = state.queued && !state.running;
                        const stopBusy = stopInn === company.inn || removeInn === company.inn;
                        const stopAction = stopIsRemove ? handleRemoveFromQueue : handleStopSingle;
                        const stopTooltip = stopIsRemove ? 'Убрать из очереди' : 'Отменить запуск';

                        return (
                          <tr
                            data-testid={`ai-analysis-company-row-${company.inn}`}
                            key={company.inn}
                            className={cn(
                              'border-b border-border/60 align-top outline outline-0 -outline-offset-1 transition-[outline-color,box-shadow]',
                              companySelected && 'ring-1 ring-primary/40',
                              rowTone,
                              outcome.rowHoverBorderClass,
                            )}
                          >
                            <td className="px-4 py-4 align-top">
                              <Checkbox
                                checked={companySelected}
                                onCheckedChange={(value) => setSelectedRangeValue(company.inn, value, false)}
                                onClick={(event) => {
                                  if (!event.shiftKey) return;
                                  event.preventDefault();
                                  setSelectedRangeValue(company.inn, !companySelected, true);
                                }}
                                aria-label={`Выбрать компанию ${companyLabel}`}
                              />
                            </td>
                            <td className="px-4 py-4 align-top" style={columnStyle('company')}>
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <outcome.icon className={cn('h-4 w-4', outcome.iconClass)} />
                                  <div
                                    className={cn(
                                      'text-sm font-semibold leading-tight',
                                      outcome.textClass ?? 'text-foreground',
                                    )}
                                  >
                                    {companyLabel}
                                  </div>
                                  <SquareImgButton
                                    icon="bitrix"
                                    title="Открыть компанию в Bitrix24 по ИНН"
                                    onClick={() =>
                                      window.open(
                                        `/api/b24/resolve-company?inn=${encodeURIComponent(company.inn)}&mode=pick`,
                                        '_blank',
                                        'noopener',
                                      )
                                    }
                                    className="mt-[1px] shrink-0"
                                    sizeClassName="h-7 w-7"
                                  />
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
                                    Ответственный: <span className="text-foreground">{responsibleLabel}</span>
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
                                  <span>
                                    Tokens: <span className="text-foreground">{formatTokens(company.tokens_total)}</span>
                                    {' '}({formatTokens(company.input_tokens)} / {formatTokens(company.cached_input_tokens)} / {formatTokens(company.output_tokens)})
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4 align-top text-xs" style={columnStyle('metrics')}>
                              <div className="space-y-2">
                                <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
                                  <div className="h-[45px] w-[100px] shrink-0 overflow-hidden">
                                    <InlineRevenueBars
                                      mode="stack"
                                      revenue={[company.revenue_3, company.revenue_2, company.revenue_1, company.revenue]}
                                      income={[company.income_3, company.income_2, company.income_1, null]}
                                      year={company.year}
                                    />
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4 align-top text-xs" style={columnStyle('sites')}>
                              <div>
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
                                  <div className="mt-1 space-y-1">
                                    <span className="text-muted-foreground">—</span>
                                    {okvedFallbackUsed && (
                                      <div className="text-[11px] text-amber-700">Нет сайта · подбор по ОКВЭД</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4 align-top text-xs" style={columnStyle('emails')}>
                              <div>
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
                            </td>
                            <td className="px-4 py-4 align-top text-xs" style={columnStyle('status')}>
                              <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                                  {liveProgress && (
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
                                    <div className={SCORE_VALUE_CLASS}>{score}</div>
                                  </div>
                                </div>
                                {finishedAt && (
                                  <div className="text-[11px] text-muted-foreground">
                                    Завершено: <span className="text-foreground">{finishedAt}</span>
                                  </div>
                                )}
                                {okvedFallbackUsed && (
                                  <div className="text-[11px] text-amber-700">
                                    Сайт не найден — выполнена попытка подбора по ОКВЭД
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4 align-top text-right" style={columnStyle('actions')}>
                              <div className="flex flex-col items-end gap-2">
                                <div className="flex items-center justify-end gap-2">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => handleRunImmediate(company.inn)}
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
                                        variant="outline"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => handleQueueSingle(company.inn)}
                                        disabled={queueDisabled}
                                      >
                                        {queueInn === company.inn ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <Clock3 className="h-4 w-4" />
                                        )}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">{queueTooltip}</TooltipContent>
                                  </Tooltip>
                                  {(state.running || state.queued) && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          type="button"
                                          variant="destructive"
                                          size="icon"
                                          className="h-8 w-8"
                                          onClick={() => stopAction(company.inn)}
                                          disabled={stopBusy}
                                          aria-label={`Остановить компанию ${companyLabel}`}
                                        >
                                          {stopBusy ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            <Square className="h-4 w-4" />
                                          )}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="bottom">{stopTooltip}</TooltipContent>
                                    </Tooltip>
                                  )}
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        data-testid={`ai-analysis-company-info-${company.inn}`}
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => openCompanyInfo(company)}
                                        aria-label={`Подробности по компании ${companyLabel}`}
                                      >
                                        <Info className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">Подробнее</TooltipContent>
                                  </Tooltip>
                                </div>
                                {liveProgress ? (
                                  <div className="w-full space-y-2 text-left">
                                    <Progress value={progressPercent} className="h-2" />
                                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                      <span>{liveStageLabel}</span>
                                      <span>{progressPercent}%</span>
                                    </div>
                                  </div>
                                ) : steps.length ? (
                                  <div className="w-full space-y-2 text-left">
                                    <ul className="space-y-1 text-xs text-muted-foreground">
                                      {steps.slice(0, 3).map((step, index) => (
                                        <li key={`${company.inn}-step-${index}`} className="flex items-start gap-2">
                                          <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-muted-foreground/60" />
                                          <span className="text-foreground">{step.label}</span>
                                          {step.status && (
                                            <span className="text-muted-foreground">· {translatePipelineStatus(step.status)}</span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : state.queued ? (
                                  <div className="w-full space-y-1 text-left text-xs text-muted-foreground">
                                    <Badge variant="outline" className="w-fit">
                                      Ожидает запуска
                                    </Badge>
                                    {queuedTime && <div>с {queuedTime}</div>}
                                  </div>
                                ) : null}
                                {showDebugStepButtons && (
                                  <div className="flex flex-wrap items-center justify-end gap-1 rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
                                    <span className="font-medium text-foreground">Шаги:</span>
                                    {stepOptions.map((opt) => {
                                      const loading =
                                        debugStepLoading?.inn === company.inn && debugStepLoading.step === opt.key;
                                      return (
                                        <Tooltip key={`${company.inn}-debug-${opt.key}`}>
                                          <TooltipTrigger asChild>
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              className="h-7"
                                              onClick={() => handleRunDebugStep(company.inn, opt.key)}
                                              disabled={
                                                integrationOffline || !!debugStepLoading || state.running || state.queued
                                              }
                                            >
                                              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : opt.label}
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent side="bottom">
                                            Запустить только шаг «{opt.label}» для компании {companyLabel}
                                          </TooltipContent>
                                        </Tooltip>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {!companies.length && !isRefreshing && (
                        <tr>
                          <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                            Данные не найдены
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>

              </div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={filtersDialogOpen} onOpenChange={setFiltersDialogOpen}>
          <DialogContent data-testid="ai-analysis-filters-dialog" className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Фильтры AI-анализа</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <span className="text-[11px] uppercase text-muted-foreground">Поиск</span>
                <Input
                  className="h-9 text-sm"
                  placeholder="Поиск по названию или ИНН"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <span className="text-[11px] uppercase text-muted-foreground">Ответственный</span>
                <Input
                  data-testid="ai-analysis-filters-search"
                  className="h-9 text-sm"
                  placeholder="Поиск по ответственному"
                  value={responsibleFilter}
                  onChange={(e) => setResponsibleFilter(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <span className="text-[11px] uppercase text-muted-foreground">Сортировка</span>
                <Select
                  value={sortBy}
                  onValueChange={(value) => {
                    setSortBy(value as CompanySortKey);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-9 w-full text-left text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {companySortOptions.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <span className="text-[11px] uppercase text-muted-foreground">Отрасль</span>
                  <div className="flex items-center gap-2">
                    <Select value={industryId} onValueChange={(value) => setIndustryId(value)}>
                      <SelectTrigger
                        className="h-9 w-full text-left text-sm"
                        disabled={industriesLoading && industries.length === 0}
                      >
                        <SelectValue placeholder="Все отрасли" />
                      </SelectTrigger>
                      <SelectContent className="min-w-full sm:min-w-[420px]">
                        <SelectItem value="all">Все отрасли</SelectItem>
                        {industries.map((item) => (
                          <SelectItem key={item.id} value={String(item.id)}>
                            {item.industry}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {industriesLoading && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] uppercase text-muted-foreground">ОКВЭД</span>
                  <Select
                    value={okvedSelectValue}
                    onValueChange={(value) => setOkvedCode(value === '__all__' ? undefined : value)}
                  >
                    <SelectTrigger className="h-9 w-full text-left text-sm">
                      <SelectValue placeholder="Все коды">
                        {selectedOkved ? (
                          <div className="flex flex-col gap-0.5 text-left">
                            <span className="font-medium text-foreground">{selectedOkved.okved_code}</span>
                            {selectedOkved.okved_main && (
                              <span className="text-xs text-muted-foreground whitespace-normal break-words">
                                {truncateText(selectedOkved.okved_main, 120)}
                              </span>
                            )}
                          </div>
                        ) : null}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="min-w-full sm:min-w-[480px] lg:min-w-[620px]">
                      <SelectItem value="__all__">Все коды</SelectItem>
                      {okvedOptions.map((item) => (
                        <SelectItem key={item.id} value={item.okved_code} title={item.okved_main}>
                          <div className="flex flex-col gap-0.5 text-left">
                            <span className="font-medium text-foreground">{item.okved_code}</span>
                            <span className="text-xs text-muted-foreground whitespace-normal break-words">
                              {truncateText(item.okved_main, 160)}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-[11px] uppercase text-muted-foreground">Статусы</span>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {statusOptions.map((option) => (
                    <label
                      key={option.key}
                      className={cn(
                        'flex items-center gap-3 rounded-md border bg-muted/50 px-3 py-2 text-sm',
                        available?.[option.field] === false && 'opacity-60',
                      )}
                    >
                      <Checkbox
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
                      />
                      <span className="text-foreground">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {hasFilters ? 'Применены пользовательские фильтры.' : 'Фильтры не выбраны.'}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                    Сбросить фильтры
                  </Button>
                  <Button type="button" onClick={() => setFiltersDialogOpen(false)}>
                    Готово
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={equipmentSettingsDialogOpen}
          onOpenChange={(open) => {
            setEquipmentSettingsDialogOpen(open);
            if (open) {
              setEquipmentSettingsDraft(equipmentSettings);
              setEquipmentSettingsError(null);
              return;
            }
            setEquipmentSettingsError(null);
          }}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Настройки расчёта оборудования</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                <div>Версия настроек: <span className="font-medium text-foreground">{equipmentSettings.version}</span></div>
                <div>
                  Последнее обновление:{' '}
                  <span className="font-medium text-foreground">
                    {equipmentSettings.updated_at ? formatDate(equipmentSettings.updated_at) + ' ' + formatTime(equipmentSettings.updated_at) : '—'}
                  </span>
                </div>
                <div className="mt-1 text-xs">
                  После сохранения коэффициенты применяются к новым пересчётам. Для открытой карточки мы сразу запускаем пересчёт snapshot-а.
                </div>
              </div>

              {equipmentSettingsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загружаем настройки…
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="okved-threshold">Порог OKVED</Label>
                    <Input
                      id="okved-threshold"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={equipmentSettingsDraft.okved_threshold}
                      onChange={(event) => setEquipmentSettingsDraft((prev) => ({ ...prev, okved_threshold: Number(event.target.value) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="top-equipment-limit">Лимит TOP оборудования</Label>
                    <Input
                      id="top-equipment-limit"
                      type="number"
                      step="1"
                      min="1"
                      max="100"
                      value={equipmentSettingsDraft.top_equipment_limit}
                      onChange={(event) => setEquipmentSettingsDraft((prev) => ({ ...prev, top_equipment_limit: Number(event.target.value) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="e1-direct-factor">K для SCORE_E1 direct</Label>
                    <Input
                      id="e1-direct-factor"
                      type="number"
                      step="0.01"
                      min="0"
                      value={equipmentSettingsDraft.e1_direct_factor}
                      onChange={(event) => setEquipmentSettingsDraft((prev) => ({ ...prev, e1_direct_factor: Number(event.target.value) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="e1-fallback-factor">K для SCORE_E1 fallback</Label>
                    <Input
                      id="e1-fallback-factor"
                      type="number"
                      step="0.01"
                      min="0"
                      value={equipmentSettingsDraft.e1_fallback_factor}
                      onChange={(event) => setEquipmentSettingsDraft((prev) => ({ ...prev, e1_fallback_factor: Number(event.target.value) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="e2-factor">K для SCORE_E2</Label>
                    <Input
                      id="e2-factor"
                      type="number"
                      step="0.01"
                      min="0"
                      value={equipmentSettingsDraft.e2_factor}
                      onChange={(event) => setEquipmentSettingsDraft((prev) => ({ ...prev, e2_factor: Number(event.target.value) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="e3-factor">K для SCORE_E3</Label>
                    <Input
                      id="e3-factor"
                      type="number"
                      step="0.01"
                      min="0"
                      value={equipmentSettingsDraft.e3_factor}
                      onChange={(event) => setEquipmentSettingsDraft((prev) => ({ ...prev, e3_factor: Number(event.target.value) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="min-equipment-score">Минимальный рейтинг оборудования</Label>
                    <Input
                      id="min-equipment-score"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={equipmentSettingsDraft.min_equipment_score}
                      onChange={(event) => setEquipmentSettingsDraft((prev) => ({ ...prev, min_equipment_score: Number(event.target.value) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="min-product-score">Минимальный рейтинг продукции</Label>
                    <Input
                      id="min-product-score"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={equipmentSettingsDraft.min_product_score}
                      onChange={(event) => setEquipmentSettingsDraft((prev) => ({ ...prev, min_product_score: Number(event.target.value) }))}
                    />
                  </div>
                </div>
              )}

              {equipmentSettingsError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {equipmentSettingsError}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEquipmentSettingsDialogOpen(false)}
                disabled={equipmentSettingsSaving}
              >
                Отмена
              </Button>
              <Button type="button" onClick={saveEquipmentSettings} disabled={equipmentSettingsLoading || equipmentSettingsSaving}>
                {equipmentSettingsSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Сохраняем…
                  </>
                ) : 'Сохранить'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={queueDialogOpen} onOpenChange={setQueueDialogOpen}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>Очередь анализа</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="text-muted-foreground">
                  {queueLoading
                    ? 'Загружаем очередь…'
                    : `В очереди и работе: ${(queueSummary?.total ?? queueItems.length).toLocaleString('ru-RU')}`}
                </div>
                <div className="flex items-center gap-2">
                  {queueError && <span className="text-xs text-destructive">{queueError}</span>}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={fetchQueue}
                    disabled={queueLoading}
                    className="gap-2"
                  >
                    <RefreshCw className={cn('h-4 w-4', queueLoading && 'animate-spin')} />
                    Обновить
                  </Button>
                </div>
              </div>
              {queueSummary && !queueLoading && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border bg-muted/20 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      Всего задач
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <div className="text-2xl font-semibold tabular-nums text-foreground">
                        {queueSummary.total}
                      </div>
                      <Badge variant="secondary">Очередь</Badge>
                    </div>
                  </div>
                  <div className="rounded-2xl border bg-muted/20 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      В работе
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <div className="text-2xl font-semibold tabular-nums text-foreground">
                        {queueSummary.running}
                      </div>
                      <div className="text-right text-[11px] text-muted-foreground">
                        {queueSummary.stop_requested > 0 ? `Стопов: ${queueSummary.stop_requested}` : 'Без остановок'}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border bg-muted/20 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      В ожидании
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <div className="text-2xl font-semibold tabular-nums text-foreground">
                        {queueSummary.queued}
                      </div>
                      <div className="text-right text-[11px] text-muted-foreground">
                        {queueSummary.retry_scheduled > 0
                          ? `Повторов: ${queueSummary.retry_scheduled}`
                          : 'Без повторов'}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border bg-muted/20 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      Контроль
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <div className="text-2xl font-semibold tabular-nums text-foreground">
                        {queueSummary.expedited}
                      </div>
                      <div className="text-right text-[11px] text-muted-foreground">
                        {queueSummary.leased > 0 ? `Под блокировкой: ${queueSummary.leased}` : 'Блокировок нет'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="max-h-[460px] space-y-3 overflow-y-auto rounded-2xl border bg-muted/20 p-3">
                {queueLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Обновляем очередь…
                  </div>
                ) : queueItems.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Очередь пуста.</div>
                ) : (
                  queueItems.map((item) => {
                    const state = computeCompanyState(item);
                    const outcome = resolveOutcome(item, state);
                    const badge = getStatusBadge(item, outcome);
                    const itemCompanyLabel = formatCompanyDisplayName(item.short_name, item.company_id);
                    const queuedTime = formatTime(item.queued_at ?? null);
                    const statusLabel = formatStatusLabel(item.analysis_status ?? 'queued');
                    const attemptsValue = toFiniteNumber(item.analysis_attempts);
                    const attempts = attemptsValue != null ? Math.max(0, Math.floor(attemptsValue)) : '—';
                    const scoreValue = resolveAnalysisScoreValue(item);
                    const score = formatAnalysisScore(scoreValue);
                    const queuePriorityLabel = formatQueuePriorityLabel(item.queue_priority);
                    const queueSourceLabel = formatQueueSourceLabel(item.queue_source);
                    const queueRetryKindLabel = formatQueueRetryKind(item.queue_last_error_kind);
                    const leaseUntil = formatTime(item.lease_expires_at ?? null);
                    const nextRetryAt = formatTime(item.next_retry_at ?? null);
                    const progressValue = toFiniteNumber(item.analysis_progress);
                    const progressPercent =
                      progressValue != null ? Math.min(100, Math.max(0, Math.round(progressValue * 100))) : null;
                    const queueAttemptCount =
                      toFiniteNumber(item.queue_attempt_count) != null
                        ? Math.max(0, Math.floor(toFiniteNumber(item.queue_attempt_count)!))
                        : null;
                    const queueRetries =
                      toFiniteNumber(item.queue_defer_count) != null
                        ? Math.max(0, Math.floor(toFiniteNumber(item.queue_defer_count)!))
                        : 0;
                    const queueErrorText = truncateText(item.queue_last_error, 120);

                    return (
                      <div
                        key={`queue-${item.inn}`}
                        className="rounded-2xl border bg-background/95 p-4 shadow-sm transition-colors hover:border-foreground/20"
                      >
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                          <button
                            type="button"
                            className="min-w-0 flex-1 rounded-xl text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => openCompanyInfo(item, { fromQueue: true })}
                          >
                            <div className="space-y-3 p-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-base font-semibold text-foreground">
                                  {itemCompanyLabel}
                                </span>
                                <Badge variant={badge.variant}>{badge.label}</Badge>
                                <Badge variant="outline" className="whitespace-nowrap text-foreground">
                                  {statusLabel}
                                </Badge>
                              </div>

                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                <span>ИНН {item.inn}</span>
                                {queuedTime && <span>В очереди с {queuedTime}</span>}
                                <span>Попыток запуска: {attempts}</span>
                              </div>

                              <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                                <div className="rounded-xl border bg-muted/20 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                    Источник
                                  </div>
                                  <div className="mt-1 text-sm font-medium text-foreground">
                                    {queueSourceLabel}
                                  </div>
                                </div>
                                <div className="rounded-xl border bg-muted/20 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                    Приоритет
                                  </div>
                                  <div className="mt-1 text-sm font-medium text-foreground">
                                    {queuePriorityLabel}
                                  </div>
                                </div>
                                <div className="rounded-xl border bg-muted/20 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                    Очередь
                                  </div>
                                  <div className="mt-1 text-sm font-medium text-foreground">
                                    {queueAttemptCount != null ? `Попытка ${queueAttemptCount}` : 'Ожидает запуска'}
                                  </div>
                                </div>
                                <div className="rounded-xl border bg-muted/20 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                    Контроль
                                  </div>
                                  <div className="mt-1 text-sm font-medium text-foreground">
                                    {item.queue_state === 'running' && item.lease_expires_at
                                      ? `До ${leaseUntil}`
                                      : item.next_retry_at
                                      ? `Повтор в ${nextRetryAt}`
                                      : 'Под контролем'}
                                  </div>
                                </div>
                              </div>

                              {(progressPercent != null || queueRetries > 0 || queueRetryKindLabel || queueErrorText) && (
                                <div className="space-y-2">
                                  {progressPercent != null && progressPercent > 0 && (
                                    <div className="space-y-1">
                                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                        <span>Текущий прогресс</span>
                                        <span>{progressPercent}%</span>
                                      </div>
                                      <Progress value={progressPercent} className="h-2" />
                                    </div>
                                  )}
                                  <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                    {queueRetries > 0 && (
                                      <Badge variant="outline" className="rounded-full px-2 py-0.5 font-normal">
                                        Повторы: {queueRetries}
                                      </Badge>
                                    )}
                                    {queueRetryKindLabel && (
                                      <Badge variant="outline" className="rounded-full px-2 py-0.5 font-normal">
                                        Причина: {queueRetryKindLabel}
                                      </Badge>
                                    )}
                                  </div>
                                  {queueErrorText && (
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                      Последняя ошибка: {queueErrorText}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </button>

                          <div className="flex shrink-0 flex-col gap-3 xl:min-w-[210px]">
                            <div className="rounded-2xl border bg-muted/20 px-4 py-3 text-right">
                              <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                Оценка
                              </div>
                              <div className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
                                {score}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {scoreValue != null ? 'Доступна для перехода в карточку' : 'Появится после расчёта'}
                              </div>
                            </div>

                            <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
                              <Button
                                type="button"
                                variant="outline"
                                className="justify-between gap-2"
                                onClick={() => openCompanyInfo(item, { fromQueue: true })}
                              >
                                <span className="inline-flex items-center gap-2">
                                  <Info className="h-4 w-4" />
                                  Карточка
                                </span>
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                className="justify-between gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={removeInn === item.inn}
                                onClick={async () => {
                                  await handleRemoveFromQueue(item.inn);
                                  fetchQueue();
                                }}
                              >
                                <span className="inline-flex items-center gap-2">
                                  {removeInn === item.inn ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                  Удалить
                                </span>
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={filterDialogOpen}
          onOpenChange={(open) => {
            setFilterDialogOpen(open);
            setFilterError(null);
            if (!open) setFilterPreview(null);
          }}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Добавить организации в очередь по фильтру</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[11px] uppercase text-muted-foreground">Поиск</span>
                  <Input
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    placeholder="Название или ИНН"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase text-muted-foreground">Начинается с</span>
                  <Input
                    value={filterStartsWith}
                    onChange={(e) => setFilterStartsWith(e.target.value)}
                    placeholder="Например, М"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase text-muted-foreground">Лимит</span>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={filterLimit}
                    onChange={(e) => setFilterLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
                  />
                </label>
                <div className="space-y-2">
                  <div className="text-[11px] uppercase text-muted-foreground">Статусы</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: 'not_started', label: 'Ещё не запускались' },
                      { key: 'failed', label: 'С ошибками' },
                      { key: 'partial', label: 'Частично' },
                      { key: 'completed', label: 'Успешные' },
                    ].map((item) => (
                      <label key={item.key} className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1">
                        <Checkbox
                          checked={filterStatuses.includes(item.key)}
                          onCheckedChange={(checked) => {
                            setFilterStatuses((prev) =>
                              checked ? Array.from(new Set([...prev, item.key])) : prev.filter((key) => key !== item.key),
                            );
                          }}
                        />
                        <span>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={filterIncludeQueued}
                    onCheckedChange={(checked) => setFilterIncludeQueued(Boolean(checked))}
                  />
                  Включать уже в очереди
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={filterIncludeRunning}
                    onCheckedChange={(checked) => setFilterIncludeRunning(Boolean(checked))}
                  />
                  Включать выполняющиеся
                </label>
              </div>

              {filterError && <div className="text-sm text-destructive">{filterError}</div>}
              {filterPreview && !filterError && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                  Подборка: {filterPreview.total.toLocaleString('ru-RU')} компаний
                  {filterPreview.inns.length > 0 && (
                    <span className="block text-xs text-muted-foreground">Пример: {filterPreview.inns.slice(0, 5).join(', ')}</span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleFilterPreview(false)}
                  disabled={filterLoading}
                >
                  {filterLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Предпросмотр
                </Button>
                <Button type="button" onClick={() => handleFilterPreview(true)} disabled={filterLoading}>
                  {filterLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Поставить в очередь
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!infoCompany} onOpenChange={(open) => !open && setInfoCompany(null)}>
          <DialogContent
            data-testid="ai-analysis-company-dialog"
            className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-background p-5 sm:p-6"
          >
            <DialogHeader>
              <DialogTitle data-testid="ai-analysis-company-dialog-title">
                {formatCompanyDisplayName(infoCompany?.short_name, infoCompany?.company_id ?? null)} · ИНН{' '}
                {infoCompany?.inn ?? ''}
              </DialogTitle>
              {infoRefreshing && (
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Обновляем данные компании…
                </div>
              )}
            </DialogHeader>
            {infoCompany && (
              <Tabs defaultValue="main" className="flex min-h-0 flex-1 flex-col gap-4 text-sm">
                <TabsList className="grid w-full grid-cols-3 rounded-xl bg-muted/60 p-1">
                  <TabsTrigger value="main" className="rounded-lg data-[state=active]:shadow-sm">Основная информация</TabsTrigger>
                  <TabsTrigger value="logs" className="rounded-lg data-[state=active]:shadow-sm">Логи и запуск</TabsTrigger>
                  <TabsTrigger value="billing" className="rounded-lg data-[state=active]:shadow-sm">Расходы</TabsTrigger>
                </TabsList>
                <TabsContent
                  value="logs"
                  className="mt-0 hidden h-full min-h-0 flex-1 flex-col space-y-4 overflow-y-auto pr-1 data-[state=active]:flex"
                >
                {(() => {
                  const steps = toPipelineSteps(infoCompany.analysis_pipeline);
                  const state = computeCompanyState(infoCompany);
                  const outcome = resolveOutcome(infoCompany, state);
                  const status = getStatusBadge(infoCompany, outcome);
                  const progressPercent = Math.min(
                    100,
                    Math.max(0, Math.round((toFiniteNumber(infoCompany.analysis_progress) ?? 0) * 100)),
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
                  const duration = formatDuration(
                    getSyncedDurationMs(
                      infoCompany,
                      state.running,
                      nowMs,
                      durationSyncByInn[infoCompany.inn],
                    ),
                  );
                  const attemptsValue = toFiniteNumber(infoCompany.analysis_attempts);
                  const attempts = attemptsValue != null ? Math.max(0, Math.floor(attemptsValue)) : undefined;
                  const infoSites = toSiteArray(infoCompany.sites);
                  const okvedFallbackUsed = isOkvedFallbackUsed(infoCompany, infoSites);
                  const scoreRaw = formatAnalysisScore(resolveAnalysisScoreValue(infoCompany));
                  const score = scoreRaw !== '—' ? scoreRaw : undefined;

                  return (
                    <div className="space-y-4 rounded-2xl border bg-gradient-to-br from-background via-background to-muted/30 p-5 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={status.variant}>{status.label}</Badge>
                            {okvedFallbackUsed && (
                              <Badge variant="outline" className="border-amber-300 text-amber-700">
                                Подбор по ОКВЭД
                              </Badge>
                            )}
                          </div>
                          <div className="space-y-1">
                            <div className="text-lg font-semibold text-foreground">Сводка по последнему запуску</div>
                            <div className="max-w-2xl text-sm text-muted-foreground">
                              {state.running
                                ? 'Анализ выполняется прямо сейчас. Карточка обновляется по мере поступления новых шагов.'
                                : infoCompany.analysis_finished_at || infoCompany.analysis_started_at
                                ? 'Здесь собраны ключевые метрики последнего запуска и текущий статус обработки компании.'
                                : 'По компании ещё не было завершённого запуска. Как только он появится, здесь отобразятся шаги и итоговые метрики.'}
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[360px]">
                          <div className="flex min-h-[96px] flex-col justify-center rounded-2xl border bg-background/80 px-4 py-3 text-center">
                            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                              Оценка
                            </div>
                            <div className="mt-2 text-3xl font-semibold leading-none tabular-nums text-foreground">
                              {score ?? '—'}
                            </div>
                          </div>
                          <div className="flex min-h-[96px] flex-col justify-center rounded-2xl border bg-background/80 px-4 py-3 text-center">
                            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                              Прогресс
                            </div>
                            <div className="mt-2 text-3xl font-semibold leading-none tabular-nums text-foreground">
                              {progressPercent}%
                            </div>
                          </div>
                          <div className="flex min-h-[96px] flex-col justify-center rounded-2xl border bg-background/80 px-4 py-3 text-center">
                            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                              Длительность
                            </div>
                            <div className="mt-2 text-3xl font-semibold leading-none tabular-nums text-foreground">
                              {duration}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-xl border bg-background/80 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                            Поставлено в очередь
                          </div>
                          <div className="mt-1 text-foreground">{queuedAt}</div>
                        </div>
                        <div className="rounded-xl border bg-background/80 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                            Начало
                          </div>
                          <div className="mt-1 text-foreground">{startedAt}</div>
                        </div>
                        <div className="rounded-xl border bg-background/80 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                            Завершение
                          </div>
                          <div className="mt-1 text-foreground">{finishedAt}</div>
                        </div>
                        <div className="rounded-xl border bg-background/80 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                            Попыток
                          </div>
                          <div className="mt-1 text-foreground">{attempts ?? '—'}</div>
                        </div>
                        {infoCompany.queued_by && (
                          <div className="rounded-xl border bg-background/80 px-4 py-3 sm:col-span-2 xl:col-span-4">
                            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                              Поставил в очередь
                            </div>
                            <div className="mt-1 text-foreground">{infoCompany.queued_by}</div>
                          </div>
                        )}
                      </div>

                      {state.running && (
                        <div className="space-y-2 rounded-xl border bg-background/80 px-4 py-3">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Выполнение анализа</span>
                            <span>{progressPercent}%</span>
                          </div>
                          <Progress value={progressPercent} className="h-2" />
                        </div>
                      )}

                      {steps.length > 0 && (
                        <div className="space-y-2 rounded-xl border bg-background/80 px-4 py-3">
                          <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                            Последний пайплайн
                          </div>
                          <ol className="grid gap-2 text-[13px] text-foreground md:grid-cols-2">
                            {steps.map((step, idx) => (
                              <li
                                key={`${infoCompany.inn}-dlg-step-${idx}`}
                                className="rounded-lg border bg-muted/20 px-3 py-2"
                              >
                                <div className="font-medium">{step.label}</div>
                                {step.status ? (
                                  <div className="mt-0.5 text-xs text-muted-foreground">
                                    {translatePipelineStatus(step.status)}
                                  </div>
                                ) : null}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  );
                })()}

                  <div className="flex min-h-[280px] flex-col space-y-3 rounded-xl border bg-background/90 p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="uppercase">Логи задачи</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => infoCompany && openCompanyLogs(infoCompany)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span className="ml-1">Открыть</span>
                    </Button>
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

                  <div className="min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border bg-muted/20">
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
                          <div key={log.id} className="space-y-1.5 px-3 py-2.5">
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
                </TabsContent>

                <TabsContent
                  value="main"
                  className="mt-0 hidden h-full min-h-0 flex-1 flex-col space-y-4 overflow-y-auto pr-1 pb-2 data-[state=active]:flex"
                >
                <div
                  data-testid="ai-analysis-company-equipment"
                  className="rounded-xl border bg-background/90 p-4 shadow-sm"
                >
                  <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Сводка по компании</div>
                  <div className="grid gap-3 md:grid-cols-4">
                  <div className="flex min-h-[94px] flex-col justify-center rounded-lg border bg-muted/20 px-4 py-3 text-center">
                    <div className="text-xs text-muted-foreground">Уровень соответствия и найденный класс предприятия</div>
                    <div className="space-y-1 font-medium">
                      {showOkvedFallbackBadge && (
                        <div className="text-sm text-amber-600">Класс определён по ОКВЭД (сайт недоступен)</div>
                      )}
                      <div className="flex flex-wrap items-baseline justify-center gap-2">
                        <span className="text-base sm:text-lg">
                          {showOkvedFallbackBadge ? 'Подбор по ОКВЭД' : prodclassScoreText || '—'}
                        </span>
                        {!showOkvedFallbackBadge && prodclassRawScoreText && (
                          <span className="text-xs text-muted-foreground">(расчёт: {prodclassRawScoreText})</span>
                        )}
                      </div>
                      {prodclassDescription && (
                        <div className="text-sm text-muted-foreground">{prodclassDescription}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex min-h-[94px] flex-col justify-center rounded-lg border bg-muted/20 px-4 py-3 text-center">
                    <div className="text-xs text-muted-foreground">Основной ОКВЭД (DaData)</div>
                    <div className="font-medium">{infoCompany.main_okved || '—'}</div>
                  </div>
                  <div className="flex min-h-[94px] flex-col justify-center rounded-lg border bg-muted/20 px-4 py-3 text-center">
                    <div className="text-xs text-muted-foreground">Домен для парсинга</div>
                    <div className="font-medium">
                      {showOkvedFallbackBadge && !analysisDomainValue ? 'Нет сайта' : analysisDomainValue || '—'}
                    </div>
                  </div>
                  <div className="flex min-h-[94px] flex-col justify-center rounded-lg border bg-muted/20 px-4 py-3 text-center">
                    <div className="text-xs text-muted-foreground">
                      Соответствие ИИ-описания сайта и ОКВЭД
                    </div>
                    <div className="font-medium">{showOkvedFallbackBadge ? 'Сайт не найден' : okvedMatchText || '—'}</div>
                  </div>
                </div>
                </div>

                <div className="rounded-xl border bg-background/90 p-4 shadow-sm">
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">ИИ-описание сайта</div>
                  <div className="rounded-lg border bg-muted/20 p-3 text-sm whitespace-pre-wrap">
                    {analyzerDescriptionText || (showOkvedFallbackBadge ? 'Сайт не найден — использован подбор по ОКВЭД.' : '—')}
                  </div>
                </div>

                <div className="rounded-xl border bg-background/90 p-4 shadow-sm">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Топ-10 оборудования</div>
                  {(() => {
                    const equipmentItems = topEquipment(infoCompany, analyzerInfo);
                    const traceStatusNote = equipmentTraceLoading ? (
                      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>{'\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0440\u0430\u0441\u0447\u0435\u0442\u0430'}</span>
                      </div>
                    ) : equipmentTraceError ? (
                      <div className="mb-2 text-xs text-amber-600">{equipmentTraceError}</div>
                    ) : null;

                    if (!equipmentItems.length) {
                      return (
                        <div className="space-y-2">
                          {traceStatusNote}
                          <div className="text-muted-foreground">{'\u0414\u0430\u043D\u043D\u044B\u0435 \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u044E\u0442'}</div>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-2">
                        {traceStatusNote}
                        <ul data-testid="ai-analysis-company-equipment-list" className="grid gap-2 sm:grid-cols-2">
                          {equipmentItems.map((item, idx) => {
                            const trace = item.trace ?? (item.id ? equipmentTraceById[item.id] : undefined);
                            const cardView = buildEquipmentCardView({
                              itemName: item.name,
                              itemScore: item.score ?? null,
                              trace,
                              showOkvedFallbackBadge,
                            });
                            const displayFinalScore = cardView.displayFinalScore;
                            const scoreLabel = cardView.scoreLabel;
                            const matchedSiteEquipment =
                              cardView.context?.kind === 'site' ? cardView.context.value : null;
                            const matchedProductName =
                              cardView.context?.kind === 'product' ? cardView.context.value : null;
                            const originName =
                              cardView.context?.kind === 'okved' || cardView.context?.kind === 'origin'
                                ? cardView.context.value
                                : null;
                            const matchedSiteScore =
                              cardView.context?.kind === 'site' ? cardView.context.scoreLabel ?? null : null;
                            const calcPathLabel = cardView.calcPathLabel;
                            const finalSourceLabel = cardView.finalSourceLabel;
                            const originLabel = cardView.originLabel;
                            const displayVectorScore = cardView.breakdown?.vector.value ?? null;
                            const displayGenScore = cardView.breakdown?.gen.value ?? null;
                            const displayFactor = cardView.breakdown?.factor.value ?? null;
                            const hasTraceBreakdown = [
                              displayVectorScore,
                              displayGenScore,
                              displayFactor,
                              displayFinalScore,
                            ].some((value) => value != null);

                            return (
                              <li
                                key={`${item.name}-${item.id ?? idx}`}
                                className="rounded-lg border bg-muted/20 px-3 py-3"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="truncate pr-2 font-medium leading-snug text-foreground">
                                      {cardView.equipmentName}
                                    </div>
                                    {matchedProductName ? (
                                      <div className="text-[11px] text-muted-foreground">
                                        <span className="font-medium text-foreground/90">Найдено через продукцию:</span>{' '}
                                        {matchedProductName}
                                      </div>
                                    ) : matchedSiteEquipment ? (
                                      <div className="text-[11px] text-muted-foreground">
                                        <span className="font-medium text-foreground/90">Найдено на сайте:</span>{' '}
                                        {matchedSiteEquipment}
                                        {matchedSiteScore ? ` (${matchedSiteScore})` : ''}
                                      </div>
                                    ) : trace?.origin_kind === 'okved' || showOkvedFallbackBadge ? (
                                      <div className="text-[11px] text-muted-foreground">
                                        <span className="font-medium text-foreground/90">Подбор:</span>{' '}
                                        {originName || 'по ОКВЭД'}
                                      </div>
                                    ) : originName ? (
                                      <div className="text-[11px] text-muted-foreground">
                                        <span className="font-medium text-foreground/90">Источник:</span>{' '}
                                        {originName}
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="flex shrink-0 items-center justify-end gap-2 self-start">
                                    <Badge variant="outline" className="min-w-[72px] justify-center rounded-full text-[12px] tabular-nums">
                                      {scoreLabel}
                                    </Badge>
                                    {item.href ? (
                                      <Button asChild type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                                        <a href={item.href} target="_blank" rel="noopener noreferrer">
                                          <ExternalLink className="h-3.5 w-3.5" />
                                        </a>
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                                  {hasTraceBreakdown ? (
                                    <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
                                      <div className="whitespace-nowrap">
                                        <span className="font-medium text-foreground/90">VECTOR:</span>{' '}
                                        {formatSimilarityScore(displayVectorScore) ?? formatRawScore(displayVectorScore) ?? '\u2014'}
                                      </div>
                                      <div className="whitespace-nowrap">
                                        <span className="font-medium text-foreground/90">GEN:</span>{' '}
                                        {formatSimilarityScore(displayGenScore) ?? formatRawScore(displayGenScore) ?? '\u2014'}
                                      </div>
                                      <div className="whitespace-nowrap">
                                        <span className="font-medium text-foreground/90">K:</span>{' '}
                                        {formatRawScore(displayFactor) ?? '\u2014'}
                                      </div>
                                      <div className="whitespace-nowrap">
                                        <span className="font-medium text-foreground/90">FINAL:</span>{' '}
                                        {formatSimilarityScore(displayFinalScore) ?? formatRawScore(displayFinalScore) ?? '\u2014'}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-[11px] text-muted-foreground">
                                      Детали расчета пока не переданы сервисом.
                                    </div>
                                  )}
                                  {(calcPathLabel || finalSourceLabel || originLabel) && (
                                    <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                                      {calcPathLabel && (
                                        <Badge variant="outline" className="h-7 rounded-full px-3 text-[11px]">
                                          {calcPathLabel}
                                        </Badge>
                                      )}
                                      {finalSourceLabel && (
                                        <Badge variant="outline" className="h-7 rounded-full px-3 text-[11px]">
                                          {finalSourceLabel}
                                        </Badge>
                                      )}
                                      {originLabel && (
                                        <Badge variant="outline" className="h-7 rounded-full px-3 text-[11px]">
                                          {originLabel}
                                        </Badge>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })()}
                </div>

                <div className="rounded-xl border bg-background/90 p-4 shadow-sm">
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Виды найденной продукции на сайте и ТНВЭД
                  </div>
                  {(() => {
                    const productItems = topProducts(infoCompany, analyzerInfo);
                    const traceStatusNote = productTraceLoading ? (
                      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Загружаем связи продукции с оборудованием</span>
                      </div>
                    ) : productTraceError ? (
                      <div className="mb-2 text-xs text-amber-600">{productTraceError}</div>
                    ) : null;

                    if (!productItems.length) {
                      return (
                        <div className="space-y-2">
                          {traceStatusNote}
                          <div className="text-muted-foreground">нет данных</div>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-2">
                        {traceStatusNote}
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {productItems.map((item, idx) => {
                            const traceLookupKey = buildProductTraceLookupKey(item.id, item.name);
                            const trace = item.trace ?? (traceLookupKey ? productTraceByKey[traceLookupKey] : undefined);
                            const displayScore = trace?.goods_types_score ?? item.score ?? null;
                            const displayFactor = trace?.factor ?? null;
                            const goodsTypeSourceLabel = formatGoodsTypeSource(trace?.goods_type_source ?? item.goodsTypeSource);
                            const linkedEquipment = trace?.linked_equipment ?? [];

                            return (
                              <li
                                key={`${item.name}-${item.id ?? idx}`}
                                className="rounded-lg border bg-muted/20 px-3 py-2.5"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 space-y-1">
                                    <div className="font-medium leading-snug text-foreground">
                                      {trace?.goods_type_name || item.name}
                                    </div>
                                    {item.code && (
                                      <div className="text-[11px] text-muted-foreground">
                                        <span className="font-medium text-foreground/90">ТН ВЭД:</span>{' '}
                                        {item.code}
                                      </div>
                                    )}
                                    {trace ? (
                                      <div className="text-[11px] text-muted-foreground">
                                        <span className="font-medium text-foreground/90">Связано с оборудованием:</span>{' '}
                                        {trace.linked_equipment_count}
                                        {displayFactor != null ? ` · K: ${formatRawScore(displayFactor) ?? displayFactor}` : ''}
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="flex min-w-[118px] flex-col items-end justify-center gap-2 self-start">
                                    <Badge variant="outline" className="text-[12px]">
                                      {displayScore != null ? formatSimilarityScore(displayScore) ?? formatRawScore(displayScore) : '—'}
                                    </Badge>
                                    <div className="flex items-center justify-end gap-2">
                                      <Badge variant="outline" className="text-[12px]">
                                        Источник: {item.source === 'okved' ? 'ОКВЭД' : item.source === 'site' ? 'сайт' : 'не указан'}
                                      </Badge>
                                      {goodsTypeSourceLabel && (
                                        <Badge variant="outline" className="text-[12px]">
                                          {goodsTypeSourceLabel}
                                        </Badge>
                                      )}
                                      {displayScore == null && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Badge variant="outline" className="text-[12px]">?</Badge>
                                          </TooltipTrigger>
                                          <TooltipContent>не сматчено со справочником</TooltipContent>
                                        </Tooltip>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {linkedEquipment.length ? (
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {linkedEquipment.slice(0, 3).map((equipment) => (
                                      <Badge
                                        key={`${item.name}-${equipment.equipment_id}`}
                                        variant="outline"
                                        className="max-w-full rounded-full px-3 text-[11px]"
                                      >
                                        <span className="truncate">
                                          {equipment.equipment_name || `Оборудование #${equipment.equipment_id}`}
                                          {equipment.final_score != null
                                            ? ` · ${formatSimilarityScore(equipment.final_score) ?? formatRawScore(equipment.final_score)}`
                                            : ''}
                                        </span>
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })()}
                </div>

                </TabsContent>

                <TabsContent
                  value="billing"
                  className="mt-0 hidden h-full min-h-0 flex-1 flex-col overflow-y-auto pr-1 data-[state=active]:flex"
                >
                <div className="space-y-3 rounded-xl border bg-background/90 p-4 shadow-sm">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Расходы AI-интеграции</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                      <div className="text-xs text-muted-foreground">API баланс</div>
                      <div className="mt-1 space-y-1">
                        <div>Доступный баланс (USD): <span className="font-medium">{billingBalanceLabel}</span></div>
                        <div>Лимит (USD): <span className="font-medium">{formatBillingValue(billing?.limit_usd)}</span></div>
                        <div>Потрачено за месяц (USD): <span className="font-medium">{formatBillingValue(billing?.spend_month_to_date_usd)}</span></div>
                        {billingSourceLabel && (
                          <div>Источник: <span className="font-medium">{billingSourceLabel}</span></div>
                        )}
                        {billing?.last_snapshot_at && (
                          <div>Снимок: <span className="font-medium">{formatDate(billing.last_snapshot_at)} {formatTime(billing.last_snapshot_at)}</span></div>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                      <div className="text-xs text-muted-foreground">По компании</div>
                      <div className="mt-1 space-y-1">
                        <div>Всего токенов: <span className="font-medium">{formatOptionalTokens(infoCompany?.analysis_cost?.tokens_total ?? infoCompany?.tokens_total)}</span></div>
                        <div>Стоимость (USD): <span className="font-medium">{formatUsd(infoCompany?.analysis_cost?.cost_usd ?? infoCompany?.cost_total_usd)}</span></div>
                      </div>
                    </div>
                  </div>
                </div>

                </TabsContent>

              </Tabs>
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

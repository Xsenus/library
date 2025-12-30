'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock3,
  ClipboardList,
  FileText,
  Filter,
  Info,
  Loader2,
  Plus,
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

const PAGE_SIZE_STORAGE_KEY = 'ai-analysis-page-size';
const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 75, 100];

type ColumnWidthKey = 'company' | 'contacts' | 'status' | 'pipeline' | 'actions';

const DEFAULT_COLUMN_WIDTHS: Record<ColumnWidthKey, number> = {
  company: 250,
  contacts: 190,
  status: 300,
  pipeline: 220,
  actions: 150,
};

const MIN_COLUMN_WIDTHS: Record<ColumnWidthKey, number> = {
  company: 250,
  contacts: 190,
  status: 240,
  pipeline: 220,
  actions: 150,
};

const COLUMN_ORDER: ColumnWidthKey[] = ['company', 'contacts', 'status', 'pipeline', 'actions'];

const COLUMN_WIDTHS_KEY = 'ai-analysis-column-widths';

type PipelineStep = { label: string; status?: string | null };

type OkvedOption = { id: number; okved_code: string; okved_main: string };

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
    products?: Array<{
      name: string;
      goods_group?: string | null;
      url?: string | null;
      domain?: string | null;
      tnved_code?: string | null;
    }>;
    equipment?: Array<{ name: string; equip_group?: string | null; url?: string | null; domain?: string | null }>;
    description_okved_score?: number | null;
    prodclass?: {
      id?: string | number | null;
      name?: string | null;
      label?: string | null;
      score?: number | null;
      description_okved_score?: number | null;
      okved_score?: number | null;
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

  const mapProducts = (
    items: any[],
  ): Array<{ name: string; goods_group?: string | null; url?: string | null; domain?: string | null; tnved_code?: string | null }> =>
    items.reduce<Array<{ name: string; goods_group?: string | null; url?: string | null; domain?: string | null; tnved_code?: string | null }>>(
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
          const tnved_code =
            item.tnved_code ??
            item.goods_type_id ??
            item.goods_type_ID ??
            item.tnved ??
            item.tn_ved ??
            item.code ??
            null;
          if (!name && !goods_group && !url) return acc;
          acc.push({ name: name || goods_group || url || '—', goods_group, url, domain, tnved_code });
          return acc;
        }

        acc.push({ name: String(item) });
        return acc;
      },
      [],
    );

  const mapEquipment = (
    items: any[],
  ): Array<{ name: string; equip_group?: string | null; url?: string | null; domain?: string | null }> =>
    items.reduce<Array<{ name: string; equip_group?: string | null; url?: string | null; domain?: string | null }>>((acc, item) => {
      if (!item) return acc;
      if (typeof item === 'string') {
        acc.push({ name: item });
        return acc;
      }
      if (typeof item === 'object') {
        const name = String(item.name ?? item.equipment ?? item.title ?? '').trim();
        const equip_group = item.equip_group ?? item.group ?? null;
        const url = item.url ?? item.link ?? null;
        const domain = item.domain ?? normalizeSite(url ?? null);

        if (!name && !equip_group && !url) return acc;

        acc.push({ name: name || equip_group || url || '—', equip_group, url, domain });
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
            }
          : null,
        prodclass_by_okved: prodclassByOkved,
        okved_score: okvedScore,
        industry: ai.industry ?? null,
        utp: ai.utp ?? ai.usp ?? null,
        letter: ai.letter ?? ai.email ?? null,
        note: ai.note ?? null,
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
          };
        }

        return {
          id: null,
          name: rawProdclass ?? (rawProdclassByOkved ? String(rawProdclassByOkved) : null),
          label: rawProdclass ?? (rawProdclassByOkved ? String(rawProdclassByOkved) : null),
          score: rawScore != null ? Number(rawScore) : rawOkvedScore != null ? Number(rawOkvedScore) : null,
          description_okved_score: rawOkvedMatch != null ? Number(rawOkvedMatch) : null,
          okved_score: rawOkvedScore != null ? Number(rawOkvedScore) : null,
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

function formatStatusLabel(status?: string | null): string {
  if (!status) return '—';
  const normalized = status.toLowerCase();
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
  const [industryId, setIndustryId] = useState<string>('all');
  const [okvedCode, setOkvedCode] = useState<string | undefined>(undefined);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industriesLoading, setIndustriesLoading] = useState(false);
  const [okvedOptions, setOkvedOptions] = useState<OkvedOption[]>([]);
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
    if (okvedCode) count += 1;
    count += statusFilters.length;
    return count;
  }, [industryId, okvedCode, search, statusFilters]);

  const hasFilters = activeFilterCount > 0;

  const resetFilters = useCallback(() => {
    setSearch('');
    setIndustryId('all');
    setOkvedCode(undefined);
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

  const fetchQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const res = await fetch('/api/ai-analysis/queue');
      const data = (await res.json().catch(() => null)) as { ok?: boolean; items?: AiCompany[]; error?: string } | null;
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `Request failed with status ${res.status}`);
      }
      const queueDataItems = data?.items;
      const queueItems = Array.isArray(queueDataItems) ? queueDataItems : [];
      setQueueItems(queueItems);
    } catch (error) {
      console.error('Failed to fetch queue', error);
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
        const note = integrationSummaryText(data?.integration);
        toast({
          title: 'Анализ запущен без очереди',
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

  const topEquipment = (company: AiCompany, analyzer?: AiAnalyzerInfo | null): string[] => {
    const raw = company.analysis_equipment;
    const items: string[] = [];
    const seen = new Set<string>();

    if (Array.isArray(raw)) {
      items.push(
        ...raw
          .map((item) => {
            if (!item) return null;
            if (typeof item === 'string') return item.trim();
            if (typeof item === 'object') {
              const label = String(item?.name ?? item?.label ?? item?.equipment ?? item?.title ?? '').trim();
              return label || null;
            }
            return String(item);
          })
          .filter((s): s is string => !!s),
      );
    }

    if (!items.length && analyzer?.ai?.equipment?.length) {
      items.push(
        ...analyzer.ai.equipment
          .map((item) => (item?.name ? String(item.name).trim() : null))
          .filter((name): name is string => !!name),
      );
    }

    return items.reduce<string[]>((acc, item) => {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) return acc;
      seen.add(key);
      acc.push(item.trim());
      return acc;
    }, []);
  };

  const tnvedProducts = (company: AiCompany, analyzer?: AiAnalyzerInfo | null): Array<{ name: string; code?: string }> => {
    const raw = company.analysis_tnved;
    const items: Array<{ name: string; code?: string }> = [];
    const seen = new Set<string>();
    if (raw) {
      const arr = Array.isArray(raw) ? raw : [raw];
      items.push(
        ...arr
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
          .filter((item): item is { name: string; code?: string } => !!item && !!item.name),
      );
    }

    if (!items.length && analyzer?.ai?.products?.length) {
      const analyzerProducts = analyzer.ai.products.reduce<Array<{ name: string; code?: string }>>((acc, item) => {
        const name = item?.name ? String(item.name).trim() : '';
        const code = item?.tnved_code ? String(item.tnved_code).trim() : undefined;
        if (!name && !code) return acc;
        acc.push({ name: name || code || '—', code });
        return acc;
      }, []);

      items.push(...analyzerProducts);
    }

    return items.reduce<Array<{ name: string; code?: string }>>((acc, item) => {
      const key = `${item.name?.trim().toLowerCase() || ''}|${item.code?.trim().toLowerCase() || ''}`;
      if (!item.name || seen.has(key)) return acc;
      seen.add(key);
      acc.push({ name: item.name.trim(), code: item.code?.trim() || undefined });
      return acc;
    }, []);
  };

  const prodclassLabel = infoCompany?.prodclass_name ?? null;
  const prodclassScoreValue =
    analyzerDescriptionOkvedScore ??
    analyzerProdclass?.score ??
    analyzerOkvedScore ??
    (infoCompany?.analysis_match_level != null ? Number(infoCompany.analysis_match_level) : null);
  const prodclassScoreText =
    formatMatchScore(prodclassScoreValue) ||
    formatMatchScore(analyzerProdclass?.score ?? null) ||
    formatMatchScore(analyzerOkvedScore) ||
    (infoCompany?.analysis_match_level ? String(infoCompany.analysis_match_level) : null);
  const prodclassRawScoreText =
    formatRawScore(prodclassScoreValue) ||
    formatRawScore(analyzerProdclass?.score ?? null) ||
    formatRawScore(analyzerOkvedScore) ||
    formatRawScore(infoCompany?.analysis_match_level ?? null);
  const prodclassId =
    (analyzerProdclass?.id as string | number | null | undefined) ??
    analyzerProdclassByOkved ??
    infoCompany?.prodclass_by_okved ??
    null;
  const prodclassDescription =
    analyzerProdclass && analyzerProdclass.name && analyzerProdclass.label && analyzerProdclass.name !== analyzerProdclass.label
      ? analyzerProdclass.name
      : null;
  const okvedMatchText =
    formatMatchScore(analyzerOkvedScore ?? infoCompany?.okved_score ?? null) ||
    formatMatchScore(analyzerDescriptionOkvedScore ?? null) ||
    (infoCompany?.analysis_okved_match ? String(infoCompany.analysis_okved_match) : null);
  const analysisDomainValue =
    infoCompany?.analysis_domain ||
    analyzerInfo?.company?.domain1_site ||
    analyzerInfo?.company?.domain2_site ||
    analyzerSites[0] ||
    null;
  const analyzerDescriptionText =
    infoCompany?.analysis_description ||
    [analyzerInfo?.company?.domain1, analyzerInfo?.company?.domain2].filter(Boolean).join('\n') ||
    null;

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
            {(search.trim() || industryId !== 'all' || okvedCode) && (
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
                        <th className="relative px-4 py-3 text-left" style={columnStyle('contacts')}>
                          <div className="flex items-center justify-between gap-2">
                            <span>Контакты</span>
                            {renderResizeHandle('contacts')}
                          </div>
                        </th>
                        <th className="relative px-4 py-3 text-left" style={columnStyle('status')}>
                          <div className="flex items-center justify-between gap-2">
                            <span>Запуски и статус</span>
                            {renderResizeHandle('status')}
                          </div>
                        </th>
                        <th className="relative px-4 py-3 text-left" style={columnStyle('pipeline')}>
                          <div className="flex items-center justify-between gap-2">
                            <span>Пайплайн</span>
                            {renderResizeHandle('pipeline')}
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
                        const emails = toStringArray(company.emails);
                        const revenue = formatRevenue(company.revenue);
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
                          : 'Запустить без очереди';
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
                            <td className="px-4 py-4 align-top text-xs" style={columnStyle('contacts')}>
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
                            <td className="px-4 py-4 align-top text-xs" style={columnStyle('status')}>
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
                            <td className="px-4 py-4 align-top text-xs" style={columnStyle('pipeline')}>
                              {state.running ? (
                                <div className="space-y-2">
                                  <Progress value={progressPercent} className="h-2" />
                                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                    <span>{currentStage || 'Выполняется…'}</span>
                                    <span>{progressPercent}%</span>
                                  </div>
                                </div>
                              ) : steps.length ? (
                                <div className="space-y-2">
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
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => setInfoCompany(company)}
                                        aria-label={`Подробности по компании ${companyLabel}`}
                                      >
                                        <Info className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">Подробнее</TooltipContent>
                                  </Tooltip>
                                </div>
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
                          <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
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
          <DialogContent className="max-w-4xl">
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

        <Dialog open={queueDialogOpen} onOpenChange={setQueueDialogOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Очередь анализа</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="text-muted-foreground">
                  {queueLoading
                    ? 'Загружаем очередь…'
                    : `В очереди: ${queueItems.length.toLocaleString('ru-RU')}`}
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
              <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-3">
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
                    const attempts =
                      item.analysis_attempts != null && Number.isFinite(item.analysis_attempts)
                        ? item.analysis_attempts
                        : '—';
                    const score =
                      item.analysis_score != null && Number.isFinite(item.analysis_score)
                        ? item.analysis_score.toFixed(2)
                        : '—';

                    return (
                      <div
                        key={`queue-${item.inn}`}
                        className="flex flex-col gap-2 rounded-md border bg-background/70 p-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                            <span>{itemCompanyLabel}</span>
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>ИНН {item.inn}</span>
                            {queuedTime && <span>в очереди с {queuedTime}</span>}
                            <span>Попыток: {attempts}</span>
                            <span>Оценка: {score}</span>
                            <Badge variant="outline" className="whitespace-nowrap text-foreground">
                              {statusLabel}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="gap-2"
                            disabled={removeInn === item.inn}
                            onClick={async () => {
                              await handleRemoveFromQueue(item.inn);
                              fetchQueue();
                            }}
                          >
                            {removeInn === item.inn ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                            Удалить
                          </Button>
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
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {formatCompanyDisplayName(infoCompany?.short_name, infoCompany?.company_id ?? null)} · ИНН{' '}
                {infoCompany?.inn ?? ''}
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
                    <div className="space-y-1 font-medium">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-base sm:text-lg">{prodclassScoreText || '—'}</span>
                        {prodclassRawScoreText && (
                          <span className="text-xs text-muted-foreground">(расчёт: {prodclassRawScoreText})</span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {prodclassId ? `Класс ${prodclassId}` : 'Класс не определён'}
                        {prodclassLabel ? ` · ${prodclassLabel}` : ''}
                      </div>
                      {prodclassDescription && (
                        <div className="text-sm text-muted-foreground">{prodclassDescription}</div>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Основной ОКВЭД (DaData)</div>
                    <div className="font-medium">{infoCompany.main_okved || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Домен для парсинга</div>
                    <div className="font-medium">{analysisDomainValue || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">
                      Соответствие ИИ-описания сайта и ОКВЭД
                    </div>
                    <div className="font-medium">{okvedMatchText || '—'}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">ИИ-описание сайта</div>
                  <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                    {analyzerDescriptionText || '—'}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-2">Топ-10 оборудования</div>
                  {topEquipment(infoCompany, analyzerInfo).length ? (
                    <ol className="list-decimal space-y-1 pl-5">
                      {topEquipment(infoCompany, analyzerInfo).slice(0, 10).map((item, index) => (
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
                  {tnvedProducts(infoCompany, analyzerInfo).length ? (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {tnvedProducts(infoCompany, analyzerInfo).map((item, idx) => (
                        <li key={`${item.name}-${idx}`} className="rounded-md border bg-muted/30 p-3">
                          <div className="font-medium text-foreground">{item.name}</div>
                          {item.code && (
                            <div className="mt-1">
                              <Badge variant="outline" className="text-[12px]">
                                ТНВЭД {item.code}
                              </Badge>
                            </div>
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


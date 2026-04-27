'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Clock3, Filter, Loader2, MapPinned, RefreshCw, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';

type IndustryItem = { id: number; industry: string };
type ProdclassItem = { id: number; prodclass: string; industry_id: number };
type OkvedOption = { id: number; okved_code: string; okved_main: string };
type MapMode = 'points' | 'heatmap';

type MapCompany = {
  inn: string;
  short_name: string;
  address: string | null;
  geo_lat: number;
  geo_lon: number;
  revenue: number | null;
  employee_count: number | null;
  branch_count: number | null;
  main_okved: string | null;
  web_sites: string | null;
  smb_type: string | null;
  smb_category: string | null;
  revenue_1: number | null;
  analysis_ok: number | null;
  analysis_score: number | null;
  responsible: string | null;
  company_id: string | null;
};

type CompaniesMapResponse = {
  items?: MapCompany[];
  total?: number;
  withGeo?: number;
  skippedNoGeo?: number;
  filterOptions?: {
    responsibles?: string[];
  };
};

type YMapsApi = any;

declare global {
  interface Window {
    ymaps?: YMapsApi;
  }
}

const MAP_SCRIPT_ID = 'yandex-maps-2-1-api';
const HEATMAP_SCRIPT_ID = 'yandex-maps-heatmap-module';
const YANDEX_MAPS_API_KEY = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY || '';
const HEATMAP_LAT_CELL_DEGREES = 0.35;
const HEATMAP_LON_CELL_DEGREES = 0.55;
const ENTERPRISE_TYPES = [
  { value: 'MICRO', label: 'Микро' },
  { value: 'SMALL', label: 'Малое' },
  { value: 'MEDIUM', label: 'Среднее' },
  { value: 'unknown', label: 'Не указано' },
];

let ymapsPromise: Promise<YMapsApi> | null = null;
let heatmapModulePromise: Promise<any> | null = null;

function loadYandexMaps(apiKey: string): Promise<YMapsApi> {
  if (typeof window === 'undefined') return Promise.reject(new Error('window is unavailable'));
  if (window.ymaps) return Promise.resolve(window.ymaps);
  if (ymapsPromise) return ymapsPromise;

  ymapsPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(MAP_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => (window.ymaps ? resolve(window.ymaps) : reject(new Error('ymaps is unavailable'))));
      existing.addEventListener('error', () => reject(new Error('Yandex Maps script failed to load')));
      return;
    }

    const script = document.createElement('script');
    script.id = MAP_SCRIPT_ID;
    script.async = true;
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    script.onload = () => (window.ymaps ? resolve(window.ymaps) : reject(new Error('ymaps is unavailable')));
    script.onerror = () => reject(new Error('Yandex Maps script failed to load'));
    document.head.appendChild(script);
  });

  return ymapsPromise;
}

function loadYandexHeatmapModule(ymaps: YMapsApi): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('window is unavailable'));
  if (heatmapModulePromise) return heatmapModulePromise;

  heatmapModulePromise = new Promise((resolve, reject) => {
    const requireModule = () => {
      ymaps.modules.require(['Heatmap'], (Heatmap: any) => resolve(Heatmap), reject);
    };

    const existing = document.getElementById(HEATMAP_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', requireModule, { once: true });
      existing.addEventListener('error', () => reject(new Error('Yandex heatmap script failed to load')), { once: true });
      if (window.ymaps?.modules) requireModule();
      return;
    }

    const script = document.createElement('script');
    script.id = HEATMAP_SCRIPT_ID;
    script.async = true;
    script.src = 'https://yastatic.net/s3/mapsapi-jslibs/heatmap/0.0.1/heatmap.min.js';
    script.onload = requireModule;
    script.onerror = () => reject(new Error('Yandex heatmap script failed to load'));
    document.head.appendChild(script);
  });

  return heatmapModulePromise;
}

function formatRevenueMln(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return Math.round(value / 1_000_000).toLocaleString('ru-RU');
}

function formatScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

function formatInteger(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('ru-RU');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateLabel(value: string, max = 38): string {
  const normalized = value.trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function buildBitrixHref(inn: string): string {
  return `/api/b24/resolve-company?inn=${encodeURIComponent(inn)}&mode=pick`;
}

function extractFirstSite(value: string | null | undefined): string | null {
  return (
    String(value ?? '')
      .replace(/[{}"]/g, ' ')
      .split(/[,\s;]+/)
      .map((item) => item.trim())
      .find(Boolean) ?? null
  );
}

function siteHref(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function formatEnterpriseType(value: string | null | undefined): string {
  const found = ENTERPRISE_TYPES.find((item) => item.value === value);
  return found?.label ?? value ?? '—';
}

function buildBalloonContent(company: MapCompany): string {
  const revenue = formatRevenueMln(company.revenue);
  const score = formatScore(company.analysis_score);
  const bitrixHref = buildBitrixHref(company.inn);
  const site = extractFirstSite(company.web_sites);
  const siteLine = site
    ? `<div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0;"><span style="color:#64748b;">Сайт</span><a href="${escapeHtml(siteHref(site))}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none;font-weight:600;">${escapeHtml(site)}</a></div>`
    : '';

  return `
    <div style="min-width:280px;max-width:380px;font-family:Inter,Arial,sans-serif;font-size:13px;line-height:1.45;color:#0f172a;padding:2px;">
      <div style="font-weight:750;font-size:15px;line-height:1.3;margin-bottom:10px;color:#020617;">${escapeHtml(company.short_name)}</div>
      <div style="display:grid;gap:4px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:8px 0;">
        <div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:#64748b;">ИНН</span><b>${escapeHtml(company.inn)}</b></div>
        <div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:#64748b;">Выручка</span><b>${escapeHtml(revenue)} млн</b></div>
        <div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:#64748b;">ОКВЭД</span><b>${escapeHtml(company.main_okved || '—')}</b></div>
        <div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:#64748b;">Скор</span><b>${escapeHtml(score)}</b></div>
        <div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:#64748b;">Ответственный</span><b>${escapeHtml(company.responsible || '—')}</b></div>
        <div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:#64748b;">Сотрудников</span><b>${escapeHtml(formatInteger(company.employee_count))}</b></div>
        <div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:#64748b;">Филиалов</span><b>${escapeHtml(formatInteger(company.branch_count))}</b></div>
        <div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:#64748b;">Тип</span><b>${escapeHtml(formatEnterpriseType(company.smb_category || company.smb_type))}</b></div>
      </div>
      ${siteLine}
      <div style="margin-top:8px;color:#475569;">${escapeHtml(company.address || 'Адрес не указан')}</div>
      <a href="${escapeHtml(bitrixHref)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;justify-content:center;margin-top:12px;border-radius:10px;background:#2563eb;color:white;font-weight:700;text-decoration:none;padding:8px 12px;">Открыть в Bitrix24</a>
    </div>
  `;
}

function buildFeatureCollection(companies: MapCompany[]) {
  return {
    type: 'FeatureCollection',
    features: companies.map((company) => {
      const revenue = formatRevenueMln(company.revenue);
      const label = `${truncateLabel(company.short_name)} · ${revenue} млн`;

      return {
        type: 'Feature',
        id: company.inn,
        geometry: {
          type: 'Point',
          coordinates: [company.geo_lat, company.geo_lon],
        },
        properties: {
          iconContent: label,
          hintContent: `${company.short_name} · ${revenue} млн`,
          balloonContent: buildBalloonContent(company),
        },
        options: {
          preset: 'islands#blueStretchyIcon',
        },
      };
    }),
  };
}

function buildAutoScaledHeatmapFeatureCollection(companies: MapCompany[]) {
  const cells = new Map<
    string,
    {
      count: number;
      latSum: number;
      lonSum: number;
    }
  >();

  for (const company of companies) {
    const latCell = Math.floor(company.geo_lat / HEATMAP_LAT_CELL_DEGREES);
    const lonCell = Math.floor(company.geo_lon / HEATMAP_LON_CELL_DEGREES);
    const key = `${latCell}:${lonCell}`;
    const cell = cells.get(key) ?? { count: 0, latSum: 0, lonSum: 0 };
    cell.count += 1;
    cell.latSum += company.geo_lat;
    cell.lonSum += company.geo_lon;
    cells.set(key, cell);
  }

  const maxCellCount = Math.max(1, ...Array.from(cells.values(), (cell) => cell.count));

  return {
    type: 'FeatureCollection',
    features: Array.from(cells.entries(), ([key, cell]) => {
      const normalizedDensity = cell.count / maxCellCount;

      return {
        type: 'Feature',
        id: key,
        geometry: {
          type: 'Point',
          coordinates: [cell.latSum / cell.count, cell.lonSum / cell.count],
        },
        properties: {
          company_count: cell.count,
          max_company_count: maxCellCount,
          weight: Math.max(0.03, Math.pow(normalizedDensity, 1.8)),
        },
      };
    }),
  };
}

function dedupeOkvedOptions(items: OkvedOption[]): OkvedOption[] {
  const map = new Map<string, OkvedOption>();
  for (const item of items) {
    const code = String(item.okved_code ?? '').trim();
    if (!code) continue;
    const main = String(item.okved_main ?? '').trim();
    const next = { ...item, okved_code: code, okved_main: main };
    const existing = map.get(code);
    if (!existing || main.length > existing.okved_main.length) {
      map.set(code, next);
    }
  }
  return Array.from(map.values());
}

function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-[12px] font-medium leading-none text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function RangeInputs({
  fromValue,
  toValue,
  onFromChange,
  onToChange,
  fromLabel,
  toLabel,
}: {
  fromValue: string;
  toValue: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  fromLabel: string;
  toLabel: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        aria-label={fromLabel}
        className={CONTROL_CLASS}
        inputMode="decimal"
        placeholder="от"
        value={fromValue}
        onChange={(event) => onFromChange(event.target.value)}
      />
      <Input
        aria-label={toLabel}
        className={CONTROL_CLASS}
        inputMode="decimal"
        placeholder="до"
        value={toValue}
        onChange={(event) => onToChange(event.target.value)}
      />
    </div>
  );
}

function ModernCheckbox({
  checked,
  onCheckedChange,
  children,
  className,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'group flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition',
        'hover:border-blue-200 hover:bg-blue-50/40',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500 has-[:focus-visible]:ring-offset-2',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(Boolean(value))}
        className={cn(
          'h-4 w-4 rounded-[5px] border-slate-300 bg-white text-white transition',
          'group-hover:border-blue-400',
          'focus-visible:ring-blue-500 focus-visible:ring-offset-2',
          'data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600',
        )}
      />
      <span className="leading-tight">{children}</span>
    </label>
  );
}

function CompactCheckbox({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="group inline-flex cursor-pointer items-center gap-2 text-[12px] leading-none text-slate-500">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(Boolean(value))}
        className={cn(
          'h-4 w-4 rounded-[5px] border-slate-300 bg-white text-white transition',
          'group-hover:border-blue-400 focus-visible:ring-blue-500',
          'data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600',
        )}
      />
      <span>{children}</span>
    </label>
  );
}

function SegmentedControl({
  value,
  onChange,
}: {
  value: MapMode;
  onChange: (value: MapMode) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-1 shadow-inner" aria-label="Режим отображения карты">
      {[
        ['points', 'Точки'],
        ['heatmap', 'Тепловая карта'],
      ].map(([itemValue, label]) => (
        <button
          key={itemValue}
          type="button"
          aria-pressed={value === itemValue}
          onClick={() => onChange(itemValue as MapMode)}
          className={cn(
            'h-8 rounded-lg px-3 text-sm font-medium text-slate-600 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
            value === itemValue
              ? 'bg-white text-slate-950 shadow-sm'
              : 'hover:bg-white/70 hover:text-slate-900',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function StatBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'blue' | 'amber' }) {
  return (
    <span
      className={cn(
        'inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium shadow-sm',
        tone === 'blue' && 'border-blue-100 bg-blue-50 text-blue-700',
        tone === 'amber' && 'border-amber-100 bg-amber-50 text-amber-700',
        tone === 'neutral' && 'border-slate-200 bg-white text-slate-600',
      )}
    >
      {children}
    </span>
  );
}

function ActiveFilterBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center rounded-full border border-blue-100 bg-blue-50 px-3 text-xs font-medium text-blue-700">
      {children}
    </span>
  );
}

const CONTROL_CLASS =
  'h-10 rounded-xl border-slate-200 bg-white text-left text-sm shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus-visible:ring-blue-500 focus-visible:ring-offset-0 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left';

export default function CompaniesMapTab() {
  const [companies, setCompanies] = useState<MapCompany[]>([]);
  const [total, setTotal] = useState(0);
  const [withGeo, setWithGeo] = useState(0);
  const [skippedNoGeo, setSkippedNoGeo] = useState(0);
  const [responsibleOptions, setResponsibleOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const [industries, setIndustries] = useState<IndustryItem[]>([]);
  const [industriesLoading, setIndustriesLoading] = useState(false);
  const [prodclasses, setProdclasses] = useState<ProdclassItem[]>([]);
  const [prodclassesLoading, setProdclassesLoading] = useState(false);
  const [okvedOptions, setOkvedOptions] = useState<OkvedOption[]>([]);
  const [okvedLoading, setOkvedLoading] = useState(false);

  const [industryId, setIndustryId] = useState('all');
  const [prodclassId, setProdclassId] = useState('all');
  const [okvedCode, setOkvedCode] = useState('all');
  const [enterpriseType, setEnterpriseType] = useState('all');
  const [mainOkvedOnly, setMainOkvedOnly] = useState(true);
  const [successOnly, setSuccessOnly] = useState(false);
  const [revenueGrowing, setRevenueGrowing] = useState(false);
  const [scoreFrom, setScoreFrom] = useState('');
  const [scoreTo, setScoreTo] = useState('');
  const [responsible, setResponsible] = useState('');
  const [responsibleOpen, setResponsibleOpen] = useState(false);
  const [revenueFromMln, setRevenueFromMln] = useState('');
  const [revenueToMln, setRevenueToMln] = useState('');
  const [mapMode, setMapMode] = useState<MapMode>('points');
  const [reloadToken, setReloadToken] = useState(0);

  const debouncedScoreFrom = useDebounce(scoreFrom, 350);
  const debouncedScoreTo = useDebounce(scoreTo, 350);
  const debouncedResponsible = useDebounce(responsible, 350);
  const debouncedRevenueFromMln = useDebounce(revenueFromMln, 350);
  const debouncedRevenueToMln = useDebounce(revenueToMln, 350);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const objectManagerRef = useRef<any>(null);
  const ymapsRef = useRef<any>(null);
  const heatmapRef = useRef<any>(null);
  const heatmapDataKeyRef = useRef('');
  const heatmapBuildIdRef = useRef(0);
  const objectManagerAttachedRef = useRef(false);
  const objectManagerDataKeyRef = useRef('');
  const mapBoundsKeyRef = useRef('');
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (industryId !== 'all') count += 1;
    if (prodclassId !== 'all') count += 1;
    if (enterpriseType !== 'all') count += 1;
    if (okvedCode !== 'all') count += 1;
    if (!mainOkvedOnly) count += 1;
    if (successOnly) count += 1;
    if (revenueGrowing) count += 1;
    if (debouncedScoreFrom.trim() || debouncedScoreTo.trim()) count += 1;
    if (debouncedResponsible.trim()) count += 1;
    if (debouncedRevenueFromMln.trim() || debouncedRevenueToMln.trim()) count += 1;
    return count;
  }, [
    debouncedResponsible,
    debouncedRevenueFromMln,
    debouncedRevenueToMln,
    debouncedScoreFrom,
    debouncedScoreTo,
    enterpriseType,
    industryId,
    mainOkvedOnly,
    okvedCode,
    prodclassId,
    revenueGrowing,
    successOnly,
  ]);

  const resetFilters = useCallback(() => {
    setIndustryId('all');
    setProdclassId('all');
    setEnterpriseType('all');
    setOkvedCode('all');
    setMainOkvedOnly(true);
    setSuccessOnly(false);
    setRevenueGrowing(false);
    setScoreFrom('');
    setScoreTo('');
    setResponsible('');
    setRevenueFromMln('');
    setRevenueToMln('');
  }, []);

  const companiesDataKey = useMemo(() => {
    const first = companies[0]?.inn ?? '';
    const last = companies[companies.length - 1]?.inn ?? '';
    return `${companies.length}:${total}:${withGeo}:${first}:${last}`;
  }, [companies, total, withGeo]);

  const pointFeatureCollection = useMemo(() => buildFeatureCollection(companies), [companies]);

  const heatmapFeatureCollection = useMemo(
    () => buildAutoScaledHeatmapFeatureCollection(companies),
    [companies],
  );

  const fetchCompanies = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setLoading(true);
        setError(null);

        const params = new URLSearchParams();
        if (industryId !== 'all') params.set('industryId', industryId);
        if (prodclassId !== 'all') params.set('prodclassId', prodclassId);
        if (enterpriseType !== 'all') params.set('enterpriseType', enterpriseType);
        if (okvedCode !== 'all') params.set('okved', okvedCode);
        params.set('mainOkvedOnly', mainOkvedOnly ? '1' : '0');
        if (successOnly) params.set('success', '1');
        if (revenueGrowing) params.set('revenueGrowing', '1');
        if (debouncedScoreFrom.trim()) params.set('scoreFrom', debouncedScoreFrom.trim());
        if (debouncedScoreTo.trim()) params.set('scoreTo', debouncedScoreTo.trim());
        if (debouncedResponsible.trim()) params.set('responsible', debouncedResponsible.trim());
        if (debouncedRevenueFromMln.trim()) params.set('revenueFromMln', debouncedRevenueFromMln.trim());
        if (debouncedRevenueToMln.trim()) params.set('revenueToMln', debouncedRevenueToMln.trim());

        const res = await fetch(`/api/ai-analysis/companies-map?${params.toString()}`, {
          cache: 'no-store',
          signal,
        });
        if (!res.ok) throw new Error(`Request failed with ${res.status}`);

        const data = (await res.json()) as CompaniesMapResponse;
        setCompanies(Array.isArray(data.items) ? data.items : []);
        setTotal(Number.isFinite(Number(data.total)) ? Number(data.total) : 0);
        setWithGeo(Number.isFinite(Number(data.withGeo)) ? Number(data.withGeo) : 0);
        setSkippedNoGeo(Number.isFinite(Number(data.skippedNoGeo)) ? Number(data.skippedNoGeo) : 0);
        setResponsibleOptions(Array.isArray(data.filterOptions?.responsibles) ? data.filterOptions!.responsibles! : []);
        setLastLoadedAt(new Date().toISOString());
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load companies map:', err);
        setError('Не удалось загрузить компании для карты');
      } finally {
        setLoading(false);
      }
    },
    [
      debouncedResponsible,
      debouncedRevenueFromMln,
      debouncedRevenueToMln,
      debouncedScoreFrom,
      debouncedScoreTo,
      enterpriseType,
      industryId,
      mainOkvedOnly,
      okvedCode,
      prodclassId,
      revenueGrowing,
      successOnly,
    ],
  );

  useEffect(() => {
    const ac = new AbortController();
    fetchCompanies(ac.signal);
    return () => ac.abort();
  }, [fetchCompanies, reloadToken]);

  useEffect(() => {
    async function loadIndustries() {
      try {
        setIndustriesLoading(true);
        const res = await fetch('/api/industries?page=1&pageSize=100', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed with ${res.status}`);
        const data = await res.json();
        setIndustries(Array.isArray(data.items) ? data.items : []);
      } catch (err) {
        console.error('Failed to load industries for map:', err);
        setIndustries([]);
      } finally {
        setIndustriesLoading(false);
      }
    }

    loadIndustries();
  }, []);

  useEffect(() => {
    const ac = new AbortController();

    if (industryId === 'all') {
      setProdclasses([]);
      setProdclassId('all');
      return () => ac.abort();
    }

    async function loadProdclasses() {
      try {
        setProdclassesLoading(true);
        const res = await fetch(`/api/industries/${encodeURIComponent(industryId)}/prodclasses?page=1&pageSize=100&scope=okved`, {
          cache: 'no-store',
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`Failed with ${res.status}`);
        const data = await res.json();
        setProdclasses(Array.isArray(data.items) ? data.items : []);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load prodclasses for map:', err);
        setProdclasses([]);
      } finally {
        setProdclassesLoading(false);
      }
    }

    setProdclassId('all');
    loadProdclasses();

    return () => ac.abort();
  }, [industryId]);

  useEffect(() => {
    const ac = new AbortController();

    async function loadOkveds() {
      try {
        setOkvedLoading(true);
        const params = new URLSearchParams();
        if (prodclassId !== 'all') params.set('prodclassId', prodclassId);
        if (industryId !== 'all') params.set('industryId', industryId);
        params.set('onlyWithCompanies', '1');
        params.set('onlyWithGeo', '1');
        params.set('mainOkvedOnly', mainOkvedOnly ? '1' : '0');
        const res = await fetch(`/api/okved?${params.toString()}`, { cache: 'no-store', signal: ac.signal });
        if (!res.ok) throw new Error(`Failed with ${res.status}`);
        const data = await res.json();
        const items = Array.isArray(data.items) ? (data.items as OkvedOption[]) : [];
        setOkvedOptions(dedupeOkvedOptions(items));
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load OKVED options for map:', err);
        setOkvedOptions([]);
      } finally {
        setOkvedLoading(false);
      }
    }

    setOkvedCode('all');
    loadOkveds();

    return () => ac.abort();
  }, [industryId, mainOkvedOnly, prodclassId]);

  useEffect(() => {
    let cancelled = false;

    if (!YANDEX_MAPS_API_KEY) {
      setMapError('Не задан NEXT_PUBLIC_YANDEX_MAPS_API_KEY');
      return undefined;
    }

    loadYandexMaps(YANDEX_MAPS_API_KEY)
      .then((ymaps) => {
        ymaps.ready(() => {
          if (cancelled || !mapContainerRef.current || mapRef.current) return;

          const map = new ymaps.Map(mapContainerRef.current, {
            center: [61.524, 105.3188],
            zoom: 4,
            controls: ['zoomControl', 'typeSelector', 'fullscreenControl'],
          });

          const objectManager = new ymaps.ObjectManager({
            clusterize: true,
            gridSize: 64,
            clusterDisableClickZoom: false,
          });

          objectManager.clusters.options.set({
            preset: 'islands#yellowClusterIcons',
          });

          map.geoObjects.add(objectManager);
          objectManagerAttachedRef.current = true;
          ymapsRef.current = ymaps;
          mapRef.current = map;
          objectManagerRef.current = objectManager;
          setMapReady(true);
        });
      })
      .catch((err) => {
        console.error('Failed to initialize Yandex Maps:', err);
        setMapError('Не удалось загрузить Яндекс.Карты');
      });

    return () => {
      cancelled = true;
      if (heatmapRef.current) {
        heatmapRef.current.setMap(null);
        heatmapRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
        objectManagerRef.current = null;
        objectManagerAttachedRef.current = false;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const objectManager = objectManagerRef.current;
    if (!map || !objectManager || !mapReady) return;

    if (!companies.length) {
      objectManager.removeAll();
      objectManagerDataKeyRef.current = '';
      mapBoundsKeyRef.current = '';
      if (heatmapRef.current) heatmapRef.current.setMap(null);
      heatmapDataKeyRef.current = '';
      map.setCenter([61.524, 105.3188], 4);
      return;
    }

    if (objectManagerDataKeyRef.current !== companiesDataKey) {
      objectManager.removeAll();
      objectManager.add(pointFeatureCollection);
      objectManagerDataKeyRef.current = companiesDataKey;
    }

    if (mapBoundsKeyRef.current !== companiesDataKey) {
      const bounds = objectManager.getBounds();
      if (bounds) {
        map.setBounds(bounds, {
          checkZoomRange: true,
          zoomMargin: [36, 36, 36, 36],
        });
      }
      mapBoundsKeyRef.current = companiesDataKey;
    }

    if (heatmapDataKeyRef.current && heatmapDataKeyRef.current !== companiesDataKey && heatmapRef.current) {
      heatmapRef.current.setMap(null);
      heatmapRef.current = null;
      heatmapDataKeyRef.current = '';
    }
  }, [companies.length, companiesDataKey, mapReady, pointFeatureCollection]);

  useEffect(() => {
    const map = mapRef.current;
    const objectManager = objectManagerRef.current;
    if (!map || !objectManager || !mapReady) return;

    if (mapMode === 'points') {
      heatmapBuildIdRef.current += 1;
      setHeatmapLoading(false);
      if (heatmapRef.current) heatmapRef.current.setMap(null);
      if (!objectManagerAttachedRef.current) {
        map.geoObjects.add(objectManager);
        objectManagerAttachedRef.current = true;
      }
      return;
    }

    if (objectManagerAttachedRef.current) {
      map.geoObjects.remove(objectManager);
      objectManagerAttachedRef.current = false;
    }

    if (!companies.length) return;

    if (heatmapRef.current && heatmapDataKeyRef.current === companiesDataKey) {
      heatmapRef.current.setMap(map);
      return;
    }

    const ymaps = ymapsRef.current;
    const buildId = heatmapBuildIdRef.current + 1;
    heatmapBuildIdRef.current = buildId;
    setHeatmapLoading(true);

    loadYandexHeatmapModule(ymaps)
      .then((Heatmap) => {
        if (heatmapBuildIdRef.current !== buildId || mapMode !== 'heatmap' || !mapRef.current) return;
        const heatmap = new Heatmap(heatmapFeatureCollection, {
          radius: 24,
          opacity: 0.82,
          dissipating: false,
          intensityOfMidpoint: 0.72,
          gradient: {
            0.1: 'rgba(82, 196, 26, 0.45)',
            0.45: 'rgba(190, 242, 100, 0.65)',
            0.72: 'rgba(250, 204, 21, 0.78)',
            0.9: 'rgba(249, 115, 22, 0.86)',
            1.0: 'rgba(220, 38, 38, 0.94)',
          },
        });
        if (heatmapRef.current) heatmapRef.current.setMap(null);
        heatmapRef.current = heatmap;
        heatmapDataKeyRef.current = companiesDataKey;
        heatmap.setMap(mapRef.current);
      })
      .catch((err) => {
        console.error('Failed to initialize heatmap layer:', err);
        setMapError('Не удалось загрузить тепловую карту');
      })
      .finally(() => {
        if (heatmapBuildIdRef.current === buildId) setHeatmapLoading(false);
      });
  }, [companies.length, companiesDataKey, heatmapFeatureCollection, mapMode, mapReady]);

  const selectedIndustryLabel = useMemo(
    () => industries.find((item) => String(item.id) === industryId)?.industry ?? null,
    [industries, industryId],
  );
  const selectedProdclassLabel = useMemo(
    () => prodclasses.find((item) => String(item.id) === prodclassId)?.prodclass ?? null,
    [prodclasses, prodclassId],
  );
  const selectedEnterpriseTypeLabel = useMemo(
    () => ENTERPRISE_TYPES.find((item) => item.value === enterpriseType)?.label ?? null,
    [enterpriseType],
  );
  const lastLoadedTime = useMemo(
    () =>
      lastLoadedAt
        ? new Date(lastLoadedAt).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        : null,
    [lastLoadedAt],
  );

  return (
    <div className="py-4">
      <div className="flex min-h-[calc(100vh-180px)] flex-col gap-4">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                    <MapPinned className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold leading-tight text-slate-950">Компании на карте</h2>
                    <p className="text-sm text-slate-500">География компаний, фильтры и режимы отображения</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatBadge tone="blue">
                    {companies.length.toLocaleString('ru-RU')} / {withGeo.toLocaleString('ru-RU')}
                  </StatBadge>
                  {skippedNoGeo > 0 && <StatBadge tone="amber">без координат: {skippedNoGeo.toLocaleString('ru-RU')}</StatBadge>}
                  {activeFilterCount > 0 && (
                    <StatBadge>
                      <Filter className="mr-1.5 h-4 w-4" />
                      фильтров: {activeFilterCount}
                    </StatBadge>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
                <ModernCheckbox checked={successOnly} onCheckedChange={setSuccessOnly} className="h-10">
                  Успешные анализы
                </ModernCheckbox>
                <SegmentedControl value={mapMode} onChange={setMapMode} />
                <div className="flex flex-wrap items-center gap-2">
                  {lastLoadedTime && (
                    <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-500 shadow-sm">
                      <Clock3 className="h-4 w-4" />
                      {lastLoadedTime}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-xl border-slate-200 bg-white px-4 text-sm font-medium shadow-sm hover:bg-slate-50"
                    onClick={resetFilters}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Сбросить
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                    onClick={() => setReloadToken((value) => value + 1)}
                    disabled={loading}
                  >
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Обновить
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4 px-4 py-4 sm:px-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <FilterField label="Отрасль" className="order-1">
                <Select value={industryId} onValueChange={setIndustryId}>
                  <SelectTrigger className={CONTROL_CLASS} disabled={industriesLoading && !industries.length}>
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
              </FilterField>

              <FilterField label="Тип предприятия" className="order-2">
                <Select value={prodclassId} onValueChange={setProdclassId} disabled={industryId === 'all'}>
                  <SelectTrigger className={CONTROL_CLASS} disabled={industryId === 'all' || (prodclassesLoading && !prodclasses.length)}>
                    <SelectValue placeholder={industryId === 'all' ? 'Сначала отрасль' : 'Все типы'} />
                  </SelectTrigger>
                  <SelectContent className="min-w-full sm:min-w-[460px]">
                    <SelectItem value="all">Все типы</SelectItem>
                    {prodclasses.map((item) => (
                      <SelectItem key={item.id} value={String(item.id)} title={item.prodclass}>
                        {item.prodclass}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>

              <FilterField label="ОКВЭД" className="order-3">
                <Select value={okvedCode} onValueChange={setOkvedCode}>
                  <SelectTrigger className={CONTROL_CLASS} disabled={okvedLoading && !okvedOptions.length}>
                    <SelectValue placeholder="Все коды" />
                  </SelectTrigger>
                  <SelectContent className="min-w-full sm:min-w-[520px]">
                    <SelectItem value="all">Все коды</SelectItem>
                    {okvedOptions.map((item) => (
                      <SelectItem key={item.okved_code} value={item.okved_code} title={item.okved_main}>
                        <div className="flex flex-col gap-0.5 text-left">
                          <span className="font-medium text-foreground">{item.okved_code}</span>
                          <span className="whitespace-normal break-words text-xs text-muted-foreground">{item.okved_main}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <CompactCheckbox checked={mainOkvedOnly} onCheckedChange={setMainOkvedOnly}>
                  Искать по основному ОКВЭД
                </CompactCheckbox>
              </FilterField>

              <FilterField label="Ответственный" className="order-4">
                <Popover open={responsibleOpen} onOpenChange={setResponsibleOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-label="Ответственный"
                      aria-expanded={responsibleOpen}
                      className={cn(CONTROL_CLASS, 'w-full justify-between px-3 text-left font-normal')}
                    >
                      <span className={cn('truncate', !responsible && 'text-slate-400')}>{responsible || 'ФИО'}</span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-slate-400" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] rounded-xl border-slate-200 p-0 shadow-xl" align="start">
                    <Command>
                      <CommandInput placeholder="Найти ФИО" />
                      <CommandList>
                        <CommandEmpty>Ничего не найдено</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="all"
                            onSelect={() => {
                              setResponsible('');
                              setResponsibleOpen(false);
                            }}
                          >
                            <Check className={cn('mr-2 h-4 w-4', !responsible ? 'opacity-100' : 'opacity-0')} />
                            Все ответственные
                          </CommandItem>
                          {responsibleOptions.map((item) => (
                            <CommandItem
                              key={item}
                              value={item}
                              onSelect={() => {
                                setResponsible(item);
                                setResponsibleOpen(false);
                              }}
                            >
                              <Check className={cn('mr-2 h-4 w-4', responsible === item ? 'opacity-100' : 'opacity-0')} />
                              <span className="truncate">{item}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </FilterField>

              <FilterField label="Скор" className="order-6">
                <RangeInputs
                  fromValue={scoreFrom}
                  toValue={scoreTo}
                  onFromChange={setScoreFrom}
                  onToChange={setScoreTo}
                  fromLabel="Скор от"
                  toLabel="Скор до"
                />
              </FilterField>

              <FilterField label="Выручка, млн" className="order-7">
                <RangeInputs
                  fromValue={revenueFromMln}
                  toValue={revenueToMln}
                  onFromChange={setRevenueFromMln}
                  onToChange={setRevenueToMln}
                  fromLabel="Выручка от"
                  toLabel="Выручка до"
                />
              </FilterField>

              <FilterField label="Размер бизнеса" className="order-5">
                <Select value={enterpriseType} onValueChange={setEnterpriseType}>
                  <SelectTrigger className={CONTROL_CLASS}>
                    <SelectValue placeholder="Все размеры" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все размеры</SelectItem>
                    {ENTERPRISE_TYPES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>

              <div className="order-8 flex min-w-0 items-end">
                <ModernCheckbox checked={revenueGrowing} onCheckedChange={setRevenueGrowing} className="h-10 w-full">
                  Выручка в рост
                </ModernCheckbox>
              </div>
            </div>

            {(selectedIndustryLabel || selectedProdclassLabel || selectedEnterpriseTypeLabel || okvedCode !== 'all' || revenueGrowing || error) && (
            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {selectedIndustryLabel && <ActiveFilterBadge>Отрасль: {selectedIndustryLabel}</ActiveFilterBadge>}
                {selectedProdclassLabel && <ActiveFilterBadge>Тип: {selectedProdclassLabel}</ActiveFilterBadge>}
                {selectedEnterpriseTypeLabel && <ActiveFilterBadge>Размер: {selectedEnterpriseTypeLabel}</ActiveFilterBadge>}
                {okvedCode !== 'all' && <ActiveFilterBadge>ОКВЭД: {okvedCode}</ActiveFilterBadge>}
                {revenueGrowing && <ActiveFilterBadge>Выручка в рост</ActiveFilterBadge>}
              </div>
              {error && <Badge variant="destructive">{error}</Badge>}
            </div>
            )}
          </div>
        </section>

        <section className="relative min-h-[540px] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
          <div ref={mapContainerRef} className={cn('h-full min-h-[540px] w-full', (!mapReady || mapError) && 'opacity-40')} />

          {(loading || heatmapLoading || !mapReady || mapError) && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/75 backdrop-blur-sm">
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm shadow-xl">
                {mapError ? (
                  <span className="text-destructive">{mapError}</span>
                ) : (
                  <span className="inline-flex items-center gap-2 text-slate-600">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    {loading ? 'Загружаем компании' : heatmapLoading ? 'Готовим тепловую карту' : 'Инициализируем карту'}
                  </span>
                )}
              </div>
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-slate-500">
          <span>Всего по фильтрам: {total.toLocaleString('ru-RU')}</span>
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span>С координатами: {withGeo.toLocaleString('ru-RU')}</span>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MapPinned, RefreshCw, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';

type IndustryItem = { id: number; industry: string };
type OkvedOption = { id: number; okved_code: string; okved_main: string };

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
const DEFAULT_YANDEX_MAPS_API_KEY = '4bcbdf72-b059-4f3e-af22-ebde00d7bdde';
const YANDEX_MAPS_API_KEY = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY || DEFAULT_YANDEX_MAPS_API_KEY;

let ymapsPromise: Promise<YMapsApi> | null = null;

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

function buildBalloonContent(company: MapCompany): string {
  const revenue = formatRevenueMln(company.revenue);
  const score = formatScore(company.analysis_score);
  const bitrixHref = buildBitrixHref(company.inn);

  return `
    <div style="min-width:260px;max-width:360px;font-family:Arial,sans-serif;font-size:13px;line-height:1.45;color:#111827;">
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;">${escapeHtml(company.short_name)}</div>
      <div><b>ИНН:</b> ${escapeHtml(company.inn)}</div>
      <div><b>Выручка:</b> ${escapeHtml(revenue)} млн</div>
      <div><b>ОКВЭД:</b> ${escapeHtml(company.main_okved || '—')}</div>
      <div><b>Скор:</b> ${escapeHtml(score)}</div>
      <div><b>Ответственный:</b> ${escapeHtml(company.responsible || '—')}</div>
      <div><b>Сотрудников:</b> ${escapeHtml(formatInteger(company.employee_count))}</div>
      <div><b>Филиалов:</b> ${escapeHtml(formatInteger(company.branch_count))}</div>
      <div style="margin-top:6px;color:#4b5563;">${escapeHtml(company.address || 'Адрес не указан')}</div>
      <a href="${escapeHtml(bitrixHref)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:10px;color:#2563eb;font-weight:700;text-decoration:none;">Открыть в Bitrix24</a>
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
  const [okvedOptions, setOkvedOptions] = useState<OkvedOption[]>([]);
  const [okvedLoading, setOkvedLoading] = useState(false);

  const [industryId, setIndustryId] = useState('all');
  const [okvedCode, setOkvedCode] = useState('all');
  const [successOnly, setSuccessOnly] = useState(false);
  const [scoreFrom, setScoreFrom] = useState('');
  const [scoreTo, setScoreTo] = useState('');
  const [responsible, setResponsible] = useState('');
  const [revenueFromMln, setRevenueFromMln] = useState('');
  const [revenueToMln, setRevenueToMln] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const debouncedScoreFrom = useDebounce(scoreFrom, 350);
  const debouncedScoreTo = useDebounce(scoreTo, 350);
  const debouncedResponsible = useDebounce(responsible, 350);
  const debouncedRevenueFromMln = useDebounce(revenueFromMln, 350);
  const debouncedRevenueToMln = useDebounce(revenueToMln, 350);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const objectManagerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (industryId !== 'all') count += 1;
    if (okvedCode !== 'all') count += 1;
    if (successOnly) count += 1;
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
    industryId,
    okvedCode,
    successOnly,
  ]);

  const resetFilters = useCallback(() => {
    setIndustryId('all');
    setOkvedCode('all');
    setSuccessOnly(false);
    setScoreFrom('');
    setScoreTo('');
    setResponsible('');
    setRevenueFromMln('');
    setRevenueToMln('');
  }, []);

  const fetchCompanies = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setLoading(true);
        setError(null);

        const params = new URLSearchParams();
        if (industryId !== 'all') params.set('industryId', industryId);
        if (okvedCode !== 'all') params.set('okved', okvedCode);
        if (successOnly) params.set('success', '1');
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
      industryId,
      okvedCode,
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

    async function loadOkveds() {
      try {
        setOkvedLoading(true);
        const params = new URLSearchParams();
        if (industryId !== 'all') params.set('industryId', industryId);
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
  }, [industryId]);

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
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
        objectManagerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const objectManager = objectManagerRef.current;
    if (!map || !objectManager || !mapReady) return;

    objectManager.removeAll();

    if (!companies.length) {
      map.setCenter([61.524, 105.3188], 4);
      return;
    }

    objectManager.add(buildFeatureCollection(companies));
    const bounds = objectManager.getBounds();
    if (bounds) {
      map.setBounds(bounds, {
        checkZoomRange: true,
        zoomMargin: [36, 36, 36, 36],
      });
    }
  }, [companies, mapReady]);

  const selectedIndustryLabel = useMemo(
    () => industries.find((item) => String(item.id) === industryId)?.industry ?? null,
    [industries, industryId],
  );

  return (
    <div className="py-4">
      <div className="flex min-h-[calc(100vh-180px)] flex-col gap-3">
        <div className="rounded-md border bg-background p-3 shadow-sm">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MapPinned className="h-5 w-5 text-muted-foreground" />
                <div className="font-semibold">Компании на карте</div>
                <Badge variant="secondary" className="font-normal">
                  {companies.length.toLocaleString('ru-RU')} / {withGeo.toLocaleString('ru-RU')}
                </Badge>
                {skippedNoGeo > 0 && (
                  <Badge variant="outline" className="font-normal">
                    без координат: {skippedNoGeo.toLocaleString('ru-RU')}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {lastLoadedAt && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(lastLoadedAt).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                )}
                {activeFilterCount > 0 && (
                  <Badge variant="outline" className="font-normal">
                    фильтров: {activeFilterCount}
                  </Badge>
                )}
                <Button type="button" variant="outline" size="sm" className="h-8 gap-2" onClick={resetFilters}>
                  <RotateCcw className="h-4 w-4" />
                  Сбросить
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2"
                  onClick={() => setReloadToken((value) => value + 1)}
                  disabled={loading}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Обновить
                </Button>
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
              <div className="space-y-1">
                <span className="text-[11px] uppercase text-muted-foreground">Отрасль</span>
                <Select value={industryId} onValueChange={setIndustryId}>
                  <SelectTrigger className="h-9 text-left text-sm" disabled={industriesLoading && !industries.length}>
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
              </div>

              <div className="space-y-1">
                <span className="text-[11px] uppercase text-muted-foreground">ОКВЭД</span>
                <Select value={okvedCode} onValueChange={setOkvedCode}>
                  <SelectTrigger className="h-9 text-left text-sm" disabled={okvedLoading && !okvedOptions.length}>
                    <SelectValue placeholder="Все коды" />
                  </SelectTrigger>
                  <SelectContent className="min-w-full sm:min-w-[520px]">
                    <SelectItem value="all">Все коды</SelectItem>
                    {okvedOptions.map((item) => (
                      <SelectItem key={item.okved_code} value={item.okved_code} title={item.okved_main}>
                        <div className="flex flex-col gap-0.5 text-left">
                          <span className="font-medium text-foreground">{item.okved_code}</span>
                          <span className="text-xs text-muted-foreground whitespace-normal break-words">
                            {item.okved_main}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] uppercase text-muted-foreground">Ответственный</span>
                <Input
                  className="h-9 text-sm"
                  list="companies-map-responsibles"
                  placeholder="ФИО"
                  value={responsible}
                  onChange={(event) => setResponsible(event.target.value)}
                />
                <datalist id="companies-map-responsibles">
                  {responsibleOptions.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] uppercase text-muted-foreground">Скор</span>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    className="h-9 text-sm"
                    inputMode="decimal"
                    placeholder="от"
                    value={scoreFrom}
                    onChange={(event) => setScoreFrom(event.target.value)}
                  />
                  <Input
                    className="h-9 text-sm"
                    inputMode="decimal"
                    placeholder="до"
                    value={scoreTo}
                    onChange={(event) => setScoreTo(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] uppercase text-muted-foreground">Выручка, млн</span>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    className="h-9 text-sm"
                    inputMode="decimal"
                    placeholder="от"
                    value={revenueFromMln}
                    onChange={(event) => setRevenueFromMln(event.target.value)}
                  />
                  <Input
                    className="h-9 text-sm"
                    inputMode="decimal"
                    placeholder="до"
                    value={revenueToMln}
                    onChange={(event) => setRevenueToMln(event.target.value)}
                  />
                </div>
              </div>

              <label className="flex h-full min-h-[58px] items-end gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <Checkbox checked={successOnly} onCheckedChange={(value) => setSuccessOnly(Boolean(value))} />
                <span className="pb-1 text-foreground">Успешные анализы</span>
              </label>
            </div>

            {(selectedIndustryLabel || okvedCode !== 'all' || error) && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {selectedIndustryLabel && <Badge variant="secondary">Отрасль: {selectedIndustryLabel}</Badge>}
                {okvedCode !== 'all' && <Badge variant="secondary">ОКВЭД: {okvedCode}</Badge>}
                {error && <Badge variant="destructive">{error}</Badge>}
              </div>
            )}
          </div>
        </div>

        <div className="relative min-h-[520px] flex-1 overflow-hidden rounded-md border bg-muted">
          <div ref={mapContainerRef} className={cn('h-full min-h-[520px] w-full', (!mapReady || mapError) && 'opacity-40')} />

          {(loading || !mapReady || mapError) && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/70">
              <div className="rounded-md border bg-background px-4 py-3 text-sm shadow-sm">
                {mapError ? (
                  <span className="text-destructive">{mapError}</span>
                ) : (
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {loading ? 'Загружаем компании' : 'Инициализируем карту'}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Всего по фильтрам: {total.toLocaleString('ru-RU')}</span>
          <span>С координатами: {withGeo.toLocaleString('ru-RU')}</span>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { okvedMainSchema, type OkvedCompany } from '@/lib/validators';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ArrowUpRight, X } from 'lucide-react';

type OkvedMain = ReturnType<typeof okvedMainSchema.parse>;
type SortKey = 'revenue_desc' | 'revenue_asc';
type IndustryItem = { id: number; industry: string };

const MIN_SIDEBAR = 480;
const MAX_SIDEBAR = 1200;
const MIN_RIGHT = 420;
const DEFAULT_SIDEBAR = 640;
const LS_KEY = 'okved:sidebarWidth';

type ListResponse<T> = {
  items: T[];
  page: number;
  totalPages: number;
};

export default function OkvedTab() {
  const sp = useSearchParams();
  const router = useRouter();

  const initialOkved = (sp.get('okved') ?? '').trim();
  const initialIndustryIdRaw = sp.get('industryId') ?? 'all';
  const initialQ = sp.get('q') ?? '';
  const initialSort = ((sp.get('sort') as SortKey) ?? 'revenue_desc') as SortKey;
  const initialExtra = (sp.get('extra') ?? '0') === '1';
  const initialPage = Number(sp.get('page')) || 1;

  const [okveds, setOkveds] = useState<OkvedMain[]>([]);
  const [okved, setOkved] = useState<string>(initialOkved);
  const [companies, setCompanies] = useState<OkvedCompany[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const pageSize = 50;

  const [industryList, setIndustryList] = useState<IndustryItem[]>([]);
  const [industriesLoading, setIndustriesLoading] = useState<boolean>(true);

  const initialIndustryIsNumber =
    initialIndustryIdRaw !== 'all' && /^\d+$/.test(initialIndustryIdRaw);
  const [csOkvedEnabled, setCsOkvedEnabled] = useState<boolean>(initialIndustryIsNumber);

  const [industryId, setIndustryId] = useState<string>(
    initialIndustryIsNumber ? initialIndustryIdRaw : 'all',
  );

  const [includeExtra, setIncludeExtra] = useState<boolean>(initialExtra);

  const [searchName, setSearchName] = useState<string>(initialQ);
  const [sortKey, setSortKey] = useState<SortKey>(initialSort);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_SIDEBAR;
    const v = Number(localStorage.getItem(LS_KEY));
    return Number.isFinite(v) ? clamp(v, MIN_SIDEBAR, MAX_SIDEBAR) : DEFAULT_SIDEBAR;
  });
  const draggingRef = useRef(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function ensureBounds() {
      const el = layoutRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const maxSidebar = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, rect.width - MIN_RIGHT));
      setSidebarWidth((w) => clamp(w, MIN_SIDEBAR, maxSidebar));
    }
    ensureBounds();
    window.addEventListener('resize', ensureBounds);
    return () => window.removeEventListener('resize', ensureBounds);
  }, []);

  const okvedReqId = useRef(0);
  const companiesReqId = useRef(0);

  useEffect(() => {
    const ac = new AbortController();
    const myId = ++okvedReqId.current;
    (async () => {
      try {
        const res = await fetch('/api/okved/main', { cache: 'no-store', signal: ac.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (myId !== okvedReqId.current) return;
        setOkveds(Array.isArray(data.items) ? data.items : []);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        console.error('Failed to load okved list:', e);
        if (myId !== okvedReqId.current) return;
        setOkveds([]);
      }
    })();
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();

    async function loadAllIndustries() {
      try {
        setIndustriesLoading(true);
        const collected: IndustryItem[] = [];
        let page = 1;
        let totalPages = 1;

        do {
          const params = new URLSearchParams({
            page: String(page),
            pageSize: '50',
            ts: String(Date.now()),
          });
          const res = await fetch(`/api/industries?${params}`, {
            cache: 'no-store',
            signal: ac.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const j: Partial<ListResponse<IndustryItem>> = await res.json();

          const items = Array.isArray(j?.items) ? j!.items! : [];
          collected.push(...items);

          const p = typeof j?.page === 'number' ? j!.page! : page;
          const tp = typeof j?.totalPages === 'number' ? j!.totalPages! : 1;

          page = p + 1;
          totalPages = tp;
        } while (page <= totalPages && !ac.signal.aborted);

        const unique = dedupeById(collected).sort((a, b) =>
          a.industry.localeCompare(b.industry, 'ru'),
        );

        if (!ac.signal.aborted) {
          setIndustryList(unique);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Failed to load industries:', err);
          setIndustryList([]);
        }
      } finally {
        if (!ac.signal.aborted) setIndustriesLoading(false);
      }
    }

    loadAllIndustries();
    return () => ac.abort();
  }, []);

  const loadCompanies = useCallback(() => {
    const ac = new AbortController();
    const myId = ++companiesReqId.current;

    setLoading(true);

    const url = new URL('/api/okved/companies', window.location.origin);
    if (okved) url.searchParams.set('okved', okved);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(pageSize));
    if (searchName.trim()) url.searchParams.set('q', searchName.trim());
    url.searchParams.set('sort', sortKey);
    url.searchParams.set('extra', includeExtra ? '1' : '0');
    if (csOkvedEnabled && industryId !== 'all') {
      url.searchParams.set('industryId', industryId);
    }

    (async () => {
      try {
        const r = await fetch(url.toString(), { cache: 'no-store', signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (myId !== companiesReqId.current) return;
        setCompanies(Array.isArray(data.items) ? data.items : []);
        setTotal(Number.isFinite(data.total) ? data.total : 0);
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        console.error('Failed to load companies:', e);
        if (myId !== companiesReqId.current) return;
        setCompanies([]);
        setTotal(0);
      } finally {
        if (myId === companiesReqId.current) setLoading(false);
      }
    })();

    const qs = new URLSearchParams(Array.from(sp.entries()));
    qs.set('tab', 'okved');
    if (okved) qs.set('okved', okved);
    else qs.delete('okved');

    if (searchName.trim()) qs.set('q', searchName.trim());
    else qs.delete('q');

    qs.set('sort', sortKey);
    qs.set('extra', includeExtra ? '1' : '0');

    if (csOkvedEnabled && industryId !== 'all') qs.set('industryId', industryId);
    else qs.delete('industryId');

    qs.set('page', String(page));
    router.replace(`/library?${qs.toString()}`);

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [okved, page, searchName, includeExtra, sortKey, csOkvedEnabled, industryId]);

  useEffect(() => {
    const abortFn = loadCompanies();
    return () => {
      if (typeof abortFn === 'function') abortFn();
    };
  }, [loadCompanies]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);
  const isAll = okved === '';

  const activeOkved = useMemo(
    () => (okved ? okveds.find((o) => o.okved_code === okved) ?? null : null),
    [okved, okveds],
  );

  useEffect(() => {
    function onMove(e: MouseEvent | TouchEvent) {
      if (!draggingRef.current) return;
      const container = layoutRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const pointerX = getPointerX(e);
      if (pointerX == null) return;

      let newW = pointerX - rect.left;
      const maxSidebarByRight = rect.width - MIN_RIGHT;
      const maxSidebar = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, maxSidebarByRight));
      newW = clamp(newW, MIN_SIDEBAR, maxSidebar);
      setSidebarWidth(newW);

      if (e instanceof TouchEvent) e.preventDefault();
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      try {
        localStorage.setItem(LS_KEY, String(sidebarWidth));
      } catch {}
      document.body.style.cursor = '';
      document.body.classList.remove('select-none');
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove as any);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, [sidebarWidth]);

  function startDrag(e: React.MouseEvent | React.TouchEvent) {
    if (!isLg()) return;
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.classList.add('select-none');
    e.preventDefault();
  }

  function revenueMln(x: number | null | undefined) {
    if (!x || !Number.isFinite(x)) return '—';
    return Math.round(x / 1_000_000).toLocaleString('ru-RU');
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isAll) {
        setOkved('');
        setPage(1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAll]);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    setPage(1);
  }, [okved, searchName, includeExtra, sortKey, csOkvedEnabled, industryId]);

  return (
    <div ref={layoutRef} className="flex flex-col lg:flex-row gap-1 text-[13px] leading-snug">
      {/* Левая панель */}
      <div
        className="lg:shrink-0"
        suppressHydrationWarning
        style={hydrated && isLg() ? { width: sidebarWidth } : undefined}>
        <Card>
          <CardHeader className="grid grid-cols-[1fr,auto] items-center gap-1 p-3">
            <CardTitle className="text-sm">ОКВЭД</CardTitle>

            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${isAll ? 'opacity-0 pointer-events-none' : ''}`}
              onClick={() => {
                setOkved('');
                setPage(1);
              }}
              title={isAll ? 'Нет активного фильтра' : 'Сбросить фильтр'}
              aria-disabled={isAll}
              tabIndex={isAll ? -1 : 0}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>

          <CardContent className="space-y-2 p-3">
            {/* Отрасли */}
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={csOkvedEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setCsOkvedEnabled(checked);
                    if (!checked) {
                      setIndustryId('all');
                      setPage(1);
                    }
                  }}
                />
                Отрасли
              </label>

              <select
                disabled={!csOkvedEnabled}
                value={industryId}
                onChange={(e) => {
                  setIndustryId(e.target.value);
                  setPage(1);
                }}
                className="h-8 w-[260px] max-w-[260px] truncate border rounded-md px-2 text-xs"
                title={
                  industryId !== 'all'
                    ? industryList.find((i) => String(i.id) === industryId)?.industry
                    : '— Все отрасли —'
                }>
                <option value="all">— Все отрасли —</option>
                {industriesLoading && (
                  <option value="" disabled>
                    (загрузка…)
                  </option>
                )}
                {!industriesLoading &&
                  industryList.map((it) => (
                    <option key={it.id} value={String(it.id)}>
                      {it.industry}
                    </option>
                  ))}
              </select>
            </div>

            {/* Искать в дополнительных ОКВЭД */}
            <label className="inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={includeExtra}
                onChange={(e) => setIncludeExtra(e.target.checked)}
              />
              Искать в дополнительных ОКВЭД
            </label>

            {/* Поиск в списке слева */}
            <Input
              className="h-8 text-xs"
              placeholder="Поиск по коду/названию…"
              onChange={(e) => {
                const q = e.target.value.toLowerCase();
                const elts = document.querySelectorAll('[data-okved-row]');
                elts.forEach((el) => {
                  const text = (el.getAttribute('data-q') ?? '').toLowerCase();
                  (el as HTMLElement).style.display = text.includes(q) ? '' : 'none';
                });
              }}
            />

            <div className="max-h-[58vh] overflow-auto divide-y">
              <div
                data-okved-row
                data-q="все компании"
                className={`flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer ${
                  isAll ? 'bg-muted' : 'hover:bg-muted'
                }`}
                onClick={() => {
                  setOkved('');
                  setPage(1);
                }}
                title="Все компании — без фильтра">
                <Button
                  size="icon"
                  variant="secondary"
                  className="shrink-0 h-7 w-7"
                  title="Открыть все компании в новой вкладке"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(`/library?tab=okved`, '_blank');
                  }}>
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
                <div className="truncate">
                  <div className="font-medium text-xs">Все компании</div>
                  <div className="text-[11px] text-muted-foreground truncate">без фильтра</div>
                </div>
              </div>

              {okveds.map((x) => {
                const active = okved === x.okved_code;
                return (
                  <div
                    key={x.id}
                    data-okved-row
                    data-q={`${x.okved_code} ${x.okved_main}`}
                    className={`flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer ${
                      active ? 'bg-muted' : 'hover:bg-muted'
                    }`}
                    onClick={() => {
                      setPage(1);
                      setOkved(active ? '' : x.okved_code);
                    }}
                    title={x.okved_main}>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="shrink-0 h-7 w-7"
                      title="Открыть в новой вкладке"
                      onClick={(e) => {
                        e.stopPropagation();
                        const url = `/library?tab=okved${
                          x.okved_code ? `&okved=${encodeURIComponent(x.okved_code)}` : ''
                        }`;
                        window.open(url, '_blank');
                      }}>
                      <ArrowUpRight className="h-4 w-4" />
                    </Button>
                    <div className="truncate">
                      <div className="font-medium text-xs">{x.okved_code}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {x.okved_main}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Резайзер */}
      <div
        className="hidden lg:block relative w-2 cursor-col-resize select-none"
        onMouseDown={startDrag}
        onTouchStart={startDrag}
        aria-label="Изменить ширину панели фильтра"
        role="separator"
        aria-orientation="vertical"
        title="Перетащите, чтобы изменить ширину панели">
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border" />
        <div className="absolute inset-y-0 left-0 right-0 hover:bg-muted/50 rounded" />
      </div>

      {/* Правая часть */}
      <div className="min-w-0 flex-1">
        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-3">
            <CardTitle className="flex flex-col text-sm">
              <span>
                {isAll ? 'Все компании' : `Компании по ОКВЭД ${okved}`}
                {total ? ` · ${total.toLocaleString('ru-RU')}` : ''}
              </span>
              {activeOkved && (
                <span className="text-xs text-muted-foreground">
                  <span className="font-medium">{activeOkved.okved_code}</span> —{' '}
                  {activeOkved.okved_main}
                </span>
              )}
            </CardTitle>

            <div className="flex items-center gap-2">
              <Input
                className="w-[320px] h-8 text-xs"
                placeholder="Поиск по названию компании…"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
              />
            </div>
          </CardHeader>

          <CardContent className="p-3">
            <div className="relative w-full overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="[&_tr]:border-b">
                  <tr className="text-left">
                    <th className="py-1 pr-2 w-[35px]"></th>
                    <th className="py-1 pr-3">ИНН</th>
                    <th className="py-1 pr-3">Название</th>
                    <th
                      className="py-1 pr-3 cursor-pointer select-none"
                      title="Сортировать по выручке"
                      onClick={() => {
                        setSortKey((s) => (s === 'revenue_desc' ? 'revenue_asc' : 'revenue_desc'));
                        setPage(1);
                      }}>
                      Выручка, млн
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        {sortKey === 'revenue_desc' ? '↓' : '↑'}
                      </span>
                    </th>
                    <th className="py-1 pr-3">Адрес</th>
                    <th className="py-1 pr-3">Филиалов</th>
                    <th className="py-1 pr-2">Год</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-muted-foreground text-xs">
                        Загрузка…
                      </td>
                    </tr>
                  )}
                  {!loading && companies.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-muted-foreground text-xs">
                        Нет данных
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    companies.map((c) => (
                      <tr key={`${c.inn}-${c.year}`} className="border-b hover:bg-muted/40">
                        <td className="py-0.5 pr-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Открыть карточку компании в Bitrix24"
                            onClick={() =>
                              window.open(
                                `/api/b24/resolve-company?inn=${encodeURIComponent(
                                  c.inn,
                                )}&mode=pick`,
                                '_blank',
                                'noopener',
                              )
                            }>
                            <ArrowUpRight className="h-4 w-4" />
                          </Button>
                        </td>
                        <td className="py-0.5 pr-3 whitespace-nowrap">{c.inn}</td>
                        <td className="py-0.5 pr-3">{c.short_name}</td>
                        <td className="py-0.5 pr-3 text-right tabular-nums">
                          {revenueMln(c.revenue)}
                        </td>
                        <td className="py-0.5 pr-3">{c.address ?? '—'}</td>
                        <td className="py-0.5 pr-3">{c.branch_count ?? '—'}</td>
                        <td className="py-0.5 pr-2">{c.year ?? '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="secondary"
                  className="h-8 px-2 text-xs"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Назад
                </Button>
                <div className="text-[11px] text-muted-foreground">
                  страница {page} / {pages}
                </div>
                <Button
                  variant="secondary"
                  className="h-8 px-2 text-xs"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}>
                  Вперёд
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
function isLg() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(min-width: 1024px)').matches;
}
function getPointerX(e: MouseEvent | TouchEvent): number | null {
  if (e instanceof MouseEvent) return e.clientX;
  const t = e.touches[0] ?? e.changedTouches[0];
  return t ? t.clientX : null;
}
function dedupeById<T extends { id: number }>(arr: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const it of arr) {
    if (!seen.has(it.id)) {
      seen.add(it.id);
      out.push(it);
    }
  }
  return out;
}

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

export default function OkvedTab() {
  const sp = useSearchParams();
  const router = useRouter();

  // --- initial from URL
  const initialOkved = (sp.get('okved') ?? '').trim();
  const initialIndustryId = sp.get('industryId') ?? 'all';
  const initialQ = sp.get('q') ?? '';
  const initialSort = ((sp.get('sort') as SortKey) ?? 'revenue_desc') as SortKey;
  const initialExtra = (sp.get('extra') ?? '0') === '1';
  const initialPage = Number(sp.get('page')) || 1;

  // --- local state
  const [okveds, setOkveds] = useState<OkvedMain[]>([]);
  const [okved, setOkved] = useState<string>(initialOkved);
  const [companies, setCompanies] = useState<OkvedCompany[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const pageSize = 50;

  // индустрии (человеческие названия)
  const [industryList, setIndustryList] = useState<IndustryItem[]>([]);
  const [csOkvedEnabled, setCsOkvedEnabled] = useState<boolean>(!!sp.get('industryId'));
  const [industryId, setIndustryId] = useState<string>(initialIndustryId); // 'all' | id
  const [includeExtra, setIncludeExtra] = useState<boolean>(initialExtra);

  // поиск/сортировка
  const [searchName, setSearchName] = useState<string>(initialQ);
  const [sortKey, setSortKey] = useState<SortKey>(initialSort);

  // --- resizer
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

  // ====== loaders (with abort & race guards) ======
  const okvedReqId = useRef(0);
  const companiesReqId = useRef(0);

  // okved list
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

  // industries list
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const url = new URL('/api/industries', window.location.origin);
        url.searchParams.set('page', '1');
        url.searchParams.set('pageSize', '500');
        const res = await fetch(url.toString(), { cache: 'no-store', signal: ac.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        setIndustryList(Array.isArray(j?.items) ? j.items : []);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('Failed to load industries:', err);
        setIndustryList([]);
      }
    })();
    return () => ac.abort();
  }, []);

  // companies load
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
      // сервер понимает industryId (id из ib_industry)
      url.searchParams.set('industryId', industryId);
    }

    (async () => {
      try {
        const r = await fetch(url.toString(), { cache: 'no-store', signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (myId !== companiesReqId.current) return; // защита от гонок
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

    // sync URL (только после старта запроса; самого запроса ждать не нужно)
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
      // если loadCompanies вернул функцию abort — вызываем
      if (typeof abortFn === 'function') abortFn();
    };
  }, [loadCompanies]);

  // вычисления
  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);
  const isAll = okved === '';

  // --- resizer handlers
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

  // Esc -> сброс активного ОКВЭД
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

  // сброс страницы при изменении фильтров
  useEffect(() => {
    setPage(1);
  }, [okved, searchName, includeExtra, sortKey, csOkvedEnabled, industryId]);

  return (
    <div ref={layoutRef} className="flex flex-col lg:flex-row gap-1">
      {/* Левая панель */}
      <div
        className="lg:shrink-0"
        suppressHydrationWarning
        style={hydrated && isLg() ? { width: sidebarWidth } : undefined}>
        <Card>
          <CardHeader className="grid grid-cols-[1fr,auto] items-center gap-2">
            <CardTitle>ОКВЭД</CardTitle>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setOkved('');
                setPage(1);
              }}
              title={isAll ? 'Нет активного фильтра' : 'Сбросить фильтр'}
              className={isAll ? 'opacity-0 pointer-events-none' : 'opacity-100'}
              aria-disabled={isAll}
              tabIndex={isAll ? -1 : 0}>
              <X className="h-5 w-5" />
            </Button>
          </CardHeader>

          <CardContent className="space-y-3">
            {/* Отрасли (человеческие) */}
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={csOkvedEnabled}
                  onChange={(e) => setCsOkvedEnabled(e.target.checked)}
                />
                Отрасли
              </label>

              <select
                disabled={!csOkvedEnabled}
                value={industryId}
                onChange={(e) => setIndustryId(e.target.value)}
                className="h-9 w-[280px] max-w-[280px] truncate border rounded-md px-2 text-sm">
                <option value="all">— Все отрасли —</option>
                {industryList.map((it) => (
                  <option key={it.id} value={String(it.id)}>
                    {it.industry}
                  </option>
                ))}
              </select>
            </div>

            {/* Искать в дополнительных ОКВЭД */}
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={includeExtra}
                onChange={(e) => setIncludeExtra(e.target.checked)}
              />
              Искать в дополнительных ОКВЭД
            </label>

            {/* Поиск по коду/названию в списке слева (визуальный фильтр) */}
            <Input
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

            <div className="max-h-[60vh] overflow-auto divide-y">
              <div
                data-okved-row
                data-q="все компании"
                className={`flex items-center gap-2 py-2 px-2 rounded-md cursor-pointer ${
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
                  className="shrink-0"
                  title="Открыть все компании в новой вкладке"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(`/library?tab=okved`, '_blank');
                  }}>
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
                <div className="truncate">
                  <div className="font-medium">Все компании</div>
                  <div className="text-xs text-muted-foreground truncate">без фильтра</div>
                </div>
              </div>

              {okveds.map((x) => {
                const active = okved === x.okved_code;
                return (
                  <div
                    key={x.id}
                    data-okved-row
                    data-q={`${x.okved_code} ${x.okved_main}`}
                    className={`flex items-center gap-2 py-2 px-2 rounded-md cursor-pointer ${
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
                      className="shrink-0"
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
                      <div className="font-medium">{x.okved_code}</div>
                      <div className="text-xs text-muted-foreground truncate">{x.okved_main}</div>
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
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>
              {isAll ? 'Все компании' : `Компании по ОКВЭД ${okved}`}
              {total ? ` · ${total.toLocaleString('ru-RU')}` : ''}
            </CardTitle>

            {/* Поиск по названию справа */}
            <div className="flex items-center gap-2">
              <Input
                className="w-[360px]"
                placeholder="Поиск по названию компании…"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
              />
            </div>
          </CardHeader>

          <CardContent>
            <div className="relative w-full overflow-auto">
              <table className="w-full text-sm">
                <thead className="[&_tr]:border-b">
                  <tr className="text-left">
                    <th className="py-2 pr-2 w-[56px]"></th>
                    <th className="py-2 pr-4">ИНН</th>
                    <th className="py-2 pr-4">Название</th>
                    <th
                      className="py-2 pr-4 cursor-pointer select-none"
                      title="Сортировать по выручке"
                      onClick={() => {
                        setSortKey((s) => (s === 'revenue_desc' ? 'revenue_asc' : 'revenue_desc'));
                        setPage(1);
                      }}>
                      Выручка, млн
                      <span className="ml-1 text-xs text-muted-foreground">
                        {sortKey === 'revenue_desc' ? '↓' : '↑'}
                      </span>
                    </th>
                    <th className="py-2 pr-4">Адрес</th>
                    <th className="py-2 pr-4">Филиалов</th>
                    <th className="py-2 pr-2">Год</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        Загрузка…
                      </td>
                    </tr>
                  )}
                  {!loading && companies.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        Нет данных
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    companies.map((c) => (
                      <tr key={`${c.inn}-${c.year}`} className="border-b hover:bg-muted/40">
                        <td className="py-1 pr-2">
                          <Button
                            size="icon"
                            variant="ghost"
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
                        <td className="py-1 pr-4 whitespace-nowrap">{c.inn}</td>
                        <td className="py-1 pr-4">{c.short_name}</td>
                        <td className="py-1 pr-4 text-right tabular-nums">
                          {revenueMln(c.revenue)}
                        </td>
                        <td className="py-1 pr-4">{c.address ?? '—'}</td>
                        <td className="py-1 pr-4">{c.branch_count ?? '—'}</td>
                        <td className="py-1 pr-2">{c.year ?? '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 pt-3">
                <Button
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Назад
                </Button>
                <div className="text-xs text-muted-foreground">
                  страница {page} / {pages}
                </div>
                <Button
                  variant="secondary"
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

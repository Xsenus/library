'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { okvedMainSchema, type OkvedCompany } from '@/lib/validators';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ArrowUpRight, X } from 'lucide-react';

type OkvedMain = ReturnType<typeof okvedMainSchema.parse>;

const MIN_SIDEBAR = 240;
const MAX_SIDEBAR = 720;
const MIN_RIGHT = 420; // минимальная ширина правой таблицы
const DEFAULT_SIDEBAR = 320;
const LS_KEY = 'okved:sidebarWidth';

export default function OkvedTab() {
  const sp = useSearchParams();
  const router = useRouter();

  const initialOkved = (sp.get('okved') ?? '').trim();

  const [okveds, setOkveds] = useState<OkvedMain[]>([]);
  const [okved, setOkved] = useState<string>(initialOkved);
  const [companies, setCompanies] = useState<OkvedCompany[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pageSize = 50;

  // --- resizer state ---
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_SIDEBAR;
    const v = Number(localStorage.getItem(LS_KEY));
    return Number.isFinite(v) ? clamp(v, MIN_SIDEBAR, MAX_SIDEBAR) : DEFAULT_SIDEBAR;
  });
  const draggingRef = useRef(false);
  const layoutRef = useRef<HTMLDivElement | null>(null); // контейнер двух колонок

  // обработка ограничения правой части при ресайзе окна
  useEffect(() => {
    function ensureBounds() {
      const el = layoutRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const totalW = rect.width;
      const maxSidebar = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, totalW - MIN_RIGHT));
      setSidebarWidth((w) => clamp(w, MIN_SIDEBAR, maxSidebar));
    }
    ensureBounds();
    window.addEventListener('resize', ensureBounds);
    return () => window.removeEventListener('resize', ensureBounds);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await fetch('/api/okved/main', { cache: 'no-store' });
      const data = await res.json();
      if (!mounted) return;
      setOkveds(data.items ?? []);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    const url = new URL('/api/okved/companies', window.location.origin);
    if (okved) url.searchParams.set('okved', okved);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(pageSize));

    fetch(url.toString(), { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setCompanies(data.items ?? []);
        setTotal(data.total ?? 0);
      })
      .finally(() => setLoading(false));

    const qs = new URLSearchParams(Array.from(sp.entries()));
    qs.set('tab', 'okved');
    if (okved) qs.set('okved', okved);
    else qs.delete('okved');
    router.replace(`/library?${qs.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [okved, page]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);
  const isAll = okved === '';

  // --- resizer handlers ---
  useEffect(() => {
    function onMove(e: MouseEvent | TouchEvent) {
      if (!draggingRef.current) return;
      const container = layoutRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const pointerX = getPointerX(e);
      if (pointerX == null) return;

      // ширина левой панели = X курсора — левый край контейнера
      let newW = pointerX - rect.left;

      // учитываем минимальную ширину правой колонки и сам резайзер (2px + отступы)
      const maxSidebarByRight = rect.width - MIN_RIGHT;
      const maxSidebar = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, maxSidebarByRight));

      newW = clamp(newW, MIN_SIDEBAR, maxSidebar);
      setSidebarWidth(newW);

      // предотвратить скролл на таче
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
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, [sidebarWidth]);

  function startDrag(e: React.MouseEvent | React.TouchEvent) {
    // начинаем тянуть только на lg+ (визуально резайзер скрыт на мобилке)
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

  return (
    <div ref={layoutRef} className="flex flex-col lg:flex-row gap-1">
      {/* Левая панель — фиксируем ширину только на lg+ */}
      <div className="lg:shrink-0" style={isLg() ? { width: sidebarWidth } : {}}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>ОКВЭД</CardTitle>
            {!isAll && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setOkved('');
                  setPage(1);
                }}
                title="Сбросить фильтр">
                <X className="h-4 w-4 mr-1" /> Сбросить
              </Button>
            )}
          </CardHeader>

          <CardContent className="space-y-2">
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

      {/* Резайзер: только на lg+ */}
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
          <CardHeader>
            <CardTitle>
              {isAll ? 'Все компании' : `Компании по ОКВЭД ${okved}`}
              {total ? ` · ${total.toLocaleString('ru-RU')}` : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative w-full overflow-auto">
              <table className="w-full text-sm">
                <thead className="[&_tr]:border-b">
                  <tr className="text-left">
                    <th className="py-2 pr-2 w-[56px]"></th>
                    <th className="py-2 pr-4">ИНН</th>
                    <th className="py-2 pr-4">Название</th>
                    <th className="py-2 pr-4">Выручка, млн</th>
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
                            title="Открыть карточку компании"
                            onClick={() =>
                              window.open(`/company?inn=${encodeURIComponent(c.inn)}`, '_blank')
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

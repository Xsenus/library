'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { okvedMainSchema, type OkvedCompany } from '@/lib/validators';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ArrowUpRight, X } from 'lucide-react';
import InlineDualArea from './inline-dual-area';

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

// ——— стили подсветки выбранного фильтра ———
const ACTIVE_ROW =
  'bg-blue-100 text-blue-700 ring-1 ring-blue-300 dark:bg-blue-900/40 dark:text-blue-100 dark:ring-blue-700';
const INACTIVE_ROW = 'hover:bg-muted';

const OKVED_SECTION_BY_2DIGIT: Record<string, string> = {
  '01': 'Растениеводство и животноводство, охота и предоставление соответствующих услуг',
  '02': 'Лесоводство и лесозаготовки',
  '03': 'Рыболовство и рыбоводство',
  '05': 'Добыча угля',
  '06': 'Добыча нефти и природного газа',
  '07': 'Добыча металлических руд',
  '08': 'Добыча прочих полезных ископаемых',
  '09': 'Услуги в области добычи полезных ископаемых',
  '10': 'Производство пищевых продуктов',
  '11': 'Производство напитков',
  '12': 'Производство табачных изделий',
  '13': 'Производство текстильных изделий',
  '14': 'Производство одежды',
  '15': 'Производство кожи и изделий из кожи',
  '16': 'Обработка древесины и производство изделий из дерева и пробки (кроме мебели)',
  '17': 'Производство бумаги и бумажных изделий',
  '18': 'Деятельность полиграфическая и копирование носителей информации',
  '19': 'Производство кокса и нефтепродуктов',
  '20': 'Производство химических веществ и химических продуктов',
  '21': 'Производство лекарственных средств и материалов',
  '22': 'Производство резиновых и пластмассовых изделий',
  '23': 'Производство прочей неметаллической минеральной продукции',
  '24': 'Производство металлургическое',
  '25': 'Производство готовых металлических изделий, кроме машин и оборудования',
  '26': 'Производство компьютеров, электронных и оптических изделий',
  '27': 'Производство электрического оборудования',
  '28': 'Производство машин и оборудования, не включённых в другие группировки',
  '29': 'Производство автотранспортных средств, прицепов и полуприцепов',
  '30': 'Производство прочих транспортных средств и оборудования',
  '31': 'Производство мебели',
  '32': 'Производство прочих готовых изделий',
  '33': 'Ремонт и монтаж машин и оборудования',
  '35': 'Обеспечение электрической энергией, газом и паром; кондиционирование воздуха',
  '36': 'Забор, очистка и распределение воды',
  '37': 'Сбор и обработка сточных вод',
  '38': 'Сбор, обработка и утилизация отходов; обработка вторичного сырья',
  '39': 'Услуги по ликвидации последствий загрязнений и удалению отходов',
  '41': 'Строительство зданий',
  '42': 'Строительство инженерных сооружений',
  '43': 'Работы строительные специализированные',
  '45': 'Торговля автотранспортными средствами и их ремонт',
  '46': 'Торговля оптовая, кроме автотрансп. средств и мотоциклов',
  '47': 'Торговля розничная, кроме автотрансп. средств и мотоциклов',
  '49': 'Деятельность сухопутного и трубопроводного транспорта',
  '50': 'Деятельность водного транспорта',
  '51': 'Деятельность воздушного и космического транспорта',
  '52': 'Складское хозяйство и вспомогательная транспортная деятельность',
  '53': 'Деятельность почтовой связи и курьерская деятельность',
  '55': 'Предоставление мест для временного проживания',
  '56': 'Предоставление продуктов питания и напитков',
  '58': 'Деятельность издательская',
  '59': 'Производство кино-, видеофильмов и теле-программ; издание звукозаписей и нот',
  '60': 'Деятельность в области телевидения и радиовещания',
  '61': 'Деятельность в сфере телекоммуникаций',
  '62': 'Разработка ПО, консалтинг в этой области и сопутствующие услуги',
  '63': 'Деятельность в области информационных технологий',
  '64': 'Финансовые услуги, кроме страхования и пенсионного обеспечения',
  '65': 'Страхование, перестрахование и деятельность НПФ (кроме обязательного соцобеспечения)',
  '66': 'Вспомогательная деятельность в сфере финансовых услуг и страхования',
  '68': 'Операции с недвижимым имуществом',
  '69': 'Деятельность в области права и бухгалтерского учёта',
  '70': 'Деятельность головных офисов; управление',
  '71': 'Архитектура, инженерные изыскания, испытания и анализ',
  '72': 'Научные исследования и разработки',
  '73': 'Реклама и исследования конъюнктуры рынка',
  '74': 'Профессиональная научная и техническая прочая деятельность',
  '75': 'Деятельность ветеринарная',
  '77': 'Аренда и лизинг',
  '78': 'Подбор и трудоустройство персонала',
  '79': 'Туристические агентства и прочие услуги в сфере туризма',
  '80': 'Обеспечение безопасности и расследования',
  '81': 'Обслуживание зданий и территорий',
  '82': 'Административно-хозяйственная деятельность и прочие вспомогательные услуги для бизнеса',
  '84': 'Госуправление и обеспечение военной безопасности; соцобеспечение',
  '85': 'Образование',
  '86': 'Здравоохранение',
  '87': 'Уход с обеспечением проживания',
  '88': 'Социальные услуги без обеспечения проживания',
  '90': 'Творческая деятельность, искусство и развлечения',
  '91': 'Библиотеки, архивы, музеи и прочие объекты культуры',
  '92': 'Азартные игры и заключение пари; лотереи',
  '93': 'Спорт, отдых и развлечения',
  '94': 'Общественные и прочие некоммерческие организации',
  '95': 'Ремонт компьютеров, предметов личного потребления и хозяйственно-бытового назначения',
  '96': 'Предоставление прочих персональных услуг',
  '97': 'Деятельность домашних хозяйств с наёмными работниками',
  '98': 'Деятельность домашних хозяйств для собственного потребления',
  '99': 'Деятельность экстерриториальных организаций и органов',
};

function getOkvedSectionTitle(two: string | null): string | null {
  if (!two) return null;
  return OKVED_SECTION_BY_2DIGIT[two] ?? null;
}

export default function OkvedTab() {
  const sp = useSearchParams();
  const router = useRouter();

  const initialOkved = (sp.get('okved') ?? '').trim();
  const initialQ = sp.get('q') ?? '';
  const initialSort = ((sp.get('sort') as SortKey) ?? 'revenue_desc') as SortKey;
  const initialExtra = (sp.get('extra') ?? '0') === '1'; // ЧБ №2
  const initialParent = (sp.get('parent') ?? '0') === '1'; // ЧБ №3
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

  const [csOkvedEnabled, setCsOkvedEnabled] = useState<boolean>(false);
  const [industryId, setIndustryId] = useState<string>('all');

  const [includeExtra, setIncludeExtra] = useState<boolean>(initialExtra); // ЧБ №2
  const [includeParent, setIncludeParent] = useState<boolean>(initialParent); // ЧБ №3

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
        const url = new URL('/api/okved/main', window.location.origin);
        if (csOkvedEnabled && industryId !== 'all') {
          url.searchParams.set('industryId', industryId);
        }

        const res = await fetch(url.toString(), { cache: 'no-store', signal: ac.signal });
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
  }, [csOkvedEnabled, industryId]);

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
    url.searchParams.set('extra', includeExtra ? '1' : '0');
    // передаём parent всегда; на бэке он игнорится, если okved пуст
    url.searchParams.set('parent', includeParent ? '1' : '0');

    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(pageSize));
    if (searchName.trim()) url.searchParams.set('q', searchName.trim());
    url.searchParams.set('sort', sortKey);
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

    // sync URL
    const qs = new URLSearchParams(Array.from(sp.entries()));
    qs.set('tab', 'okved');
    if (okved) qs.set('okved', okved);
    else qs.delete('okved');

    if (searchName.trim()) qs.set('q', searchName.trim());
    else qs.delete('q');

    qs.set('sort', sortKey);
    qs.set('extra', includeExtra ? '1' : '0');
    qs.set('parent', includeParent ? '1' : '0');

    if (csOkvedEnabled && industryId !== 'all') qs.set('industryId', industryId);
    else qs.delete('industryId');

    qs.set('page', String(page));
    router.replace(`/library?${qs.toString()}`);

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [okved, page, searchName, includeExtra, includeParent, sortKey, csOkvedEnabled, industryId]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);
  const isAll = okved === '';

  const activeOkved = useMemo(
    () => (okved ? okveds.find((o) => o.okved_code === okved) ?? null : null),
    [okved, okveds],
  );

  // поднятие выбранного фильтра в начало (не трогаем исходный массив)
  const okvedsView = useMemo(() => {
    if (!okved) return okveds;
    const idx = okveds.findIndex((o) => o.okved_code === okved);
    if (idx < 0) return okveds;
    return [okveds[idx], ...okveds.slice(0, idx), ...okveds.slice(idx + 1)];
  }, [okved, okveds]);

  const parent2 = useMemo(() => {
    const m = okved.match(/^\d{2}/);
    return m ? m[0] : null;
  }, [okved]);

  const parent2Title = useMemo(() => getOkvedSectionTitle(parent2), [parent2]);

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
    window.addEventListener('touchmove', onMove as any, { passive: false } as any);
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
  }, [okved, searchName, includeExtra, includeParent, sortKey, csOkvedEnabled, industryId]);

  useEffect(() => {
    const abortFn = loadCompanies();
    return () => {
      if (typeof abortFn === 'function') abortFn();
    };
  }, [loadCompanies]);

  const lastYear = new Date().getFullYear() - 1;

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
              <label className="inline-flex items-center gap-2 text-xs leading-none">
                <input
                  type="checkbox"
                  className="h-4 w-4"
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

            {/* Чекбоксы один под другим */}
            <div className="flex flex-col gap-2">
              {/* ЧБ №2 */}
              <label className="inline-flex items-center gap-2 text-xs leading-none">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={includeExtra}
                  onChange={(e) => setIncludeExtra(e.target.checked)}
                />
                Искать в дополнительных ОКВЭД
              </label>

              {/* ЧБ №3 */}
              <label
                className="inline-flex items-center gap-2 text-xs leading-none flex-nowrap"
                title={
                  okved
                    ? `Искать по всем кодам, начинающимся на ${parent2}`
                    : 'Выберите ОКВЭД слева — без выбранного кода флаг не влияет на результат'
                }>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={includeParent}
                  onChange={(e) => setIncludeParent(e.target.checked)}
                />
                <span>Все коды из родового ОКВЭД </span>

                {okved && parent2Title && (
                  <span
                    className="text-muted-foreground flex-1 min-w-0 truncate"
                    title={`${parent2} — ${parent2Title}`}>
                    {okved ? parent2 : '—'} - {parent2Title}
                  </span>
                )}
              </label>
            </div>

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
                  isAll ? ACTIVE_ROW : INACTIVE_ROW
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
                  <div
                    className={`font-medium text-xs ${
                      isAll ? 'text-blue-900 dark:text-blue-100' : ''
                    }`}>
                    Все компании
                  </div>
                  <div
                    className={`text-[11px] truncate ${
                      isAll ? 'text-blue-800/80 dark:text-blue-200/80' : 'text-muted-foreground'
                    }`}>
                    без фильтра
                  </div>
                </div>
              </div>

              {okvedsView.map((x) => {
                const active = okved === x.okved_code;
                return (
                  <div
                    key={x.id}
                    data-okved-row
                    data-q={`${x.okved_code} ${x.okved_main}`}
                    className={`flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer ${
                      active ? ACTIVE_ROW : INACTIVE_ROW
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
                      <div
                        className={`font-medium text-xs ${
                          active ? 'text-blue-900 dark:text-blue-100' : ''
                        }`}>
                        {x.okved_code}
                      </div>
                      <div
                        className={`text-[11px] truncate ${
                          active
                            ? 'text-blue-800/80 dark:text-blue-200/80'
                            : 'text-muted-foreground'
                        }`}>
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
                    <th className="py-1 pr-3">Штат</th>
                    <th className="py-1 pr-3">Филиалов</th>
                    <th className="py-1 pr-2">Год</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted-foreground text-xs">
                        Загрузка…
                      </td>
                    </tr>
                  )}
                  {!loading && companies.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted-foreground text-xs">
                        Нет данных
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    companies.map((c) => {
                      const seriesRevenue = [c.revenue_3, c.revenue_2, c.revenue_1, c.revenue];
                      const seriesIncome = [c.income_3, c.income_2, c.income_1, c.income];

                      const title = `Выручка (млн): ${seriesRevenue
                        .map((v) =>
                          Number.isFinite(v as number)
                            ? Math.round((v as number) / 1_000_000)
                            : '—',
                        )
                        .join(' · ')} | Прибыль (млн): ${seriesIncome
                        .map((v) =>
                          Number.isFinite(v as number)
                            ? Math.round((v as number) / 1_000_000)
                            : '—',
                        )
                        .join(' · ')}`;

                      const isActual = (c.year ?? 0) === lastYear;

                      const valueLabel = isLg()
                        ? revenueMln(c.revenue)
                        : revenueMln(c.income as number | null);

                      const valueTitle = isLg() ? 'Выручка, млн' : 'Прибыль, млн';

                      return (
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

                          {/* мини-график + цифра рядом */}
                          <td className="py-0.5 pr-3 align-middle">
                            <div className="flex items-center gap-2">
                              <div className="w-[100px] h-[45px] shrink-0 overflow-hidden">
                                <InlineDualArea
                                  revenue={[c.revenue_3, c.revenue_2, c.revenue_1, c.revenue]}
                                  income={[c.income_3, c.income_2, c.income_1, c.income]}
                                  year={c.year}
                                />
                              </div>
                              <div className="text-right tabular-nums w-[56px]">
                                {isLg()
                                  ? revenueMln(c.revenue)
                                  : revenueMln(c.income as number | null)}
                              </div>
                            </div>
                          </td>

                          <td className="py-0.5 pr-3">{c.address ?? '—'}</td>
                          <td className="py-0.5 pr-3">{formatEmployees(getEmployeeCount(c))}</td>
                          <td className="py-0.5 pr-3">{c.branch_count ?? '—'}</td>
                          <td className="py-0.5 pr-2">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded border ${
                                isActual
                                  ? 'border-transparent text-foreground'
                                  : 'border-red-400 text-red-600'
                              }`}
                              title={
                                isActual ? 'Последний закрытый год' : 'Не последний закрытый год'
                              }>
                              {c.year ?? '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
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
  const t = (e as TouchEvent).touches[0] ?? (e as TouchEvent).changedTouches[0];
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
function getEmployeeCount(c: OkvedCompany): number | null {
  const anyC = c as any;
  const v = anyC?.dadata_result?.employee_count ?? anyC?.employee_count ?? null;
  return Number.isFinite(v) ? Number(v) : null;
}
function formatEmployees(n: number | null): string {
  if (!n || !Number.isFinite(n)) return '—';
  return n.toLocaleString('ru-RU');
}

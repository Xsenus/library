'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  okvedMainSchema,
  type OkvedCompany,
  type CompanyAnalysisRow,
} from '@/lib/validators';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { X, Play, Square, Loader2, Info, AlertCircle } from 'lucide-react';
import InlineRevenueBars from './inline-revenue-bar';
import SquareImgButton from './square-img-button';

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

type AnalysisRow = CompanyAnalysisRow;

const PIPELINE_STEPS: { id: string; label: string }[] = [
  { id: 'init', label: 'Подготовка' },
  { id: 'domains', label: 'Домены' },
  { id: 'parsing', label: 'Парсинг' },
  { id: 'ai', label: 'AI' },
  { id: 'saving', label: 'Сохранение' },
];

const STATUS_LABELS: Record<string, string> = {
  idle: 'Готово',
  queued: 'В очереди',
  running: 'В работе',
  success: 'Успех',
  failed: 'Ошибка',
  stopping: 'Остановка',
};

function buildEmptyAnalysisRow(inn: string): AnalysisRow {
  return {
    inn,
    websites: [],
    emails: [],
    status: 'idle',
    stage: null,
    progress: 0,
    last_started_at: null,
    last_finished_at: null,
    duration_seconds: null,
    attempts: null,
    rating: null,
    stop_requested: false,
    info: null,
    flags: {},
  };
}

function normalizeClientArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : String(v ?? '')).trim())
      .filter((v) => v.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;\n]+/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  return [];
}

function mergeAnalysisRows(
  existing: AnalysisRow | null,
  incoming: Partial<AnalysisRow> & { inn?: string },
): AnalysisRow {
  const base = existing ? { ...existing } : buildEmptyAnalysisRow(incoming.inn ?? '');
  const inn = (incoming.inn ?? base.inn ?? '').trim();
  const flags = { ...(base.flags ?? {}), ...(incoming.flags ?? {}) } as NonNullable<AnalysisRow['flags']>;

  return {
    inn,
    websites:
      incoming.websites !== undefined
        ? normalizeClientArray(incoming.websites)
        : normalizeClientArray(base.websites),
    emails:
      incoming.emails !== undefined
        ? normalizeClientArray(incoming.emails)
        : normalizeClientArray(base.emails),
    status: incoming.status ?? base.status ?? 'idle',
    stage: incoming.stage ?? base.stage ?? null,
    progress:
      incoming.progress ?? (typeof base.progress === 'number' ? base.progress : 0),
    last_started_at: incoming.last_started_at ?? base.last_started_at ?? null,
    last_finished_at: incoming.last_finished_at ?? base.last_finished_at ?? null,
    duration_seconds: incoming.duration_seconds ?? base.duration_seconds ?? null,
    attempts: incoming.attempts ?? base.attempts ?? null,
    rating: incoming.rating ?? base.rating ?? null,
    stop_requested: incoming.stop_requested ?? base.stop_requested ?? false,
    info: incoming.info ?? base.info ?? null,
    flags,
  };
}

function buildAnalysisRowFromCompany(company: OkvedCompany): AnalysisRow {
  const base = buildEmptyAnalysisRow(company.inn);
  const incoming: Partial<AnalysisRow> & { inn?: string } = {
    inn: company.inn,
    websites: company.websites ?? [],
    emails: company.emails ?? [],
  };
  if (company.analysis_state) {
    const st = company.analysis_state;
    incoming.status = st.status ?? 'idle';
    incoming.stage = st.stage ?? null;
    incoming.progress = st.progress ?? 0;
    incoming.last_started_at = st.last_started_at ?? null;
    incoming.last_finished_at = st.last_finished_at ?? null;
    incoming.duration_seconds = st.duration_seconds ?? null;
    incoming.attempts = st.attempts ?? null;
    incoming.rating = st.rating ?? null;
    incoming.stop_requested = st.stop_requested ?? false;
    incoming.info = st.info ?? null;
    incoming.flags = st.flags ?? {};
  }
  return mergeAnalysisRows(base, incoming);
}

function ensureHttp(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '#';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/\//.test(trimmed)) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

function normalizeInn(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.toString().trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/[^0-9]/g, '');
  return digits.length > 0 ? digits : trimmed;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-100 text-emerald-700';
    case 'failed':
      return 'bg-red-100 text-red-700';
    case 'running':
      return 'bg-blue-100 text-blue-700';
    case 'queued':
      return 'bg-amber-100 text-amber-700';
    case 'stopping':
      return 'bg-rose-100 text-rose-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU').format(date);
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${seconds.toFixed(0)} с`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours} ч ${remMins} мин`;
  }
  return secs > 0 ? `${mins} мин ${secs} с` : `${mins} мин`;
}

function formatAttempts(attempts: number | null | undefined): string {
  if (attempts == null) return '—';
  return attempts.toString();
}

function formatRating(rating: number | null | undefined): string {
  if (rating == null) return '—';
  return Number(rating).toFixed(2);
}

// ——— стили подсветки выбранного фильтра ———
const ACTIVE_ROW =
  'bg-blue-100 text-blue-700 ring-1 ring-blue-300 dark:bg-blue-900/40 dark:text-blue-100 dark:ring-blue-700';
const INACTIVE_ROW = 'hover:bg-muted';

// очистка пояснения ОКВЭД: убираем ведущий код/цифры/точки и разделители
function cleanOkvedPhrase(s: string | null | undefined) {
  const t = (s ?? '').trim();
  return t.replace(/^\s*[\d.]+\s*[-–—:]*\s*/, '').trim();
}

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

type RespInfo = {
  assignedById?: number;
  assignedName?: string;
  colorId?: number;
  colorLabel?: string;
  colorXmlId?: string;
};

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

  const initialPageSize = Number(sp.get('pageSize')) || 20;
  const [pageSize, setPageSize] = useState<number>(
    [5, 10, 20, 25, 50, 75, 100].includes(initialPageSize) ? initialPageSize : 20,
  );

  const [industryList, setIndustryList] = useState<IndustryItem[]>([]);
  const [industriesLoading, setIndustriesLoading] = useState<boolean>(true);

  const [csOkvedEnabled, setCsOkvedEnabled] = useState<boolean>(false);
  const [industryId, setIndustryId] = useState<string>('all');

  const [includeExtra, setIncludeParent] = [
    useState<boolean>(initialExtra)[0],
    useState<boolean>(initialParent)[1],
  ]; // keep line count stable (no-op fix)

  const [includeExtraState, setIncludeExtra] = useState<boolean>(initialExtra); // ЧБ №2
  const [includeParentState, setIncludeParentState] = useState<boolean>(initialParent); // ЧБ №3

  const [searchName, setSearchName] = useState<string>(initialQ);
  const [sortKey, setSortKey] = useState<SortKey>(initialSort);

  const [responsibles, setResponsibles] = useState<Record<string, RespInfo>>({});
  const [respLoading, setRespLoading] = useState(false);

  const [analysisState, setAnalysisState] = useState<Record<string, AnalysisRow>>({});
  const [selectedInns, setSelectedInns] = useState<Set<string>>(new Set());
  const [busyInns, setBusyInns] = useState<Set<string>>(new Set());
  const [globalActionLoading, setGlobalActionLoading] = useState(false);
  const [statusFilters, setStatusFilters] = useState({
    success: false,
    serverError: false,
    noDomain: false,
  });
  const [infoDialog, setInfoDialog] = useState<{ company: OkvedCompany; analysis: AnalysisRow } | null>(
    null,
  );

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
    url.searchParams.set('extra', includeExtraState ? '1' : '0');
    // передаём parent всегда; на бэке он игнорится, если okved пуст
    url.searchParams.set('parent', includeParentState ? '1' : '0');

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
    qs.set('extra', includeExtraState ? '1' : '0');
    qs.set('parent', includeParentState ? '1' : '0');

    if (csOkvedEnabled && industryId !== 'all') qs.set('industryId', industryId);
    else qs.delete('industryId');

    qs.set('page', String(page));
    qs.set('pageSize', String(pageSize));
    router.replace(`/library?${qs.toString()}`);

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    okved,
    page,
    searchName,
    includeExtraState,
    includeParentState,
    sortKey,
    csOkvedEnabled,
    industryId,
    pageSize,
  ]);

  useEffect(() => {
    setAnalysisState((prev) => {
      const next: Record<string, AnalysisRow> = {};
      for (const company of companies) {
        const prevRow = prev[company.inn];
        const fromCompany = buildAnalysisRowFromCompany(company);
        next[company.inn] = prevRow ? mergeAnalysisRows(prevRow, fromCompany) : fromCompany;
      }
      return next;
    });
  }, [companies]);

  useEffect(() => {
    const valid = new Set(companies.map((c) => c.inn));
    setSelectedInns((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((inn) => {
        if (valid.has(inn)) {
          next.add(inn);
        } else {
          changed = true;
        }
      });
      if (!changed && next.size === prev.size) return prev;
      return next;
    });
  }, [companies]);

  const applyAnalysisUpdate = useCallback((rows: Partial<AnalysisRow>[] | null | undefined) => {
    if (!rows || rows.length === 0) return;
    setAnalysisState((prev) => {
      const next: Record<string, AnalysisRow> = { ...prev };
      for (const raw of rows) {
        if (!raw) continue;
        const inn = (raw as AnalysisRow).inn ?? '';
        if (!inn) continue;
        const prevRow = next[inn] ?? buildEmptyAnalysisRow(inn);
        next[inn] = mergeAnalysisRows(prevRow, raw as Partial<AnalysisRow> & { inn?: string });
      }
      return next;
    });
  }, []);

  const markBusy = useCallback((inns: string[], busy: boolean) => {
    if (!inns.length) return;
    setBusyInns((prev) => {
      const next = new Set(prev);
      for (const inn of inns) {
        if (busy) next.add(inn);
        else next.delete(inn);
      }
      return next;
    });
  }, []);

  const postJson = useCallback(async (url: string, payload: any) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }, []);

  const refreshAnalysis = useCallback(
    async (inns: string[]) => {
      const unique = Array.from(new Set(inns.filter((v) => typeof v === 'string' && v.trim())));
      if (unique.length === 0) return;
      const params = new URLSearchParams();
      for (const inn of unique) params.append('inn', inn);
      try {
        const res = await fetch(`/api/analysis/state?${params.toString()}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data?.items)) {
          applyAnalysisUpdate(data.items as Partial<AnalysisRow>[]);
        }
      } catch (error) {
        console.error('refreshAnalysis failed', error);
      }
    },
    [applyAnalysisUpdate],
  );

  const collectStopInns = useCallback(() => {
    if (selectedInns.size > 0) {
      return Array.from(selectedInns).filter((inn) => {
        const state = analysisState[inn];
        return state && ['running', 'queued', 'stopping'].includes(state.status ?? '');
      });
    }
    return Object.values(analysisState)
      .filter((state) => state && ['running', 'queued', 'stopping'].includes(state.status ?? ''))
      .map((state) => state.inn);
  }, [analysisState, selectedInns]);

  const handleStartSelected = useCallback(async () => {
    const inns = Array.from(selectedInns);
    if (!inns.length) return;
    setGlobalActionLoading(true);
    markBusy(inns, true);
    try {
      const data = await postJson('/api/analysis/start', { inns });
      applyAnalysisUpdate(data?.items ?? []);
      await refreshAnalysis(inns);
    } catch (error) {
      console.error('handleStartSelected failed', error);
    } finally {
      markBusy(inns, false);
      setGlobalActionLoading(false);
    }
  }, [selectedInns, postJson, applyAnalysisUpdate, refreshAnalysis, markBusy]);

  const handleStartSingle = useCallback(
    async (inn: string) => {
      if (!inn) return;
      markBusy([inn], true);
      try {
        const data = await postJson('/api/analysis/start', { inns: [inn] });
        applyAnalysisUpdate(data?.items ?? []);
        await refreshAnalysis([inn]);
      } catch (error) {
        console.error('handleStartSingle failed', error);
      } finally {
        markBusy([inn], false);
      }
    },
    [postJson, applyAnalysisUpdate, refreshAnalysis, markBusy],
  );

  const handleStopSelected = useCallback(async () => {
    const inns = collectStopInns();
    if (inns.length === 0) return;
    setGlobalActionLoading(true);
    markBusy(inns, true);
    try {
      const data = await postJson('/api/analysis/stop', { inns });
      applyAnalysisUpdate(data?.items ?? []);
      await refreshAnalysis(inns);
    } catch (error) {
      console.error('handleStopSelected failed', error);
    } finally {
      markBusy(inns, false);
      setGlobalActionLoading(false);
    }
  }, [collectStopInns, postJson, applyAnalysisUpdate, refreshAnalysis, markBusy]);

  const handleStopSingle = useCallback(
    async (inn: string) => {
      if (!inn) return;
      markBusy([inn], true);
      try {
        const data = await postJson('/api/analysis/stop', { inns: [inn] });
        applyAnalysisUpdate(data?.items ?? []);
        await refreshAnalysis([inn]);
      } catch (error) {
        console.error('handleStopSingle failed', error);
      } finally {
        markBusy([inn], false);
      }
    },
    [postJson, applyAnalysisUpdate, refreshAnalysis, markBusy],
  );

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const isAll = okved === '';

  const filteredCompanies = useMemo(() => {
    return companies.filter((company) => {
      const state = analysisState[company.inn] ?? buildAnalysisRowFromCompany(company);
      if (statusFilters.success && !state?.flags?.analysis_ok) return false;
      if (statusFilters.serverError && !state?.flags?.server_error) return false;
      if (statusFilters.noDomain && !state?.flags?.no_valid_site) return false;
      return true;
    });
  }, [companies, analysisState, statusFilters]);

  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedInns(new Set(filteredCompanies.map((company) => company.inn)));
      } else {
        setSelectedInns(new Set());
      }
    },
    [filteredCompanies],
  );

  const toggleSelectInn = useCallback((inn: string, checked: boolean) => {
    setSelectedInns((prev) => {
      const next = new Set(prev);
      if (checked) next.add(inn);
      else next.delete(inn);
      return next;
    });
  }, []);

  const hasSelection = selectedInns.size > 0;
  const allSelected =
    filteredCompanies.length > 0 && filteredCompanies.every((company) => selectedInns.has(company.inn));
  const someSelected = !allSelected && filteredCompanies.some((company) => selectedInns.has(company.inn));
  const headerCheckboxValue: boolean | 'indeterminate' = allSelected ? true : someSelected ? 'indeterminate' : false;

  const activeInns = useMemo(
    () =>
      Object.values(analysisState)
        .filter((row) => row && ['running', 'queued', 'stopping'].includes(row.status ?? ''))
        .map((row) => row.inn),
    [analysisState],
  );

  const pollInns = useMemo(() => {
    if (activeInns.length === 0) return [] as string[];
    const uniq = Array.from(new Set(activeInns.map((inn) => inn.trim()).filter(Boolean)));
    uniq.sort();
    return uniq;
  }, [activeInns]);

  const pollKey = useMemo(() => pollInns.join('|'), [pollInns]);

  const canStop = useMemo(() => {
    if (selectedInns.size > 0) {
      return Array.from(selectedInns).some((inn) => {
        const state = analysisState[inn];
        return state && ['running', 'queued', 'stopping'].includes(state.status ?? '');
      });
    }
    return activeInns.length > 0;
  }, [selectedInns, analysisState, activeInns]);

  const dialogCompany = infoDialog?.company ?? null;
  const dialogAnalysis = infoDialog?.analysis ?? null;
  const dialogInfo = dialogAnalysis?.info ?? null;

  useEffect(() => {
    if (!pollKey) return;

    const inns = pollKey.split('|').filter(Boolean);
    if (inns.length === 0) return;
    let timer: number | undefined;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        await refreshAnalysis(inns);
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(tick, 8000);
        }
      }
    };

    void refreshAnalysis(inns).finally(() => {
      if (!cancelled) {
        timer = window.setTimeout(tick, 8000);
      }
    });

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [pollKey, refreshAnalysis]);

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
  }, [
    okved,
    searchName,
    includeExtraState,
    includeParentState,
    sortKey,
    csOkvedEnabled,
    industryId,
    pageSize,
  ]);

  useEffect(() => {
    const abortFn = loadCompanies();
    return () => {
      if (typeof abortFn === 'function') abortFn();
    };
  }, [loadCompanies]);

  useEffect(() => {
    const innSet = new Set<string>();
    for (const company of companies) {
      const raw = (company?.inn ?? '').toString().trim();
      if (raw) innSet.add(raw);
    }
    const inns = Array.from(innSet);
    if (inns.length === 0) {
      setResponsibles({});
      return;
    }
    const ac = new AbortController();
    (async () => {
      try {
        setRespLoading(true);
        const r = await fetch('/api/b24/responsibles', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ inns }),
          signal: ac.signal,
        });
        const j = await r.json();
        if (!j?.ok) throw new Error(j?.error || 'b24 responsibles error');

        const map: Record<string, RespInfo> = {};
        for (const it of j.items || []) {
          const rawInn = (it?.inn ?? '').toString().trim();
          const normalizedInn = normalizeInn(rawInn);
          if (!rawInn && !normalizedInn) continue;
          const value: RespInfo = {
            assignedById: it.assignedById,
            assignedName: it.assignedName,
            colorId: it.colorId,
            colorLabel: it.colorLabel,
            colorXmlId: it.colorXmlId,
          };
          if (rawInn) map[rawInn] = value;
          if (normalizedInn && normalizedInn !== rawInn) {
            map[normalizedInn] = value;
          }
        }
        setResponsibles(map);
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          console.error('load responsibles failed', e);
        }
      } finally {
        setRespLoading(false);
      }
    })();
    return () => ac.abort();
  }, [companies]);

  const lastYear = new Date().getFullYear() - 1;

  function colorRowClass(label?: string, xmlId?: string): string | undefined {
    const key = (label || xmlId || '').toString().trim().toLowerCase();
    if (!key) return undefined;

    if (key.includes('красн') || key.includes('red')) {
      return 'bg-red-50 dark:bg-red-950/20 ring-1 ring-red-200 dark:ring-red-800';
    }
    if (
      key.includes('жёлт') ||
      key.includes('желт') ||
      key.includes('yellow') ||
      key.includes('amber')
    ) {
      return 'bg-yellow-50 dark:bg-yellow-950/20 ring-1 ring-yellow-200 dark:ring-yellow-800';
    }
    if (key.includes('зел') || key.includes('green')) {
      return 'bg-green-50 dark:bg-green-950/20 ring-1 ring-green-200 dark:ring-green-800';
    }
    if (key.includes('син') || key.includes('blue')) {
      return 'bg-blue-50 dark:bg-blue-950/20 ring-1 ring-blue-200 dark:ring-blue-800';
    }
    if (key.includes('фиол') || key.includes('purple') || key.includes('violet')) {
      return 'bg-purple-50 dark:bg-purple-950/20 ring-1 ring-purple-200 dark:ring-purple-800';
    }
    if (key.includes('оранж') || key.includes('orange')) {
      return 'bg-orange-50 dark:bg-orange-950/20 ring-1 ring-orange-200 dark:ring-orange-800';
    }
    // ——— СЕРЫЙ / NEUTRAL / DEFAULT — делаем заметнее (примерно gray-200)
    if (
      key.includes('сер') ||
      key.includes('gray') ||
      key.includes('grey') ||
      key.includes('neutral') ||
      key.includes('default')
    ) {
      return 'bg-gray-200 dark:bg-gray-900/30 ring-1 ring-gray-300 dark:ring-gray-700';
    }
    return 'bg-muted/30';
  }

  function colorRowBg(label?: string, xmlId?: string): string | undefined {
    const key = (label || xmlId || '').toString().trim().toLowerCase();
    if (!key) return undefined;

    if (key.includes('красн') || key.includes('red')) return '#FEE2E2'; // red-100
    if (
      key.includes('жёлт') ||
      key.includes('желт') ||
      key.includes('yellow') ||
      key.includes('amber')
    )
      return '#FEF9C3'; // yellow-100
    if (key.includes('зел') || key.includes('green')) return '#DCFCE7'; // green-100
    if (key.includes('син') || key.includes('blue')) return '#DBEAFE'; // blue-100
    if (key.includes('фиол') || key.includes('purple') || key.includes('violet')) return '#F3E8FF'; // purple-100
    if (key.includes('оранж') || key.includes('orange')) return '#FFEDD5'; // orange-100

    if (
      key.includes('сер') ||
      key.includes('gray') ||
      key.includes('grey') ||
      key.includes('neutral') ||
      key.includes('default')
    ) {
      return '#E5E7EB'; // gray-200
    }

    return undefined;
  }

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
                  checked={includeExtraState}
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
                  checked={includeParentState}
                  onChange={(e) => setIncludeParentState(e.target.checked)}
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
                <div className="flex items-center gap-1.5 shrink-0">
                  <SquareImgButton
                    icon="okved"
                    title="Открыть все компании в новой вкладке"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open('/library?tab=okved', '_blank');
                    }}
                    className="my-[2px]"
                    sizeClassName="h-7 w-7"
                  />
                  <SquareImgButton
                    icon="search"
                    title="Открыть AI-поиск (введите фразу вручную)"
                    onClick={(e) => {
                      e.stopPropagation();
                      const qp = new URLSearchParams();
                      qp.set('tab', 'aisearch');
                      window.open(`/library?${qp.toString()}`, '_blank');
                    }}
                    className="my-[2px]"
                    sizeClassName="h-7 w-7"
                  />
                </div>

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
                    <div className="flex items-center gap-1.5 shrink-0">
                      <SquareImgButton
                        icon="okved"
                        title="Открыть в новой вкладке"
                        onClick={(e) => {
                          e.stopPropagation();
                          const url = `/library?tab=okved${
                            x.okved_code ? `&okved=${encodeURIComponent(x.okved_code)}` : ''
                          }`;
                          window.open(url, '_blank');
                        }}
                        className="my-[2px]"
                        sizeClassName="h-7 w-7"
                      />
                      <SquareImgButton
                        icon="search"
                        title="Открыть AI-поиск по этому ОКВЭД"
                        onClick={(e) => {
                          e.stopPropagation();
                          const phrase = cleanOkvedPhrase(x.okved_main);
                          const qp = new URLSearchParams();
                          qp.set('tab', 'aisearch');
                          if (phrase) qp.set('q', phrase);
                          qp.set('autorun', '1');
                          window.open(`/library?${qp.toString()}`, '_blank');
                        }}
                        className="my-[2px]"
                        sizeClassName="h-7 w-7"
                      />
                    </div>

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

          <CardContent className="p-3 space-y-3">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="h-8"
                  disabled={!hasSelection || globalActionLoading}
                  onClick={handleStartSelected}>
                  {globalActionLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  ЗАПУСК АНАЛИЗА ДЛЯ ВЫБРАННЫХ КОМПАНИЙ
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={!canStop || globalActionLoading}
                  onClick={handleStopSelected}>
                  <Square className="mr-2 h-4 w-4" />
                  ОСТАНОВИТЬ АНАЛИЗ
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                <label className="flex items-center gap-2">
                  <Checkbox
                    className="h-4 w-4"
                    checked={statusFilters.success}
                    onCheckedChange={(value) =>
                      setStatusFilters((prev) => ({ ...prev, success: value === true }))
                    }
                  />
                  Успешные анализы
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    className="h-4 w-4"
                    checked={statusFilters.serverError}
                    onCheckedChange={(value) =>
                      setStatusFilters((prev) => ({ ...prev, serverError: value === true }))
                    }
                  />
                  Сервер был недоступен
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    className="h-4 w-4"
                    checked={statusFilters.noDomain}
                    onCheckedChange={(value) =>
                      setStatusFilters((prev) => ({ ...prev, noDomain: value === true }))
                    }
                  />
                  Не было доступных доменов
                </label>
              </div>
            </div>

            <div className="relative w-full overflow-auto">
              <TooltipProvider delayDuration={150}>
                <table className="w-full min-w-[1200px] text-[13px]">
                  <thead className="[&_tr]:border-b">
                    <tr className="text-center">
                      <th className="py-1 px-2 w-[32px] align-middle">
                        <Checkbox
                          className="mx-auto"
                          checked={headerCheckboxValue}
                          disabled={filteredCompanies.length === 0}
                          onCheckedChange={(value) => toggleSelectAll(value === true)}
                        />
                      </th>
                      <th className="py-1 px-2 w-[42px]"></th>
                      <th className="py-1 px-2 w-[160px] text-center">Анализ</th>
                      <th className="py-1 px-2 whitespace-nowrap text-center">ИНН</th>
                      <th className="py-1 px-2 text-left">Название</th>
                      <th className="py-1 px-2 text-left">Сайты</th>
                      <th className="py-1 px-2 text-left">Имейлы</th>
                      <th className="py-1 px-2 whitespace-nowrap text-center">Дата запуска</th>
                      <th className="py-1 px-2 whitespace-nowrap text-center">Время запуска</th>
                      <th className="py-1 px-2 whitespace-nowrap text-center">Длительность</th>
                      <th className="py-1 px-2 whitespace-nowrap text-center">Попытки</th>
                      <th className="py-1 px-2 whitespace-nowrap text-center">Оценка</th>
                      <th className="py-1 px-2 text-center">Инфо</th>
                      <th
                        className="py-1 px-3 cursor-pointer select-none"
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
                      <th className="py-1 px-2">Штат</th>
                      <th className="py-1 px-2">Филиалы</th>
                      <th className="py-1 px-2">Год</th>
                      <th className="py-1 px-2">Ответственный</th>
                      <th className="py-1 px-2 text-left">Адрес</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan={19} className="py-6 text-center text-muted-foreground text-xs">
                          Загрузка…
                        </td>
                      </tr>
                    )}
                    {!loading && filteredCompanies.length === 0 && (
                      <tr>
                        <td colSpan={19} className="py-6 text-center text-muted-foreground text-xs">
                          Нет данных
                        </td>
                      </tr>
                    )}
                    {!loading &&
                      filteredCompanies.map((company) => {
                        const analysis = analysisState[company.inn] ?? buildAnalysisRowFromCompany(company);
                        const status = analysis.status ?? 'idle';
                        const statusLabel = STATUS_LABELS[status] ?? status;
                        const progressValue = Math.max(0, Math.min(100, analysis.progress ?? 0));
                        const stageLabel =
                          PIPELINE_STEPS.find((step) => step.id === (analysis.stage ?? ''))?.label;
                        const seriesRevenue: [
                          number | null | undefined,
                          number | null | undefined,
                          number | null | undefined,
                          number | null | undefined,
                        ] = [
                          company.revenue_3 ?? null,
                          company.revenue_2 ?? null,
                          company.revenue_1 ?? null,
                          company.revenue ?? null,
                        ];
                        const seriesIncome: [
                          number | null | undefined,
                          number | null | undefined,
                          number | null | undefined,
                          number | null | undefined,
                        ] = [
                          company.income_3 ?? null,
                          company.income_2 ?? null,
                          company.income_1 ?? null,
                          company.income ?? null,
                        ];
                        const isActual = (company.year ?? 0) === lastYear;
                        const rawInn = (company.inn ?? '').toString().trim();
                        const normalizedInn = normalizeInn(company.inn);
                        const resp = responsibles[rawInn] ?? (normalizedInn ? responsibles[normalizedInn] : undefined);
                        const rowColorClass = colorRowClass(resp?.colorLabel, resp?.colorXmlId);
                        const rowBg = colorRowBg(resp?.colorLabel, resp?.colorXmlId);
                        const hasColor = !!rowBg;
                        const selected = selectedInns.has(company.inn);
                        const busy = busyInns.has(company.inn) || globalActionLoading;
                        const isFailure =
                          status === 'failed' ||
                          !!analysis.flags?.server_error ||
                          !!analysis.flags?.no_valid_site;
                        const websites = analysis.websites ?? [];
                        const emails = analysis.emails ?? [];
                        const websitesToShow = websites.slice(0, 4);
                        const extraWebsites = Math.max(0, websites.length - websitesToShow.length);
                        const emailsToShow = emails.slice(0, 4);
                        const extraEmails = Math.max(0, emails.length - emailsToShow.length);
                        const infoAvailable = analysis.info && Object.keys(analysis.info ?? {}).length > 0;

                        return (
                          <tr
                            key={`${company.inn}-${company.year ?? ''}`}
                            className={cn(
                              'border-b transition-colors',
                              hasColor
                                ? 'transition-[filter] hover:brightness-95 dark:hover:brightness-110'
                                : 'hover:bg-muted/40',
                              rowColorClass ?? '',
                            )}
                            style={hasColor ? { backgroundColor: rowBg } : undefined}>
                            <td className="py-1 px-2 text-center align-middle">
                              <Checkbox
                                className="mx-auto"
                                checked={selected}
                                onCheckedChange={(value) => toggleSelectInn(company.inn, value === true)}
                              />
                            </td>
                            <td className="py-1 px-2 text-center align-middle">
                              <SquareImgButton
                                icon="bitrix"
                                title="Открыть карточку компании в Bitrix24"
                                onClick={() =>
                                  window.open(
                                    `/api/b24/resolve-company?inn=${encodeURIComponent(
                                      company.inn,
                                    )}&mode=pick`,
                                    '_blank',
                                    'noopener',
                                  )
                                }
                                className="mx-auto my-[2px]"
                                sizeClassName="h-7 w-7"
                              />
                            </td>
                            <td className="py-1 px-2 align-middle">
                              {status === 'running' || status === 'stopping' ? (
                                <div className="flex min-h-[92px] flex-col items-center justify-center gap-2 text-center">
                                  <Progress value={progressValue} className="h-2 w-24" />
                                  <div className="text-[10px] text-muted-foreground">
                                    {stageLabel ?? 'Выполнение'}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    disabled={busy}
                                    onClick={() => handleStopSingle(company.inn)}
                                    aria-label="Остановить анализ">
                                    <Square className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ) : status === 'queued' ? (
                                <div className="flex min-h-[92px] flex-col items-center justify-center gap-2 text-center">
                                  <Badge className={cn('text-[10px] uppercase', statusBadgeClass(status))}>
                                    {statusLabel}
                                  </Badge>
                                  <div className="flex items-center justify-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      disabled={busy}
                                      onClick={() => handleStartSingle(company.inn)}
                                      aria-label="Запустить анализ">
                                      <Play className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      disabled={busy}
                                      onClick={() => handleStopSingle(company.inn)}
                                      aria-label="Остановить анализ">
                                      <Square className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex min-h-[92px] items-center justify-center">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    disabled={busy}
                                    onClick={() => handleStartSingle(company.inn)}
                                    aria-label="Запустить анализ">
                                    {busy ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Play className="h-4 w-4" />
                                    )}
                                  </Button>
                                </div>
                              )}
                            </td>
                            <td className="py-1 px-2 whitespace-nowrap align-middle">{company.inn}</td>
                            <td className="py-1 px-2 align-middle">
                              <div className="flex flex-col gap-1 leading-tight">
                                <div
                                  className={cn(
                                    'text-sm font-medium text-foreground break-words',
                                    isFailure && 'text-red-600',
                                  )}>
                                  {company.short_name}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <Badge
                                    className={cn(
                                      'text-[10px] font-semibold uppercase tracking-wide',
                                      statusBadgeClass(status),
                                    )}>
                                    {statusLabel}
                                  </Badge>
                                  {analysis.flags?.server_error && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <AlertCircle className="h-4 w-4 text-red-500" />
                                      </TooltipTrigger>
                                      <TooltipContent className="text-xs">
                                        Сервер был недоступен
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                  {analysis.flags?.no_valid_site && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <AlertCircle className="h-4 w-4 text-amber-500" />
                                      </TooltipTrigger>
                                      <TooltipContent className="text-xs">
                                        Не найден подходящий домен
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-1 px-2 align-middle">
                              <div className="flex min-h-[92px] flex-col justify-center text-left">
                                {websitesToShow.length === 0 ? (
                                  <span className="text-xs text-muted-foreground">—</span>
                                ) : (
                                  <div className="flex max-h-24 flex-col gap-0.5 overflow-y-auto pr-1 text-xs">
                                    {websitesToShow.map((site) => (
                                      <a
                                        key={site}
                                        href={ensureHttp(site)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="break-words text-blue-600 hover:underline">
                                        {site}
                                      </a>
                                    ))}
                                    {extraWebsites > 0 && (
                                      <span className="text-[10px] text-muted-foreground">
                                        + ещё {extraWebsites}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="py-1 px-2 align-middle">
                              <div className="flex min-h-[92px] flex-col justify-center text-left">
                                {emailsToShow.length === 0 ? (
                                  <span className="text-xs text-muted-foreground">—</span>
                                ) : (
                                  <div className="flex max-h-24 flex-col gap-0.5 overflow-y-auto pr-1 text-xs">
                                    {emailsToShow.map((email) => (
                                      <a
                                        key={email}
                                        href={`mailto:${email}`}
                                        className="break-words text-blue-600 hover:underline">
                                        {email}
                                      </a>
                                    ))}
                                    {extraEmails > 0 && (
                                      <span className="text-[10px] text-muted-foreground">
                                        + ещё {extraEmails}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="py-1 px-2 whitespace-nowrap align-middle">
                              {formatDate(analysis.last_started_at)}
                            </td>
                            <td className="py-1 px-2 whitespace-nowrap align-middle">
                              {formatTime(analysis.last_started_at)}
                            </td>
                            <td className="py-1 px-2 whitespace-nowrap align-middle">
                              {formatDuration(analysis.duration_seconds)}
                            </td>
                            <td className="py-1 px-2 text-center align-middle">
                              {formatAttempts(analysis.attempts)}
                            </td>
                            <td className="py-1 px-2 text-center align-middle">
                              {formatRating(analysis.rating)}
                            </td>
                            <td className="py-1 px-2 text-center align-middle">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={!infoAvailable}
                                onClick={() => setInfoDialog({ company, analysis })}>
                                <Info className="h-4 w-4" />
                              </Button>
                            </td>
                            <td className="py-1 px-3 align-middle">
                              <div className="flex items-center gap-2">
                                <div className="w-[100px] h-[45px] shrink-0 overflow-hidden">
                                  <InlineRevenueBars
                                    mode="stack"
                                    revenue={seriesRevenue}
                                    income={seriesIncome}
                                    year={company.year}
                                  />
                                </div>
                                <div className="text-right tabular-nums w-[56px]">
                                  {isLg()
                                    ? revenueMln(company.revenue)
                                    : revenueMln(company.income as number | null)}
                                </div>
                              </div>
                            </td>
                            <td className="py-1 px-2 text-center align-middle">
                              {formatEmployees(getEmployeeCount(company))}
                            </td>
                            <td className="py-1 px-2 text-center align-middle">
                              {company.branch_count ?? '—'}
                            </td>
                            <td className="py-1 px-2 text-center align-middle">
                              <span
                                className={cn(
                                  'inline-block rounded border px-1.5 py-0.5',
                                  isActual
                                    ? 'border-transparent text-foreground'
                                    : 'border-red-400 text-red-600',
                                )}
                                title={isActual ? 'Последний закрытый год' : 'Не последний закрытый год'}>
                                {company.year ?? '—'}
                              </span>
                            </td>
                            <td className="py-1 px-2 whitespace-nowrap text-center align-middle">
                              {resp?.assignedName ?? (respLoading ? '…' : '—')}
                            </td>
                            <td className="py-1 px-2 text-left text-[10px] text-muted-foreground align-top">
                              {company.address ?? '—'}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </TooltipProvider>
            </div>

            {pages > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2">
                <div className="flex items-center gap-2">
                  <label htmlFor="page-size" className="text-[11px] text-muted-foreground">
                    На странице:
                  </label>
                  <select
                    id="page-size"
                    className="h-8 border rounded-md px-2 text-xs"
                    value={pageSize}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 20;
                      setPageSize(v);
                      setPage(1);
                    }}>
                    {[5, 10, 20, 25, 50, 75, 100].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2">
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
              </div>
            )}
          </CardContent>

          <Dialog open={!!infoDialog} onOpenChange={(open) => !open && setInfoDialog(null)}>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>{dialogCompany?.short_name ?? 'Информация о компании'}</DialogTitle>
                <DialogDescription>
                  {dialogCompany ? `ИНН ${dialogCompany.inn}` : 'Подробности анализа'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-sm leading-relaxed">
                <div>
                  <div className="font-semibold">Уровень соответствия и класс предприятия</div>
                  <div className="text-muted-foreground">
                    {dialogInfo?.match_level || dialogInfo?.enterprise_class
                      ? [dialogInfo?.match_level, dialogInfo?.enterprise_class]
                          .filter(Boolean)
                          .join(' · ')
                      : '—'}
                  </div>
                </div>

                <div>
                  <div className="font-semibold">Основной ОКВЭД (DaData)</div>
                  <div className="text-muted-foreground">
                    {dialogInfo?.main_okved ?? dialogCompany?.main_okved ?? '—'}
                  </div>
                </div>

                <div>
                  <div className="font-semibold">Домен для парсинга</div>
                  <div className="text-muted-foreground">
                    {dialogInfo?.parsing_domain ?? '—'}
                  </div>
                </div>

                <div>
                  <div className="font-semibold">
                    Соответствие ИИ-описания сайта и основного ОКВЭД
                  </div>
                  <div className="text-muted-foreground">
                    {dialogInfo?.okved_match_ai ?? '—'}
                  </div>
                </div>

                <div>
                  <div className="font-semibold">ИИ-описание сайта</div>
                  <div className="whitespace-pre-wrap text-muted-foreground">
                    {dialogInfo?.site_ai_description ?? '—'}
                  </div>
                </div>

                <div>
                  <div className="font-semibold">Топ-10 оборудований</div>
                  {dialogInfo?.top_equipment && dialogInfo.top_equipment.length > 0 ? (
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {dialogInfo.top_equipment.map((item, idx) => (
                        <li key={`${item}-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-muted-foreground">—</div>
                  )}
                </div>

                <div>
                  <div className="font-semibold">Виды продукции и ТНВЭД</div>
                  {dialogInfo?.products && dialogInfo.products.length > 0 ? (
                    <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                      {dialogInfo.products.map((product, idx) => (
                        <li key={`${product.name}-${idx}`}>
                          <span className="font-medium text-foreground">{product.name}</span>
                          {product.tnved && product.tnved.length > 0 && (
                            <span className="block text-xs text-muted-foreground">
                              ТНВЭД: {product.tnved.join(', ')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-muted-foreground">—</div>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>

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

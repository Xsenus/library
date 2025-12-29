'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { HierarchyList } from '@/components/library/hierarchy-list';
import { EquipmentCard } from '@/components/library/equipment-card';
import { useDebounce } from '@/hooks/use-debounce';
import {
  Industry,
  Prodclass,
  Workshop,
  EquipmentListItem,
  EquipmentDetail,
  ListResponse,
  CleanScoreRow,
} from '@/lib/validators';
import { Home, ArrowUpRight } from 'lucide-react';
import { useDailyQuota } from '@/hooks/use-daily-quota';
import { cn } from '@/lib/utils';
import OkvedTab from '@/components/library/okved-tab';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import AiSearchTab from '@/components/library/ai-search-tab';
import AiCompanyAnalysisTab from '@/components/library/ai-company-analysis-tab';
import AiDebugTab from '@/components/library/ai-debug-tab';
import SquareImgButton from '@/components/library/square-img-button';

interface ListState<T> {
  items: T[];
  loading: boolean;
  hasNextPage: boolean;
  page: number;
  searchQuery: string;
}

type CleanScoreRowEx = CleanScoreRow & {
  equipment_score_real?: number | null;
};

export default function LibraryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') ?? 'library') as
    | 'library'
    | 'cleanscore'
    | 'okved'
    | 'aisearch'
    | 'aianalysis'
    | 'aidebug';

  const [tab, setTab] = useState<'library' | 'cleanscore' | 'okved' | 'aisearch' | 'aianalysis' | 'aidebug'>(
    initialTab === 'cleanscore' || initialTab === 'okved' || initialTab === 'aianalysis' || initialTab === 'aidebug'
      ? 'library'
      : initialTab,
  );

  // ======= auth/user flags =======
  const [isWorker, setIsWorker] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const { quota, refetch: refetchQuota } = useDailyQuota({ showLoading: false });

  const didInitQuota = useRef(false);
  useEffect(() => {
    if (!didInitQuota.current && !isWorker) {
      didInitQuota.current = true;
      refetchQuota();
    }
  }, [isWorker, refetchQuota]);

  const [limitExceeded, setLimitExceeded] = useState(false);

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setIsWorker(!!data?.user?.irbis_worker);
      setIsAdmin(!!data?.user?.is_admin);
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (tab === 'cleanscore') loadMe();
  }, [tab, loadMe]);

  // держим таб в синхроне с URL (?tab=...)
  useEffect(() => {
    const tSafe = (searchParams.get('tab') ?? 'library') as
      | 'library'
      | 'cleanscore'
      | 'okved'
      | 'aisearch'
      | 'aianalysis'
      | 'aidebug';

    setTab(
      !isWorker && (tSafe === 'cleanscore' || tSafe === 'okved' || tSafe === 'aianalysis' || tSafe === 'aidebug')
        ? 'library'
        : tSafe,
    );
  }, [searchParams, isWorker]);

  // Logout
  const [loggingOut, setLoggingOut] = useState(false);
  const handleLogout = useCallback(async () => {
    try {
      setLoggingOut(true);
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch {
      // no-op
    } finally {
      setLoggingOut(false);
    }
  }, [router]);

  // Selection state
  const [selectedIndustry, setSelectedIndustry] = useState<Industry | null>(null);
  const [selectedProdclass, setSelectedProdclass] = useState<Prodclass | null>(null);
  const [selectedWorkshop, setSelectedWorkshop] = useState<Workshop | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentListItem | null>(null);
  const [equipmentDetail, setEquipmentDetail] = useState<EquipmentDetail | null>(null);

  const handleEsConfirmChange = useCallback((id: number, confirmed: boolean) => {
    const val = confirmed ? 1 : 0;
    setEquipmentState((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === id ? { ...it, equipment_score_real: val } : it)),
    }));
    setSelectedEquipment((prev) =>
      prev && prev.id === id ? { ...prev, equipment_score_real: val } : prev,
    );
    setEquipmentDetail((prev) =>
      prev && prev.id === id ? { ...prev, equipment_score_real: val } : prev,
    );
    setCsRows((prev) =>
      prev.map((r) => (r.equipment_id === id ? ({ ...r, equipment_score_real: val } as any) : r)),
    );
  }, []);

  // Автовыбор
  const [autoSelectProdclass, setAutoSelectProdclass] = useState(false);
  const [autoSelectWorkshop, setAutoSelectWorkshop] = useState(false);
  const [autoSelectEquipment, setAutoSelectEquipment] = useState(false);

  // Lists
  const [industriesState, setIndustriesState] = useState<ListState<Industry>>({
    items: [],
    loading: true,
    hasNextPage: true,
    page: 1,
    searchQuery: '',
  });

  const [prodclassesState, setProdclassesState] = useState<ListState<Prodclass>>({
    items: [],
    loading: false,
    hasNextPage: false,
    page: 1,
    searchQuery: '',
  });

  const [workshopsState, setWorkshopsState] = useState<ListState<Workshop>>({
    items: [],
    loading: false,
    hasNextPage: false,
    page: 1,
    searchQuery: '',
  });

  const [equipmentState, setEquipmentState] = useState<ListState<EquipmentListItem>>({
    items: [],
    loading: false,
    hasNextPage: false,
    page: 1,
    searchQuery: '',
  });

  // Table (CleanScore)
  const [csRows, setCsRows] = useState<CleanScoreRowEx[]>([]);
  const [csPage, setCsPage] = useState(1);
  const [csHasNext, setCsHasNext] = useState(true);
  const [csLoading, setCsLoading] = useState(false);
  const [csQuery, setCsQuery] = useState('');
  const csQueryDebounced = useDebounce(csQuery, 300);

  const [rowSaving, setRowSaving] = useState<Record<number, boolean>>({});

  // Debounced search (hierarchy)
  const debouncedIndustrySearch = useDebounce(industriesState.searchQuery, 300);
  const debouncedProdclassSearch = useDebounce(prodclassesState.searchQuery, 300);
  const debouncedWorkshopSearch = useDebounce(workshopsState.searchQuery, 300);
  const debouncedEquipmentSearch = useDebounce(equipmentState.searchQuery, 300);

  // CleanScore filters
  const [csIndustryEnabled, setCsIndustryEnabled] = useState(false);
  const [csIndustryId, setCsIndustryId] = useState<number | null>(null);

  const [csMinScore, setCsMinScore] = useState(0.95);
  const [csMaxScore, setCsMaxScore] = useState(1.0);
  const scoreOptions = Array.from({ length: 16 }, (_, i) => Number((0.85 + i * 0.01).toFixed(2)));

  // ===== ОКВЭД: состояние селекта/списка
  const [csOkvedEnabled, setCsOkvedEnabled] = useState(false);
  const [csOkvedId, setCsOkvedId] = useState<number | null>(null);
  const [okvedOptions, setOkvedOptions] = useState<
    Array<{ id: number; okved_code: string; okved_main: string }>
  >([]);

  // + перед return (рядом с остальными хелперами)
  const selectedOkvedLabel =
    csOkvedId != null
      ? (() => {
          const o = okvedOptions.find((x) => x.id === csOkvedId);
          return o ? `${o.okved_code} — ${o.okved_main}` : '— Все ОКВЭД —';
        })()
      : '— Все ОКВЭД —';

  // ====== фикс ширины столбцов в таблице
  const colW = { card: 35, check: 35, cs: 35 } as const;

  // ========================= API LOADERS =========================
  const fetchIndustries = useCallback(
    async (page: number, query: string, append: boolean = false) => {
      try {
        setIndustriesState((prev) => ({ ...prev, loading: true }));
        const params = new URLSearchParams({
          page: String(page),
          pageSize: '30',
          ...(query && { query }),
        });
        const response = await fetch(`/api/industries?${params}`);
        const data: ListResponse<Industry> = await response.json();
        const safeData = {
          items: Array.isArray(data.items) ? data.items : [],
          page: typeof data.page === 'number' ? data.page : 1,
          totalPages: typeof data.totalPages === 'number' ? data.totalPages : 1,
        };
        setIndustriesState((prev) => ({
          ...prev,
          items: append ? [...prev.items, ...safeData.items] : safeData.items,
          hasNextPage: safeData.page < safeData.totalPages,
          page: safeData.page,
          loading: false,
        }));
      } catch (error) {
        console.error('Failed to fetch industries:', error);
        setIndustriesState((prev) => ({ ...prev, loading: false }));
      }
    },
    [],
  );

  const fetchProdclasses = useCallback(
    async (industryId: number, page: number, query: string, append: boolean = false) => {
      try {
        setProdclassesState((prev) => ({ ...prev, loading: true }));
        const params = new URLSearchParams({
          page: String(page),
          pageSize: '30',
          ...(query && { query }),
        });
        const response = await fetch(`/api/industries/${industryId}/prodclasses?${params}`);
        const data: ListResponse<Prodclass> = await response.json();
        const safeData = {
          items: Array.isArray(data.items) ? data.items : [],
          page: typeof data.page === 'number' ? data.page : 1,
          totalPages: typeof data.totalPages === 'number' ? data.totalPages : 1,
        };
        setProdclassesState((prev) => ({
          ...prev,
          items: append ? [...prev.items, ...safeData.items] : safeData.items,
          hasNextPage: safeData.page < safeData.totalPages,
          page: safeData.page,
          loading: false,
        }));
      } catch (error) {
        console.error('Failed to fetch prodclasses:', error);
        setProdclassesState((prev) => ({ ...prev, loading: false }));
      }
    },
    [],
  );

  const fetchWorkshops = useCallback(
    async (prodclassId: number, page: number, query: string, append: boolean = false) => {
      try {
        setWorkshopsState((prev) => ({ ...prev, loading: true }));
        const params = new URLSearchParams({
          page: String(page),
          pageSize: '30',
          ...(query && { query }),
        });
        const response = await fetch(`/api/prodclasses/${prodclassId}/workshops?${params}`);
        const data: ListResponse<Workshop> = await response.json();
        const safeData = {
          items: Array.isArray(data.items) ? data.items : [],
          page: typeof data.page === 'number' ? data.page : 1,
          totalPages: typeof data.totalPages === 'number' ? data.totalPages : 1,
        };
        setWorkshopsState((prev) => ({
          ...prev,
          items: append ? [...prev.items, ...safeData.items] : safeData.items,
          hasNextPage: safeData.page < safeData.totalPages,
          page: safeData.page,
          loading: false,
        }));
      } catch (error) {
        console.error('Failed to fetch workshops:', error);
        setWorkshopsState((prev) => ({ ...prev, loading: false }));
      }
    },
    [],
  );

  const fetchEquipment = useCallback(
    async (workshopId: number, page: number, query: string, append: boolean = false) => {
      try {
        setEquipmentState((prev) => ({ ...prev, loading: true }));
        const params = new URLSearchParams({
          page: String(page),
          pageSize: '30',
          ...(query && { query }),
        });
        const response = await fetch(`/api/workshops/${workshopId}/equipment?${params}`);
        const data: ListResponse<EquipmentListItem> = await response.json();
        const safeData = {
          items: Array.isArray(data.items) ? data.items : [],
          page: typeof data.page === 'number' ? data.page : 1,
          totalPages: typeof data.totalPages === 'number' ? data.totalPages : 1,
        };
        setEquipmentState((prev) => ({
          ...prev,
          items: append ? [...prev.items, ...safeData.items] : safeData.items,
          hasNextPage: safeData.page < safeData.totalPages,
          page: safeData.page,
          loading: false,
        }));
      } catch (error) {
        console.error('Failed to fetch equipment:', error);
        setEquipmentState((prev) => ({ ...prev, loading: false }));
      }
    },
    [],
  );

  const fetchEquipmentDetail = useCallback(
    async (equipmentId: number) => {
      try {
        setLimitExceeded(false);
        const res = await fetch(`/api/equipment/${equipmentId}`, { cache: 'no-store' });

        if (!res.ok) {
          if (!isWorker && res.status === 403) {
            setLimitExceeded(true);
            setEquipmentDetail(null);
            refetchQuota();
            return;
          }

          refetchQuota();
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || `HTTP ${res.status}`);
        }

        const data: EquipmentDetail = await res.json();
        setEquipmentDetail(data);
        setLimitExceeded(false);
        refetchQuota();
      } catch (error) {
        console.error('Failed to fetch equipment detail:', error);
      }
    },
    [isWorker, refetchQuota],
  );

  const loadOkvedOptions = useCallback(async () => {
    // Не сотрудник — не дергаем API вообще
    if (!isWorker) {
      setOkvedOptions([]);
      return;
    }
    try {
      const params = new URLSearchParams();
      if (csIndustryEnabled && csIndustryId) params.set('industryId', String(csIndustryId));

      const r = await fetch(`/api/okved?${params.toString()}`, { cache: 'no-store' });
      if (!r.ok) {
        console.warn('loadOkvedOptions: HTTP', r.status);
        setOkvedOptions([]);
        return;
      }

      const j = await r.json();
      setOkvedOptions(Array.isArray(j.items) ? j.items : []);
    } catch (e) {
      console.error('loadOkvedOptions failed:', e);
      setOkvedOptions([]);
    }
  }, [isWorker, csIndustryEnabled, csIndustryId]);

  useEffect(() => {
    if (!isWorker) return;
    loadOkvedOptions();
  }, [isWorker, loadOkvedOptions]);

  useEffect(() => {
    if (!isWorker) {
      setCsOkvedId(null);
      setOkvedOptions([]);
      return;
    }
    loadOkvedOptions();
    setCsOkvedId(null);
  }, [isWorker, csIndustryEnabled, csIndustryId, loadOkvedOptions]);

  const fetchCleanScore = useCallback(
    async (page: number, query: string, append = false) => {
      try {
        setCsLoading(true);
        const params = new URLSearchParams({
          page: String(page),
          pageSize: '30',
          query,
          minScore: csMinScore.toFixed(2),
          maxScore: csMaxScore.toFixed(2),
          ts: String(Date.now()),
        });
        if (csIndustryEnabled && csIndustryId) params.set('industryId', String(csIndustryId));
        if (csOkvedEnabled && csOkvedId) params.set('okvedId', String(csOkvedId));

        const res = await fetch(`/api/cleanscore?${params}`, { cache: 'no-store' });
        if (!res.ok) {
          console.warn('fetchCleanScore HTTP', res.status);
          if (!append) setCsRows([]);
          setCsHasNext(false);
          return;
        }

        const data: Partial<ListResponse<CleanScoreRowEx>> = await res.json();

        const items: CleanScoreRowEx[] = Array.isArray(data?.items) ? data!.items! : [];
        const totalPages = typeof data?.totalPages === 'number' ? data!.totalPages! : 1;

        setCsRows((prev) => (append ? [...prev, ...items] : items));
        setCsHasNext(page < totalPages);
        setCsPage(page);
      } catch (e) {
        console.error('Failed to fetch cleanscore:', e);
        if (!append) setCsRows([]);
        setCsHasNext(false);
      } finally {
        setCsLoading(false);
      }
    },
    [csIndustryEnabled, csIndustryId, csOkvedEnabled, csOkvedId, csMinScore, csMaxScore],
  );

  // ========================= EFFECTS =========================
  useEffect(() => {
    fetchIndustries(1, debouncedIndustrySearch);
  }, [fetchIndustries, debouncedIndustrySearch]);

  useEffect(() => {
    if (selectedIndustry) {
      setProdclassesState((prev) => ({ ...prev, page: 1 }));
      fetchProdclasses(selectedIndustry.id, 1, debouncedProdclassSearch);
    }
  }, [selectedIndustry, fetchProdclasses, debouncedProdclassSearch]);

  useEffect(() => {
    if (selectedProdclass) {
      setWorkshopsState((prev) => ({ ...prev, page: 1 }));
      fetchWorkshops(selectedProdclass.id, 1, debouncedWorkshopSearch);
    }
  }, [selectedProdclass, fetchWorkshops, debouncedWorkshopSearch]);

  useEffect(() => {
    if (selectedWorkshop) {
      setEquipmentState((prev) => ({ ...prev, page: 1 }));
      fetchEquipment(selectedWorkshop.id, 1, debouncedEquipmentSearch);
    }
  }, [selectedWorkshop, fetchEquipment, debouncedEquipmentSearch]);

  useEffect(() => {
    if (selectedEquipment) {
      fetchEquipmentDetail(selectedEquipment.id);
    }
  }, [selectedEquipment, fetchEquipmentDetail]);

  useEffect(() => {
    if (tab === 'cleanscore' && isWorker) {
      fetchCleanScore(1, csQueryDebounced);
    }
  }, [
    tab,
    isWorker,
    csQueryDebounced,
    csIndustryEnabled,
    csIndustryId,
    csOkvedEnabled,
    csOkvedId,
    csMinScore,
    csMaxScore,
    fetchCleanScore,
  ]);

  useEffect(() => {
    if (tab === 'cleanscore' && isWorker) {
      setCsPage(1);
      fetchCleanScore(1, csQueryDebounced);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csOkvedEnabled, csOkvedId]);

  // Deep link по goodsId: превращаем в набор industryId/prodclassId/workshopId/equipmentId
  useEffect(() => {
    const gid = Number(searchParams.get('goodsId') ?? '');
    if (!gid) return;

    (async () => {
      try {
        const r = await fetch(`/api/goods/${gid}/resolve`, { cache: 'no-store' });
        const j = await r.json();

        const qp = new URLSearchParams(searchParams);
        qp.delete('goodsId'); // убираем, чтобы не зациклиться
        qp.set('tab', 'library');

        if (j?.found && (j.equipment_id || j.workshop_id || j.prodclass_id || j.industry_id)) {
          if (j.industry_id) qp.set('industryId', String(j.industry_id));
          if (j.prodclass_id) qp.set('prodclassId', String(j.prodclass_id));
          if (j.workshop_id) qp.set('workshopId', String(j.workshop_id));
          if (j.equipment_id) qp.set('equipmentId', String(j.equipment_id));
        }

        router.replace(`/library?${qp.toString()}`);
      } catch (e) {
        console.error('Failed to resolve goodsId → chain:', e);
        const qp = new URLSearchParams(searchParams);
        qp.delete('goodsId');
        router.replace(`/library?${qp.toString()}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Deep link
  useEffect(() => {
    const iid = Number(searchParams.get('industryId') ?? '');
    const pid = Number(searchParams.get('prodclassId') ?? '');
    const wid = Number(searchParams.get('workshopId') ?? '');
    const eid = Number(searchParams.get('equipmentId') ?? '');
    if (iid) setSelectedIndustry({ id: iid, industry: '(загрузка...)' } as Industry);
    if (pid) {
      setSelectedProdclass({
        id: pid,
        prodclass: '(загрузка...)',
        industry_id: iid || 0,
        best_cs: null,
      } as Prodclass);
    }
    if (wid) {
      setSelectedWorkshop({
        id: wid,
        workshop_name: '(загрузка...)',
        prodclass_id: pid || 0,
        company_id: 0,
        workshop_score: 0,
        best_cs: null,
        created_at: new Date().toISOString(),
      } as unknown as Workshop);
    }
    if (eid) {
      setSelectedEquipment({
        id: eid,
        equipment_name: '(загрузка...)',
        workshop_id: wid || 0,
        equipment_score: null,
        equipment_score_real: null,
        clean_score: null,
      } as EquipmentListItem);
    }
  }, [searchParams]);

  // Подменяем заглушки
  useEffect(() => {
    if (!selectedIndustry || !industriesState.items.length) return;
    if (selectedIndustry.industry?.startsWith('(загруз')) {
      const real = industriesState.items.find((i) => i.id === selectedIndustry.id);
      if (real) setSelectedIndustry(real);
    }
  }, [industriesState.items, selectedIndustry]);

  useEffect(() => {
    if (!selectedProdclass || !prodclassesState.items.length) return;
    if (selectedProdclass.prodclass?.startsWith('(загруз')) {
      const real = prodclassesState.items.find((i) => i.id === selectedProdclass.id);
      if (real) setSelectedProdclass(real);
    }
  }, [prodclassesState.items, selectedProdclass]);

  useEffect(() => {
    if (!selectedWorkshop || !workshopsState.items.length) return;
    if (selectedWorkshop.workshop_name?.startsWith('(загруз')) {
      const real = workshopsState.items.find((i) => i.id === selectedWorkshop.id);
      if (real) setSelectedWorkshop(real as any);
    }
  }, [workshopsState.items, selectedWorkshop]);

  useEffect(() => {
    if (!selectedEquipment || !equipmentState.items.length) return;
    if (selectedEquipment.equipment_name?.startsWith('(загруз')) {
      const real = equipmentState.items.find((i) => i.id === selectedEquipment.id);
      if (real) setSelectedEquipment(real);
    }
  }, [equipmentState.items, selectedEquipment]);

  // Автовыбор цепочки
  useEffect(() => {
    if (
      isWorker &&
      autoSelectProdclass &&
      !prodclassesState.loading &&
      prodclassesState.items.length > 0
    ) {
      setAutoSelectProdclass(false);
      handleProdclassSelect(prodclassesState.items[0]);
    }
  }, [autoSelectProdclass, prodclassesState.loading, prodclassesState.items]); // eslint-disable-line

  useEffect(() => {
    if (
      isWorker &&
      autoSelectWorkshop &&
      !workshopsState.loading &&
      workshopsState.items.length > 0
    ) {
      setAutoSelectWorkshop(false);
      handleWorkshopSelect(workshopsState.items[0] as Workshop);
    }
  }, [autoSelectWorkshop, workshopsState.loading, workshopsState.items]); // eslint-disable-line

  useEffect(() => {
    if (
      isWorker &&
      autoSelectEquipment &&
      !equipmentState.loading &&
      equipmentState.items.length > 0
    ) {
      setAutoSelectEquipment(false);
      handleEquipmentSelect(equipmentState.items[0]);
    }
  }, [autoSelectEquipment, equipmentState.loading, equipmentState.items]); // eslint-disable-line

  useEffect(() => {
    if (!isWorker && (tab === 'cleanscore' || tab === 'okved' || tab === 'aianalysis' || tab === 'aidebug')) {
      setTab('library');
    }
  }, [isWorker, tab]);

  // ========================= HANDЛЕРЫ =========================
  const handleIndustrySelect = (industry: Industry) => {
    if (selectedIndustry?.id === industry.id) return;
    setSelectedIndustry(industry);
    setSelectedProdclass(null);
    setSelectedWorkshop(null);
    setSelectedEquipment(null);
    setEquipmentDetail(null);

    if (isWorker) {
      setAutoSelectProdclass(true);
      setAutoSelectWorkshop(true);
      setAutoSelectEquipment(true);
    }

    setProdclassesState((prev) => ({
      ...prev,
      items: [],
      page: 1,
      searchQuery: '',
      hasNextPage: false,
    }));
    setWorkshopsState((prev) => ({
      ...prev,
      items: [],
      page: 1,
      searchQuery: '',
      hasNextPage: false,
    }));
    setEquipmentState((prev) => ({
      ...prev,
      items: [],
      page: 1,
      searchQuery: '',
      hasNextPage: false,
    }));
  };

  const handleProdclassSelect = (prodclass: Prodclass) => {
    if (selectedProdclass?.id === prodclass.id) return;
    setSelectedProdclass(prodclass);
    setSelectedWorkshop(null);
    setSelectedEquipment(null);
    setEquipmentDetail(null);

    if (isWorker) {
      setAutoSelectWorkshop(true);
      setAutoSelectEquipment(true);
    }

    setWorkshopsState((prev) => ({
      ...prev,
      items: [],
      page: 1,
      searchQuery: '',
      hasNextPage: false,
    }));
    setEquipmentState((prev) => ({
      ...prev,
      items: [],
      page: 1,
      searchQuery: '',
      hasNextPage: false,
    }));
  };

  const handleWorkshopSelect = (workshop: Workshop) => {
    if (selectedWorkshop?.id === workshop.id) return;
    setSelectedWorkshop(workshop);
    setSelectedEquipment(null);
    setEquipmentDetail(null);

    if (isWorker) {
      setAutoSelectEquipment(true);
    }

    setEquipmentState((prev) => ({
      ...prev,
      items: [],
      page: 1,
      searchQuery: '',
      hasNextPage: false,
    }));
  };

  const handleEquipmentSelect = (equipment: EquipmentListItem) => {
    if (selectedEquipment?.id === equipment.id) return;
    if (!isWorker && quota && !quota.unlimited && (quota.remaining ?? 0) === 0) {
      setLimitExceeded(true);
      setEquipmentDetail(null);
      return;
    }
    setSelectedEquipment(equipment);
  };

  // Пагинации и вспомогательные
  const LoadingCrumb = () => <div className="h-4 w-24 rounded bg-muted animate-pulse" />;
  const isLoadingText = (s?: string | null) => Boolean(s && s.startsWith('(загруз'));

  const loadMoreIndustries = () => {
    if (!industriesState.loading && industriesState.hasNextPage) {
      const nextPage = industriesState.page + 1;
      setIndustriesState((prev) => ({ ...prev, page: nextPage }));
      fetchIndustries(nextPage, debouncedIndustrySearch, true);
    }
  };

  const loadMoreProdclasses = () => {
    if (!prodclassesState.loading && prodclassesState.hasNextPage && selectedIndustry) {
      const nextPage = prodclassesState.page + 1;
      setProdclassesState((prev) => ({ ...prev, page: nextPage }));
      fetchProdclasses(selectedIndustry.id, nextPage, debouncedProdclassSearch, true);
    }
  };

  const loadMoreWorkshops = () => {
    if (!workshopsState.loading && workshopsState.hasNextPage && selectedProdclass) {
      const nextPage = workshopsState.page + 1;
      setWorkshopsState((prev) => ({ ...prev, page: nextPage }));
      fetchWorkshops(selectedProdclass.id, nextPage, debouncedWorkshopSearch, true);
    }
  };

  const loadMoreEquipment = () => {
    if (!equipmentState.loading && equipmentState.hasNextPage && selectedWorkshop) {
      const nextPage = equipmentState.page + 1;
      setEquipmentState((prev) => ({ ...prev, page: nextPage }));
      fetchEquipment(selectedWorkshop.id, nextPage, debouncedEquipmentSearch, true);
    }
  };

  // Ссылка из строки CleanScore
  const toLibraryLink = (r: CleanScoreRow) => {
    const qp = new URLSearchParams();
    if (r.industry_id) qp.set('industryId', String(r.industry_id));
    if (r.prodclass_id) qp.set('prodclassId', String(r.prodclass_id));
    if (r.workshop_id) qp.set('workshopId', String(r.workshop_id));
    if (r.equipment_id) qp.set('equipmentId', String(r.equipment_id));
    return `/library?${qp.toString()}`;
  };

  // видимые колонки для colSpan
  const visibleColCount = (isWorker ? 12 : 6) + 2;

  const SHOW_BREADCRUMBS = false;

  // чекбокс подтверждения
  const toggleRowConfirm = useCallback(
    async (row: CleanScoreRowEx) => {
      if (!isAdmin || !row?.equipment_id) return;
      const id = row.equipment_id;
      const current = !!Number(row.equipment_score_real || 0);
      const want = !current;

      setRowSaving((prev) => ({ ...prev, [id]: true }));
      handleEsConfirmChange(id, want);

      try {
        const r = await fetch(`/api/equipment/${id}/es-confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ confirmed: want }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err?.error || `HTTP ${r.status}`);
        }
        const data = await r.json();
        const confirmedServer = !!Number(data?.equipment_score_real);
        handleEsConfirmChange(id, confirmedServer);
      } catch (e) {
        console.error('Failed to toggle ES confirm (table):', e);
        handleEsConfirmChange(id, current);
      } finally {
        setRowSaving((prev) => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
        });
      }
    },
    [isAdmin, handleEsConfirmChange],
  );

  // ========================= RENDER =========================
  return (
    <div className="h-screen flex flex-col">
      {/* ===== HEADER ===== */}
      <div className="border-b bg-background">
        <div className="container mx-auto px-4">
          <div className="flex flex-wrap items-center justify-between gap-2 py-3 sm:py-4">
            <div className="flex min-w-[240px] items-center gap-3">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-semibold leading-tight">
                Отраслевой навигатор криобластинга от ИРБИСТЕХ
              </h1>

              {!isWorker && quota && !quota.unlimited && (
                <div
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs leading-5"
                  title="Сколько карточек можно открыть сегодня">
                  <strong className="text-red-600">Остаток лимита: {quota.remaining}</strong>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <Image
                src="/logo.png"
                alt="ИрбисТех"
                width={160}
                height={48}
                priority
                className="h-8 w-auto sm:h-10 lg:h-12"
              />
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="whitespace-nowrap rounded-md border px-3 py-1 text-sm hover:bg-accent disabled:opacity-50"
                title="Завершить сессию">
                {loggingOut ? 'Выходим…' : 'Выйти'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ===== TABS ===== */}
      <div className="bg-background">
        <div className="container mx-auto px-4">
          <Tabs
            value={tab}
            onValueChange={(v) => {
              if ((v === 'cleanscore' || v === 'okved' || v === 'aianalysis' || v === 'aidebug') && !isWorker) return;
              setTab(v as any);
              const qp = new URLSearchParams(searchParams);
              qp.set('tab', v);
              router.replace(`/library?${qp.toString()}`);
            }}
            className="w-full">
            <div className="grid w-full grid-cols-6 gap-1 rounded-lg bg-muted p-1">
              <TabsList className="contents">
                <TabsTrigger
                  value="library"
                  className="
                    h-10 w-full justify-center rounded-md px-4 text-sm
                    border border-transparent
                    data-[state=active]:bg-background data-[state=active]:border-border
                    data-[state=inactive]:text-muted-foreground data-[state=active]:text-foreground
                    shadow-none transition
                  ">
                  Каталог
                </TabsTrigger>

                <TabsTrigger
                  value="cleanscore"
                  disabled={!isWorker}
                  title={!isWorker ? 'Доступно только сотрудникам' : undefined}
                  className="
                    h-10 w-full justify-center rounded-md px-4 text-sm
                    border border-transparent
                    data-[state=active]:bg-background data-[state=active]:border-border
                    data-[state=inactive]:text-muted-foreground data-[state=active]:text-foreground
                    disabled:opacity-50 disabled:cursor-not-allowed
                    shadow-none transition
                  ">
                  Таблица
                </TabsTrigger>

                <TabsTrigger
                  value="okved"
                  disabled={!isWorker}
                  title={!isWorker ? 'Доступно только сотрудникам' : undefined}
                  className="
                    h-10 w-full justify-center rounded-md px-4 text-sm
                    border border-transparent
                    data-[state=active]:bg-background data-[state=active]:border-border
                    data-[state=inactive]:text-muted-foreground data-[state=active]:text-foreground
                    disabled:opacity-50 disabled:cursor-not-allowed
                    shadow-none transition
                  ">
                  База компаний
                </TabsTrigger>

                <TabsTrigger
                  value="aianalysis"
                  disabled={!isWorker}
                  title={!isWorker ? 'Доступно только сотрудникам' : undefined}
                  className="
                    h-10 w-full justify-center rounded-md px-4 text-sm
                    border border-transparent
                    data-[state=active]:bg-background data-[state=active]:border-border
                    data-[state=inactive]:text-muted-foreground data-[state=active]:text-foreground
                    disabled:opacity-50 disabled:cursor-not-allowed
                    shadow-none transition
                  "
                >
                  AI-анализ компаний
                </TabsTrigger>

                <TabsTrigger
                  value="aidebug"
                  disabled={!isWorker}
                  title={!isWorker ? 'Доступно только сотрудникам' : undefined}
                  className="
                    h-10 w-full justify-center rounded-md px-4 text-sm
                    border border-transparent
                    data-[state=active]:bg-background data-[state=active]:border-border
                    data-[state=inactive]:text-muted-foreground data-[state=active]:text-foreground
                    disabled:opacity-50 disabled:cursor-not-allowed
                    shadow-none transition
                  "
                >
                  AI-отладка
                </TabsTrigger>

                <TabsTrigger
                  value="aisearch"
                  className="
                    h-10 w-full justify-center rounded-md px-4 text-sm
                    border border-transparent
                    data-[state=active]:bg-background data-[state=active]:border-border
                    data-[state=inactive]:text-muted-foreground data-[state=active]:text-foreground
                    shadow-none transition
                  ">
                  AI-поиск
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ===== LIBRARY TAB ===== */}
            <TabsContent value="library" className="mt-0">
              <div className="py-4 space-y-4">
                {false && (
                  <Breadcrumb>
                    <BreadcrumbList>
                      <BreadcrumbItem>
                        <Home className="h-4 w-4" />
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbPage>Каталог</BreadcrumbPage>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        <BreadcrumbPage>Навигатор</BreadcrumbPage>
                      </BreadcrumbItem>
                    </BreadcrumbList>
                  </Breadcrumb>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-[max-content_1fr] gap-4 h-[calc(100vh-200px)] bg-background">
                  <div className="h-full">
                    <div className="flex h-full flex-col rounded-xl border shadow-sm bg-card overflow-hidden">
                      <div className="px-3 py-2 border-b bg-card text-sm font-semibold">
                        Навигатор
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[160px_160px_160px_160px] gap-5 md:gap-3 lg:gap-1 p-2 h-full text-base md:text-sm bg-background">
                        <HierarchyList
                          title="Индустрия"
                          enabled={true}
                          items={industriesState.items}
                          selectedId={selectedIndustry?.id || null}
                          loading={industriesState.loading}
                          hasNextPage={industriesState.hasNextPage}
                          showSearch={false}
                          titleClassName="font-semibold"
                          headerClassName="bg-muted"
                          onItemSelect={handleIndustrySelect}
                          onLoadMore={loadMoreIndustries}
                          getItemId={(item) => item.id}
                          getItemTitle={(item) => item.industry}
                        />

                        <HierarchyList
                          title="Класс предприятия"
                          enabled={!!selectedIndustry}
                          items={prodclassesState.items}
                          selectedId={selectedProdclass?.id || null}
                          loading={prodclassesState.loading}
                          hasNextPage={prodclassesState.hasNextPage}
                          showSearch={false}
                          titleClassName="font-semibold"
                          headerClassName="bg-muted"
                          onItemSelect={handleProdclassSelect}
                          onLoadMore={loadMoreProdclasses}
                          getItemId={(item) => item.id}
                          getItemTitle={(item) => item.prodclass}
                          emptyMessage={
                            selectedIndustry ? 'Нет классов предприятий' : 'Выберите индустрию'
                          }
                        />

                        <HierarchyList
                          title="Цех предприятия"
                          enabled={!!selectedProdclass}
                          items={workshopsState.items}
                          selectedId={selectedWorkshop?.id || null}
                          loading={workshopsState.loading}
                          hasNextPage={workshopsState.hasNextPage}
                          showSearch={false}
                          titleClassName="font-semibold"
                          headerClassName="bg-muted"
                          onItemSelect={handleWorkshopSelect}
                          onLoadMore={loadMoreWorkshops}
                          getItemId={(item) => item.id}
                          getItemTitle={(item) => item.workshop_name}
                          getItemCs={(item) => item.best_cs ?? null}
                          emptyMessage={
                            selectedProdclass ? 'Нет цехов' : 'Выберите класс предприятия'
                          }
                        />

                        <HierarchyList
                          title="Оборудование из цеха"
                          enabled={!!selectedWorkshop}
                          items={equipmentState.items}
                          selectedId={selectedEquipment?.id || null}
                          loading={equipmentState.loading}
                          hasNextPage={equipmentState.hasNextPage}
                          showSearch={false}
                          titleClassName="font-semibold"
                          headerClassName="bg-muted"
                          onItemSelect={handleEquipmentSelect}
                          onLoadMore={loadMoreEquipment}
                          getItemId={(item) => item.id}
                          getItemTitle={(item) => item.equipment_name}
                          getItemCs={(item) => item.clean_score ?? null}
                          getItemConfirmed={(item) => Number(item.equipment_score_real) !== 0}
                          emptyMessage={selectedWorkshop ? 'Нет оборудования' : 'Выберите цех'}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="h-full min-w-0">
                    {!isWorker && limitExceeded ? (
                      <div className="h-full flex items-center justify-center rounded-lg bg-background">
                        <div className="max-w-md text-center space-y-3">
                          <div className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
                            Лимит на текущую дату исчерпан
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Вы использовали дневной лимит просмотра карточек. Лимит обновится
                            завтра.
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Остаток на сегодня: <strong>{quota?.remaining ?? 0}</strong> из{' '}
                            {quota?.limit ?? 10}
                          </p>
                        </div>
                      </div>
                    ) : equipmentDetail ? (
                      <div className="h-full overflow-auto">
                        <EquipmentCard
                          equipment={equipmentDetail}
                          onEsConfirmChange={handleEsConfirmChange}
                        />
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center rounded-lg bg-background">
                        <div className="text-center text-muted-foreground">
                          <div className="text-sm">Выберите оборудование</div>
                          <div className="text-xs mt-1">для просмотра деталей</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ===== CLEAN SCORE TAB ===== */}
            {isWorker && (
              <TabsContent value="cleanscore" className="mt-0">
                <div className="py-4 space-y-4">
                  {/* Панель фильтров (всегда в одну строку, со скроллом на узких) */}
                  <div className="flex flex-nowrap items-center gap-2 md:gap-3 overflow-x-auto min-w-0">
                    {/* Поиск + Обновить */}
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        className="h-9 w-[320px] rounded-md border px-3 text-sm"
                        placeholder="Поиск (оборудование, отрасль, цех, текст...)"
                        value={csQuery}
                        onChange={(e) => {
                          setCsPage(1);
                          setCsQuery(e.target.value);
                        }}
                      />
                      <button
                        className="h-9 rounded-md border px-3 text-sm"
                        onClick={() => fetchCleanScore(1, csQueryDebounced)}
                        disabled={!isWorker || csLoading}>
                        Обновить
                      </button>
                    </div>

                    {/* Фильтр отрасли */}
                    <div className="flex items-center gap-2 shrink-0">
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={csIndustryEnabled}
                          onChange={(e) => setCsIndustryEnabled(e.target.checked)}
                        />
                        Отрасли
                      </label>
                      <div className="max-w-[340px] w-[340px]">
                        <select
                          className="h-9 w-full rounded-md border px-2 text-sm overflow-hidden text-ellipsis whitespace-nowrap"
                          disabled={!csIndustryEnabled}
                          value={csIndustryId ?? ''}
                          onChange={(e) =>
                            setCsIndustryId(e.target.value ? Number(e.target.value) : null)
                          }
                          title={
                            csIndustryEnabled
                              ? industriesState.items.find((i) => i.id === csIndustryId)?.industry
                              : '— Все отрасли —'
                          }>
                          <option value="">— Все отрасли —</option>
                          {industriesState.items.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.industry}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Фильтр ОКВЭД */}
                    <div className="flex items-center gap-2 shrink-0">
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={csOkvedEnabled}
                          onChange={(e) => setCsOkvedEnabled(e.target.checked)}
                        />
                        ОКВЭД
                      </label>

                      <Select
                        disabled={!csOkvedEnabled}
                        value={csOkvedId == null ? 'all' : String(csOkvedId)}
                        onValueChange={(v) => setCsOkvedId(v === 'all' ? null : Number(v))}>
                        <SelectTrigger
                          title={selectedOkvedLabel}
                          className="h-9 w-[460px] max-w-[480px] truncate">
                          <SelectValue placeholder="— Все ОКВЭД —" />
                        </SelectTrigger>

                        <SelectContent
                          side="bottom"
                          align="start"
                          position="popper"
                          className="force-select-scroll w-[min(90vw,480px)] max-h-80">
                          <SelectItem
                            value="all"
                            className="whitespace-normal break-words leading-5">
                            — Все ОКВЭД —
                          </SelectItem>
                          {okvedOptions.map((o) => (
                            <SelectItem
                              key={o.id}
                              value={String(o.id)}
                              className="whitespace-normal break-words leading-5">
                              {o.okved_code} — {o.okved_main}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Диапазон CS */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm text-muted-foreground">CS</span>
                      <select
                        className="h-9 rounded-md border px-2 text-sm"
                        value={csMinScore.toFixed(2)}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setCsMinScore(v);
                          if (v > csMaxScore) setCsMaxScore(v);
                        }}>
                        {scoreOptions.map((v) => (
                          <option key={`min-${v}`} value={v.toFixed(2)}>
                            {v.toFixed(2)}
                          </option>
                        ))}
                      </select>
                      <span className="text-sm text-muted-foreground"></span>
                      <select
                        className="h-9 rounded-md border px-2 text-sm"
                        value={csMaxScore.toFixed(2)}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setCsMaxScore(v);
                          if (v < csMinScore) setCsMinScore(v);
                        }}>
                        {scoreOptions
                          .filter((v) => v >= csMinScore)
                          .map((v) => (
                            <option key={`max-${v}`} value={v.toFixed(2)}>
                              {v.toFixed(2)}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {/* Таблица */}
                  <div className="rounded-lg border overflow-auto">
                    <table className={`w-full text-xs ${isWorker ? 'table-fixed' : 'table-auto'}`}>
                      <thead
                        className="
                        sticky top-0 z-10 text-left border-b
                        [&>tr>th]:px-2 [&>tr>th]:py-2
                        [&>tr>th]:bg-sky-50
                      ">
                        <tr>
                          <th style={{ width: colW.card }} className="text-center" />
                          <th
                            style={{ width: colW.check }}
                            className="w-[1%] text-center whitespace-nowrap">
                            Чек
                          </th>
                          <th className="text-left">Отрасль</th>
                          <th className="text-left whitespace-nowrap">Основной ОКВЭД</th>
                          <th className="text-left">Класс</th>
                          <th className="text-left">Цех</th>
                          <th className="text-left">Оборудование</th>
                          <th style={{ width: colW.cs }}>CS</th>
                          {isWorker && (
                            <>
                              <th className="text-left">Загрязнения</th>
                              <th className="text-left">Поверхности</th>
                              <th className="text-left">Проблемы</th>
                              <th className="text-left">Традиционная очистка</th>
                              <th className="text-left">Недостатки традиц.</th>
                              <th className="text-left">Преимущества</th>
                            </>
                          )}
                        </tr>
                      </thead>

                      <tbody
                        className="
                        [&>tr>td]:px-2 [&>tr>td]:py-1.5 align-top
                        [&>tr]:border-b
                      ">
                        {(csRows ?? []).map((r) => {
                          const confirmed = !!Number(r.equipment_score_real || 0);
                          return (
                            <tr
                              key={r.equipment_id}
                              className={cn(
                                'align-top',
                                confirmed && 'bg-blue-50 dark:bg-blue-900/10',
                              )}>
                              {/* 1) Карточка каталога (квадратная кнопка) */}
                              <td style={{ width: colW.card }} className="text-center align-top">
                                <SquareImgButton
                                  icon="catalog"
                                  title="Открыть карточку в каталоге"
                                  onClick={() =>
                                    window.open(toLibraryLink(r), '_blank', 'noopener')
                                  }
                                  className="mx-auto my-[2px]"
                                  sizeClassName="h-7 w-7"
                                />
                              </td>

                              {/* чекбокс подтверждения */}
                              <td style={{ width: colW.check }} className="w-[1%] text-center">
                                <label
                                  className={cn(
                                    'group inline-flex items-center justify-center rounded-md p-0.5 transition',
                                    isAdmin
                                      ? 'cursor-pointer hover:ring-2 hover:ring-blue-400 focus-within:ring-2 focus-within:ring-blue-400'
                                      : 'opacity-50 cursor-not-allowed',
                                  )}
                                  title={
                                    isAdmin
                                      ? 'Переключить подтверждение'
                                      : 'Недоступно: только для администратора'
                                  }>
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4"
                                    checked={!!Number(r.equipment_score_real || 0)}
                                    onChange={() => toggleRowConfirm(r)}
                                    disabled={!isAdmin || !!rowSaving[r.equipment_id]}
                                    aria-label="Подтверждено ИРБИСТЕХ"
                                  />
                                </label>
                              </td>

                              {/* авто-ширины */}
                              <td className="whitespace-normal break-words leading-4">
                                {r.industry}
                              </td>

                              {/* 2) Основной ОКВЭД: слева кнопка, текст без ссылки */}
                              <td className="whitespace-normal break-words leading-4 align-top">
                                {r.okved_code ? (
                                  <div className="flex items-start gap-2">
                                    <SquareImgButton
                                      icon="okved"
                                      title="Открыть вкладку «База компаний» по этому коду"
                                      onClick={() =>
                                        window.open(
                                          `/library?tab=okved${
                                            r.okved_code
                                              ? `&okved=${encodeURIComponent(r.okved_code)}`
                                              : ''
                                          }${
                                            r.okved_id
                                              ? `&okvedId=${encodeURIComponent(String(r.okved_id))}`
                                              : ''
                                          }`,
                                          '_blank',
                                          'noopener',
                                        )
                                      }
                                      className="mt-[2px]" // чтобы быть на одном уровне с кнопкой в 1-й колонке
                                      sizeClassName="h-7 w-7"
                                    />

                                    <div className="min-w-0">
                                      <div className="font-medium">{r.okved_code}</div>
                                      {r.okved_main && (
                                        <div className="text-muted-foreground">{r.okved_main}</div>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </td>

                              <td className="whitespace-normal break-words leading-4">
                                {r.prodclass}
                              </td>
                              <td className="whitespace-normal break-words leading-4">
                                {r.workshop_name}
                              </td>
                              <td className="whitespace-normal break-words leading-4 font-medium">
                                {r.equipment_name}
                              </td>

                              {/* CS — фикс */}
                              <td
                                className="whitespace-nowrap tabular-nums"
                                style={{ width: colW.cs }}>
                                {r.clean_score != null ? r.clean_score.toFixed(2) : '—'}
                              </td>

                              {isWorker && (
                                <>
                                  <td className="whitespace-normal break-words leading-4">
                                    {r.contamination}
                                  </td>
                                  <td className="whitespace-normal break-words leading-4">
                                    {r.surface}
                                  </td>
                                  <td className="whitespace-normal break-words leading-4">
                                    {r.problems}
                                  </td>
                                  <td className="whitespace-normal break-words leading-4">
                                    {r.old_method}
                                  </td>
                                  <td className="whitespace-normal break-words leading-4">
                                    {r.old_problem}
                                  </td>
                                  <td className="whitespace-normal break-words leading-4">
                                    {r.benefit}
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}

                        {csRows.length === 0 && !csLoading && (
                          <tr>
                            <td
                              colSpan={visibleColCount}
                              className="text-center py-6 text-sm text-muted-foreground">
                              Нет данных
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Пагинация */}
                  <div className="flex justify-center">
                    {csHasNext && (
                      <button
                        className="h-9 rounded-md border px-3 text-sm"
                        onClick={() => fetchCleanScore(csPage + 1, csQueryDebounced, true)}
                        disabled={csLoading}>
                        Загрузить ещё
                      </button>
                    )}
                  </div>
                </div>
              </TabsContent>
            )}

            {isWorker && (
              <TabsContent value="aianalysis" className="mt-0">
                <AiCompanyAnalysisTab />
              </TabsContent>
            )}

            {isWorker && (
              <TabsContent value="aidebug" className="mt-0">
                <div className="py-4">
                  <AiDebugTab isAdmin={isAdmin} />
                </div>
              </TabsContent>
            )}

            {isWorker && (
              <TabsContent value="okved" className="mt-0">
                <div className="py-4">
                  <OkvedTab />
                </div>
              </TabsContent>
            )}

            <TabsContent value="aisearch" className="mt-0">
              <AiSearchTab />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

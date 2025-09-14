'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
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

interface ListState<T> {
  items: T[];
  loading: boolean;
  hasNextPage: boolean;
  page: number;
  searchQuery: string;
}

export default function LibraryPage() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') ?? 'library') as 'library' | 'cleanscore';

  // Табы
  const [tab, setTab] = useState<'library' | 'cleanscore'>(initialTab);

  // Selection state (иерархия)
  const [selectedIndustry, setSelectedIndustry] = useState<Industry | null>(null);
  const [selectedProdclass, setSelectedProdclass] = useState<Prodclass | null>(null);
  const [selectedWorkshop, setSelectedWorkshop] = useState<Workshop | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentListItem | null>(null);
  const [equipmentDetail, setEquipmentDetail] = useState<EquipmentDetail | null>(null);

  // List states
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
    hasNextPage: false, // ← по умолчанию зависимые списки выключены
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

  // CleanScore state (таблица)
  const [csRows, setCsRows] = useState<CleanScoreRow[]>([]);
  const [csPage, setCsPage] = useState(1);
  const [csHasNext, setCsHasNext] = useState(true);
  const [csLoading, setCsLoading] = useState(false);
  const [csQuery, setCsQuery] = useState('');
  const csQueryDebounced = useDebounce(csQuery, 300);

  // Debounced search queries (иерархия)
  const debouncedIndustrySearch = useDebounce(industriesState.searchQuery, 300);
  const debouncedProdclassSearch = useDebounce(prodclassesState.searchQuery, 300);
  const debouncedWorkshopSearch = useDebounce(workshopsState.searchQuery, 300);
  const debouncedEquipmentSearch = useDebounce(equipmentState.searchQuery, 300);

  // Фильтры CleanScore
  const [csIndustryEnabled, setCsIndustryEnabled] = useState(false);
  const [csIndustryId, setCsIndustryId] = useState<number | null>(null);

  const [csMinScore, setCsMinScore] = useState(0.95);
  const [csMaxScore, setCsMaxScore] = useState(1.0);
  const scoreOptions = Array.from({ length: 16 }, (_, i) => Number((0.85 + i * 0.01).toFixed(2)));

  // Ручные ширины колонок (таблица)
  const colW = {
    card: 35,
    industry: 100,
    prodclass: 100,
    workshop: 100,
    equipment: 100,
    cs: 35,
    contamination: 100,
    surface: 125,
    problems: 125,
    old_method: 125,
    old_problem: 125,
    benefit: 260,
  } as const;

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

  const fetchEquipmentDetail = useCallback(async (equipmentId: number) => {
    try {
      const response = await fetch(`/api/equipment/${equipmentId}`);
      const data: EquipmentDetail = await response.json();
      setEquipmentDetail(data);
    } catch (error) {
      console.error('Failed to fetch equipment detail:', error);
    }
  }, []);

  // CleanScore loader (с фильтрами)
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
        });
        if (csIndustryEnabled && csIndustryId) {
          params.set('industryId', String(csIndustryId));
        }
        const res = await fetch(`/api/cleanscore?${params}`);
        const data: ListResponse<CleanScoreRow> = await res.json();
        setCsRows((prev) => (append ? [...prev, ...data.items] : data.items));
        setCsHasNext(page < data.totalPages);
        setCsPage(page);
      } catch (e) {
        console.error('Failed to fetch cleanscore:', e);
      } finally {
        setCsLoading(false);
      }
    },
    [csIndustryEnabled, csIndustryId, csMinScore, csMaxScore],
  );

  // ========================= EFFECTS =========================
  useEffect(() => {
    fetchIndustries(1, debouncedIndustrySearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchIndustries, debouncedIndustrySearch]);

  useEffect(() => {
    if (selectedIndustry) {
      setProdclassesState((prev) => ({ ...prev, page: 1 }));
      fetchProdclasses(selectedIndustry.id, 1, debouncedProdclassSearch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndustry, fetchProdclasses, debouncedProdclassSearch]);

  useEffect(() => {
    if (selectedProdclass) {
      setWorkshopsState((prev) => ({ ...prev, page: 1 }));
      fetchWorkshops(selectedProdclass.id, 1, debouncedWorkshopSearch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProdclass, fetchWorkshops, debouncedWorkshopSearch]);

  useEffect(() => {
    if (selectedWorkshop) {
      setEquipmentState((prev) => ({ ...prev, page: 1 }));
      fetchEquipment(selectedWorkshop.id, 1, debouncedEquipmentSearch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkshop, fetchEquipment, debouncedEquipmentSearch]);

  useEffect(() => {
    if (selectedEquipment) {
      fetchEquipmentDetail(selectedEquipment.id);
    }
  }, [selectedEquipment, fetchEquipmentDetail]);

  useEffect(() => {
    if (tab === 'cleanscore') {
      fetchCleanScore(1, csQueryDebounced);
    }
  }, [
    tab,
    csQueryDebounced,
    csIndustryEnabled,
    csIndustryId,
    csMinScore,
    csMaxScore,
    fetchCleanScore,
  ]);

  // Поддержка deep-link
  useEffect(() => {
    const iid = Number(searchParams.get('industryId') ?? '');
    const pid = Number(searchParams.get('prodclassId') ?? '');
    const wid = Number(searchParams.get('workshopId') ?? '');
    const eid = Number(searchParams.get('equipmentId') ?? '');
    if (iid) {
      setSelectedIndustry({ id: iid, industry: '(загрузка...)' } as Industry);
    }
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

  // ========================= HANDЛЕРЫ =========================
  const handleIndustrySelect = (industry: Industry) => {
    if (selectedIndustry?.id === industry.id) return;
    setSelectedIndustry(industry);
    setSelectedProdclass(null);
    setSelectedWorkshop(null);
    setSelectedEquipment(null);
    setEquipmentDetail(null);
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
    setSelectedEquipment(equipment);
  };

  // Load more handlers
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

  // ========================= RENDER =========================
  return (
    <div className="h-screen flex flex-col">
      {/* ===== ГЛАВНАЯ ШАПКА СВЕРХУ (над вкладками) ===== */}
      <div className="border-b bg-background">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between py-4">
            <h1 className="text-xl md:text-2xl font-semibold leading-tight">
              Отраслевой навигатор криобластинга от ИРБИСТЕХ
            </h1>
            <Image src="/logo.png" alt="ИрбисТех" width={160} height={48} priority />
          </div>
        </div>
      </div>

      {/* ===== ВКЛАДКИ И СОДЕРЖИМОЕ ===== */}
      <div className="bg-background">
        <div className="container mx-auto px-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
            <TabsList className="grid w-full md:w-auto grid-cols-3 md:grid-cols-3 gap-0">
              <TabsTrigger value="library" className="px-6 py-2">
                Каталог
              </TabsTrigger>
              <TabsTrigger value="cleanscore" className="px-6 py-2">
                Таблица
              </TabsTrigger>
              <TabsTrigger value="search" className="px-6 py-2" disabled>
                AI-поиск
              </TabsTrigger>
            </TabsList>

            {/* ===== LIBRARY TAB ===== */}
            <TabsContent value="library" className="mt-0">
              <div className="py-4 space-y-4">
                {/* Breadcrumbs */}
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
                    {selectedIndustry && (
                      <>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                          {isLoadingText(selectedIndustry.industry) ? (
                            <LoadingCrumb />
                          ) : (
                            <BreadcrumbPage className="max-w-[200px] truncate">
                              {selectedIndustry.industry}
                            </BreadcrumbPage>
                          )}
                        </BreadcrumbItem>
                      </>
                    )}
                    {selectedProdclass && (
                      <>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                          {isLoadingText(selectedProdclass.prodclass) ? (
                            <LoadingCrumb />
                          ) : (
                            <BreadcrumbPage className="max-w-[200px] truncate">
                              {selectedProdclass.prodclass}
                            </BreadcrumbPage>
                          )}
                        </BreadcrumbItem>
                      </>
                    )}
                    {selectedWorkshop && (
                      <>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                          {isLoadingText(selectedWorkshop.workshop_name) ? (
                            <LoadingCrumb />
                          ) : (
                            <BreadcrumbPage className="max-w-[200px] truncate">
                              {selectedWorkshop.workshop_name}
                            </BreadcrumbPage>
                          )}
                        </BreadcrumbItem>
                      </>
                    )}
                    {selectedEquipment && (
                      <>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                          {isLoadingText(selectedEquipment.equipment_name) ? (
                            <LoadingCrumb />
                          ) : (
                            <BreadcrumbPage className="max-w-[200px] truncate">
                              {selectedEquipment.equipment_name}
                            </BreadcrumbPage>
                          )}
                        </BreadcrumbItem>
                      </>
                    )}
                  </BreadcrumbList>
                </Breadcrumb>

                {/* Main Content */}
                <div className="grid grid-cols-1 lg:grid-cols-7 gap-4 h-[calc(100vh-200px)] bg-background">
                  {/* Lists */}
                  <div className="lg:col-span-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 h-full">
                    {/* Industries — всегда активен */}
                    <HierarchyList
                      title="Индустрия"
                      enabled={true}
                      items={industriesState.items}
                      selectedId={selectedIndustry?.id || null}
                      loading={industriesState.loading}
                      hasNextPage={industriesState.hasNextPage}
                      searchQuery={industriesState.searchQuery}
                      onSearchChange={(query) =>
                        setIndustriesState((prev) => ({ ...prev, searchQuery: query, page: 1 }))
                      }
                      onItemSelect={handleIndustrySelect}
                      onLoadMore={loadMoreIndustries}
                      getItemId={(item) => item.id}
                      getItemTitle={(item) => item.industry}
                    />

                    {/* Prodclasses — активен после выбора индустрии */}
                    <HierarchyList
                      title="Класс предприятия"
                      enabled={!!selectedIndustry}
                      items={prodclassesState.items}
                      selectedId={selectedProdclass?.id || null}
                      loading={prodclassesState.loading}
                      hasNextPage={prodclassesState.hasNextPage}
                      searchQuery={prodclassesState.searchQuery}
                      onSearchChange={(query) =>
                        setProdclassesState((prev) => ({ ...prev, searchQuery: query, page: 1 }))
                      }
                      onItemSelect={handleProdclassSelect}
                      onLoadMore={loadMoreProdclasses}
                      getItemId={(item) => item.id}
                      getItemTitle={(item) => item.prodclass}
                      getItemCs={(item) => item.best_cs ?? null}
                      emptyMessage={
                        selectedIndustry ? 'Нет классов предприятий' : 'Выберите индустрию'
                      }
                    />

                    {/* Workshops — активен после выбора класса */}
                    <HierarchyList
                      title="Цех предприятия"
                      enabled={!!selectedProdclass}
                      items={workshopsState.items}
                      selectedId={selectedWorkshop?.id || null}
                      loading={workshopsState.loading}
                      hasNextPage={workshopsState.hasNextPage}
                      searchQuery={workshopsState.searchQuery}
                      onSearchChange={(query) =>
                        setWorkshopsState((prev) => ({ ...prev, searchQuery: query, page: 1 }))
                      }
                      onItemSelect={handleWorkshopSelect}
                      onLoadMore={loadMoreWorkshops}
                      getItemId={(item) => item.id}
                      getItemTitle={(item) => item.workshop_name}
                      getItemCs={(item) => item.best_cs ?? null}
                      emptyMessage={selectedProdclass ? 'Нет цехов' : 'Выберите класс предприятия'}
                    />

                    {/* Equipment — активен после выбора цеха */}
                    <HierarchyList
                      title="Оборудование из цеха"
                      enabled={!!selectedWorkshop}
                      items={equipmentState.items}
                      selectedId={selectedEquipment?.id || null}
                      loading={equipmentState.loading}
                      hasNextPage={equipmentState.hasNextPage}
                      searchQuery={equipmentState.searchQuery}
                      onSearchChange={(query) =>
                        setEquipmentState((prev) => ({ ...prev, searchQuery: query, page: 1 }))
                      }
                      onItemSelect={handleEquipmentSelect}
                      onLoadMore={loadMoreEquipment}
                      getItemId={(item) => item.id}
                      getItemTitle={(item) => item.equipment_name}
                      getItemCs={(item) => item.clean_score ?? null}
                      emptyMessage={selectedWorkshop ? 'Нет оборудования' : 'Выберите цех'}
                    />
                  </div>

                  {/* Details */}
                  <div className="lg:col-span-3 h-full">
                    {equipmentDetail ? (
                      <div className="h-full overflow-auto">
                        <EquipmentCard equipment={equipmentDetail} />
                      </div>
                    ) : (
                      // единый фон, без бордера — никаких «реек»
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

            {/* ===== CLEAN SCORE TAB (Таблица) ===== */}
            <TabsContent value="cleanscore" className="mt-0">
              <div className="py-4 space-y-4">
                {/* Панель поиска + фильтры */}
                <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
                  {/* Поиск и Обновить */}
                  <div className="flex items-center gap-2">
                    <input
                      className="w-[320px] rounded-md border px-3 py-1.5 text-sm"
                      placeholder="Поиск (оборудование, отрасль, цех, текст...)"
                      value={csQuery}
                      onChange={(e) => {
                        setCsPage(1);
                        setCsQuery(e.target.value);
                      }}
                    />
                    <button
                      className="rounded-md border px-3 py-1.5 text-sm"
                      onClick={() => fetchCleanScore(1, csQueryDebounced)}
                      disabled={csLoading}>
                      Обновить
                    </button>
                  </div>

                  {/* Фильтр отрасли */}
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={csIndustryEnabled}
                        onChange={(e) => setCsIndustryEnabled(e.target.checked)}
                      />
                      Фильтр по отрасли
                    </label>
                    <select
                      className="rounded-md border px-2 py-1.5 text-sm min-w-[220px]"
                      disabled={!csIndustryEnabled}
                      value={csIndustryId ?? ''}
                      onChange={(e) =>
                        setCsIndustryId(e.target.value ? Number(e.target.value) : null)
                      }>
                      <option value="">— Все отрасли —</option>
                      {industriesState.items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.industry}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Диапазон CS */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">CS от</span>
                    <select
                      className="rounded-md border px-2 py-1.5 text-sm"
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
                    <span className="text-sm text-muted-foreground">до</span>
                    <select
                      className="rounded-md border px-2 py-1.5 text-sm"
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
                  <table className="w-full text-xs table-fixed">
                    <thead
                      className="
                        sticky top-0 z-10 text-left border-b
                        [&>tr>th]:px-2 [&>tr>th]:py-2
                        [&>tr>th]:bg-sky-50
                      ">
                      <tr>
                        <th style={{ width: colW.card }} />
                        <th style={{ width: colW.industry }}>Отрасль</th>
                        <th style={{ width: colW.prodclass }}>Класс</th>
                        <th style={{ width: colW.workshop }}>Цех</th>
                        <th style={{ width: colW.equipment }}>Оборудование</th>
                        <th style={{ width: colW.cs }}>CS</th>
                        <th style={{ width: colW.contamination }}>Загрязнения</th>
                        <th style={{ width: colW.surface }}>Поверхности</th>
                        <th style={{ width: colW.problems }}>Проблемы</th>
                        <th style={{ width: colW.old_method }}>Традиционная очистка</th>
                        <th style={{ width: colW.old_problem }}>Недостатки традиц.</th>
                        <th style={{ width: colW.benefit }}>Преимущества</th>
                      </tr>
                    </thead>

                    <tbody
                      className="
                        [&>tr>td]:px-2 [&>tr>td]:py-1.5 align-top
                        [&>tr]:border-b
                        [&>tr>td:nth-child(12)]:bg-sky-100
                      ">
                      {csRows.map((r) => (
                        <tr key={r.equipment_id} className="align-top">
                          <td style={{ width: colW.card }}>
                            <a
                              href={toLibraryLink(r)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center rounded-md border p-1 hover:bg-accent"
                              title="Открыть карточку в каталоге"
                              aria-label="Открыть карточку в каталоге">
                              <ArrowUpRight className="h-4 w-4" />
                            </a>
                          </td>
                          <td
                            className="whitespace-normal break-words leading-4"
                            style={{ width: colW.industry }}>
                            {r.industry}
                          </td>
                          <td
                            className="whitespace-normal break-words leading-4"
                            style={{ width: colW.prodclass }}>
                            {r.prodclass}
                          </td>
                          <td
                            className="whitespace-normal break-words leading-4"
                            style={{ width: colW.workshop }}>
                            {r.workshop_name}
                          </td>
                          <td
                            className="whitespace-normal break-words leading-4 font-medium"
                            style={{ width: colW.equipment }}>
                            {r.equipment_name}
                          </td>
                          <td className="whitespace-nowrap tabular-nums" style={{ width: colW.cs }}>
                            {r.clean_score != null ? r.clean_score.toFixed(2) : '—'}
                          </td>
                          <td
                            className="whitespace-normal break-words leading-4"
                            style={{ width: colW.contamination }}>
                            {r.contamination}
                          </td>
                          <td
                            className="whitespace-normal break-words leading-4"
                            style={{ width: colW.surface }}>
                            {r.surface}
                          </td>
                          <td
                            className="whitespace-normal break-words leading-4"
                            style={{ width: colW.problems }}>
                            {r.problems}
                          </td>
                          <td
                            className="whitespace-normal break-words leading-4"
                            style={{ width: colW.old_method }}>
                            {r.old_method}
                          </td>
                          <td
                            className="whitespace-normal break-words leading-4"
                            style={{ width: colW.old_problem }}>
                            {r.old_problem}
                          </td>
                          <td
                            className="whitespace-normal break-words leading-4"
                            style={{ width: colW.benefit }}>
                            {r.benefit}
                          </td>
                        </tr>
                      ))}
                      {csRows.length === 0 && !csLoading && (
                        <tr>
                          <td
                            colSpan={12}
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
                      className="rounded-md border px-3 py-1.5 text-sm"
                      onClick={() => fetchCleanScore(csPage + 1, csQueryDebounced, true)}
                      disabled={csLoading}>
                      Загрузить ещё
                    </button>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

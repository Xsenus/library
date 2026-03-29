'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import type { HistoryRow, Industry, ListResponse } from '@/lib/validators';
import { cn } from '@/lib/utils';
import SquareImgButton from '@/components/library/square-img-button';

type HistoryTabProps = {
  isAdmin: boolean;
};

const colW = {
  viewedAt: 110,
  card: 35,
  check: 35,
  cs: 35,
} as const;

function formatViewedAt(value: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return { date: '—', time: '' };
  }
  return {
    date: dt.toLocaleDateString('ru-RU'),
    time: dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  };
}

export default function HistoryTab({ isAdmin }: HistoryTabProps) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(true);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [total, setTotal] = useState(0);
  const [rowSaving, setRowSaving] = useState<Record<number, boolean>>({});

  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industriesLoading, setIndustriesLoading] = useState(false);
  const [industryEnabled, setIndustryEnabled] = useState(false);
  const [industryId, setIndustryId] = useState<number | null>(null);

  const visibleColCount = 8;
  const trimmedQuery = useDebounce(query.trim(), 300);

  const loadIndustries = useCallback(async () => {
    try {
      setIndustriesLoading(true);
      const collected: Industry[] = [];
      let nextPage = 1;
      let totalPages = 1;

      do {
        const params = new URLSearchParams({
          page: String(nextPage),
          pageSize: '100',
          ts: String(Date.now()),
        });

        const res = await fetch(`/api/industries?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data: Partial<ListResponse<Industry>> = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        collected.push(...items);
        totalPages = typeof data?.totalPages === 'number' ? data.totalPages : 1;
        nextPage += 1;
      } while (nextPage <= totalPages);

      setIndustries(collected);
    } catch (error) {
      console.error('Failed to load industries for history:', error);
      setIndustries([]);
    } finally {
      setIndustriesLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(
    async (nextPage: number, nextQuery: string, append = false) => {
      try {
        setLoading(true);
        const params = new URLSearchParams({
          page: String(nextPage),
          pageSize: '30',
          query: nextQuery,
          ts: String(Date.now()),
        });

        if (industryEnabled && industryId) {
          params.set('industryId', String(industryId));
        }

        const res = await fetch(`/api/history?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) {
          if (!append) setRows([]);
          setHasNext(false);
          setTotal(0);
          return;
        }

        const data: Partial<ListResponse<HistoryRow>> = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        const totalPages = typeof data?.totalPages === 'number' ? data.totalPages : 1;
        const totalItems = typeof data?.total === 'number' ? data.total : items.length;

        setRows((prev) => (append ? [...prev, ...items] : items));
        setHasNext(nextPage < totalPages);
        setPage(nextPage);
        setTotal(totalItems);
      } catch (error) {
        console.error('Failed to fetch history:', error);
        if (!append) setRows([]);
        setHasNext(false);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [industryEnabled, industryId],
  );

  useEffect(() => {
    loadIndustries();
  }, [loadIndustries]);

  useEffect(() => {
    fetchHistory(1, trimmedQuery);
  }, [fetchHistory, trimmedQuery]);

  const toLibraryLink = (row: HistoryRow) => {
    const qp = new URLSearchParams();
    if (row.industry_id) qp.set('industryId', String(row.industry_id));
    if (row.prodclass_id) qp.set('prodclassId', String(row.prodclass_id));
    if (row.workshop_id) qp.set('workshopId', String(row.workshop_id));
    if (row.equipment_id) qp.set('equipmentId', String(row.equipment_id));
    return `/library?${qp.toString()}`;
  };

  const applyLocalConfirmChange = useCallback((equipmentId: number, confirmed: boolean) => {
    const value = confirmed ? 1 : 0;
    setRows((prev) =>
      prev.map((row) =>
        row.equipment_id === equipmentId ? { ...row, equipment_score_real: value } : row,
      ),
    );
  }, []);

  const toggleRowConfirm = useCallback(
    async (row: HistoryRow) => {
      if (!isAdmin || !row?.equipment_id) return;
      const id = row.equipment_id;
      const current = !!Number(row.equipment_score_real || 0);
      const want = !current;

      setRowSaving((prev) => ({ ...prev, [id]: true }));
      applyLocalConfirmChange(id, want);

      try {
        const res = await fetch(`/api/equipment/${id}/es-confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ confirmed: want }),
        });
        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          throw new Error(error?.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        applyLocalConfirmChange(id, !!Number(data?.equipment_score_real));
      } catch (error) {
        console.error('Failed to toggle ES confirm (history):', error);
        applyLocalConfirmChange(id, current);
      } finally {
        setRowSaving((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [applyLocalConfirmChange, isAdmin],
  );

  return (
    <div className="py-4 space-y-4">
      <div className="flex flex-nowrap items-center gap-2 md:gap-3 overflow-x-auto min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <input
            className="h-9 w-[320px] rounded-md border px-3 text-sm"
            placeholder="Поиск (оборудование, отрасль, цех, класс...)"
            value={query}
            onChange={(event) => {
              setPage(1);
              setQuery(event.target.value);
            }}
          />
          <button
            className="h-9 rounded-md border px-3 text-sm"
            onClick={() => fetchHistory(1, query.trim())}
            disabled={loading}>
            Обновить
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={industryEnabled}
              onChange={(event) => setIndustryEnabled(event.target.checked)}
            />
            Отрасли
          </label>
          <div className="max-w-[260px]">
            <select
              className="h-9 w-full rounded-md border px-2 text-sm overflow-hidden text-ellipsis whitespace-nowrap"
              disabled={!industryEnabled || industriesLoading}
              value={industryId ?? ''}
              onChange={(event) => setIndustryId(event.target.value ? Number(event.target.value) : null)}
              title={
                industryEnabled
                  ? industries.find((item) => item.id === industryId)?.industry
                  : '— Все отрасли —'
              }>
              <option value="">— Все отрасли —</option>
              {industries.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.industry}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="shrink-0 text-sm text-muted-foreground">
          Просмотров в истории: <span className="font-medium text-foreground">{total}</span>
        </div>
      </div>

      <div className="rounded-lg border overflow-auto">
        <table className="w-full table-fixed text-xs">
          <thead
            className="
              sticky top-0 z-10 text-left border-b
              [&>tr>th]:px-2 [&>tr>th]:py-2
              [&>tr>th]:bg-sky-50
            ">
            <tr>
              <th style={{ width: colW.viewedAt }} className="text-left">
                Дата просмотра
              </th>
              <th style={{ width: colW.card }} className="text-center" />
              <th
                style={{ width: colW.check }}
                className="w-[1%] text-center whitespace-nowrap">
                Чек
              </th>
              <th className="text-left">Отрасль</th>
              <th className="text-left">Класс</th>
              <th className="text-left">Цех</th>
              <th className="text-left">Оборудование</th>
              <th style={{ width: colW.cs }}>CS</th>
            </tr>
          </thead>

          <tbody
            className="
              [&>tr>td]:px-2 [&>tr>td]:py-1.5 align-top
              [&>tr]:border-b
            ">
            {rows.map((row) => {
              const viewedAt = formatViewedAt(row.open_at);
              const confirmed = !!Number(row.equipment_score_real || 0);

              return (
                <tr
                  key={`${row.equipment_id}-${row.open_at}`}
                  className={cn('align-top', confirmed && 'bg-blue-50 dark:bg-blue-900/10')}>
                  <td className="whitespace-nowrap leading-4">
                    <div>{viewedAt.date}</div>
                    {viewedAt.time ? (
                      <div className="text-muted-foreground">{viewedAt.time}</div>
                    ) : null}
                  </td>

                  <td style={{ width: colW.card }} className="text-center align-top">
                    <SquareImgButton
                      icon="catalog"
                      title="Открыть карточку в каталоге"
                      onClick={() => window.open(toLibraryLink(row), '_blank', 'noopener')}
                      className="mx-auto my-[2px]"
                      sizeClassName="h-7 w-7"
                    />
                  </td>

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
                        checked={confirmed}
                        onChange={() => toggleRowConfirm(row)}
                        disabled={!isAdmin || !!rowSaving[row.equipment_id]}
                        aria-label="Подтверждено ИРБИСТЕХ"
                      />
                    </label>
                  </td>

                  <td className="whitespace-normal break-words leading-4">{row.industry ?? '—'}</td>
                  <td className="whitespace-normal break-words leading-4">
                    {row.prodclass ?? '—'}
                  </td>
                  <td className="whitespace-normal break-words leading-4">
                    {row.workshop_name ?? '—'}
                  </td>
                  <td className="whitespace-normal break-words leading-4 font-medium">
                    {row.equipment_name}
                  </td>
                  <td className="whitespace-nowrap tabular-nums" style={{ width: colW.cs }}>
                    {row.clean_score != null ? row.clean_score.toFixed(2) : '—'}
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={visibleColCount} className="py-6 text-center text-sm text-muted-foreground">
                  История просмотров пока пуста
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex justify-center">
        {hasNext ? (
          <button
            className="h-9 rounded-md border px-3 text-sm"
            onClick={() => fetchHistory(page + 1, trimmedQuery, true)}
            disabled={loading}>
            Загрузить ещё
          </button>
        ) : null}
      </div>
    </div>
  );
}

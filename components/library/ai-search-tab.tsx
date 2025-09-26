'use client';

import { useCallback, useState } from 'react';
import SquareImgButton from './square-img-button';

type GoodRow = {
  id: number;
  name: string;
  target_equipment_id?: number | null;
  target_industry_id?: number | null;
  target_industry?: string | null;
  target_prodclass_id?: number | null;
  target_prodclass?: string | null;
  target_workshop_id?: number | null;
  target_workshop_name?: string | null;
  target_cs?: number | null;
};
type EquipRow = {
  id: number;
  equipment_name: string;
  industry_id: number;
  industry: string;
  prodclass_id: number;
  prodclass: string;
  workshop_id: number;
  workshop_name: string;
  cs?: number | null;
};
type ProdclassRow = {
  id: number;
  prodclass: string;
  industry_id: number;
  industry: string;
  cs?: number | null;
};

type AiResponse = {
  goods: GoodRow[];
  equipment: EquipRow[];
  prodclasses: ProdclassRow[];
};

function toLibraryLink(
  ids: Partial<{
    industry_id: number;
    prodclass_id: number;
    workshop_id: number;
    equipment_id: number;
  }>,
) {
  const qp = new URLSearchParams();
  qp.set('tab', 'library');
  if (ids.industry_id) qp.set('industryId', String(ids.industry_id));
  if (ids.prodclass_id) qp.set('prodclassId', String(ids.prodclass_id));
  if (ids.workshop_id) qp.set('workshopId', String(ids.workshop_id));
  if (ids.equipment_id) qp.set('equipmentId', String(ids.equipment_id));
  return `/library?${qp.toString()}`;
}
function toLibraryLinkByGoods(goodsId: number) {
  const qp = new URLSearchParams();
  qp.set('tab', 'library');
  qp.set('goodsId', String(goodsId));
  return `/library?${qp.toString()}`;
}
function toLibraryLinkFromGood(g: GoodRow) {
  if (
    g.target_industry_id &&
    g.target_prodclass_id &&
    g.target_workshop_id &&
    g.target_equipment_id
  ) {
    return toLibraryLink({
      industry_id: g.target_industry_id,
      prodclass_id: g.target_prodclass_id,
      workshop_id: g.target_workshop_id,
      equipment_id: g.target_equipment_id,
    });
  }
  return toLibraryLinkByGoods(g.id);
}

function csColor(score: number) {
  if (!Number.isFinite(score)) return 'text-muted-foreground';
  if (score < 0.8) return 'text-muted-foreground';
  if (score < 0.86) return 'text-zinc-500';
  if (score < 0.9) return 'text-emerald-500';
  if (score < 0.95) return 'text-emerald-600';
  return 'text-emerald-700';
}

export default function AiSearchTab() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  const [goods, setGoods] = useState<GoodRow[]>([]);
  const [equipment, setEquipment] = useState<EquipRow[]>([]);
  const [prodclasses, setProdclasses] = useState<ProdclassRow[]>([]);

  const hasAny = goods.length || equipment.length || prodclasses.length;

  const runSearch = useCallback(async () => {
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    setGoods([]);
    setEquipment([]);
    setProdclasses([]);
    try {
      const res = await fetch('/api/ai-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ q: query }),
      });
      const data: Partial<AiResponse> = await res.json();
      setGoods(Array.isArray(data.goods) ? data.goods : []);
      setEquipment(Array.isArray(data.equipment) ? data.equipment : []);
      setProdclasses(Array.isArray(data.prodclasses) ? data.prodclasses : []);
    } catch (e) {
      console.error('AI search failed:', e);
      setGoods([]);
      setEquipment([]);
      setProdclasses([]);
    } finally {
      setLoading(false);
    }
  }, [q]);

  const Column: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="rounded-xl border shadow-sm bg-card overflow-hidden flex flex-col">
      <div className="px-3 py-2 border-b bg-card text-sm font-semibold">{title}</div>
      <div className="p-2 flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 rounded-md border bg-background overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );

  return (
    <div className="py-4 space-y-4">
      {/* Верхняя панель */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Введите поисковую фразу:</span>
        <input
          className="h-9 w-[360px] max-w-[90vw] rounded-md border px-3 text-sm"
          placeholder="Напр.: мойка, пескоструй, пищевое производство…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
        />
        <button
          className="h-9 rounded-md border px-3 text-sm"
          onClick={runSearch}
          disabled={loading || !q.trim()}>
          {loading ? 'Идет поиск…' : 'Провести AI-поиск'}
        </button>
      </div>

      <div className="h-[calc(100vh-220px)] grid grid-cols-1 gap-2 lg:grid-cols-3 pb-2">
        {/* Типы продукции */}
        <Column title="Типы продукции">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 border-b bg-sky-50">
              <tr>
                <th className="px-2 py-2 text-left">Наименование</th>
                <th className="px-2 py-2 w-[1%] text-center" />
              </tr>
            </thead>
            <tbody className="[&>tr>td]:px-2 [&>tr>td]:py-1.5">
              {goods.map((g) => (
                <tr key={g.id} className="border-b">
                  <td className="whitespace-normal break-words leading-5">
                    <span className="font-medium">{g.name}</span>
                    {typeof g.target_cs === 'number' && (
                      <span
                        className={`ml-1 font-extrabold tabular-nums ${csColor(g.target_cs)}`}
                        title="Clean Score (оборудование по ссылке)">
                        {g.target_cs.toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="text-center">
                    <SquareImgButton
                      icon="catalog"
                      title="Открыть каталог"
                      href={toLibraryLinkFromGood(g)}
                    />
                  </td>
                </tr>
              ))}
              {!goods.length && (
                <tr>
                  <td colSpan={2} className="text-center py-6 text-muted-foreground">
                    {hasAny ? 'Нет результатов в разделе' : 'Пока пусто'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Column>

        {/* Оборудования */}
        <Column title="Оборудования">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 border-b bg-sky-50">
              <tr>
                <th className="px-2 py-2">Отрасль</th>
                <th className="px-2 py-2">Наименование</th>
                <th className="px-2 py-2 w-[1%] text-center" />
              </tr>
            </thead>
            <tbody className="[&>tr>td]:px-2 [&>tr>td]:py-1.5">
              {equipment.map((r) => (
                <tr key={r.id} className="border-b align-top">
                  <td className="whitespace-normal break-words leading-5">{r.industry || '—'}</td>
                  <td className="whitespace-normal break-words leading-5">
                    <div className="font-medium">
                      {r.equipment_name}
                      {typeof r.cs === 'number' && (
                        <span
                          className={`ml-1 font-extrabold tabular-nums ${csColor(r.cs)}`}
                          title="Clean Score">
                          {r.cs.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground">
                      {r.prodclass} / {r.workshop_name}
                    </div>
                  </td>
                  <td className="text-center">
                    <SquareImgButton
                      icon="catalog"
                      title="Открыть карточку в каталоге"
                      href={toLibraryLink({
                        industry_id: r.industry_id,
                        prodclass_id: r.prodclass_id,
                        workshop_id: r.workshop_id,
                        equipment_id: r.id,
                      })}
                    />
                  </td>
                </tr>
              ))}
              {!equipment.length && (
                <tr>
                  <td colSpan={3} className="text-center py-6 text-muted-foreground">
                    {hasAny ? 'Нет результатов в разделе' : 'Пока пусто'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Column>

        {/* Классы предприятий */}
        <Column title="Классы предприятий">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 border-b bg-sky-50">
              <tr>
                <th className="px-2 py-2">Отрасль</th>
                <th className="px-2 py-2">Наименование класса</th>
                <th className="px-2 py-2 w-[1%] text-center" />
              </tr>
            </thead>
            <tbody className="[&>tr>td]:px-2 [&>tr>td]:py-1.5">
              {prodclasses.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="whitespace-normal break-words leading-5">{r.industry || '—'}</td>
                  <td className="whitespace-normal break-words leading-5">
                    <span className="font-medium">{r.prodclass}</span>
                    {typeof r.cs === 'number' && (
                      <span
                        className={`ml-1 font-extrabold tabular-nums ${csColor(r.cs)}`}
                        title="Clean Score (best)">
                        {r.cs.toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="text-center">
                    <SquareImgButton
                      icon="catalog"
                      title="Открыть класс в каталоге"
                      href={toLibraryLink({ industry_id: r.industry_id, prodclass_id: r.id })}
                    />
                  </td>
                </tr>
              ))}
              {!prodclasses.length && (
                <tr>
                  <td colSpan={3} className="text-center py-6 text-muted-foreground">
                    {hasAny ? 'Нет результатов в разделе' : 'Пока пусто'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Column>
      </div>
    </div>
  );
}

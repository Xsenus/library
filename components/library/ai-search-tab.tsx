'use client';

import { useCallback, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';

type GoodRow = { id: number; name: string };
type EquipRow = {
  id: number;
  equipment_name: string;
  industry_id: number;
  industry: string;
  prodclass_id: number;
  prodclass: string;
  workshop_id: number;
  workshop_name: string;
};
type ProdclassRow = {
  id: number;
  prodclass: string;
  industry_id: number;
  industry: string;
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

export default function AiSearchTab() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  const [goods, setGoods] = useState<GoodRow[]>([]);
  const [equipment, setEquipment] = useState<EquipRow[]>([]);
  const [prodclasses, setProdclasses] = useState<ProdclassRow[]>([]);

  const hasAny = goods.length || equipment.length || prodclasses.length;

  const runSearch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ q }),
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

  return (
    <div className="min-h-[100vh] flex flex-col py-4 space-y-4">
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

      {/* Три колонки */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-3 flex-1 items-stretch pb-6">
        {/* Колонка 1: Типы продукции */}
        <div className="rounded-xl border shadow-sm bg-card overflow-hidden flex flex-col max-h-[78vh]">
          <div className="px-3 py-2 border-b bg-card text-sm font-semibold">Типы продукции</div>

          <div className="p-2 flex-1 flex flex-col">
            <div className="flex-1 overflow-auto rounded-md border bg-background">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 border-b bg-sky-50">
                  <tr>
                    <th className="px-2 py-2 text-left">Наименование</th>
                    <th className="px-2 py-2 w-[1%] text-center"></th>
                  </tr>
                </thead>
                <tbody className="[&>tr>td]:px-2 [&>tr>td]:py-1.5">
                  {goods.map((g) => (
                    <tr key={g.id} className="border-b">
                      <td className="whitespace-normal break-words leading-5">{g.name}</td>
                      <td className="text-center">{/* ссылка убрана */}</td>
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
            </div>
          </div>
        </div>

        {/* Колонка 2: Оборудования */}
        <div className="rounded-xl border shadow-sm bg-card overflow-hidden flex flex-col max-h-[78vh]">
          <div className="px-3 py-2 border-b bg-card text-sm font-semibold">Оборудования</div>

          <div className="p-2 flex-1 flex flex-col">
            <div className="flex-1 overflow-auto rounded-md border bg-background">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 border-b bg-sky-50">
                  <tr>
                    <th className="px-2 py-2">Отрасль</th>
                    <th className="px-2 py-2">Наименование</th>
                    <th className="px-2 py-2 w-[1%] text-center"></th>
                  </tr>
                </thead>
                <tbody className="[&>tr>td]:px-2 [&>tr>td]:py-1.5">
                  {equipment.map((r) => (
                    <tr key={r.id} className="border-b align-top">
                      <td className="whitespace-normal break-words leading-5">
                        {r.industry || '—'}
                      </td>
                      <td className="whitespace-normal break-words leading-5">
                        <div className="font-medium">{r.equipment_name}</div>
                        <div className="text-muted-foreground">
                          {r.prodclass} / {r.workshop_name}
                        </div>
                      </td>
                      <td className="text-center">
                        <a
                          href={toLibraryLink({
                            industry_id: r.industry_id,
                            prodclass_id: r.prodclass_id,
                            workshop_id: r.workshop_id,
                            equipment_id: r.id,
                          })}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-md border p-1 hover:bg-accent"
                          title="Открыть карточку в каталоге">
                          <ArrowUpRight className="h-4 w-4" />
                        </a>
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
            </div>
          </div>
        </div>

        {/* Колонка 3: Классы предприятий */}
        <div className="rounded-xl border shadow-sm bg-card overflow-hidden flex flex-col max-h-[78vh]">
          <div className="px-3 py-2 border-b bg-card text-sm font-semibold">Классы предприятий</div>

          <div className="p-2 flex-1 flex flex-col">
            <div className="flex-1 overflow-auto rounded-md border bg-background">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 border-b bg-sky-50">
                  <tr>
                    <th className="px-2 py-2">Отрасль</th>
                    <th className="px-2 py-2">Наименование класса</th>
                    <th className="px-2 py-2 w-[1%] text-center"></th>
                  </tr>
                </thead>
                <tbody className="[&>tr>td]:px-2 [&>tr>td]:py-1.5">
                  {prodclasses.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="whitespace-normal break-words leading-5">
                        {r.industry || '—'}
                      </td>
                      <td className="whitespace-normal break-words leading-5">{r.prodclass}</td>
                      <td className="text-center">
                        <a
                          href={toLibraryLink({
                            industry_id: r.industry_id,
                            prodclass_id: r.id,
                          })}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center rounded-md border p-1 hover:bg-accent"
                          title="Открыть класс в каталоге">
                          <ArrowUpRight className="h-4 w-4" />
                        </a>
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

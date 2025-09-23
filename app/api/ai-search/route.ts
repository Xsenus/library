import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const BASE = process.env.AI_SEARCH_BASE ?? 'http://37.221.125.221:8090/';

type AnyRow = Record<string, any>;
type AiRawResponse = {
  goods?: AnyRow[];
  equipment?: AnyRow[];
  prodclasses?: AnyRow[];
  data?: {
    goods?: AnyRow[];
    equipment?: AnyRow[];
    prodclasses?: AnyRow[];
  };
};

function normGoods(rows: AnyRow[] | undefined) {
  return (rows ?? [])
    .map((r) => ({
      id: Number(r.id ?? r.goods_id ?? r.gid ?? 0),
      name: String(r.name ?? r.goods_type_name ?? r.title ?? r.label ?? '') || 'Без названия',
    }))
    .filter((x) => x.id > 0);
}

function normEquipment(rows: AnyRow[] | undefined) {
  return (rows ?? [])
    .map((r) => ({
      id: Number(r.id ?? r.equipment_id ?? r.eid ?? 0),
      equipment_name: String(r.equipment_name ?? r.name ?? r.title ?? '').trim() || 'Оборудование',
      industry_id: Number(r.industry_id ?? r.iid ?? 0),
      industry: String(r.industry ?? r.industry_name ?? '') || '',
      prodclass_id: Number(r.prodclass_id ?? r.pc_id ?? 0),
      prodclass: String(r.prodclass ?? r.prodclass_name ?? '') || '',
      workshop_id: Number(r.workshop_id ?? r.wid ?? 0),
      workshop_name: String(r.workshop_name ?? r.workshop ?? '') || '',
    }))
    .filter((x) => x.id > 0);
}

function normProdclasses(rows: AnyRow[] | undefined) {
  return (rows ?? [])
    .map((r) => ({
      id: Number(r.id ?? r.prodclass_id ?? r.pcid ?? 0),
      prodclass: String(r.prodclass ?? r.name ?? r.title ?? '') || 'Класс',
      industry_id: Number(r.industry_id ?? r.iid ?? 0),
      industry: String(r.industry ?? r.industry_name ?? '') || '',
    }))
    .filter((x) => x.id > 0);
}

/* ---------- DB: безопасные ILIKE-запросы ---------- */
const Q_GOODS = `
SELECT
  g.id::int               AS id,
  g.goods_type_name::text AS name
FROM ib_goods_types AS g
WHERE g.goods_type_name ILIKE '%' || $1 || '%'
ORDER BY length(g.goods_type_name) ASC, g.id
LIMIT 20;
`;

const Q_EQUIPMENT = `
SELECT
  e.id::int              AS id,
  e.equipment_name::text AS equipment_name,
  i.id::int              AS industry_id,
  i.industry::text       AS industry,
  pc.id::int             AS prodclass_id,
  pc.prodclass::text     AS prodclass,
  w.id::int              AS workshop_id,
  w.workshop_name::text  AS workshop_name
FROM ib_equipment AS e
LEFT JOIN ib_workshops AS w ON w.id = e.workshop_id
LEFT JOIN ib_prodclass AS pc ON pc.id = w.prodclass_id
LEFT JOIN ib_industry  AS i  ON i.id  = pc.industry_id
WHERE
  e.equipment_name ILIKE '%' || $1 || '%'
  OR pc.prodclass   ILIKE '%' || $1 || '%'
  OR w.workshop_name ILIKE '%' || $1 || '%'
  OR i.industry     ILIKE '%' || $1 || '%'
ORDER BY length(e.equipment_name) ASC, e.id
LIMIT 20;
`;

const Q_PRODCLASS = `
SELECT
  pc.id::int         AS id,
  pc.prodclass::text AS prodclass,
  i.id::int          AS industry_id,
  i.industry::text   AS industry
FROM ib_prodclass AS pc
LEFT JOIN ib_industry AS i ON i.id = pc.industry_id
WHERE pc.prodclass ILIKE '%' || $1 || '%'
   OR i.industry  ILIKE '%' || $1 || '%'
ORDER BY length(pc.prodclass) ASC, pc.id
LIMIT 20;
`;

async function queryDb(q: string) {
  const [g, e, p] = await Promise.all([
    db.query(Q_GOODS, [q]).catch(() => ({ rows: [] as AnyRow[] })),
    db.query(Q_EQUIPMENT, [q]).catch(() => ({ rows: [] as AnyRow[] })),
    db.query(Q_PRODCLASS, [q]).catch(() => ({ rows: [] as AnyRow[] })),
  ]);
  return {
    goods: normGoods(g.rows),
    equipment: normEquipment(e.rows),
    prodclasses: normProdclasses(p.rows),
  };
}

function hasAny(data: { goods: any[]; equipment: any[]; prodclasses: any[] }) {
  return (
    (data.goods?.length ?? 0) > 0 ||
    (data.equipment?.length ?? 0) > 0 ||
    (data.prodclasses?.length ?? 0) > 0
  );
}

async function callUpstream(q: string, signal: AbortSignal) {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q }),
    signal,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Upstream ${r.status}: ${txt.slice(0, 300)}`);
  }
  const raw: AiRawResponse = await r.json();
  const payload = raw?.data ?? raw ?? {};
  return {
    goods: normGoods(payload.goods),
    equipment: normEquipment(payload.equipment),
    prodclasses: normProdclasses(payload.prodclasses),
  };
}

export async function POST(req: NextRequest) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);

  try {
    const { q } = await req.json().catch(() => ({}));
    const query = String(q ?? '').trim();
    if (!query) return NextResponse.json({ goods: [], equipment: [], prodclasses: [] });

    // 1) Первая выборка из БД
    const firstDb = await queryDb(query);

    // 2) Всегда дергаем внешний сервис
    try {
      const ai = await callUpstream(query, ctrl.signal);

      // 3) Сразу после ответа — повторная выборка из БД (API мог обновить таблицы)
      const secondDb = await queryDb(query);

      if (hasAny(secondDb)) {
        return NextResponse.json(secondDb);
      }
      // Если БД всё ещё пуста — вернём нормализованный ответ AI как резерв
      if (!hasAny(firstDb) && hasAny(ai)) {
        return NextResponse.json(ai);
      }

      // Иначе отдадим первый снимок БД (он уже был не пуст/или пуст одинаково)
      return NextResponse.json(firstDb);
    } catch {
      // API не ответил — отдаем первую БД
      return NextResponse.json(firstDb);
    }
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return NextResponse.json(
      { error: aborted ? 'Timeout while calling upstream' : String(err?.message ?? err) },
      { status: 504 },
    );
  } finally {
    clearTimeout(t);
  }
}

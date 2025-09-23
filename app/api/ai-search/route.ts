import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const BASE = process.env.AI_SEARCH_BASE ?? 'http://37.221.125.221:8123/ai-search';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const OPENAI_EMBED_MODEL = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-large';
const AI_TIMEOUT_MS = 15000;

type AnyRow = Record<string, any>;
type Payload = {
  goods: { id: number; name: string }[];
  equipment: {
    id: number;
    equipment_name: string;
    industry_id: number;
    industry: string;
    prodclass_id: number;
    prodclass: string;
    workshop_id: number;
    workshop_name: string;
  }[];
  prodclasses: { id: number; prodclass: string; industry_id: number; industry: string }[];
};

function uniqById<T extends { id: number }>(rows: T[]): T[] {
  const seen: Record<number, true> = Object.create(null);
  const out: T[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const id = (r?.id as number) | 0;
    if (id > 0 && !seen[id]) {
      seen[id] = true;
      out.push(r);
    }
  }
  return out;
}

function hasAny(p: Payload) {
  return (p.goods?.length ?? 0) + (p.equipment?.length ?? 0) + (p.prodclasses?.length ?? 0) > 0;
}
function normGoods(rows: AnyRow[]) {
  return (rows ?? [])
    .map((r) => ({
      id: Number(r.id ?? r.goods_id ?? 0),
      name: String(r.name ?? r.goods_type_name ?? r.title ?? ''),
    }))
    .filter((x) => x.id > 0);
}
function normEquipment(rows: AnyRow[]) {
  return (rows ?? [])
    .map((r) => ({
      id: Number(r.id ?? r.equipment_id ?? 0),
      equipment_name: String(r.equipment_name ?? r.name ?? ''),
      industry_id: Number(r.industry_id ?? 0),
      industry: String(r.industry ?? r.industry_name ?? ''),
      prodclass_id: Number(r.prodclass_id ?? 0),
      prodclass: String(r.prodclass ?? r.prodclass_name ?? ''),
      workshop_id: Number(r.workshop_id ?? 0),
      workshop_name: String(r.workshop_name ?? r.workshop ?? ''),
    }))
    .filter((x) => x.id > 0);
}
function normProdclasses(rows: AnyRow[]) {
  return (rows ?? [])
    .map((r) => ({
      id: Number(r.id ?? r.prodclass_id ?? 0),
      prodclass: String(r.prodclass ?? r.name ?? ''),
      industry_id: Number(r.industry_id ?? 0),
      industry: String(r.industry ?? r.industry_name ?? ''),
    }))
    .filter((x) => x.id > 0);
}
function pack(g: AnyRow[], e: AnyRow[], p: AnyRow[]): Payload {
  return {
    goods: uniqById(normGoods(g)),
    equipment: uniqById(normEquipment(e)),
    prodclasses: uniqById(normProdclasses(p)),
  };
}

/* ---------- SQL: быстрый локальный поиск (без эмбеддинга) ---------- */
const QF1_GOODS = `
SELECT g.id::int AS id, g.goods_type_name::text AS name
FROM ib_goods_types g
WHERE g.goods_type_name ILIKE '%' || $1 || '%'
ORDER BY length(g.goods_type_name) ASC, g.id
LIMIT 20;
`;
const QF1_EQUIPMENT = `
SELECT
  e.id::int              AS id,
  e.equipment_name::text AS equipment_name,
  i.id::int              AS industry_id,
  i.industry::text       AS industry,
  pc.id::int             AS prodclass_id,
  pc.prodclass::text     AS prodclass,
  w.id::int              AS workshop_id,
  w.workshop_name::text  AS workshop_name
FROM ib_equipment e
LEFT JOIN ib_workshops w ON w.id = e.workshop_id
LEFT JOIN ib_prodclass pc ON pc.id = w.prodclass_id
LEFT JOIN ib_industry  i  ON i.id  = pc.industry_id
WHERE e.equipment_name ILIKE '%' || $1 || '%'
   OR pc.prodclass     ILIKE '%' || $1 || '%'
   OR w.workshop_name  ILIKE '%' || $1 || '%'
   OR i.industry       ILIKE '%' || $1 || '%'
ORDER BY length(e.equipment_name) ASC, e.id
LIMIT 20;
`;
const QF1_PRODCLASS = `
SELECT
  pc.id::int         AS id,
  pc.prodclass::text AS prodclass,
  i.id::int          AS industry_id,
  i.industry::text   AS industry
FROM ib_prodclass pc
LEFT JOIN ib_industry i ON i.id = pc.industry_id
WHERE pc.prodclass ILIKE '%' || $1 || '%'
   OR i.industry  ILIKE '%' || $1 || '%'
ORDER BY length(pc.prodclass) ASC, pc.id
LIMIT 20;
`;

/* ---------- SQL: kNN по pgvector ---------- */
const QV_GOODS = `
SELECT g.id::int AS id, g.goods_type_name::text AS name
FROM ib_goods_types g
ORDER BY g.goods_type_vector <=> $1::vector
LIMIT 20;
`;
const QV_EQUIPMENT = `
SELECT
  e.id::int              AS id,
  e.equipment_name::text AS equipment_name,
  i.id::int              AS industry_id,
  i.industry::text       AS industry,
  pc.id::int             AS prodclass_id,
  pc.prodclass::text     AS prodclass,
  w.id::int              AS workshop_id,
  w.workshop_name::text  AS workshop_name
FROM ib_equipment e
LEFT JOIN ib_workshops w ON w.id = e.workshop_id
LEFT JOIN ib_prodclass pc ON pc.id = w.prodclass_id
LEFT JOIN ib_industry  i  ON i.id  = pc.industry_id
ORDER BY e.equipment_vector <=> $1::vector
LIMIT 20;
`;
const QV_PRODCLASS = `
SELECT
  pc.id::int         AS id,
  pc.prodclass::text AS prodclass,
  i.id::int          AS industry_id,
  i.industry::text   AS industry
FROM ib_prodclass pc
LEFT JOIN ib_industry i ON i.id = pc.industry_id
ORDER BY pc.prodclass_vector <=> $1::vector
LIMIT 20;
`;

/* ---------- SQL: выборка по ID (если сервис вернул списки id) ---------- */
const Q_BY_GOODS_IDS = `
SELECT g.id::int AS id, g.goods_type_name::text AS name
FROM ib_goods_types g
WHERE g.id = ANY($1::int[])
LIMIT 50;
`;
const Q_BY_EQUIPMENT_IDS = `
SELECT
  e.id::int AS id,
  e.equipment_name::text AS equipment_name,
  i.id::int AS industry_id, i.industry::text AS industry,
  pc.id::int AS prodclass_id, pc.prodclass::text AS prodclass,
  w.id::int  AS workshop_id, w.workshop_name::text AS workshop_name
FROM ib_equipment e
LEFT JOIN ib_workshops w ON w.id = e.workshop_id
LEFT JOIN ib_prodclass pc ON pc.id = w.prodclass_id
LEFT JOIN ib_industry  i  ON i.id  = pc.industry_id
WHERE e.id = ANY($1::int[])
LIMIT 50;
`;
const Q_BY_PRODCLASS_IDS = `
SELECT pc.id::int AS id, pc.prodclass::text AS prodclass,
       i.id::int AS industry_id, i.industry::text AS industry
FROM ib_prodclass pc
LEFT JOIN ib_industry i ON i.id = pc.industry_id
WHERE pc.id = ANY($1::int[])
LIMIT 50;
`;

/* ---------- helpers ---------- */
async function queryDbFast(q: string): Promise<Payload> {
  const [g, e, p] = await Promise.all([
    db.query(QF1_GOODS, [q]).catch(() => ({ rows: [] as AnyRow[] })),
    db.query(QF1_EQUIPMENT, [q]).catch(() => ({ rows: [] as AnyRow[] })),
    db.query(QF1_PRODCLASS, [q]).catch(() => ({ rows: [] as AnyRow[] })),
  ]);
  return pack(g.rows, e.rows, p.rows);
}

function toVectorLiteral(vec: number[]) {
  return `[${vec.join(',')}]`;
}

async function embedQuery(text: string, signal: AbortSignal): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_EMBED_MODEL, input: text }),
    signal,
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => '');
    throw new Error(`OpenAI ${r.status}: ${msg.slice(0, 300)}`);
  }
  const j = await r.json();
  const arr: number[] = j?.data?.[0]?.embedding;
  if (!Array.isArray(arr) || !arr.length) throw new Error('Bad embedding response');
  return toVectorLiteral(arr);
}

async function queryDbVector(vecLiteral: string): Promise<Payload> {
  const [g, e, p] = await Promise.all([
    db.query(QV_GOODS, [vecLiteral]).catch(() => ({ rows: [] as AnyRow[] })),
    db.query(QV_EQUIPMENT, [vecLiteral]).catch(() => ({ rows: [] as AnyRow[] })),
    db.query(QV_PRODCLASS, [vecLiteral]).catch(() => ({ rows: [] as AnyRow[] })),
  ]);
  return pack(g.rows, e.rows, p.rows);
}

async function queryByIds(ids: {
  goods?: number[];
  equipment?: number[];
  prodclasses?: number[];
}): Promise<Payload> {
  const [g, e, p] = await Promise.all([
    (ids.goods?.length
      ? db.query(Q_BY_GOODS_IDS, [ids.goods])
      : Promise.resolve({ rows: [] as AnyRow[] })
    ).catch(() => ({ rows: [] as AnyRow[] })),
    (ids.equipment?.length
      ? db.query(Q_BY_EQUIPMENT_IDS, [ids.equipment])
      : Promise.resolve({ rows: [] as AnyRow[] })
    ).catch(() => ({ rows: [] as AnyRow[] })),
    (ids.prodclasses?.length
      ? db.query(Q_BY_PRODCLASS_IDS, [ids.prodclasses])
      : Promise.resolve({ rows: [] as AnyRow[] })
    ).catch(() => ({ rows: [] as AnyRow[] })),
  ]);
  return pack(g.rows, e.rows, p.rows);
}

async function callUpstream(q: string, signal: AbortSignal): Promise<Payload> {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q }),
    signal,
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => '');
    throw new Error(`Upstream ${r.status}: ${msg.slice(0, 400)}`);
  }

  const raw = await r.json();

  // 1) Если сервис вернул вектор — делаем kNN
  const vec = raw?.embedding ?? raw?.vector;
  if (Array.isArray(vec) && vec.length) {
    const payload = await queryDbVector(toVectorLiteral(vec));
    return payload;
  }

  // 2) Если вернул ids — добираем из БД
  if (
    raw?.ids &&
    (raw.ids.goods?.length || raw.ids.equipment?.length || raw.ids.prodclasses?.length)
  ) {
    return await queryByIds(raw.ids);
  }

  // 3) Если уже готовые массивы — нормализуем
  const goods = normGoods(raw?.data?.goods ?? raw?.goods ?? []);
  const equipment = normEquipment(raw?.data?.equipment ?? raw?.equipment ?? []);
  const prodclasses = normProdclasses(raw?.data?.prodclasses ?? raw?.prodclasses ?? []);
  return {
    goods: uniqById(goods),
    equipment: uniqById(equipment),
    prodclasses: uniqById(prodclasses),
  };
}

export async function POST(req: NextRequest) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);

  try {
    const { q } = await req.json().catch(() => ({}));
    const query = String(q ?? '').trim();
    if (!query) return NextResponse.json({ goods: [], equipment: [], prodclasses: [] });

    // step 1: быстрый локальный снимок
    const firstDb = await queryDbFast(query);

    // step 2: пробуем свой сервис
    try {
      const aiFromUpstream = await callUpstream(query, ctrl.signal);
      const dedup = {
        goods: uniqById([...(firstDb.goods ?? []), ...(aiFromUpstream.goods ?? [])]),
        equipment: uniqById([...(firstDb.equipment ?? []), ...(aiFromUpstream.equipment ?? [])]),
        prodclasses: uniqById([
          ...(firstDb.prodclasses ?? []),
          ...(aiFromUpstream.prodclasses ?? []),
        ]),
      };
      if (hasAny(dedup)) return NextResponse.json(dedup);
    } catch {
      // пойдём на шаг 3
    }

    // step 3: если свой сервис не помог — сами считаем эмбеддинг и делаем kNN
    try {
      const vec = await embedQuery(query, ctrl.signal);
      const fromVector = await queryDbVector(vec);
      const dedup = {
        goods: uniqById([...(firstDb.goods ?? []), ...(fromVector.goods ?? [])]),
        equipment: uniqById([...(firstDb.equipment ?? []), ...(fromVector.equipment ?? [])]),
        prodclasses: uniqById([...(firstDb.prodclasses ?? []), ...(fromVector.prodclasses ?? [])]),
      };
      return NextResponse.json(dedup);
    } catch {
      // ничего — вернём только первую БД
    }

    return NextResponse.json(firstDb);
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return NextResponse.json(
      { error: aborted ? 'Timeout while processing' : String(err?.message ?? err) },
      { status: 500 },
    );
  } finally {
    clearTimeout(timer);
  }
}

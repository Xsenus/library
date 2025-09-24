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

type Payload = {
  goods: GoodRow[];
  equipment: EquipRow[];
  prodclasses: ProdclassRow[];
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

/* ---------- normalizers ---------- */
function normGoods(rows: AnyRow[]): GoodRow[] {
  return (rows ?? [])
    .map((r) => ({
      id: Number(r.id ?? r.goods_id ?? 0),
      name: String(r.name ?? r.goods_type_name ?? r.title ?? ''),
      target_equipment_id: r.target_equipment_id != null ? Number(r.target_equipment_id) : null,
      target_industry_id: r.target_industry_id != null ? Number(r.target_industry_id) : null,
      target_industry:
        r.target_industry != null
          ? String(r.target_industry)
          : r.industry != null
          ? String(r.industry)
          : null,
      target_prodclass_id: r.target_prodclass_id != null ? Number(r.target_prodclass_id) : null,
      target_prodclass:
        r.target_prodclass != null
          ? String(r.target_prodclass)
          : r.prodclass != null
          ? String(r.prodclass)
          : null,
      target_workshop_id: r.target_workshop_id != null ? Number(r.target_workshop_id) : null,
      target_workshop_name:
        r.target_workshop_name != null
          ? String(r.target_workshop_name)
          : r.workshop_name != null
          ? String(r.workshop_name)
          : null,
      target_cs: r.target_cs == null ? (r.cs == null ? null : Number(r.cs)) : Number(r.target_cs),
    }))
    .filter((x) => x.id > 0);
}

function normEquipment(rows: AnyRow[]): EquipRow[] {
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
      cs: r.cs == null ? (r.clean_score == null ? null : Number(r.clean_score)) : Number(r.cs),
    }))
    .filter((x) => x.id > 0);
}

function normProdclasses(rows: AnyRow[]): ProdclassRow[] {
  return (rows ?? [])
    .map((r) => ({
      id: Number(r.id ?? r.prodclass_id ?? 0),
      prodclass: String(r.prodclass ?? r.name ?? ''),
      industry_id: Number(r.industry_id ?? 0),
      industry: String(r.industry ?? r.industry_name ?? ''),
      cs: r.cs == null ? (r.best_cs == null ? null : Number(r.best_cs)) : Number(r.cs),
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

/* ---------- SQL: быстрый локальный поиск ---------- */
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
  w.workshop_name::text  AS workshop_name,
  e.clean_score::numeric AS cs
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
  pc.id::int          AS id,
  pc.prodclass::text  AS prodclass,
  i.id::int           AS industry_id,
  i.industry::text    AS industry,
  pc.best_cs::numeric AS cs
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
  w.workshop_name::text  AS workshop_name,
  e.clean_score::numeric AS cs
FROM ib_equipment e
LEFT JOIN ib_workshops w ON w.id = e.workshop_id
LEFT JOIN ib_prodclass pc ON pc.id = w.prodclass_id
LEFT JOIN ib_industry  i  ON i.id  = pc.industry_id
ORDER BY e.equipment_vector <=> $1::vector
LIMIT 20;
`;
const QV_PRODCLASS = `
SELECT
  pc.id::int          AS id,
  pc.prodclass::text  AS prodclass,
  i.id::int           AS industry_id,
  i.industry::text    AS industry,
  pc.best_cs::numeric AS cs
FROM ib_prodclass pc
LEFT JOIN ib_industry i ON i.id = pc.industry_id
ORDER BY pc.prodclass_vector <=> $1::vector
LIMIT 20;
`;

/* ---------- SQL: выборка по ID ---------- */
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
  w.id::int  AS workshop_id, w.workshop_name::text AS workshop_name,
  e.clean_score::numeric AS cs
FROM ib_equipment e
LEFT JOIN ib_workshops w ON w.id = e.workshop_id
LEFT JOIN ib_prodclass pc ON pc.id = w.prodclass_id
LEFT JOIN ib_industry  i  ON i.id  = pc.industry_id
WHERE e.id = ANY($1::int[])
LIMIT 50;
`;
const Q_BY_PRODCLASS_IDS = `
SELECT
  pc.id::int AS id,
  pc.prodclass::text AS prodclass,
  i.id::int AS industry_id,
  i.industry::text AS industry,
  pc.best_cs::numeric AS cs
FROM ib_prodclass pc
LEFT JOIN ib_industry i ON i.id = pc.industry_id
WHERE pc.id = ANY($1::int[])
LIMIT 50;
`;

/* ---------- NEW: целевое оборудование для каждого товара ---------- */
const Q_TARGET_EQUIPMENT_FOR_GOODS = `
SELECT
  g.id::int             AS goods_id,
  e.id::int             AS target_equipment_id,
  e.clean_score::numeric AS target_cs,
  i.id::int             AS target_industry_id,
  i.industry::text      AS target_industry,
  pc.id::int            AS target_prodclass_id,
  pc.prodclass::text    AS target_prodclass,
  w.id::int             AS target_workshop_id,
  w.workshop_name::text AS target_workshop_name
FROM ib_goods_types g
CROSS JOIN LATERAL (
  SELECT e.id, e.clean_score, w.id AS w_id, pc.id AS pc_id, i.id AS i_id
  FROM ib_equipment e
  LEFT JOIN ib_workshops w ON w.id = e.workshop_id
  LEFT JOIN ib_prodclass pc ON pc.id = w.prodclass_id
  LEFT JOIN ib_industry  i  ON i.id  = pc.industry_id
  ORDER BY e.equipment_vector <=> g.goods_type_vector
  LIMIT 1
) sel
LEFT JOIN ib_equipment e ON e.id = sel.id
LEFT JOIN ib_workshops w ON w.id = sel.w_id
LEFT JOIN ib_prodclass pc ON pc.id = sel.pc_id
LEFT JOIN ib_industry  i  ON i.id  = sel.i_id
WHERE g.id = ANY($1::int[])
`;

async function enrichGoodsWithTargets(goods: GoodRow[]): Promise<GoodRow[]> {
  if (!goods.length) return goods;
  const ids = goods.map((g) => g.id);
  const { rows } = await db
    .query(Q_TARGET_EQUIPMENT_FOR_GOODS, [ids])
    .catch(() => ({ rows: [] as AnyRow[] }));
  const byGoods: Record<number, AnyRow> = Object.create(null);
  for (const r of rows) byGoods[Number(r.goods_id)] = r;
  return goods.map((g) => {
    const t = byGoods[g.id];
    if (!t) return g;
    return {
      ...g,
      target_equipment_id: t.target_equipment_id ?? null,
      target_cs: t.target_cs == null ? null : Number(t.target_cs),
      target_industry_id: t.target_industry_id ?? null,
      target_industry: t.target_industry ?? null,
      target_prodclass_id: t.target_prodclass_id ?? null,
      target_prodclass: t.target_prodclass ?? null,
      target_workshop_id: t.target_workshop_id ?? null,
      target_workshop_name: t.target_workshop_name ?? null,
    };
  });
}

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

  // vector
  const vec = raw?.embedding ?? raw?.vector;
  if (Array.isArray(vec) && vec.length) {
    return await queryDbVector(toVectorLiteral(vec));
  }

  // ids
  if (
    raw?.ids &&
    (raw.ids.goods?.length || raw.ids.equipment?.length || raw.ids.prodclasses?.length)
  ) {
    return await queryByIds(raw.ids);
  }

  // ready arrays
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

    const firstDb = await queryDbFast(query);

    let finalPayload: Payload | null = null;
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
      if (hasAny(dedup)) finalPayload = dedup;
    } catch {
      /* continue */
    }

    if (!finalPayload) {
      try {
        const vec = await embedQuery(query, ctrl.signal);
        const fromVector = await queryDbVector(vec);
        finalPayload = {
          goods: uniqById([...(firstDb.goods ?? []), ...(fromVector.goods ?? [])]),
          equipment: uniqById([...(firstDb.equipment ?? []), ...(fromVector.equipment ?? [])]),
          prodclasses: uniqById([
            ...(firstDb.prodclasses ?? []),
            ...(fromVector.prodclasses ?? []),
          ]),
        };
      } catch {
        finalPayload = firstDb;
      }
    }

    // enrich goods with target equipment
    if (finalPayload.goods?.length) {
      finalPayload.goods = await enrichGoodsWithTargets(finalPayload.goods);
    }

    return NextResponse.json(finalPayload);
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

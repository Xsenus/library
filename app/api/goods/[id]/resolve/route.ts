import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Резолв цепочки для goodsId:
 * 1) прямое соответствие через ib_equipment_goods
 * 2) векторный фолбэк: ближайшее оборудование к goods_type_vector
 * 3) строковый фолбэк: ILIKE по имени товара
 * Возвращаем первую подходящую цепочку industry_id → prodclass_id → workshop_id → equipment_id
 */

/** Шаг 1: прямое соответствие по связям */
const SQL_DIRECT = `
SELECT
  e.id  ::int AS equipment_id,
  w.id  ::int AS workshop_id,
  pc.id ::int AS prodclass_id,
  i.id  ::int AS industry_id
FROM ib_equipment e
JOIN ib_equipment_goods eg ON eg.equipment_id = e.id
LEFT JOIN ib_workshops  w  ON w.id  = e.workshop_id
LEFT JOIN ib_prodclass  pc ON pc.id = w.prodclass_id
LEFT JOIN ib_industry   i  ON i.id  = pc.industry_id
WHERE eg.goods_id = $1
ORDER BY (e.clean_score IS NULL), e.clean_score DESC NULLS LAST, e.id
LIMIT 1;
`;

/** Шаг 2: векторный фолбэк (pgvector) — ближайшее оборудование к вектору товара */
const SQL_VECTOR = `
WITH g AS (
  SELECT id, goods_type_name, goods_type_vector
  FROM ib_goods_types
  WHERE id = $1
)
SELECT
  e.id  ::int AS equipment_id,
  w.id  ::int AS workshop_id,
  pc.id ::int AS prodclass_id,
  i.id  ::int AS industry_id
FROM ib_equipment e
LEFT JOIN ib_workshops  w  ON w.id  = e.workshop_id
LEFT JOIN ib_prodclass  pc ON pc.id = w.prodclass_id
LEFT JOIN ib_industry   i  ON i.id  = pc.industry_id,
g
ORDER BY e.equipment_vector <=> g.goods_type_vector
LIMIT 1;
`;

/** Шаг 3: строковый фолбэк — ILIKE по имени товара */
const SQL_BY_NAME = `
WITH g AS (
  SELECT id, goods_type_name::text AS name
  FROM ib_goods_types
  WHERE id = $1
)
SELECT
  e.id  ::int AS equipment_id,
  w.id  ::int AS workshop_id,
  pc.id ::int AS prodclass_id,
  i.id  ::int AS industry_id
FROM ib_equipment e
LEFT JOIN ib_workshops  w  ON w.id  = e.workshop_id
LEFT JOIN ib_prodclass  pc ON pc.id  = w.prodclass_id
LEFT JOIN ib_industry   i  ON i.id   = pc.industry_id,
g
WHERE e.equipment_name ILIKE '%' || g.name || '%'
   OR pc.prodclass     ILIKE '%' || g.name || '%'
   OR w.workshop_name  ILIKE '%' || g.name || '%'
   OR i.industry       ILIKE '%' || g.name || '%'
ORDER BY length(e.equipment_name) ASC, e.id
LIMIT 1;
`;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params?.id ?? '');
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'bad goods id' }, { status: 400 });
  }

  try {
    // 1) прямое соответствие
    const d1 = await db.query(SQL_DIRECT, [id]);
    if (d1.rows?.[0]) {
      const r = d1.rows[0];
      return NextResponse.json({
        found: true,
        method: 'direct',
        industry_id: r.industry_id ?? null,
        prodclass_id: r.prodclass_id ?? null,
        workshop_id: r.workshop_id ?? null,
        equipment_id: r.equipment_id ?? null,
      });
    }

    // 2) векторный фолбэк
    const d2 = await db.query(SQL_VECTOR, [id]).catch(() => ({ rows: [] as any[] }));
    if (d2.rows?.[0]) {
      const r = d2.rows[0];
      return NextResponse.json({
        found: true,
        method: 'vector',
        industry_id: r.industry_id ?? null,
        prodclass_id: r.prodclass_id ?? null,
        workshop_id: r.workshop_id ?? null,
        equipment_id: r.equipment_id ?? null,
      });
    }

    // 3) строковый фолбэк
    const d3 = await db.query(SQL_BY_NAME, [id]).catch(() => ({ rows: [] as any[] }));
    if (d3.rows?.[0]) {
      const r = d3.rows[0];
      return NextResponse.json({
        found: true,
        method: 'name',
        industry_id: r.industry_id ?? null,
        prodclass_id: r.prodclass_id ?? null,
        workshop_id: r.workshop_id ?? null,
        equipment_id: r.equipment_id ?? null,
      });
    }

    return NextResponse.json({ found: false });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

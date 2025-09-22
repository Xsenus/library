import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { okvedByEquipmentSchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const equipmentId = Number(params.id);
    if (!Number.isFinite(equipmentId)) {
      return NextResponse.json({ items: [] });
    }

    const sql = `
      WITH ctx AS (
        SELECT pc.id AS prodclass_id, pc.industry_id
        FROM ib_equipment e
        JOIN ib_workshops  w  ON w.id  = e.workshop_id
        JOIN ib_prodclass_pc pc ON pc.id = w.prodclass_id
        WHERE e.id = $1
      )
      SELECT DISTINCT ON (m.okved_code)
        c.prodclass_id,
        m.id,
        m.okved_code,
        m.okved_main
      FROM ctx c
      JOIN ib_okved_main m
        ON m.industry_id = c.industry_id
      ORDER BY m.okved_code, m.okved_main
    `;

    const { rows } = await db.query(sql, [equipmentId]);
    const items = rows.map((r: any) => okvedByEquipmentSchema.parse(r));
    return NextResponse.json({ items });
  } catch (e) {
    console.error('GET /api/equipment/[id]/okved error', e);
    return NextResponse.json({ items: [] });
  }
}

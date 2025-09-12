// app/api/workshops/[workshopId]/equipment/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { equipmentQuerySchema, equipmentListSchema } from '@/lib/validators';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { workshopId: string } }) {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = equipmentQuerySchema.parse({
      workshopId: params.workshopId,
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
      query: searchParams.get('query'),
    });

    const { workshopId, page, pageSize, query } = queryParams;
    const offset = (page - 1) * pageSize;

    // total
    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM ib_equipment
      WHERE workshop_id = $1
        AND ($2::text IS NULL OR equipment_name ILIKE '%'||$2||'%')
    `;
    const countRes = await db.query<{ count: number }>(countSql, [workshopId, query ?? null]);
    const total = countRes.rows[0]?.count ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    // page items — новый ORDER BY
    const listSql = `
      SELECT
        id,
        equipment_name,
        workshop_id,
        equipment_score,
        equipment_score_real,
        clean_score
      FROM ib_equipment
      WHERE workshop_id = $1
        AND ($2::text IS NULL OR equipment_name ILIKE '%'||$2||'%')
      ORDER BY clean_score DESC NULLS LAST, equipment_name
      LIMIT $3 OFFSET $4
    `;
    const listRes = await db.query(listSql, [workshopId, query ?? null, pageSize, offset]);

    const items = listRes.rows.map((row) => equipmentListSchema.parse(row));

    return NextResponse.json({
      items,
      page,
      pageSize,
      total,
      totalPages,
    });
  } catch (error) {
    console.error('Equipment API error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: error.errors },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// app/api/prodclasses/[prodclassId]/workshops/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workshopsQuerySchema, workshopSchema } from '@/lib/validators';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { prodclassId: string } }) {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = workshopsQuerySchema.parse({
      prodclassId: params.prodclassId,
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
      query: searchParams.get('query'),
    });

    const { prodclassId, page, pageSize, query } = queryParams;
    const offset = (page - 1) * pageSize;

    const where = `
      w.prodclass_id = $1
      AND ($2::text IS NULL OR w.workshop_name ILIKE '%'||$2||'%')
      AND EXISTS (SELECT 1 FROM ib_equipment e WHERE e.workshop_id = w.id)
    `;

    // total
    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM ib_workshops w
      WHERE ${where};
    `;
    const countRes = await db.query<{ count: number }>(countSql, [prodclassId, query ?? null]);
    const total = countRes.rows[0]?.count ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    // page
    const listSql = `
      SELECT
        w.id,
        w.workshop_name,
        w.prodclass_id,
        w.company_id,
        w.workshop_score,
        w.best_cs,
        w.created_at
      FROM ib_workshops w
      WHERE ${where}
      ORDER BY w.best_cs DESC NULLS LAST, w.workshop_name
      LIMIT $3 OFFSET $4;
    `;
    const listRes = await db.query(listSql, [prodclassId, query ?? null, pageSize, offset]);

    const items = listRes.rows.map((r) => workshopSchema.parse(r));

    return NextResponse.json({ items, page, pageSize, total, totalPages });
  } catch (error) {
    console.error('Workshops API error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: error.errors },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

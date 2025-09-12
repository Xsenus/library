// app/api/industries/[industryId]/prodclasses/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { prodclassesQuerySchema, prodclassSchema } from '@/lib/validators';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { industryId: string } }) {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = prodclassesQuerySchema.parse({
      industryId: params.industryId,
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
      query: searchParams.get('query'),
    });

    const { industryId, page, pageSize, query } = queryParams;
    const offset = (page - 1) * pageSize;

    // --- WHERE блок по новому принципу
    // p: prodclass, w: workshop, e: equipment
    const where = `
      p.industry_id = $1
      AND ($2::text IS NULL OR p.prodclass ILIKE '%'||$2||'%')
      AND EXISTS (
        SELECT 1
        FROM ib_workshops w
        WHERE w.prodclass_id = p.id
          AND EXISTS (
            SELECT 1
            FROM ib_equipment e
            WHERE e.workshop_id = w.id
          )
      )
    `;

    // total
    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM ib_prodclass p
      WHERE ${where};
    `;
    const { rows: countRows } = await db.query<{ count: number }>(countSql, [
      industryId,
      query ?? null,
    ]);
    const total = countRows[0]?.count ?? 0;
    const totalPages = Math.ceil(total / pageSize);

    // page items
    const listSql = `
      SELECT p.id, p.prodclass, p.industry_id, p.best_cs
      FROM ib_prodclass p
      WHERE ${where}
      ORDER BY p.best_cs DESC NULLS LAST, p.prodclass
      LIMIT $3 OFFSET $4;
    `;
    const { rows } = await db.query(listSql, [industryId, query ?? null, pageSize, offset]);

    const items = rows.map((row) => prodclassSchema.parse(row));

    return NextResponse.json({
      items,
      page,
      pageSize,
      total,
      totalPages,
    });
  } catch (error) {
    console.error('Prodclasses API error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: error.errors },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
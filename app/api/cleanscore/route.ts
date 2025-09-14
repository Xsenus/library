import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cleanScoreQuerySchema, cleanScoreRowSchema } from '@/lib/validators';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = cleanScoreQuerySchema.parse({
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
      query: searchParams.get('query'),
      minScore: searchParams.get('minScore'),
      maxScore: searchParams.get('maxScore'),
      industryId: searchParams.get('industryId'),
    });

    const { page, pageSize, query, minScore, maxScore, industryId } = parsed;
    const offset = (page - 1) * pageSize;

    const where = `
      (e.clean_score IS NOT NULL AND e.clean_score BETWEEN $1 AND $2)
      AND ($3::int IS NULL OR i.id = $3)
      AND (
        $4::text IS NULL OR
        e.equipment_name ILIKE '%'||$4||'%' OR
        i.industry       ILIKE '%'||$4||'%' OR
        p.prodclass      ILIKE '%'||$4||'%' OR
        w.workshop_name  ILIKE '%'||$4||'%' OR
        e.contamination  ILIKE '%'||$4||'%' OR
        e.surface        ILIKE '%'||$4||'%' OR
        e.problems       ILIKE '%'||$4||'%' OR
        e.old_method     ILIKE '%'||$4||'%' OR
        e.old_problem    ILIKE '%'||$4||'%' OR
        e.benefit        ILIKE '%'||$4||'%'
      )
    `;

    const baseParams = [minScore, maxScore, industryId ?? null, query ?? null];

    const countSql = `
      SELECT COUNT(*)::int AS count
      FROM ib_equipment e
      LEFT JOIN ib_workshops w ON w.id = e.workshop_id
      LEFT JOIN ib_prodclass p ON p.id = w.prodclass_id
      LEFT JOIN ib_industry i ON i.id = p.industry_id
      WHERE ${where};
    `;
    const countRes = await db.query<{ count: number }>(countSql, baseParams);
    const total = countRes.rows[0]?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const listSql = `
      SELECT
        e.id                AS equipment_id,
        e.equipment_name,
        e.clean_score,
        i.id                AS industry_id,
        i.industry,
        p.id                AS prodclass_id,
        p.prodclass,
        w.id                AS workshop_id,
        w.workshop_name,
        e.contamination,
        e.surface,
        e.problems,
        e.old_method,
        e.old_problem,
        e.benefit
      FROM ib_equipment e
      LEFT JOIN ib_workshops w ON w.id = e.workshop_id
      LEFT JOIN ib_prodclass p ON p.id = w.prodclass_id
      LEFT JOIN ib_industry i ON i.id = p.industry_id
      WHERE ${where}
      ORDER BY
        COALESCE(i.industry,'~'),
        COALESCE(p.prodclass,'~'),
        COALESCE(w.workshop_name,'~'),
        e.equipment_name
      LIMIT $5 OFFSET $6;
    `;
    const listRes = await db.query(listSql, [...baseParams, pageSize, offset]);
    const items = listRes.rows.map((r) => cleanScoreRowSchema.parse(r));

    return NextResponse.json({ items, page, pageSize, total, totalPages });
  } catch (err) {
    console.error('CleanScore API error:', err);
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: err.errors },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

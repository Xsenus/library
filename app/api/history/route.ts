import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { historyQuerySchema, historyRowSchema } from '@/lib/validators';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const parsed = historyQuerySchema.parse({
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
      query: searchParams.get('query'),
      industryId: searchParams.get('industryId'),
    });

    const { page, pageSize, query, industryId } = parsed;
    const offset = (page - 1) * pageSize;

    const where = `
      ua.user_id = $1
      AND ($2::int IS NULL OR i.id = $2)
      AND (
        $3::text IS NULL OR
        e.equipment_name ILIKE '%' || $3 || '%' OR
        i.industry ILIKE '%' || $3 || '%' OR
        p.prodclass ILIKE '%' || $3 || '%' OR
        w.workshop_name ILIKE '%' || $3 || '%'
      )
    `;

    const baseParams = [auth.session.id, industryId ?? null, query ?? null];

    const fromJoins = `
      FROM users_activity ua
      JOIN ib_equipment e ON e.id = ua.equipment_id
      LEFT JOIN ib_workshops w ON w.id = e.workshop_id
      LEFT JOIN ib_prodclass p ON p.id = w.prodclass_id
      LEFT JOIN ib_industry i ON i.id = p.industry_id
      LEFT JOIN LATERAL (
        SELECT om.id, om.okved_code, om.okved_main
        FROM ib_okved_main om
        WHERE om.industry_id = i.id
        ORDER BY om.okved_code
        LIMIT 1
      ) o ON TRUE
    `;

    const countSql = `
      SELECT COUNT(*)::int AS count
      ${fromJoins}
      WHERE ${where};
    `;
    const countRes = await db.query<{ count: number }>(countSql, baseParams);
    const total = countRes.rows[0]?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const listSql = `
      SELECT
        ua.open_at,
        e.id AS equipment_id,
        e.equipment_name,
        e.clean_score,
        e.equipment_score_real,
        i.id AS industry_id,
        i.industry,
        p.id AS prodclass_id,
        p.prodclass,
        w.id AS workshop_id,
        w.workshop_name,
        e.contamination,
        e.surface,
        e.problems,
        e.old_method,
        e.old_problem,
        e.benefit,
        o.id::int AS okved_id,
        o.okved_code,
        o.okved_main
      ${fromJoins}
      WHERE ${where}
      ORDER BY ua.open_at DESC, e.id DESC
      LIMIT $4 OFFSET $5;
    `;
    const listRes = await db.query(listSql, [...baseParams, pageSize, offset]);

    const items = listRes.rows.map((row) => historyRowSchema.parse(row));

    return NextResponse.json({ items, page, pageSize, total, totalPages });
  } catch (err) {
    console.error('History API error:', err);
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: err.errors },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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

    // cleanScoreQuerySchema должен включать okvedId, okvedCode (оба optional)
    const parsed = cleanScoreQuerySchema.parse({
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
      query: searchParams.get('query'),
      minScore: searchParams.get('minScore'),
      maxScore: searchParams.get('maxScore'),
      industryId: searchParams.get('industryId'),
      okvedId: searchParams.get('okvedId'),
      okvedCode: searchParams.get('okvedCode'),
    });

    const { page, pageSize, query, minScore, maxScore, industryId, okvedId, okvedCode } = parsed;

    const offset = (page - 1) * pageSize;

    const where = `
      (e.clean_score IS NOT NULL AND e.clean_score BETWEEN $1 AND $2)
      AND ($3::int  IS NULL OR i.id = $3)
      AND (
        $4::int IS NULL
        OR EXISTS (
            SELECT 1
            FROM ib_okved_main om2
            WHERE om2.id = $4
              AND om2.industry_id = i.id
        )
      )
      AND (
        $5::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM ib_okved_main om3
            WHERE om3.okved_code = $5
              AND om3.industry_id = i.id
        )
      )
      AND (
        $6::text IS NULL OR
        e.equipment_name ILIKE '%'||$6||'%' OR
        i.industry       ILIKE '%'||$6||'%' OR
        p.prodclass      ILIKE '%'||$6||'%' OR
        w.workshop_name  ILIKE '%'||$6||'%' OR
        e.contamination  ILIKE '%'||$6||'%' OR
        e.surface        ILIKE '%'||$6||'%' OR
        e.problems       ILIKE '%'||$6||'%' OR
        e.old_method     ILIKE '%'||$6||'%' OR
        e.old_problem    ILIKE '%'||$6||'%' OR
        e.benefit        ILIKE '%'||$6||'%'
      )
    `;

    const baseParams = [
      minScore, // $1
      maxScore, // $2
      industryId ?? null, // $3
      okvedId ?? null, // $4
      okvedCode ?? null, // $5
      query ?? null, // $6
    ];

    const fromJoins = `
      FROM ib_equipment e
      LEFT JOIN ib_workshops w  ON w.id = e.workshop_id
      LEFT JOIN ib_prodclass p  ON p.id = w.prodclass_id
      LEFT JOIN ib_industry i   ON i.id = p.industry_id
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
        e.id                AS equipment_id,
        e.equipment_name,
        e.clean_score,
        e.equipment_score_real,
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
        e.benefit,

        -- ОКВЭД из LATERAL-подзапроса (важно привести id к int)
        o.id::int           AS okved_id,
        o.okved_code,
        o.okved_main
      ${fromJoins}
      WHERE ${where}
      ORDER BY
        COALESCE(i.industry,'~'),
        COALESCE(p.prodclass,'~'),
        COALESCE(w.workshop_name,'~'),
        e.equipment_name
      LIMIT $7 OFFSET $8;
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

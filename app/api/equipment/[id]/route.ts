import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { equipmentIdSchema, equipmentDetailSchema } from '@/lib/validators';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = equipmentIdSchema.parse({ id: params.id });

    const sql = `
      SELECT
        e.id::int                                  AS id,
        e.equipment_name,
        e.workshop_id::int                         AS workshop_id,

        e.equipment_score::float8                  AS equipment_score,
        e.equipment_score_real::float8             AS equipment_score_real,
        e.clean_score::float8                      AS clean_score,

        e.clean_url_1, e.clean_url_2, e.clean_url_3,
        e.description, e.description_url, e.images_url, e.images_promt,
        e.contamination, e.surface, e.problems,
        e.old_method, e.old_problem, e.benefit,
        e.synonyms_ru, e.synonyms_en,

        e.blaster, e.air,
        e.rate::float8                             AS rate,
        e.company_id::int                          AS company_id,

        s.utp_post, s.utp_mail,

        dc.decision_pr, dc.decision_prs, dc.decision_sov, dc.decision_operator, dc.decision_proc,

        -- полный список по тому же prodclass (без лимита)
        ge.goods_examples,

        co.company_name, co.site_description

      FROM ib_equipment e
      LEFT JOIN ib_workshops w0 ON w0.id = e.workshop_id  -- нужен prodclass_id, но не дропаем строки без workshop

      LEFT JOIN LATERAL (
        SELECT s.utp_post, s.utp_mail
        FROM ib_successful_story s
        WHERE s.company_id = e.company_id
        ORDER BY s.id DESC
        LIMIT 1
      ) s ON TRUE

      LEFT JOIN LATERAL (
        SELECT
          d.lpr        AS decision_pr,
          d.prs        AS decision_prs,
          d.sov        AS decision_sov,
          d."operator" AS decision_operator,
          d.proc       AS decision_proc
        FROM ib_decision_center d
        WHERE d.workshop_id = e.workshop_id
          AND d.company_id  = e.company_id
        ORDER BY d.id DESC
        LIMIT 1
      ) dc ON TRUE

      -- все товары по prodclass текущего оборудования
      LEFT JOIN LATERAL (
        SELECT ARRAY(
          SELECT DISTINCT g.goods_name::text
          FROM ib_equipment e2
          JOIN ib_workshops w2        ON w2.id = e2.workshop_id
          JOIN ib_equipment_goods eg  ON eg.equipment_id = e2.id
          JOIN ib_goods g             ON g.id = eg.goods_id
          WHERE (w0.prodclass_id IS NOT NULL AND w2.prodclass_id = w0.prodclass_id)
          ORDER BY g.goods_name
        )::text[] AS goods_examples
      ) ge ON TRUE

      LEFT JOIN LATERAL (
        SELECT c.company_name, c.site_description
        FROM ib_clients c
        WHERE c.id = e.company_id
        LIMIT 1
      ) co ON TRUE

      WHERE e.id = $1
    `;

    const result = await db.query(sql, [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Equipment not found' }, { status: 404 });
    }

    const equipment = equipmentDetailSchema.parse(result.rows[0]);
    return NextResponse.json(equipment);
  } catch (error) {
    console.error('Equipment detail API error:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid parameters', details: error.errors },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

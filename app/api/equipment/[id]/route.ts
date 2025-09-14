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
        e.id, e.equipment_name, e.workshop_id,
        e.equipment_score, e.equipment_score_real, e.clean_score,
        e.clean_url_1, e.clean_url_2, e.clean_url_3,
        e.description, e.description_url, e.images_url, e.images_promt,
        e.contamination, e.surface, e.problems,
        e.old_method, e.old_problem, e.benefit,
        e.synonyms_ru, e.synonyms_en,
        e.blaster, e.air, e.rate, e.company_id,
        s.utp_post, s.utp_mail,

        -- Центр принятия решений
        dc.decision_pr, dc.decision_prs, dc.decision_sov, dc.decision_operator, dc.decision_proc,

        -- Примеры товаров
        ge.goods_examples,

        -- Пример компании
        co.company_name, co.site_description

      FROM ib_equipment e

      -- последняя успешная история
      LEFT JOIN LATERAL (
        SELECT s.utp_post, s.utp_mail
        FROM ib_successful_story s
        WHERE s.company_id = e.company_id
        ORDER BY s.id DESC
        LIMIT 1
      ) s ON TRUE

      -- центр принятия решений (по цеху + компании)
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

      -- примеры товаров (до 6 шт.)
      LEFT JOIN LATERAL (
        SELECT ARRAY(
          SELECT DISTINCT g.goods_name
          FROM ib_equipment e2
          JOIN ib_equipment_goods eg ON eg.equipment_id = e2.id
          JOIN ib_goods g ON g.id = eg.goods_id
          WHERE e2.workshop_id = e.workshop_id
            AND e2.company_id = e.company_id
          ORDER BY g.goods_name
          LIMIT 6
        ) AS goods_examples
      ) ge ON TRUE

      -- пример компании
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

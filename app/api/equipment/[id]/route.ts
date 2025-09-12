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
        s.utp_post, s.utp_mail
      FROM ib_equipment e
      LEFT JOIN LATERAL (
        SELECT s.utp_post, s.utp_mail
        FROM ib_successful_story s
        WHERE s.company_id = e.company_id
        ORDER BY s.id DESC
        LIMIT 1
      ) s ON TRUE
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

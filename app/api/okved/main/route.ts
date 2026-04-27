import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { okvedMainSchema } from '@/lib/validators';
import { requireApiAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const industryId = Number(searchParams.get('industryId') ?? '') || null;
    const prodclassId = Number(searchParams.get('prodclassId') ?? '') || null;

    const { rows } = await db.query(
      `
      WITH src AS (
        SELECT
          id,
          okved_main,
          btrim(okved_code) AS code_raw,
          -- убираем все пробелы (включая NBSP) и края
          regexp_replace(btrim(okved_code), '[\\s\\u00A0]+', '', 'g') AS code_norm
        FROM ib_okved_main
        WHERE $2::int IS NULL
          AND ($1::int IS NULL OR industry_id = $1)
        UNION ALL
        SELECT
          o.id,
          o.okved_main,
          btrim(o.okved_code) AS code_raw,
          regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g') AS code_norm
        FROM ib_okved o
        JOIN ib_prodclass p ON p.id = o.prodclass_id
        WHERE (
          $2::int IS NOT NULL
          AND o.prodclass_id = $2
        ) OR (
          $2::int IS NULL
          AND $1::int IS NOT NULL
          AND p.industry_id = $1
        )
      ),
      ranked AS (
        SELECT
          id,
          code_norm,
          okved_main,
          row_number() OVER (
            PARTITION BY code_norm
            ORDER BY okved_main DESC, id
          ) AS rn
        FROM src
      )
      SELECT
        id::int,
        code_norm AS okved_code,
        okved_main
      FROM ranked
      WHERE rn = 1
      ORDER BY string_to_array(code_norm, '.')::int[];
      `,
      [industryId, prodclassId],
    );

    const items = rows.map((r: any) => okvedMainSchema.parse(r));
    return NextResponse.json({ items });
  } catch (e) {
    console.error('GET /api/okved/main error', e);
    return NextResponse.json({ items: [] });
  }
}

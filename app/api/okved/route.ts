// app/api/okved/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireApiAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type OkvedItem = {
  id: number;
  okved_code: string;
  okved_main: string;
};

// Примерная структура. Подправь JOIN'ы под свои реальные таблицы/связи.
const SQL_ALL = `
  SELECT o.id, o.okved_code, o.okved_main
  FROM ib_okved_main o
  ORDER BY o.okved_code
  LIMIT 1000
`;

const SQL_BY_INDUSTRY = `
  SELECT DISTINCT o.id, o.okved_code, o.okved_main
  FROM ib_okved_main o
  WHERE o.industry_id = $1
  ORDER BY o.okved_code
  LIMIT 1000
`;

const SQL_BY_PRODCLASS = `
  SELECT DISTINCT ON (regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g'))
    o.id,
    regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g') AS okved_code,
    o.okved_main
  FROM ib_okved o
  WHERE o.prodclass_id = $1
  ORDER BY regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g'), o.okved_main DESC, o.id
  LIMIT 1000
`;

const SQL_BY_INDUSTRY_PRODCLASSES = `
  SELECT DISTINCT ON (regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g'))
    o.id,
    regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g') AS okved_code,
    o.okved_main
  FROM ib_okved o
  JOIN ib_prodclass p ON p.id = o.prodclass_id
  WHERE p.industry_id = $1
  ORDER BY regexp_replace(btrim(o.okved_code), '[\\s\\u00A0]+', '', 'g'), o.okved_main DESC, o.id
  LIMIT 1000
`;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth({ requireWorker: true });
    if (!auth.ok) return auth.response;


    const { searchParams } = new URL(req.url);
    const industryId = Number(searchParams.get('industryId') || '');
    const prodclassId = Number(searchParams.get('prodclassId') || '');

    let rows: OkvedItem[] = [];
    if (Number.isFinite(prodclassId) && prodclassId > 0) {
      const res = await db.query<OkvedItem>(SQL_BY_PRODCLASS, [prodclassId]);
      rows = res.rows;
    } else if (Number.isFinite(industryId) && industryId > 0) {
      const res = await db.query<OkvedItem>(SQL_BY_INDUSTRY_PRODCLASSES, [industryId]).catch(() =>
        db.query<OkvedItem>(SQL_BY_INDUSTRY, [industryId]),
      );
      rows = res.rows;
    } else {
      const res = await db.query<OkvedItem>(SQL_ALL);
      rows = res.rows;
    }

    return NextResponse.json({ items: rows });
  } catch (e: any) {
    console.error('/api/okved error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

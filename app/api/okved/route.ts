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
  JOIN ib_okved_industry_map m ON m.okved_id = o.id
  WHERE m.industry_id = $1
  ORDER BY o.okved_code
  LIMIT 1000
`;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth({ requireWorker: true });
    if (!auth.ok) return auth.response;


    const { searchParams } = new URL(req.url);
    const industryId = Number(searchParams.get('industryId') || '');

    let rows: OkvedItem[] = [];
    if (Number.isFinite(industryId) && industryId > 0) {
      const res = await db.query<OkvedItem>(SQL_BY_INDUSTRY, [industryId]);
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

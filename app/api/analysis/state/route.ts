import { NextRequest, NextResponse } from 'next/server';
import { getCompanyAnalysisStateMap } from '@/lib/company-analysis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parseInnsFromSearch(params: URLSearchParams): string[] {
  const result = new Set<string>();
  for (const value of params.getAll('inn')) {
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .forEach((part) => result.add(part));
  }
  const combined = params.get('inns');
  if (combined) {
    combined
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .forEach((part) => result.add(part));
  }
  return Array.from(result);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const inns = parseInnsFromSearch(searchParams);
    if (inns.length === 0) {
      return NextResponse.json({ ok: true, items: [] });
    }
    const map = await getCompanyAnalysisStateMap(inns);
    return NextResponse.json({ ok: true, items: Array.from(map.values()) });
  } catch (error) {
    console.error('GET /api/analysis/state error', error);
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}

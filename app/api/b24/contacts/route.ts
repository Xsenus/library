import { NextRequest, NextResponse } from 'next/server';
import { refreshCompanyContacts } from '@/lib/company-contacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const debug = req.nextUrl.searchParams.get('debug') === '1';
    const maxAgeMinutesParam = req.nextUrl.searchParams.get('maxAgeMinutes');
    const maxAgeMinutes = maxAgeMinutesParam ? Number(maxAgeMinutesParam) : undefined;

    const body = (await req.json().catch(() => null)) as { inns?: string[] } | null;
    const inns = Array.isArray(body?.inns) ? body!.inns! : [];

    const { items, debug: dbg } = await refreshCompanyContacts(inns, { maxAgeMinutes, debug });

    return NextResponse.json({ ok: true, items, debug: dbg });
  } catch (error: any) {
    console.error('b24 contacts refresh failed', error);
    return NextResponse.json({ ok: false, error: error?.message ?? 'internal error' }, { status: 500 });
  }
}


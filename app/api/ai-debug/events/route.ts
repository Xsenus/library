import { NextRequest, NextResponse } from 'next/server';
import { aiDebugEventSchema, deleteAllAiDebugEvents, listAiDebugEvents, logAiDebugEvent } from '@/lib/ai-debug';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

const allowedPageSizes = [10, 20, 35, 50, 100];

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const pageRaw = sp.get('page');
    const pageSizeRaw = sp.get('pageSize');
    const companyId = sp.get('companyId') || undefined;
    const source = sp.get('source') || undefined;
    const direction = sp.get('direction') || undefined;
    const type = sp.get('type') || undefined;
    const dateFrom = sp.get('dateFrom') || undefined;
    const dateTo = sp.get('dateTo') || undefined;
    const inn = sp.get('inn') || undefined;
    const name = sp.get('name') || undefined;
    const search = sp.get('q') || undefined;

    const page = Number.isFinite(Number(pageRaw)) ? Number(pageRaw) : 1;
    const requestedPageSize = Number.isFinite(Number(pageSizeRaw)) ? Number(pageSizeRaw) : 50;
    const pageSize = allowedPageSizes.includes(requestedPageSize) ? requestedPageSize : 50;
    const categories = sp.getAll('category').filter(Boolean) as ('traffic' | 'error' | 'notification')[];

    const data = await listAiDebugEvents({
      categories,
      page,
      pageSize,
      companyId,
      source,
      direction,
      type,
      dateFrom,
      dateTo,
      inn,
      companyName: name,
      search,
    });
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('GET /api/ai-debug/events failed', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = aiDebugEventSchema.parse(await req.json());
    await logAiDebugEvent(parsed);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('POST /api/ai-debug/events failed', error);
    const status = error?.name === 'ZodError' ? 400 : 500;
    const message = error?.issues ? error.issues : error?.message ?? 'Internal Server Error';
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE() {
  const session = await getSession();
  const isAdmin = (session?.login ?? '').toLowerCase() === 'admin';
  if (!isAdmin) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    await deleteAllAiDebugEvents();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/ai-debug/events failed', error);
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

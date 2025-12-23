import { NextRequest, NextResponse } from 'next/server';
import { aiDebugEventSchema, deleteAllAiDebugEvents, listAiDebugEvents, logAiDebugEvent } from '@/lib/ai-debug';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const pageRaw = sp.get('page');
    const pageSizeRaw = sp.get('pageSize');
    const companyId = sp.get('companyId') || undefined;

    const page = Number.isFinite(Number(pageRaw)) ? Number(pageRaw) : 1;
    const pageSize = Number.isFinite(Number(pageSizeRaw)) ? Number(pageSizeRaw) : 50;
    const categories = sp.getAll('category').filter(Boolean) as ('traffic' | 'error' | 'notification')[];

    const data = await listAiDebugEvents({ categories, page, pageSize, companyId });
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

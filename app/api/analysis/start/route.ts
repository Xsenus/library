import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { startCompanyAnalysis } from '@/lib/company-analysis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const startSchema = z.object({
  inns: z.array(z.string().trim().min(1)).min(1, 'inns required'),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { inns } = startSchema.parse(body);
    const result = await startCompanyAnalysis(inns);
    return NextResponse.json({ ok: true, items: result });
  } catch (error: any) {
    console.error('POST /api/analysis/start error', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 });
  }
}

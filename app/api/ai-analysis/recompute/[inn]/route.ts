import { NextResponse } from 'next/server';

import { callAiIntegration } from '@/lib/ai-integration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

type RouteContext = {
  params: {
    inn: string;
  };
};

export async function POST(_request: Request, { params }: RouteContext) {
  const inn = String(params?.inn ?? '').trim();
  if (!inn) {
    return NextResponse.json({ error: 'INN is required' }, { status: 400 });
  }

  const res = await callAiIntegration(`/v1/equipment-selection/recompute/by-inn/${encodeURIComponent(inn)}`, {
    method: 'POST',
    cache: 'no-store',
    timeoutMs: 60_000,
  });

  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status || 502 });
  }

  return NextResponse.json(res.data, { status: 200 });
}

import { NextResponse } from 'next/server';

import { callAiIntegration } from '@/lib/ai-integration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

export async function GET() {
  const res = await callAiIntegration('/v1/equipment-selection/settings', {
    method: 'GET',
    cache: 'no-store',
    timeoutMs: 20_000,
  });

  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status || 502 });
  }

  return NextResponse.json(res.data, { status: 200 });
}

export async function PUT(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Settings payload is required' }, { status: 400 });
  }

  const res = await callAiIntegration('/v1/equipment-selection/settings', {
    method: 'PUT',
    cache: 'no-store',
    timeoutMs: 20_000,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status || 502 });
  }

  return NextResponse.json(res.data, { status: 200 });
}

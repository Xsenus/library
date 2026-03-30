import { NextResponse } from 'next/server';

import { callAiIntegration } from '@/lib/ai-integration';
import { normalizeEquipmentTracePayload } from '@/lib/ai-analysis-equipment-trace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

type RouteContext = {
  params: {
    inn: string;
  };
};

export async function GET(_request: Request, { params }: RouteContext) {
  const inn = String(params?.inn ?? '').trim();
  if (!inn) {
    return NextResponse.json({ error: 'INN is required', items: [] }, { status: 400 });
  }

  const snapshotRes = await callAiIntegration(
    `/v1/equipment-selection/snapshot/by-inn/${encodeURIComponent(inn)}`,
    {
      method: 'GET',
      cache: 'no-store',
      timeoutMs: 20_000,
    },
  );

  const res =
    snapshotRes.ok || (snapshotRes.status && snapshotRes.status !== 404)
      ? snapshotRes
      : await callAiIntegration(`/v1/equipment-selection/by-inn/${encodeURIComponent(inn)}`, {
        method: 'GET',
        cache: 'no-store',
        timeoutMs: 20_000,
      });

  if (!res.ok) {
    return NextResponse.json({ error: res.error, items: [] }, { status: res.status || 502 });
  }

  return NextResponse.json(
    {
      items: normalizeEquipmentTracePayload(res.data),
    },
    { status: 200 },
  );
}

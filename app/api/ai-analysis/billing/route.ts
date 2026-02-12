import { NextResponse } from 'next/server';
import { callAiIntegration } from '@/lib/ai-integration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

export async function GET() {
  const res = await callAiIntegration('/v1/billing/remaining', {
    method: 'GET',
    cache: 'no-store',
    timeoutMs: 10000,
  });

  if (!res.ok) {
    return NextResponse.json(
      {
        error: res.error,
        remaining_usd: null,
        limit_usd: null,
        spend_month_to_date_usd: null,
      },
      { status: res.status || 502 },
    );
  }

  const payload = (res.data ?? {}) as Record<string, any>;

  return NextResponse.json(
    {
      remaining_usd: payload.remaining_usd ?? null,
      limit_usd: payload.limit_usd ?? payload.budget_monthly_usd ?? null,
      spend_month_to_date_usd: payload.spend_month_to_date_usd ?? payload.month_to_date_spend_usd ?? null,
    },
    { status: 200 },
  );
}

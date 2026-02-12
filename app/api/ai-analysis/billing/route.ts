import { NextResponse } from 'next/server';
import { callAiIntegration } from '@/lib/ai-integration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

export async function GET() {
  const res = await callAiIntegration('/api/billing/remaining', {
    method: 'GET',
    cache: 'no-store',
    timeoutMs: 10000,
  });

  if (!res.ok) {
    return NextResponse.json(
      {
        error: res.error,
        month_to_date_spend_usd: null,
        budget_monthly_usd: null,
        remaining_usd: null,
      },
      { status: res.status || 502 },
    );
  }

  return NextResponse.json(res.data, { status: 200 });
}

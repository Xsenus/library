import { NextResponse } from 'next/server';
import { callAiIntegration } from '@/lib/ai-integration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstNumber(payload: Record<string, any>, keys: string[]): number | null {
  for (const key of keys) {
    const direct = toFiniteNumber(payload?.[key]);
    if (direct != null) return direct;

    const nested = payload?.data;
    if (nested && typeof nested === 'object') {
      const nestedValue = toFiniteNumber((nested as Record<string, any>)[key]);
      if (nestedValue != null) return nestedValue;
    }
  }

  return null;
}

export async function GET() {
  const requestInit = {
    method: 'GET',
    cache: 'no-store',
    timeoutMs: 10000,
  } as const;

  const primary = await callAiIntegration('/v1/billing/remaining', requestInit);
  const res =
    primary.ok || (primary.status !== 404 && primary.status !== 405)
      ? primary
      : await callAiIntegration('/v1/billing', requestInit);

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
      remaining_usd: firstNumber(payload, ['remaining_usd', 'remaining', 'balance_usd']),
      limit_usd: firstNumber(payload, ['limit_usd', 'budget_monthly_usd', 'monthly_budget_usd', 'limit']),
      spend_month_to_date_usd: firstNumber(payload, [
        'spend_month_to_date_usd',
        'month_to_date_spend_usd',
        'spent_usd',
        'spent',
      ]),
    },
    { status: 200 },
  );
}

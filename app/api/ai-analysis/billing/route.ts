import { NextResponse } from 'next/server';

import { mergeBillingSnapshots, normalizeBillingPayload, type BillingSnapshot } from '@/lib/ai-analysis-billing';
import { callAiIntegration } from '@/lib/ai-integration';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

type BillingSnapshotRow = {
  billing_summary: unknown;
  created_at: string | null;
};

type MonthSpendRow = {
  spend_month_to_date_usd: number | string | null;
};

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

function buildLiveFallback(error: string | null | undefined): BillingSnapshot {
  const normalizedError = error?.trim() || null;
  return {
    remaining_usd: null,
    limit_usd: null,
    spend_month_to_date_usd: null,
    configured: normalizedError?.toLowerCase().includes('not configured') ? false : null,
    error: normalizedError,
    source: 'live',
    last_snapshot_at: null,
  };
}

async function loadLatestBillingSnapshot(): Promise<BillingSnapshot | null> {
  try {
    const { rows } = await db.query<BillingSnapshotRow>(
      `
        SELECT billing_summary, created_at
        FROM public.ai_site_openai_responses
        WHERE billing_summary IS NOT NULL
        ORDER BY created_at DESC NULLS LAST, id DESC NULLS LAST
        LIMIT 1
      `,
    );

    const row = rows[0];
    if (!row) return null;
    return normalizeBillingPayload(row.billing_summary, {
      source: 'snapshot',
      lastSnapshotAt: row.created_at,
    });
  } catch (error) {
    console.warn('Failed to load AI billing snapshot', error);
    return null;
  }
}

async function loadMonthSpendUsd(): Promise<number | null> {
  try {
    const { rows } = await db.query<MonthSpendRow>(
      `
        SELECT COALESCE(SUM(cost_usd), 0)::numeric(12,6) AS spend_month_to_date_usd
        FROM public.ai_site_openai_responses
        WHERE cost_usd IS NOT NULL
          AND created_at >= date_trunc('month', now())
          AND created_at < date_trunc('month', now()) + interval '1 month'
      `,
    );
    return toFiniteNumber(rows[0]?.spend_month_to_date_usd ?? null);
  } catch (error) {
    console.warn('Failed to load AI monthly spend fallback', error);
    return null;
  }
}

async function loadLiveBilling(): Promise<BillingSnapshot> {
  const requestInit = {
    method: 'GET',
    cache: 'no-store',
    timeoutMs: 10_000,
  } as const;

  const primary = await callAiIntegration('/v1/billing/remaining', requestInit);
  const res =
    primary.ok || (primary.status !== 404 && primary.status !== 405)
      ? primary
      : await callAiIntegration('/v1/billing', requestInit);

  if (!res.ok) {
    return buildLiveFallback(res.error);
  }

  return (
    normalizeBillingPayload(res.data, {
      source: 'live',
    }) ?? buildLiveFallback(null)
  );
}

export async function GET() {
  const [live, snapshot, monthSpendUsd] = await Promise.all([
    loadLiveBilling(),
    loadLatestBillingSnapshot(),
    loadMonthSpendUsd(),
  ]);

  const merged = mergeBillingSnapshots({
    live,
    snapshot,
    monthSpendUsd,
  });

  return NextResponse.json(merged, { status: 200 });
}

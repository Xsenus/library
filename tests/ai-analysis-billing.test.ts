import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeBillingSnapshots, normalizeBillingPayload } from '../lib/ai-analysis-billing';

test('normalizeBillingPayload reads numbers from top level and nested data', () => {
  const payload = normalizeBillingPayload(
    {
      data: {
        remaining_usd: '12.50',
        limit_usd: '25',
        spend_month_to_date_usd: '4.5',
        configured: false,
        error: 'OPENAI_ADMIN_KEY not configured',
      },
    },
    { source: 'snapshot', lastSnapshotAt: '2026-03-30T10:00:00.000Z' },
  );

  assert.deepEqual(payload, {
    remaining_usd: 12.5,
    limit_usd: 25,
    spend_month_to_date_usd: 4.5,
    configured: false,
    error: 'OPENAI_ADMIN_KEY not configured',
    source: 'snapshot',
    last_snapshot_at: '2026-03-30T10:00:00.000Z',
  });
});

test('mergeBillingSnapshots combines live values with db fallback spend and derived remaining', () => {
  const merged = mergeBillingSnapshots({
    live: {
      remaining_usd: null,
      limit_usd: 40,
      spend_month_to_date_usd: null,
      configured: false,
      error: 'OPENAI_ADMIN_KEY not configured',
      source: 'live',
      last_snapshot_at: null,
    },
    snapshot: {
      remaining_usd: null,
      limit_usd: 40,
      spend_month_to_date_usd: null,
      configured: false,
      error: null,
      source: 'snapshot',
      last_snapshot_at: '2026-03-29T08:00:00.000Z',
    },
    monthSpendUsd: 12.3456,
  });

  assert.deepEqual(merged, {
    remaining_usd: 27.6544,
    limit_usd: 40,
    spend_month_to_date_usd: 12.3456,
    configured: false,
    error: 'OPENAI_ADMIN_KEY not configured',
    source: 'live, db-month, derived',
    last_snapshot_at: '2026-03-29T08:00:00.000Z',
  });
});

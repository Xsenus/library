export type BillingSnapshot = {
  remaining_usd?: number | null;
  limit_usd?: number | null;
  spend_month_to_date_usd?: number | null;
  configured?: boolean | null;
  error?: string | null;
  source?: string | null;
  last_snapshot_at?: string | null;
};

type AnyRecord = Record<string, unknown>;

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

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (['true', '1', 'yes', 'ok'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
  }
  return null;
}

function recordFrom(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null;
}

function firstNumber(payload: AnyRecord, keys: string[]): number | null {
  const nested = recordFrom(payload.data);
  for (const key of keys) {
    const direct = toFiniteNumber(payload[key]);
    if (direct != null) return direct;
    if (nested) {
      const nestedValue = toFiniteNumber(nested[key]);
      if (nestedValue != null) return nestedValue;
    }
  }
  return null;
}

function firstText(payload: AnyRecord, keys: string[]): string | null {
  const nested = recordFrom(payload.data);
  for (const key of keys) {
    const direct = toText(payload[key]);
    if (direct) return direct;
    if (nested) {
      const nestedValue = toText(nested[key]);
      if (nestedValue) return nestedValue;
    }
  }
  return null;
}

function firstBoolean(payload: AnyRecord, keys: string[]): boolean | null {
  const nested = recordFrom(payload.data);
  for (const key of keys) {
    const direct = toBoolean(payload[key]);
    if (direct != null) return direct;
    if (nested) {
      const nestedValue = toBoolean(nested[key]);
      if (nestedValue != null) return nestedValue;
    }
  }
  return null;
}

export function normalizeBillingPayload(
  payload: unknown,
  options: { source?: string | null; lastSnapshotAt?: string | null } = {},
): BillingSnapshot | null {
  const record = recordFrom(payload);
  if (!record) return null;

  return {
    remaining_usd: firstNumber(record, ['remaining_usd', 'remaining', 'balance_usd']),
    limit_usd: firstNumber(record, ['limit_usd', 'budget_monthly_usd', 'monthly_budget_usd', 'limit']),
    spend_month_to_date_usd: firstNumber(record, [
      'spend_month_to_date_usd',
      'month_to_date_spend_usd',
      'spent_usd',
      'spent',
    ]),
    configured: firstBoolean(record, ['configured', 'is_configured']),
    error: firstText(record, ['error', 'detail', 'message']),
    source: options.source ?? firstText(record, ['source']),
    last_snapshot_at: options.lastSnapshotAt ?? firstText(record, ['last_snapshot_at', 'created_at']),
  };
}

export function mergeBillingSnapshots(options: {
  live?: BillingSnapshot | null;
  snapshot?: BillingSnapshot | null;
  monthSpendUsd?: number | null;
}): BillingSnapshot {
  const live = options.live ?? null;
  const snapshot = options.snapshot ?? null;
  const monthSpendUsd = toFiniteNumber(options.monthSpendUsd);
  const sources = new Set<string>();

  const take = (key: keyof BillingSnapshot): number | null => {
    const liveValue = toFiniteNumber(live?.[key]);
    if (liveValue != null) {
      sources.add('live');
      return liveValue;
    }
    const snapshotValue = toFiniteNumber(snapshot?.[key]);
    if (snapshotValue != null) {
      sources.add('snapshot');
      return snapshotValue;
    }
    return null;
  };

  let remainingUsd = take('remaining_usd');
  const limitUsd = take('limit_usd');
  let spendMonthToDateUsd = take('spend_month_to_date_usd');

  if (spendMonthToDateUsd == null && monthSpendUsd != null) {
    spendMonthToDateUsd = monthSpendUsd;
    sources.add('db-month');
  }

  if (remainingUsd == null && limitUsd != null && spendMonthToDateUsd != null) {
    remainingUsd = Number(Math.max(limitUsd - spendMonthToDateUsd, 0).toFixed(6));
    sources.add('derived');
  }

  return {
    remaining_usd: remainingUsd,
    limit_usd: limitUsd,
    spend_month_to_date_usd: spendMonthToDateUsd,
    configured: live?.configured ?? snapshot?.configured ?? null,
    error: live?.error ?? snapshot?.error ?? null,
    source: sources.size ? Array.from(sources).join(', ') : live?.source ?? snapshot?.source ?? null,
    last_snapshot_at: live?.last_snapshot_at ?? snapshot?.last_snapshot_at ?? null,
  };
}

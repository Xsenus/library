const OBJECT_PLACEHOLDER_VALUES = new Set(['[object object]', '[object array]']);

function normalizeCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (OBJECT_PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

export function parseDisplayString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return normalizeCandidate(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return normalizeCandidate(String(value));
  }
  return null;
}

type ExtractOptions = {
  preferredKeys?: string[];
  maxDepth?: number;
};

export function extractMeaningfulText(
  value: unknown,
  { preferredKeys = [], maxDepth = 4 }: ExtractOptions = {},
): string | null {
  const seen = new WeakSet<object>();

  const visit = (current: unknown, depth: number): string | null => {
    const direct = parseDisplayString(current);
    if (direct) return direct;
    if (depth >= maxDepth || current == null) return null;

    if (Array.isArray(current)) {
      for (const entry of current) {
        const candidate = visit(entry, depth + 1);
        if (candidate) return candidate;
      }
      return null;
    }

    if (typeof current !== 'object') return null;
    if (seen.has(current)) return null;
    seen.add(current);

    const record = current as Record<string, unknown>;

    for (const key of preferredKeys) {
      if (!(key in record)) continue;
      const candidate = visit(record[key], depth + 1);
      if (candidate) return candidate;
    }

    for (const entry of Object.values(record)) {
      const candidate = visit(entry, depth + 1);
      if (candidate) return candidate;
    }

    return null;
  };

  return visit(value, 0);
}

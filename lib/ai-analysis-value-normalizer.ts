const OBJECT_PLACEHOLDER_VALUES = new Set(['[object object]', '[object array]']);
const LARGE_ANALYSIS_KEYS = new Set([
  'description_vector',
  'text_vector',
  'vector',
  'vectors',
  'embedding',
  'embeddings',
  'prompt',
  'prompt_raw',
  'answer_raw',
  'raw_text',
  'text_raw',
  'chunks',
  'text_chunks',
  'chunks_raw',
]);

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

export type NormalizedOkvedEntry = {
  code: string;
  name: string | null;
  main: boolean;
};

export function normalizeOkvedEntries(value: unknown): NormalizedOkvedEntry[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const result: NormalizedOkvedEntry[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (item == null) continue;

    const code =
      typeof item === 'string'
        ? normalizeCandidate(item)
        : extractMeaningfulText(item, {
            preferredKeys: ['code', 'okved_code', 'value', 'label', 'name', 'title', 'text'],
          });

    if (!code) continue;

    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const name =
      typeof item === 'object' && item != null
        ? extractMeaningfulText(item, {
            preferredKeys: ['name', 'okved_name', 'label', 'title', 'description', 'text'],
          })
        : null;
    const main =
      typeof item === 'object' && item != null
        ? Boolean((item as Record<string, unknown>).main)
        : false;

    result.push({
      code,
      name: name && name !== code ? name : null,
      main,
    });
  }

  return result;
}

export function stripLargeAnalysisFields<T>(value: T): T {
  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) {
      return current.map((entry) => visit(entry));
    }

    if (!current || typeof current !== 'object') {
      return current;
    }

    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
      if (LARGE_ANALYSIS_KEYS.has(key)) continue;
      next[key] = visit(entry);
    }
    return next;
  };

  return visit(value) as T;
}

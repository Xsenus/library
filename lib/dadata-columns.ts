import { dbBitrix } from './db-bitrix';

const COLUMN_SPECS: Record<
  'status' | 'startedAt' | 'finishedAt' | 'progress' | 'durationMs' | 'okFlag' | 'serverError' | 'attempts',
  string[]
> = {
  status: ['analysis_status', 'analysis_state', 'analysis_stage'],
  startedAt: ['analysis_started_at', 'analysis_last_start', 'analysis_last_started_at'],
  finishedAt: ['analysis_finished_at', 'analysis_last_finish', 'analysis_last_finished_at'],
  progress: ['analysis_progress', 'analysis_percent', 'analysis_ratio'],
  durationMs: ['analysis_duration_ms', 'analysis_last_duration_ms', 'analysis_duration'],
  attempts: ['analysis_attempts', 'analysis_retry_count'],
  okFlag: ['analysis_ok'],
  serverError: ['server_error', 'analysis_server_error'],
};

const COLUMN_DEFAULTS: Record<
  keyof typeof COLUMN_SPECS,
  | {
      name: string;
      type: string;
      default?: string;
    }
  | null
> = {
  status: { name: 'analysis_status', type: 'text' },
  startedAt: { name: 'analysis_started_at', type: 'timestamp with time zone' },
  finishedAt: { name: 'analysis_finished_at', type: 'timestamp with time zone' },
  progress: { name: 'analysis_progress', type: 'double precision' },
  durationMs: { name: 'analysis_duration_ms', type: 'integer' },
  attempts: { name: 'analysis_attempts', type: 'integer', default: '0' },
  okFlag: { name: 'analysis_ok', type: 'integer', default: '0' },
  serverError: { name: 'analysis_server_error', type: 'integer', default: '0' },
};

export type DadataColumns = {
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  progress: string | null;
  durationMs: string | null;
  okFlag: string | null;
  serverError: string | null;
  attempts: string | null;
};

let cachedColumns: { columns: DadataColumns; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getDadataColumns(): Promise<DadataColumns> {
  const now = Date.now();
  if (cachedColumns && now - cachedColumns.ts < CACHE_TTL_MS) {
    return cachedColumns.columns;
  }

  let res = await dbBitrix.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dadata_result'`,
  );
  const names = new Set((res.rows ?? []).map((row) => row.column_name));

  const ensureColumn = async (key: keyof typeof COLUMN_DEFAULTS) => {
    const definition = COLUMN_DEFAULTS[key];
    if (!definition) return false;
    if (COLUMN_SPECS[key].some((candidate) => names.has(candidate))) {
      return false;
    }

    const defaultSql = definition.default ? ` DEFAULT ${definition.default}` : '';
    try {
      await dbBitrix.query(
        `ALTER TABLE dadata_result ADD COLUMN IF NOT EXISTS "${definition.name}" ${definition.type}${defaultSql}`,
      );
      return true;
    } catch (error) {
      console.warn(`failed to add ${definition.name} column to dadata_result`, error);
      return false;
    }
  };

  // Попробуем добавить отсутствующие основные служебные поля, чтобы обновления статуса и прогресса
  // больше не падали на базах без новых колонок.
  let schemaChanged = false;
  for (const key of Object.keys(COLUMN_DEFAULTS) as (keyof typeof COLUMN_DEFAULTS)[]) {
    const added = await ensureColumn(key);
    schemaChanged = schemaChanged || added;
  }

  if (schemaChanged) {
    res = await dbBitrix.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dadata_result'`,
    );
    names.clear();
    for (const row of res.rows ?? []) {
      names.add(row.column_name);
    }
  }

  const columns: DadataColumns = {
    status: null,
    startedAt: null,
    finishedAt: null,
    progress: null,
    durationMs: null,
    okFlag: null,
    serverError: null,
    attempts: null,
  };

  (Object.keys(COLUMN_SPECS) as (keyof typeof COLUMN_SPECS)[]).forEach((key) => {
    const match = COLUMN_SPECS[key].find((candidate) => names.has(candidate));
    (columns as any)[key] = match ?? null;
  });

  cachedColumns = { columns, ts: now };
  return columns;
}

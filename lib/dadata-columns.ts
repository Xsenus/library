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

  const res = await dbBitrix.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dadata_result'`,
  );
  const names = new Set((res.rows ?? []).map((row) => row.column_name));

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

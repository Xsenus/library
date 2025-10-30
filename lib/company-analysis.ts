import { db } from './db';
import {
  companyAnalysisRowSchema,
  type CompanyAnalysisRow,
  type CompanyAnalysisState,
  type CompanyAnalysisInfo,
} from './validators';

let ensurePromise: Promise<void> | null = null;

async function ensureSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS company_analysis_state (
          inn TEXT PRIMARY KEY,
          websites TEXT[] DEFAULT '{}'::text[],
          emails TEXT[] DEFAULT '{}'::text[],
          status TEXT NOT NULL DEFAULT 'idle',
          stage TEXT NULL,
          progress INTEGER NOT NULL DEFAULT 0,
          last_started_at TIMESTAMPTZ NULL,
          last_finished_at TIMESTAMPTZ NULL,
          duration_seconds INTEGER NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          rating NUMERIC NULL,
          info JSONB DEFAULT '{}'::jsonb,
          analysis_ok BOOLEAN DEFAULT FALSE,
          server_error BOOLEAN DEFAULT FALSE,
          no_valid_site BOOLEAN DEFAULT FALSE,
          stop_requested BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await db.query(`
        DO $do$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_proc WHERE proname = 'company_analysis_state_touch'
          ) THEN
            CREATE FUNCTION company_analysis_state_touch()
            RETURNS TRIGGER AS $fn$
            BEGIN
              NEW.updated_at = NOW();
              RETURN NEW;
            END;
            $fn$ LANGUAGE plpgsql;
          END IF;
        END;
        $do$;
      `);

      await db.query(`
        DO $do$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_trigger WHERE tgname = 'company_analysis_state_touch_trg'
          ) THEN
            CREATE TRIGGER company_analysis_state_touch_trg
            BEFORE UPDATE ON company_analysis_state
            FOR EACH ROW
            EXECUTE FUNCTION company_analysis_state_touch();
          END IF;
        END;
        $do$;
      `);
    })();
  }
  return ensurePromise;
}

function normalizeArray(value: any): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : String(v ?? '')).trim())
      .filter((v) => v.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;\n]+/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  return [];
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseRow(row: any): CompanyAnalysisRow {
  let infoRaw: any = null;
  if (row.info && typeof row.info === 'string') {
    try {
      infoRaw = JSON.parse(row.info);
    } catch {
      infoRaw = null;
    }
  } else if (row.info && typeof row.info === 'object') {
    infoRaw = row.info;
  }
  const parsed = companyAnalysisRowSchema.parse({
    inn: row.inn,
    status: row.status ?? 'idle',
    stage: row.stage ?? null,
    progress: (() => {
      if (row.progress == null || row.progress === '') return 0;
      const num = Number(row.progress);
      return Number.isFinite(num) ? num : 0;
    })(),
    last_started_at: toIso(row.last_started_at),
    last_finished_at: toIso(row.last_finished_at),
    duration_seconds: (() => {
      if (row.duration_seconds == null || row.duration_seconds === '') return null;
      const num = Number(row.duration_seconds);
      return Number.isFinite(num) ? num : null;
    })(),
    attempts: (() => {
      if (row.attempts == null || row.attempts === '') return null;
      const num = Number(row.attempts);
      return Number.isFinite(num) ? num : null;
    })(),
    rating: (() => {
      if (row.rating == null || row.rating === '') return null;
      const num = Number(row.rating);
      return Number.isFinite(num) ? num : null;
    })(),
    stop_requested: !!row.stop_requested,
    info: infoRaw,
    flags: {
      analysis_ok: !!row.analysis_ok,
      server_error: !!row.server_error,
      no_valid_site: !!row.no_valid_site,
    },
    websites: normalizeArray(row.websites),
    emails: normalizeArray(row.emails),
  });
  return parsed;
}

export async function getCompanyAnalysisStateMap(
  inns: string[],
): Promise<Map<string, CompanyAnalysisRow>> {
  await ensureSchema();
  const unique = Array.from(new Set(inns.filter((v) => typeof v === 'string' && v.trim())));
  if (unique.length === 0) return new Map();
  const { rows } = await db.query(
    `
      SELECT
        inn,
        websites,
        emails,
        status,
        stage,
        progress,
        last_started_at,
        last_finished_at,
        duration_seconds,
        attempts,
        rating,
        info,
        analysis_ok,
        server_error,
        no_valid_site,
        stop_requested
      FROM company_analysis_state
      WHERE inn = ANY($1::text[])
    `,
    [unique],
  );
  const map = new Map<string, CompanyAnalysisRow>();
  for (const row of rows) {
    const parsed = parseRow(row);
    map.set(parsed.inn, parsed);
  }
  return map;
}

export async function startCompanyAnalysis(inns: string[]): Promise<CompanyAnalysisRow[]> {
  await ensureSchema();
  const unique = Array.from(new Set(inns.filter((v) => typeof v === 'string' && v.trim())));
  if (unique.length === 0) return [];

  const { rows } = await db.query(
    `
      WITH payload AS (
        SELECT DISTINCT TRIM(inn) AS inn FROM UNNEST($1::text[]) AS t(inn)
      ),
      ins AS (
        INSERT INTO company_analysis_state (
          inn,
          status,
          stage,
          progress,
          last_started_at,
          stop_requested,
          attempts,
          analysis_ok,
          server_error,
          no_valid_site,
          rating,
          duration_seconds
        )
        SELECT
          p.inn,
          'running',
          'init',
          0,
          NOW(),
          FALSE,
          1,
          FALSE,
          FALSE,
          FALSE,
          NULL,
          NULL
        FROM payload p
        ON CONFLICT (inn) DO UPDATE SET
          status = 'running',
          stage = 'init',
          progress = 0,
          last_started_at = NOW(),
          last_finished_at = NULL,
          duration_seconds = NULL,
          rating = NULL,
          stop_requested = FALSE,
          attempts = company_analysis_state.attempts + 1,
          analysis_ok = FALSE,
          server_error = FALSE,
          no_valid_site = FALSE,
          info = '{}'::jsonb
        RETURNING *
      )
      SELECT * FROM ins
    `,
    [unique],
  );
  return rows.map(parseRow);
}

export async function queueCompanyAnalysis(inns: string[]): Promise<CompanyAnalysisRow[]> {
  await ensureSchema();
  const unique = Array.from(new Set(inns.filter((v) => typeof v === 'string' && v.trim())));
  if (unique.length === 0) return [];
  const { rows } = await db.query(
    `
      WITH payload AS (
        SELECT DISTINCT TRIM(inn) AS inn FROM UNNEST($1::text[]) AS t(inn)
      ),
      ins AS (
        INSERT INTO company_analysis_state (inn, status, stage, progress, stop_requested)
        SELECT
          p.inn,
          'queued',
          'init',
          0,
          FALSE
        FROM payload p
        ON CONFLICT (inn) DO UPDATE SET
          status = 'queued',
          stage = 'init',
          progress = 0,
          stop_requested = FALSE
        RETURNING *
      )
      SELECT * FROM ins
    `,
    [unique],
  );
  return rows.map(parseRow);
}

export async function stopCompanyAnalysis(inns: string[]): Promise<CompanyAnalysisRow[]> {
  await ensureSchema();
  const unique = Array.from(new Set(inns.filter((v) => typeof v === 'string' && v.trim())));
  if (unique.length === 0) return [];
  const { rows } = await db.query(
    `
      UPDATE company_analysis_state
      SET
        stop_requested = TRUE,
        status = CASE WHEN status = 'running' THEN 'stopping' ELSE status END
      WHERE inn = ANY($1::text[])
      RETURNING *
    `,
    [unique],
  );
  return rows.map(parseRow);
}

export type CompanyAnalysisUpdate = {
  inn: string;
  status?: CompanyAnalysisState['status'];
  stage?: string | null;
  progress?: number | null;
  rating?: number | null;
  analysisOk?: boolean | null;
  serverError?: boolean | null;
  noValidSite?: boolean | null;
  info?: CompanyAnalysisInfo | null;
  websites?: string[] | null;
  emails?: string[] | null;
  lastStartedAt?: string | Date | null;
  lastFinishedAt?: string | Date | null;
  durationSeconds?: number | null;
  stopRequested?: boolean | null;
};

export async function updateCompanyAnalysis(
  update: CompanyAnalysisUpdate,
): Promise<CompanyAnalysisRow | null> {
  await ensureSchema();
  const inn = update.inn?.trim();
  if (!inn) return null;
  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (update.status !== undefined) {
    sets.push(`status = $${i++}`);
    values.push(update.status);
  }
  if (update.stage !== undefined) {
    sets.push(`stage = $${i++}`);
    values.push(update.stage);
  }
  if (update.progress !== undefined) {
    sets.push(`progress = $${i++}`);
    values.push(update.progress ?? 0);
  }
  if (update.rating !== undefined) {
    sets.push(`rating = $${i++}`);
    values.push(update.rating);
  }
  if (update.analysisOk !== undefined) {
    sets.push(`analysis_ok = $${i++}`);
    values.push(update.analysisOk);
  }
  if (update.serverError !== undefined) {
    sets.push(`server_error = $${i++}`);
    values.push(update.serverError);
  }
  if (update.noValidSite !== undefined) {
    sets.push(`no_valid_site = $${i++}`);
    values.push(update.noValidSite);
  }
  if (update.info !== undefined) {
    sets.push(`info = $${i++}`);
    values.push(update.info ? JSON.stringify(update.info) : null);
  }
  if (update.websites !== undefined) {
    sets.push(`websites = $${i++}`);
    values.push(update.websites ? normalizeArray(update.websites) : []);
  }
  if (update.emails !== undefined) {
    sets.push(`emails = $${i++}`);
    values.push(update.emails ? normalizeArray(update.emails) : []);
  }
  if (update.lastStartedAt !== undefined) {
    sets.push(`last_started_at = $${i++}`);
    values.push(update.lastStartedAt);
  }
  if (update.lastFinishedAt !== undefined) {
    sets.push(`last_finished_at = $${i++}`);
    values.push(update.lastFinishedAt);
  }
  if (update.durationSeconds !== undefined) {
    sets.push(`duration_seconds = $${i++}`);
    values.push(update.durationSeconds);
  }
  if (update.stopRequested !== undefined) {
    sets.push(`stop_requested = $${i++}`);
    values.push(update.stopRequested);
  }

  if (sets.length === 0) return null;

  const { rows } = await db.query(
    `
      UPDATE company_analysis_state
      SET ${sets.join(', ')}
      WHERE inn = $${i}
      RETURNING *
    `,
    [...values, inn],
  );
  if (!rows[0]) return null;
  return parseRow(rows[0]);
}

export async function ensureCompanyAnalysisLoaded() {
  await ensureSchema();
}

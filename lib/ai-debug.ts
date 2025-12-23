import { z } from 'zod';
import { dbBitrix } from './db-bitrix';

export type AiDebugEventType = 'request' | 'response' | 'error' | 'notification';

export type AiDebugEventRecord = {
  id: number;
  created_at: string;
  event_type: AiDebugEventType;
  source?: string | null;
  direction?: 'request' | 'response' | null;
  request_id?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  message?: string | null;
  payload?: any;
};

type NotificationKey =
  | 'analysis_start'
  | 'analysis_success'
  | 'few_products'
  | 'domain_unavailable'
  | 'domain_wrong_okved'
  | 'no_domains'
  | 'all_domains_wrong'
  | 'no_domains_at_all';

export const aiDebugEventSchema = z.object({
  type: z.enum(['request', 'response', 'error', 'notification']) as z.ZodType<AiDebugEventType>,
  source: z.string().trim().max(128).optional(),
  direction: z.enum(['request', 'response']).optional(),
  requestId: z.string().trim().max(128).optional(),
  companyId: z.string().trim().max(128).optional(),
  companyName: z.string().trim().max(512).optional(),
  message: z.string().trim().max(4000).optional(),
  payload: z.any().optional(),
  notificationKey: z
    .enum([
      'analysis_start',
      'analysis_success',
      'few_products',
      'domain_unavailable',
      'domain_wrong_okved',
      'no_domains',
      'all_domains_wrong',
      'no_domains_at_all',
    ])
    .optional(),
  errorKey: z.enum(['server_retry', 'server_stop']).optional(),
  attempt: z.coerce.number().int().min(1).max(3).optional(),
});

type AiDebugEventInput = z.infer<typeof aiDebugEventSchema>;

let ensured = false;

async function ensureTables() {
  if (ensured) return;

  await dbBitrix.query(`
    CREATE TABLE IF NOT EXISTS ai_debug_events (
      id BIGSERIAL PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      event_type text NOT NULL,
      source text,
      direction text,
      request_id text,
      company_id text,
      company_name text,
      message text,
      payload jsonb
    )
  `);

  await dbBitrix.query(`CREATE INDEX IF NOT EXISTS idx_ai_debug_events_created_at ON ai_debug_events (created_at DESC)`);
  await dbBitrix.query(`CREATE INDEX IF NOT EXISTS idx_ai_debug_events_type ON ai_debug_events (event_type)`);
  await dbBitrix.query(`CREATE INDEX IF NOT EXISTS idx_ai_debug_events_request_id ON ai_debug_events (request_id)`);
  await dbBitrix.query(`CREATE INDEX IF NOT EXISTS idx_ai_debug_events_company_id ON ai_debug_events (company_id)`);

  await dbBitrix.query(`ALTER TABLE dadata_result ADD COLUMN IF NOT EXISTS server_error int`);
  await dbBitrix.query(`ALTER TABLE dadata_result ADD COLUMN IF NOT EXISTS analysis_ok int`);
  await dbBitrix.query(`ALTER TABLE dadata_result ADD COLUMN IF NOT EXISTS analysis_started_at timestamptz`);

  ensured = true;
}

async function updateDadataFlags(
  companyId: string | undefined,
  updates: Partial<{ server_error: number; analysis_ok: number; analysis_started_at: 'now' }>,
) {
  if (!companyId) return;
  const sets: string[] = [];
  const params: any[] = [];

  if (updates.server_error != null) {
    sets.push(`server_error = $${sets.length + 1}`);
    params.push(updates.server_error);
  }
  if (updates.analysis_ok != null) {
    sets.push(`analysis_ok = $${sets.length + 1}`);
    params.push(updates.analysis_ok);
  }
  if (updates.analysis_started_at === 'now') {
    sets.push(`analysis_started_at = COALESCE(analysis_started_at, now())`);
  }

  if (!sets.length) return;

  params.push(companyId);
  await dbBitrix.query(`UPDATE dadata_result SET ${sets.join(', ')} WHERE inn = $${params.length}`, params);
}

function formatNotificationMessage(key: NotificationKey, companyName?: string | null): string {
  const safeName = companyName?.trim() || '—';
  switch (key) {
    case 'analysis_start':
      return `Начат анализ компании ${safeName}`;
    case 'analysis_success':
      return `Удачно завершен анализ компании ${safeName}`;
    case 'few_products':
      return `Сайт компании ${safeName} содержит мало продукции, делаем повторный анализ.`;
    case 'domain_unavailable':
      return `Сайт компании ${safeName} не доступен, пропускаем домен.`;
    case 'domain_wrong_okved':
      return `Сайт компании ${safeName} не соответствует ОКВЭД, пропускаем домен.`;
    case 'no_domains':
      return `Компания ${safeName} не имеет ДОСТУПНЫХ доменов для парсинга, пропускаем AI-анализ доменов, анализируем по ОКВЭД`;
    case 'all_domains_wrong':
      return `Все домены компании ${safeName} не соответствуют ОКВЭД/названию, анализируем по прямому ОКВЭД`;
    case 'no_domains_at_all':
      return `Компания ${safeName} не имеет доменов для парсинга, пропускаем AI-анализ доменов, анализируем по ОКВЭД`;
    default:
      return '';
  }
}

async function applyTemplates(entry: AiDebugEventInput): Promise<{ message?: string; flagUpdates?: Record<string, any> }>
{
  if (entry.type === 'notification' && entry.notificationKey) {
    const message = formatNotificationMessage(entry.notificationKey as NotificationKey, entry.companyName);
    const flagUpdates: Record<string, any> = {};

    if (entry.notificationKey === 'analysis_start') {
      flagUpdates.server_error = 0;
      flagUpdates.analysis_ok = 0;
      flagUpdates.analysis_started_at = 'now';
    }
    if (entry.notificationKey === 'analysis_success') {
      flagUpdates.analysis_ok = 1;
    }

    return { message, flagUpdates };
  }

  if (entry.type === 'error' && entry.errorKey) {
    if (entry.errorKey === 'server_retry') {
      return {
        message: 'RU сервер не доступен, делаем попытку',
        flagUpdates: { server_error: 1, analysis_started_at: 'now' },
      };
    }
    if (entry.errorKey === 'server_stop') {
      return {
        message: 'RU сервер не доступен, остановили анализ',
        flagUpdates: { server_error: 1 },
      };
    }
  }

  return {};
}

export async function logAiDebugEvent(rawEntry: AiDebugEventInput): Promise<void> {
  await ensureTables();

  const { flagUpdates, message } = await applyTemplates(rawEntry);

  const entry = {
    ...rawEntry,
    message: rawEntry.message ?? message ?? null,
    direction: rawEntry.direction ?? (rawEntry.type === 'request' ? 'request' : rawEntry.type === 'response' ? 'response' : null),
  };

  const payload = entry.payload == null ? null : entry.payload;

  await dbBitrix.query(
    `
      INSERT INTO ai_debug_events (event_type, source, direction, request_id, company_id, company_name, message, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      entry.type,
      entry.source ?? null,
      entry.direction ?? null,
      entry.requestId ?? null,
      entry.companyId ?? null,
      entry.companyName ?? null,
      entry.message ?? null,
      payload == null ? null : JSON.stringify(payload),
    ],
  );

  if (flagUpdates) {
    try {
      await updateDadataFlags(entry.companyId, flagUpdates as any);
    } catch (error) {
      console.warn('Failed to update dadata_result flags for AI debug event', error);
    }
  }
}

export async function listAiDebugEvents(params: {
  categories?: ('traffic' | 'error' | 'notification')[];
  page?: number;
  pageSize?: number;
  companyId?: string;
}): Promise<{ items: AiDebugEventRecord[]; total: number; page: number; pageSize: number }> {
  await ensureTables();

  const rawPage = Number(params.page);
  const rawPageSize = Number(params.pageSize);

  const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1);
  const pageSize = Math.min(Math.max(1, Number.isFinite(rawPageSize) ? rawPageSize : 30), 100);

  const filters: string[] = [];
  const filterParams: any[] = [];

  const cats = params.categories?.length ? params.categories : ['traffic', 'error', 'notification'];
  const typeConditions: string[] = [];

  if (cats.includes('traffic')) typeConditions.push("event_type IN ('request','response')");
  if (cats.includes('error')) typeConditions.push("event_type = 'error'");
  if (cats.includes('notification')) typeConditions.push("event_type = 'notification'");

  if (typeConditions.length === 1) {
    filters.push(typeConditions[0]);
  } else if (typeConditions.length > 1) {
    filters.push(`(${typeConditions.join(' OR ')})`);
  }

  if (params.companyId) {
    filterParams.push(params.companyId);
    filters.push(`company_id = $${filterParams.length}`);
  }

  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const { rows } = await dbBitrix.query<AiDebugEventRecord>(
    `
      SELECT id, created_at, event_type, source, direction, request_id, company_id, company_name, message, payload
      FROM ai_debug_events
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT $1 OFFSET $2
    `,
    [...filterParams, pageSize, (page - 1) * pageSize],
  );

  const totalRes = await dbBitrix.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ai_debug_events ${whereSql}`,
    filterParams,
  );
  const total = Number(totalRes.rows?.[0]?.count ?? 0);

  return { items: rows ?? [], total, page, pageSize };
}

export async function deleteAllAiDebugEvents() {
  await ensureTables();
  await dbBitrix.query(`TRUNCATE ai_debug_events RESTART IDENTITY`);
}

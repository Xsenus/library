// lib/quota.ts
import { db } from '@/lib/db';

/**
 * Базовый лимит по умолчанию для НЕ-сотрудников, если в БД нет персонального.
 */
export const DEFAULT_DAILY_LIMIT = 10;

/**
 * Таймзона, в которой считаем "сутки".
 * Если нужна другая — поменяйте здесь один раз.
 */
export const QUOTA_TIMEZONE = 'Europe/Amsterdam';

export type ResolvedLimit = { unlimited: true; limit: null } | { unlimited: false; limit: number };

/**
 * Унифицированный резолвер лимита пользователя.
 * - Если у пользователя в БД (users_irbis.limits) есть положительное значение — используем его.
 * - Иначе, если пользователь является сотрудником (isWorker=true) — безлимит.
 * - Иначе — DEFAULT_DAILY_LIMIT.
 */
export async function resolveUserLimit(userId: number, isWorker: boolean): Promise<ResolvedLimit> {
  const { rows } = await db.query<{ lim: number | null }>(
    `SELECT limits::int AS lim FROM users_irbis WHERE id = $1 LIMIT 1`,
    [userId],
  );

  const lim = rows?.[0]?.lim ?? null;

  if (lim && lim > 0) return { unlimited: false, limit: lim };
  if (isWorker) return { unlimited: true, limit: null };
  return { unlimited: false, limit: DEFAULT_DAILY_LIMIT };
}

/**
 * SQL-условие "сегодня", независимое от таймзоны сервера.
 * Пример использования: WHERE ${dayCond('open_at')}
 */
export function dayCond(column: string = 'open_at', tz: string = QUOTA_TIMEZONE): string {
  // (ts|js) -> sql фрагмент. Вставляется в строку запроса как есть.
  return `( (${column} AT TIME ZONE '${tz}')::date = (now() AT TIME ZONE '${tz}')::date )`;
}

/**
 * Считает, сколько уникальных карточек оборудования пользователь открыл СЕГОДНЯ.
 * Важно: учитывает таймзону QUOTA_TIMEZONE.
 */
export async function countUsedToday(userId: number): Promise<number> {
  const cond = dayCond('open_at', QUOTA_TIMEZONE);
  const { rows } = await db.query<{ used: string | number }>(
    `
      SELECT COUNT(DISTINCT equipment_id)::int AS used
      FROM users_activity
      WHERE user_id = $1 AND ${cond}
    `,
    [userId],
  );
  const raw = rows?.[0]?.used ?? 0;
  return typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
}

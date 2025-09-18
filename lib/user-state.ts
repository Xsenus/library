import { db } from '@/lib/db';

export type LiveUserState = {
  id: number;
  activated: boolean;
  irbis_worker: boolean;
};

export async function getLiveUserState(userId: number): Promise<LiveUserState | null> {
  const sql = `
    SELECT id::int, activated, irbis_worker
    FROM users_irbis
    WHERE id = $1
    LIMIT 1
  `;
  const { rows } = await db.query(sql, [userId]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    activated: Boolean(r.activated),
    irbis_worker: Boolean(r.irbis_worker),
  };
}

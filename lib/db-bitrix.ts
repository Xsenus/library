// lib/db-bitrix.ts
import { Pool } from 'pg';

// Separate connection pool for bitrix_data database (dadata_result table)
const sslMode = (process.env.BITRIX_DB_SSL ?? '').toLowerCase();

export const dbBitrix = new Pool({
  host: process.env.BITRIX_DB_HOST,
  port: Number(process.env.BITRIX_DB_PORT ?? 5432),
  database: process.env.BITRIX_DB_NAME,
  user: process.env.BITRIX_DB_USER,
  password: process.env.BITRIX_DB_PASSWORD,
  ssl: sslMode === 'require' || sslMode === 'enable' ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
});

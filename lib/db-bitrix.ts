import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

// Separate connection pool for bitrix_data database (dadata_result table)
const sslMode = (process.env.BITRIX_DB_SSL ?? '').toLowerCase();

function createBitrixPool() {
  return new Pool({
    host: process.env.BITRIX_DB_HOST,
    port: Number(process.env.BITRIX_DB_PORT ?? 5432),
    database: process.env.BITRIX_DB_NAME,
    user: process.env.BITRIX_DB_USER,
    password: process.env.BITRIX_DB_PASSWORD,
    ssl: sslMode === 'require' || sslMode === 'enable' ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

declare global {
  var __libraryMainBitrixDb: Pool | undefined;
}

type BitrixDatabase = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: any[],
  ): Promise<QueryResult<T>>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
};

const bitrixPool = globalThis.__libraryMainBitrixDb ?? createBitrixPool();

export const dbBitrix: BitrixDatabase = bitrixPool;

if (process.env.NODE_ENV !== 'production') {
  globalThis.__libraryMainBitrixDb = bitrixPool;
}

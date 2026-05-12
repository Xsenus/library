import { dbBitrix } from '@/lib/db-bitrix';

type ColumnRow = {
  column_name: string;
};

type InnRow = {
  inn: string | null;
};

const PP719_TABLE = 'pp719companies';
const PP719_INN_COLUMN_CANDIDATES = ['inn', 'ИНН', 'Инн', 'инн', 'INN'];
const PP719_CACHE_TTL_MS = 5 * 60 * 1000;

let pp719InnCache: { items: string[]; ts: number } | null = null;

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function resolvePp719InnColumn(): Promise<string | null> {
  const { rows } = await dbBitrix.query<ColumnRow>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [PP719_TABLE],
  );

  const columns = rows.map((row) => row.column_name);
  const normalizedColumns = new Map(columns.map((column) => [column.toLowerCase(), column]));

  for (const candidate of PP719_INN_COLUMN_CANDIDATES) {
    const exact = columns.find((column) => column === candidate);
    if (exact) return exact;

    const normalized = normalizedColumns.get(candidate.toLowerCase());
    if (normalized) return normalized;
  }

  const fuzzy = columns.find((column) => column.toLowerCase().includes('inn') || column.toLowerCase().includes('инн'));
  return fuzzy ?? null;
}

export async function loadPp719Inns(): Promise<string[]> {
  const now = Date.now();
  if (pp719InnCache && now - pp719InnCache.ts < PP719_CACHE_TTL_MS) {
    return pp719InnCache.items;
  }

  try {
    const innColumn = await resolvePp719InnColumn();
    if (!innColumn) {
      console.warn('pp719companies: INN column was not found');
      pp719InnCache = { items: [], ts: now };
      return [];
    }

    const table = quoteIdent(PP719_TABLE);
    const column = quoteIdent(innColumn);
    const { rows } = await dbBitrix.query<InnRow>(
      `
        SELECT DISTINCT btrim(${column}::text) AS inn
        FROM ${table}
        WHERE ${column} IS NOT NULL
          AND btrim(${column}::text) <> ''
      `,
    );

    const items = rows.map((row) => String(row.inn ?? '').trim()).filter(Boolean);
    pp719InnCache = { items, ts: now };
    return items;
  } catch (error) {
    console.warn('pp719companies: failed to load INNs', error);
    pp719InnCache = { items: [], ts: now };
    return [];
  }
}


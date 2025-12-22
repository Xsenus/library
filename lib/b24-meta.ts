import { db } from './db';

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS b24_company_meta (
    inn varchar(20) PRIMARY KEY,
    company_id text,
    assigned_by_id integer,
    assigned_name text,
    color_id integer,
    color_label text,
    color_xml_id text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    emails jsonb,
    web_sites jsonb,
    contacts_updated_at timestamptz
  );
`;

const ALTER_SQL: string[] = [
  "ALTER TABLE b24_company_meta ADD COLUMN IF NOT EXISTS emails jsonb",
  "ALTER TABLE b24_company_meta ADD COLUMN IF NOT EXISTS web_sites jsonb",
  "ALTER TABLE b24_company_meta ADD COLUMN IF NOT EXISTS contacts_updated_at timestamptz",
  "ALTER TABLE b24_company_meta ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW()",
  "ALTER TABLE b24_company_meta ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW()",
  "ALTER TABLE b24_company_meta ADD COLUMN IF NOT EXISTS company_id text",
  "ALTER TABLE b24_company_meta ADD COLUMN IF NOT EXISTS assigned_by_id integer",
  "ALTER TABLE b24_company_meta ADD COLUMN IF NOT EXISTS assigned_name text",
  "ALTER TABLE b24_company_meta ADD COLUMN IF NOT EXISTS color_id integer",
  "ALTER TABLE b24_company_meta ADD COLUMN IF NOT EXISTS color_label text",
  "ALTER TABLE b24_company_meta ADD COLUMN IF NOT EXISTS color_xml_id text",
];

let ensurePromise: Promise<void> | null = null;

export async function ensureCompanyMetaTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await db.query(TABLE_SQL);
      for (const sql of ALTER_SQL) {
        await db.query(sql);
      }
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

export type CompanyMetaRow = {
  inn: string;
  company_id: string | null;
  assigned_by_id: number | null;
  assigned_name: string | null;
  color_id: number | null;
  color_label: string | null;
  color_xml_id: string | null;
  updated_at: Date | null;
  created_at?: Date | null;
  emails?: any;
  web_sites?: any;
  contacts_updated_at?: Date | null;
};


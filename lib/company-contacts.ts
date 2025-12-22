import { b24BatchJson, chunk } from './b24';
import { db } from './db';
import { dbBitrix } from './db-bitrix';
import { CompanyMetaRow, ensureCompanyMetaTable } from './b24-meta';

type ContactsItem = {
  inn: string;
  companyId?: string;
  emails?: string[];
  webSites?: string[];
  updatedAt?: string;
};

const UF_FIELDS = (process.env.B24_UF_INN_FIELDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const FALLBACK_UF = process.env.B24_UF_INN_FIELD || 'UF_CRM_1705778266246';
const UF_LIST = UF_FIELDS.length ? UF_FIELDS : [FALLBACK_UF];

const BATCH_LIMIT = 50;
const DEFAULT_MAX_AGE_MINUTES = 24 * 60;

const notEmpty = (s: string) => !!s && s.trim().length > 0;

function collectMultifieldValues(input: any): string[] {
  const out: string[] = [];
  if (!Array.isArray(input)) return out;
  for (const item of input) {
    const val =
      item && typeof item === 'object'
        ? item?.VALUE ?? item?.value ?? null
        : item;
    if (typeof val !== 'string') continue;
    const trim = val.trim();
    if (!trim) continue;
    out.push(trim);
  }
  return out;
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trim = value.trim();
  if (!trim || !trim.includes('@') || /\s/.test(trim)) return null;
  return trim.toLowerCase();
}

function normalizeSite(value: any): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^[\s'"<>]+|[\s'"<>]+$/g, '')
    .replace(/^[({\[]+/, '')
    .replace(/[)}\]]+$/, '')
    .replace(/[.,;:!]+$/, '');

  if (!cleaned) return null;

  const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

  try {
    const url = new URL(withProtocol);
    if (!url.hostname || !url.hostname.includes('.')) return null;

    const sanitizedHost = url.hostname
      .replace(/^[^a-z0-9]+/i, '')
      .replace(/[^a-z0-9.-]+/gi, '')
      .replace(/^[.-]+|[.-]+$/g, '');

    if (!sanitizedHost || !sanitizedHost.includes('.')) return null;

    return sanitizedHost.toLowerCase();
  } catch {
    return null;
  }
}

function addDomainFromEmail(email: string | null | undefined, collector: string[]) {
  if (!email) return;
  const atIndex = email.indexOf('@');
  if (atIndex === -1 || atIndex === email.length - 1) return;
  const domain = email.slice(atIndex + 1);
  const normalizedDomain = normalizeSite(domain);
  if (normalizedDomain) collector.push(normalizedDomain);
}

function appendValue<T extends string>(collector: T[], value: any): void {
  if (Array.isArray(value)) {
    value.forEach((item) => appendValue(collector, item));
    return;
  }
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const trim = String(value).trim();
    if (trim) collector.push(trim as T);
  }
}

function uniqueStrings(values: any[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const low = trimmed.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(trimmed);
  }
  return out;
}

async function getCachedContacts(
  inns: string[],
  staleBefore: number,
): Promise<{ fresh: Record<string, ContactsItem>; missing: string[]; stale: string[] }> {
  if (!inns.length)
    return { fresh: {} as Record<string, ContactsItem>, missing: inns, stale: [] };
  await ensureCompanyMetaTable();

  const { rows } = await db.query<CompanyMetaRow>(
    `SELECT inn, company_id, emails, web_sites, contacts_updated_at FROM b24_company_meta WHERE inn = ANY($1::text[])`,
    [inns],
  );

  const fresh: Record<string, ContactsItem> = {};
  const missing: string[] = [];
  const stale: string[] = [];

  const rowsByInn = new Map(rows.map((r) => [r.inn, r] as const));

  for (const inn of inns) {
    const row = rowsByInn.get(inn);
    if (!row) {
      missing.push(inn);
      continue;
    }
    const ts = row.contacts_updated_at?.getTime?.();
    if (ts && ts >= staleBefore) {
      fresh[inn] = {
        inn,
        companyId: row.company_id ?? undefined,
        emails: Array.isArray(row.emails) ? row.emails : undefined,
        webSites: Array.isArray(row.web_sites) ? row.web_sites : undefined,
        updatedAt: row.contacts_updated_at?.toISOString(),
      };
    } else {
      stale.push(inn);
    }
  }

  return { fresh, missing, stale };
}

function parseStringArray(val: any): string[] {
  if (val == null) return [];
  if (Array.isArray(val)) {
    return uniqueStrings(val.map((v) => (v == null ? '' : String(v))));
  }
  if (typeof val === 'string') {
    return uniqueStrings(val.split(/[\s,;]+/));
  }
  return [];
}

async function fetchFromBitrix(inns: string[], debug: boolean) {
  if (!inns.length) return { items: [] as ContactsItem[], previewCmd: [] as string[] };

  const previewCmd: string[] = [];
  const items: ContactsItem[] = [];

  for (const pack of chunk(inns, BATCH_LIMIT)) {
    if (!pack.length) continue;

    const cmd: Record<string, string> = {};
    const keys: Array<{ inn: string; cmdKeys: string[] }> = [];

    for (const inn of pack) {
      const cmdKeys: string[] = [];
      for (const uf of UF_LIST) {
        const key = `get_${uf}_${inn}`;
        cmd[key] =
          `crm.company.list?` +
          `filter[${uf}]=${encodeURIComponent(inn)}` +
          `&select[]=ID` +
          `&select[]=EMAIL` +
          `&select[]=WEB` +
          `&select[]=${encodeURIComponent(uf)}` +
          `&start=-1`;
        cmdKeys.push(key);
        if (debug) previewCmd.push(`${key}: ${cmd[key]}`);
      }
      keys.push({ inn, cmdKeys });
    }

    try {
      const r = await b24BatchJson(cmd, 0);
      const buckets = (r?.result?.result ?? {}) as Record<string, any>;

      for (const { inn, cmdKeys } of keys) {
        if (items.some((it) => it.inn === inn)) continue;
        let found: any | null = null;
        for (const k of cmdKeys) {
          const arr = buckets[k];
          if (Array.isArray(arr) && arr[0]) {
            found = arr[0];
            break;
          }
        }
        if (!found) continue;

        const emailCandidates: string[] = [];
        const siteCandidates: string[] = [];

        for (const email of collectMultifieldValues(found.EMAIL || [])) {
          const norm = normalizeEmail(email);
          if (norm) {
            emailCandidates.push(norm);
            addDomainFromEmail(norm, siteCandidates);
          }
        }

        for (const site of collectMultifieldValues(found.WEB || [])) {
          const normalizedSite = normalizeSite(site);
          if (normalizedSite) siteCandidates.push(normalizedSite);
        }

        items.push({
          inn,
          companyId: found.ID ? String(found.ID) : undefined,
          emails: uniqueStrings(emailCandidates),
          webSites: uniqueStrings(siteCandidates),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('Failed to fetch contacts from Bitrix24', error);
    }
  }

  return { items, previewCmd };
}

async function fetchFromBitrixData(inns: string[]) {
  if (!inns.length) return [] as ContactsItem[];
  try {
    const { rows } = await dbBitrix.query<{ inn: string; emails: any; web_sites: any }>(
      `SELECT inn, emails, web_sites FROM dadata_result WHERE inn = ANY($1::text[])`,
      [inns],
    );

    return rows.map((row) => ({
      inn: row.inn,
      emails: parseStringArray(row.emails)?.map((email) => normalizeEmail(email)).filter(Boolean) as string[] | undefined,
      webSites: parseStringArray(row.web_sites)
        ?.map((site) => normalizeSite(site))
        .filter(Boolean) as string[] | undefined,
      updatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.error('Failed to load contacts from bitrix_data', error);
    return [];
  }
}

async function saveContacts(items: ContactsItem[]) {
  if (!items.length) return;
  await ensureCompanyMetaTable();

  const cols = ['inn', 'company_id', 'emails', 'web_sites', 'contacts_updated_at'];
  const values: string[] = [];
  const params: any[] = [];

  items.forEach((item, idx) => {
    const base = idx * cols.length;
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
    params.push(
      item.inn,
      item.companyId ?? null,
      item.emails && item.emails.length ? JSON.stringify(item.emails) : null,
      item.webSites && item.webSites.length ? JSON.stringify(item.webSites) : null,
      item.updatedAt ? new Date(item.updatedAt) : new Date(),
    );
  });

  const sql = `
    INSERT INTO b24_company_meta (${cols.join(', ')})
    VALUES ${values.join(', ')}
    ON CONFLICT (inn) DO UPDATE SET
      company_id = COALESCE(EXCLUDED.company_id, b24_company_meta.company_id),
      emails = COALESCE(EXCLUDED.emails, b24_company_meta.emails),
      web_sites = COALESCE(EXCLUDED.web_sites, b24_company_meta.web_sites),
      contacts_updated_at = EXCLUDED.contacts_updated_at,
      updated_at = NOW();
  `;

  await db.query(sql, params);
}

function mergeContacts(bitrix: ContactsItem[], bitrixData: ContactsItem[]): ContactsItem[] {
  const merged: Record<string, ContactsItem> = {};

  const add = (item: ContactsItem) => {
    if (!item.inn) return;
    const existing = merged[item.inn] || { inn: item.inn };
    const emailCandidates: string[] = [];
    const siteCandidates: string[] = [];

    appendValue(emailCandidates, existing.emails || []);
    appendValue(siteCandidates, existing.webSites || []);

    appendValue(emailCandidates, item.emails || []);
    appendValue(siteCandidates, item.webSites || []);

    const normalizedEmails = uniqueStrings(emailCandidates.map((email) => normalizeEmail(email) || ''));

    for (const email of normalizedEmails) {
      addDomainFromEmail(email, siteCandidates);
    }

    const normalizedSites = uniqueStrings(siteCandidates.map((site) => normalizeSite(site) || '').filter(Boolean));

    merged[item.inn] = {
      inn: item.inn,
      companyId: item.companyId ?? existing.companyId,
      emails: normalizedEmails,
      webSites: normalizedSites,
      updatedAt: item.updatedAt ?? existing.updatedAt ?? new Date().toISOString(),
    };
  };

  bitrixData.forEach(add);
  bitrix.forEach(add);

  return Object.values(merged);
}

export async function refreshCompanyContacts(
  innsRaw: string[],
  options?: { maxAgeMinutes?: number; debug?: boolean },
) {
  const inns = Array.from(new Set(innsRaw.map((s) => (s ?? '').toString().trim()).filter(notEmpty)));
  if (!inns.length) return { items: [] as ContactsItem[] };

  const maxAgeMinutes = Number.isFinite(options?.maxAgeMinutes ?? NaN)
    ? Number(options!.maxAgeMinutes)
    : DEFAULT_MAX_AGE_MINUTES;
  const maxAgeMs = Math.max(1, maxAgeMinutes) * 60_000;
  const staleBefore = Date.now() - maxAgeMs;

  const { fresh, missing, stale } = await getCachedContacts(inns, staleBefore);
  const toUpdate = Array.from(new Set([...missing, ...stale]));

  const [{ items: bitrix, previewCmd }, bitrixData] = await Promise.all([
    fetchFromBitrix(toUpdate, Boolean(options?.debug)),
    fetchFromBitrixData(toUpdate),
  ]);

  const merged = mergeContacts(bitrix, bitrixData);
  await saveContacts(merged);

  const result: Record<string, ContactsItem> = { ...fresh };
  merged.forEach((item) => {
    result[item.inn] = item;
  });

  return {
    items: inns.map((inn) => result[inn]).filter(Boolean),
    debug: options?.debug ? { previewCmd } : undefined,
  };
}


// app/api/b24/responsibles/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { b24BatchJson, chunk } from '@/lib/b24';
import { db } from '@/lib/db';

type RespItem = {
  inn: string;
  companyId?: string;
  assignedById?: number;
  assignedName?: string;
  colorId?: number;
  colorLabel?: string;
  colorXmlId?: string;
  updatedAt?: string;
};

const UF_FIELDS = (process.env.B24_UF_INN_FIELDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// fallback: если список не задан — берём одиночное поле
const FALLBACK_UF = process.env.B24_UF_INN_FIELD || 'UF_CRM_1705778266246';
const UF_LIST = UF_FIELDS.length ? UF_FIELDS : [FALLBACK_UF];

const COLOR_FIELD = process.env.B24_COLOR_UF_FIELD || 'UF_CRM_1743187724272';
const BATCH_LIMIT = 50;
const USERS_TTL_MS = 10 * 60_000;
const ENUM_TTL_MS = 60 * 60_000;

type UserCacheVal = { name: string; exp: number };
const usersCache: Map<number, UserCacheVal> =
  (globalThis as any).__USERS_CACHE__ ?? new Map<number, UserCacheVal>();
(globalThis as any).__USERS_CACHE__ = usersCache;

type EnumMapVal = { id: number; value: string; xmlId?: string };
type EnumMap = Map<number, EnumMapVal>;
let enumCache: { field: string; map: EnumMap; exp: number } | null =
  (globalThis as any).__ENUM_CACHE__ ?? null;
(globalThis as any).__ENUM_CACHE__ = enumCache;
// ───────────────────────────────────────────────────────────────────────────

const notEmpty = (s: string) => !!s && s.trim().length > 0;
const core = (r: any) => (r?.result?.result ?? {}) as Record<string, any>;

let seq = 0;
const nextKey = (p: string) => `${p}${++seq}`;

const MAX_AGE_DEFAULT_MINUTES = 30;
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
    updated_at timestamptz NOT NULL DEFAULT NOW()
  );
`;

let ensureTablePromise: Promise<void> | null = null;

async function ensureTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = db
      .query(TABLE_SQL)
      .then(() => void 0)
      .catch((e) => {
        ensureTablePromise = null;
        throw e;
      });
  }
  return ensureTablePromise;
}

async function getCachedMeta(
  inns: string[],
  staleBefore: number,
): Promise<{
  fresh: Record<string, RespItem>;
  missing: string[];
  stale: string[];
  staleData: Record<string, RespItem>;
}> {
  if (!inns.length) return { fresh: {}, missing: [], stale: [], staleData: {} };
  await ensureTable();

  const { rows } = await db.query<{
    inn: string;
    company_id: string | null;
    assigned_by_id: number | null;
    assigned_name: string | null;
    color_id: number | null;
    color_label: string | null;
    color_xml_id: string | null;
    updated_at: Date;
  }>(
    `SELECT inn, company_id, assigned_by_id, assigned_name, color_id, color_label, color_xml_id, updated_at
     FROM b24_company_meta
     WHERE inn = ANY($1::text[])`,
    [inns],
  );

  const fresh: Record<string, RespItem> = {};
  const stale: string[] = [];
  const staleData: Record<string, RespItem> = {};

  const rowsByInn = new Map(rows.map((r) => [r.inn, r] as const));

  for (const inn of inns) {
    const row = rowsByInn.get(inn);
    if (!row) continue;

    const ts = row.updated_at?.getTime?.();
    if (ts && ts >= staleBefore) {
      fresh[inn] = {
        inn,
        companyId: row.company_id ?? undefined,
        assignedById: row.assigned_by_id ?? undefined,
        assignedName: row.assigned_name ?? undefined,
        colorId: row.color_id ?? undefined,
        colorLabel: row.color_label ?? undefined,
        colorXmlId: row.color_xml_id ?? undefined,
        updatedAt: row.updated_at.toISOString(),
      };
    } else {
      stale.push(inn);
      staleData[inn] = {
        inn,
        companyId: row.company_id ?? undefined,
        assignedById: row.assigned_by_id ?? undefined,
        assignedName: row.assigned_name ?? undefined,
        colorId: row.color_id ?? undefined,
        colorLabel: row.color_label ?? undefined,
        colorXmlId: row.color_xml_id ?? undefined,
        updatedAt: row.updated_at?.toISOString(),
      };
    }
  }

  const missing = inns.filter((inn) => !rowsByInn.has(inn));
  return { fresh, missing, stale, staleData };
}

async function saveMeta(items: RespItem[]) {
  if (!items.length) return;
  await ensureTable();

  const cols = [
    'inn',
    'company_id',
    'assigned_by_id',
    'assigned_name',
    'color_id',
    'color_label',
    'color_xml_id',
    'updated_at',
  ];

  const valuesSql: string[] = [];
  const params: any[] = [];

  items.forEach((item, idx) => {
    const base = idx * cols.length;
    valuesSql.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
    );
    params.push(
      item.inn,
      item.companyId ?? null,
      item.assignedById ?? null,
      item.assignedName ?? null,
      item.colorId ?? null,
      item.colorLabel ?? null,
      item.colorXmlId ?? null,
      item.updatedAt ? new Date(item.updatedAt) : new Date(),
    );
  });

  const sql = `
    INSERT INTO b24_company_meta (${cols.join(', ')})
    VALUES ${valuesSql.join(', ')}
    ON CONFLICT (inn) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      assigned_by_id = EXCLUDED.assigned_by_id,
      assigned_name = EXCLUDED.assigned_name,
      color_id = EXCLUDED.color_id,
      color_label = EXCLUDED.color_label,
      color_xml_id = EXCLUDED.color_xml_id,
      updated_at = EXCLUDED.updated_at;
  `;

  await db.query(sql, params);
}

function makeFio(u: any): string {
  const parts = [u?.LAST_NAME, u?.NAME, u?.SECOND_NAME].filter(Boolean);
  const fio = parts.join(' ').trim();
  if (fio) return fio;
  return u?.NAME || u?.LOGIN || String(u?.ID ?? '');
}

async function getEnumMapForColorField(debug: boolean): Promise<EnumMap> {
  const now = Date.now();
  if (enumCache && enumCache.field === COLOR_FIELD && enumCache.exp > now) {
    return enumCache.map;
  }

  const cmd: Record<string, string> = {
    uflist: `crm.company.userfield.list?filter[FIELD_NAME]=${encodeURIComponent(COLOR_FIELD)}`,
  };

  const r = await b24BatchJson(cmd, 0);
  const buckets = core(r);
  const arr = Array.isArray(buckets.uflist) ? buckets.uflist : [];
  const field = arr[0];

  const map: EnumMap = new Map();

  const list: any[] = Array.isArray(field?.LIST) ? field.LIST : [];

  for (const it of list) {
    const idNum = Number(it?.ID);
    if (Number.isFinite(idNum)) {
      map.set(idNum, {
        id: idNum,
        value: String(it?.VALUE ?? '').trim(),
        xmlId: it?.XML_ID ? String(it.XML_ID).trim() : undefined,
      });
    }
  }

  enumCache = { field: COLOR_FIELD, map, exp: now + ENUM_TTL_MS };
  (globalThis as any).__ENUM_CACHE__ = enumCache;

  if (debug) {
    const values: EnumMapVal[] = [];
    map.forEach((v) => values.push(v));
    console.log('Color enum map loaded:', values);
  }

  return map;
}

async function fetchFromBitrix(
  inns: string[],
  debug: boolean,
): Promise<{ items: RespItem[]; previewCmd: string[]; userCmdPreview: string[] }> {
  if (!inns.length) return { items: [], previewCmd: [], userCmdPreview: [] };

  const enumMap = await getEnumMapForColorField(debug);

  const innToCompany: Record<
    string,
    { ID: string; ASSIGNED_BY_ID?: number; COLOR_ID?: number | null }
  > = {};
  const previewCmd: string[] = [];

  for (const pack of chunk(inns, BATCH_LIMIT)) {
    if (!pack.length) break;
    const cmd: Record<string, string> = {};
    const innKeys: Record<string, string[]> = {};

    for (const inn of pack) {
      const keys: string[] = [];
      for (const uf of UF_LIST) {
        const k = nextKey('get_');
        cmd[k] =
          `crm.company.list?` +
          `filter[${uf}]=${encodeURIComponent(inn)}` +
          `&select[]=ID` +
          `&select[]=ASSIGNED_BY_ID` +
          `&select[]=${encodeURIComponent(COLOR_FIELD)}` +
          `&select[]=UF_*` +
          `&start=-1`;
        keys.push(k);
        if (debug) previewCmd.push(`${k}: ${cmd[k]}`);
      }
      innKeys[inn] = keys;
    }

    const r = await b24BatchJson(cmd, 0);
    const buckets = core(r);

    for (const inn of pack) {
      if (innToCompany[inn]) continue;
      for (const k of innKeys[inn] || []) {
        const rows = buckets[k] as any[] | undefined;
        const first = Array.isArray(rows) && rows[0] ? rows[0] : null;
        if (first?.ID) {
          const rawColor = first?.[COLOR_FIELD];
          const colorIdNum =
            typeof rawColor === 'string' || typeof rawColor === 'number'
              ? Number(rawColor)
              : null;

          innToCompany[inn] = {
            ID: String(first.ID),
            ASSIGNED_BY_ID: first.ASSIGNED_BY_ID ? Number(first.ASSIGNED_BY_ID) : undefined,
            COLOR_ID: Number.isFinite(colorIdNum) ? colorIdNum! : null,
          };
          break;
        }
      }
    }
  }

  const allUserIds = Array.from(
    new Set(
      Object.values(innToCompany)
        .map((v) => v?.ASSIGNED_BY_ID)
        .filter((x): x is number => Number.isFinite(x as number)),
    ),
  );

  const userIdToName: Record<number, string> = {};
  const userCmdPreview: string[] = [];

  const now2 = Date.now();
  const missingUserIds: number[] = [];
  for (const uid of allUserIds) {
    const c = usersCache.get(uid);
    if (c && c.exp > now2) {
      userIdToName[uid] = c.name;
    } else {
      missingUserIds.push(uid);
    }
  }

  for (const pack of chunk(missingUserIds, BATCH_LIMIT)) {
    if (!pack.length) break;
    const cmd: Record<string, string> = {};
    const keys: Array<{ key: string; uid: number }> = [];

    for (const uid of pack) {
      const k = nextKey('u');
      cmd[k] = `user.get?ID=${encodeURIComponent(String(uid))}`;
      keys.push({ key: k, uid });
      if (debug) userCmdPreview.push(`${k}: ${cmd[k]}`);
    }

    const r = await b24BatchJson(cmd, 0);
    const buckets = core(r);

    for (const { key: k, uid } of keys) {
      const arr = buckets[k] as any[];
      const u = Array.isArray(arr) && arr[0] ? arr[0] : null;
      if (u?.ID) {
        const name = makeFio(u);
        userIdToName[uid] = name;
        usersCache.set(uid, { name, exp: Date.now() + USERS_TTL_MS });
      }
    }
  }

  const items: RespItem[] = [];
  for (const inn of inns) {
    const info = innToCompany[inn];
    if (!info) continue;
    const assignedById = info?.ASSIGNED_BY_ID;
    const assignedName = assignedById ? userIdToName[assignedById] : undefined;

    let colorId: number | undefined = undefined;
    let colorLabel: string | undefined = undefined;
    let colorXmlId: string | undefined = undefined;

    if (Number.isFinite(info?.COLOR_ID as number)) {
      const row = enumMap.get(info!.COLOR_ID!);
      if (row) {
        colorId = row.id;
        colorLabel = row.value;
        colorXmlId = row.xmlId;
      }
    }

    items.push({
      inn,
      companyId: info?.ID,
      assignedById,
      assignedName,
      colorId,
      colorLabel,
      colorXmlId,
      updatedAt: new Date().toISOString(),
    });
  }

  return { items, previewCmd, userCmdPreview };
}

export async function POST(req: NextRequest) {
  try {
    const debug = req.nextUrl.searchParams.get('debug') === '1';
    const maxAgeMinutes = Number(req.nextUrl.searchParams.get('maxAgeMinutes'));
    const maxAgeMs = Number.isFinite(maxAgeMinutes) && maxAgeMinutes > 0
      ? maxAgeMinutes * 60_000
      : MAX_AGE_DEFAULT_MINUTES * 60_000;
    const staleBefore = Date.now() - maxAgeMs;
    const body = (await req.json().catch(() => null)) as { inns?: string[] } | null;
    const innsRaw = Array.isArray(body?.inns) ? body!.inns! : [];
    const inns = Array.from(
      new Set(innsRaw.map((s) => (s ?? '').toString().trim()).filter(notEmpty)),
    );
    if (!inns.length) return NextResponse.json({ ok: true, items: [] });

    const { fresh, missing, stale, staleData } = await getCachedMeta(inns, staleBefore);
    const toFind = Array.from(new Set([...missing, ...stale]));

    const { items: fetched, previewCmd, userCmdPreview } = await fetchFromBitrix(toFind, debug);

    await saveMeta(fetched);

    const merged: Record<string, RespItem> = { ...fresh, ...staleData };
    for (const it of fetched) {
      merged[it.inn] = it;
    }

    return NextResponse.json({
      ok: true,
      items: inns.map((inn) => merged[inn]).filter(Boolean),
      debug: debug
        ? { ufFieldsTried: UF_LIST, previewCmd, userCmd: userCmdPreview, colorField: COLOR_FIELD }
        : undefined,
    });
  } catch (e: any) {
    console.error('responsibles (JSON batch) failed:', e);
    return NextResponse.json({ ok: false, error: e?.message || 'internal error' }, { status: 500 });
  }
}

// app/api/b24/responsibles/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { b24BatchJson, chunk } from '@/lib/b24';

type RespItem = {
  inn: string;
  companyId?: string;
  assignedById?: number;
  assignedName?: string;
  colorId?: number;
  colorLabel?: string;
  colorXmlId?: string;
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
const TTL_MS = 60_000;
const USERS_TTL_MS = 10 * 60_000;
const ENUM_TTL_MS = 60 * 60_000;

const cache: Map<string, { value: RespItem; exp: number }> =
  (globalThis as any).__RESP_CACHE__ ?? new Map<string, { value: RespItem; exp: number }>();
(globalThis as any).__RESP_CACHE__ = cache;

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

export async function POST(req: NextRequest) {
  try {
    const debug = req.nextUrl.searchParams.get('debug') === '1';
    const body = (await req.json().catch(() => null)) as { inns?: string[] } | null;
    const innsRaw = Array.isArray(body?.inns) ? body!.inns! : [];
    const inns = Array.from(
      new Set(innsRaw.map((s) => (s ?? '').toString().trim()).filter(notEmpty)),
    );
    if (!inns.length) return NextResponse.json({ ok: true, items: [] });

    const now = Date.now();
    const cached: Record<string, RespItem> = {};
    const toFind: string[] = [];
    for (const inn of inns) {
      const c = cache.get(inn);
      if (c && c.exp > now) cached[inn] = c.value;
      else toFind.push(inn);
    }

    let enumMap: EnumMap;
    let enumMapError: any = null;
    try {
      enumMap = await getEnumMapForColorField(debug);
    } catch (err) {
      enumMapError = err;
      if (enumCache?.map) {
        enumMap = enumCache.map;
      } else {
        throw err;
      }
    }

    let bitrixError: any = null;

    const innToCompany: Record<
      string,
      { ID: string; ASSIGNED_BY_ID?: number; COLOR_ID?: number | null }
    > = {};
    const previewCmd: string[] = [];

    for (const pack of chunk(toFind, BATCH_LIMIT)) {
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

      let r: any;
      try {
        r = await b24BatchJson(cmd, 0);
      } catch (err: any) {
        const message = err?.message || String(err);
        console.error('Bitrix batch error while fetching companies:', {
          message,
          inns: pack,
          commands: cmd,
        });
        bitrixError = bitrixError ?? err;
        break;
      }
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
    const missing: number[] = [];
    for (const uid of allUserIds) {
      const c = usersCache.get(uid);
      if (c && c.exp > now2) {
        userIdToName[uid] = c.name;
      } else {
        missing.push(uid);
      }
    }

    for (const pack of chunk(missing, BATCH_LIMIT)) {
      if (!pack.length) break;
      const cmd: Record<string, string> = {};
      const keys: Array<{ key: string; uid: number }> = [];

      for (const uid of pack) {
        const k = nextKey('u');
        cmd[k] = `user.get?ID=${encodeURIComponent(String(uid))}`;
        keys.push({ key: k, uid });
        if (debug) userCmdPreview.push(`${k}: ${cmd[k]}`);
      }

      let r: any;
      try {
        r = await b24BatchJson(cmd, 0);
      } catch (err: any) {
        const message = err?.message || String(err);
        console.error('Bitrix batch error while fetching users:', {
          message,
          userIds: pack,
          commands: cmd,
        });
        bitrixError = bitrixError ?? err;
        break;
      }
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

    const items: RespItem[] = inns.map((inn) => {
      if (cached[inn]) return cached[inn];
      const info = innToCompany[inn];
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

      const item: RespItem = {
        inn,
        companyId: info?.ID,
        assignedById,
        assignedName,
        colorId,
        colorLabel,
        colorXmlId,
      };
      if (info) {
        cache.set(inn, { value: item, exp: Date.now() + TTL_MS });
      }
      return item;
    });

    if (bitrixError) {
      console.warn('Bitrix responsibles request partially failed:', bitrixError);
    }
    if (enumMapError) {
      console.warn('Bitrix color map request fell back to cache:', enumMapError);
    }

    return NextResponse.json({
      ok: true,
      items,
      warning:
        bitrixError || enumMapError
          ? {
              code: 'bitrix_partial_failure',
              message: (bitrixError || enumMapError)?.message || 'Bitrix request failed',
            }
          : undefined,
      debug: debug
        ? { ufFieldsTried: UF_LIST, previewCmd, userCmd: userCmdPreview, colorField: COLOR_FIELD }
        : undefined,
    });
  } catch (e: any) {
    console.error('responsibles (JSON batch) failed:', e);
    return NextResponse.json({ ok: false, error: e?.message || 'internal error' }, { status: 500 });
  }
}

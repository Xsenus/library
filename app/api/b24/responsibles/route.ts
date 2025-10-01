// app/api/b24/responsibles/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { b24BatchJson, chunk } from '@/lib/b24';

type RespItem = {
  inn: string;
  companyId?: string;
  assignedById?: number;
  assignedName?: string;
};

const UF_FIELDS = (process.env.B24_UF_INN_FIELDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// fallback: если список не задан — берём одиночное поле
const FALLBACK_UF = process.env.B24_UF_INN_FIELD || 'UF_CRM_1705778266246';
const UF_LIST = UF_FIELDS.length ? UF_FIELDS : [FALLBACK_UF];

const BATCH_LIMIT = 50;
const TTL_MS = 60_000;

// простой кэш в пределах воркера
const cache =
  (globalThis as any).__RESP_CACHE__ ?? new Map<string, { value: RespItem; exp: number }>();
(globalThis as any).__RESP_CACHE__ = cache;

const notEmpty = (s: string) => !!s && s.trim().length > 0;
const core = (r: any) => (r?.result?.result ?? {}) as Record<string, any>;

let seq = 0;
const nextKey = (p: string) => `${p}${++seq}`;

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

    // 1) batch: crm.company.list по каждому UF-полю
    const innToCompany: Record<string, { ID: string; ASSIGNED_BY_ID?: number } | undefined> = {};
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
            innToCompany[inn] = {
              ID: String(first.ID),
              ASSIGNED_BY_ID: first.ASSIGNED_BY_ID ? Number(first.ASSIGNED_BY_ID) : undefined,
            };
            break;
          }
        }
      }
    }

    // 2) user.get по всем уникальным ASSIGNED_BY_ID
    const userIds = Array.from(
      new Set(
        Object.values(innToCompany)
          .map((v) => v?.ASSIGNED_BY_ID)
          .filter((x): x is number => Number.isFinite(x as number)),
      ),
    );

    const userIdToName: Record<number, string> = {};
    const userCmdPreview: string[] = [];

    for (const pack of chunk(userIds, BATCH_LIMIT)) {
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
          const name = [u.LAST_NAME, u.NAME, u.SECOND_NAME].filter(Boolean).join(' ').trim();
          userIdToName[uid] = name || u.NAME || String(uid);
        }
      }
    }

    // 3) ответ + кэш
    const items: RespItem[] = inns.map((inn) => {
      if (cached[inn]) return cached[inn];
      const info = innToCompany[inn];
      const assignedById = info?.ASSIGNED_BY_ID;
      const assignedName = assignedById ? userIdToName[assignedById] : undefined;
      const item: RespItem = { inn, companyId: info?.ID, assignedById, assignedName };
      cache.set(inn, { value: item, exp: Date.now() + TTL_MS });
      return item;
    });

    return NextResponse.json({
      ok: true,
      items,
      debug: debug ? { ufFieldsTried: UF_LIST, previewCmd, userCmd: userCmdPreview } : undefined,
    });
  } catch (e: any) {
    console.error('responsibles (JSON batch) failed:', e);
    return NextResponse.json({ ok: false, error: e?.message || 'internal error' }, { status: 500 });
  }
}

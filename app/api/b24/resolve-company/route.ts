import { NextRequest, NextResponse } from 'next/server';
import { b24Call, getPortalOrigin } from '@/lib/b24';

type RequisiteRow = { ID: string; ENTITY_ID: string; ENTITY_TYPE_ID: string; RQ_INN?: string };
type CompanyRow = { ID: string; TITLE?: string };

const UF_INN = process.env.B24_UF_INN_FIELD || 'UF_CRM_1705778266246';

export async function GET(req: NextRequest) {
  const innRaw = (req.nextUrl.searchParams.get('inn') ?? '').trim();
  if (!innRaw) return NextResponse.json({ ok: false, error: 'inn required' }, { status: 400 });

  const innDigits = innRaw.replace(/\D+/g, '');
  const portal = getPortalOrigin();
  const ids: string[] = [];

  // 1) requisites: точное совпадение по RQ_INN (обычно цифры)
  await collectUnique(ids, () => findByRequisiteInn(innDigits));
  if (ids.length !== 1 && innDigits !== innRaw) {
    await collectUnique(ids, () => findByRequisiteInn(innRaw));
  }
  if (ids.length === 1) {
    return NextResponse.redirect(`${portal}/crm/company/details/${ids[0]}/`, { status: 302 });
  }

  // 2) company.list: точное совпадение по одному UF-полю (равенство)
  await collectUnique(ids, () => findByUfInn(innDigits));
  if (ids.length !== 1 && innDigits !== innRaw) {
    await collectUnique(ids, () => findByUfInn(innRaw));
  }
  if (ids.length === 1) {
    return NextResponse.redirect(`${portal}/crm/company/details/${ids[0]}/`, { status: 302 });
  }

  // 3) дубль или пусто — всегда на список с FIND
  const listUrl = `${portal}/crm/company/?apply_filter=Y&FIND=${encodeURIComponent(innRaw)}`;
  return NextResponse.redirect(listUrl, { status: 302 });
}

// ===== helpers

async function findByRequisiteInn(value: string) {
  if (!value) return [] as string[];
  try {
    const r = await b24Call<any>('crm.requisite.list', {
      filter: { RQ_INN: value, ENTITY_TYPE_ID: 4 },
      select: ['ENTITY_ID'],
      start: -1,
    });
    const rows: RequisiteRow[] = Array.isArray(r?.result) ? r.result : Array.isArray(r) ? r : [];
    return rows.map((x) => String(x.ENTITY_ID));
  } catch {
    return [];
  }
}

async function findByUfInn(value: string) {
  if (!value) return [] as string[];
  try {
    const r = await b24Call<any>('crm.company.list', {
      filter: { ['=' + UF_INN]: value },
      select: ['ID'],
      start: -1,
    });
    const rows: CompanyRow[] = Array.isArray(r?.result) ? r.result : Array.isArray(r) ? r : [];
    return rows.map((x) => String(x.ID));
  } catch {
    return [];
  }
}

async function collectUnique(target: string[], getIds: () => Promise<string[]>) {
  const found = await getIds();
  for (const id of found) if (!target.includes(id)) target.push(id);
}

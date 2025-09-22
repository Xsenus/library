import { NextRequest, NextResponse } from 'next/server';
import { b24Call, getPortalOrigin } from '@/lib/b24';

type RequisiteRow = { ID: string; ENTITY_ID: string; ENTITY_TYPE_ID: string; RQ_INN?: string };
type CompanyRow = { ID: string; TITLE?: string };

const UF_INN = process.env.B24_UF_INN_FIELD || 'UF_CRM_1705778266246';

export async function GET(req: NextRequest) {
  const innRaw = (req.nextUrl.searchParams.get('inn') ?? '').trim();
  const mode = (req.nextUrl.searchParams.get('mode') ?? 'pick') as 'pick' | 'find'; // что делать при дублях
  if (!innRaw) return NextResponse.json({ ok: false, error: 'inn required' }, { status: 400 });

  const innDigits = innRaw.replace(/\D+/g, '');
  const portal = getPortalOrigin();
  const ids: string[] = [];

  // --- 1) requisites: точное совпадение по RQ_INN (обычно цифры)
  await collectUnique(ids, () => findByRequisiteInn(innDigits));
  if (ids.length !== 1 && innDigits !== innRaw) {
    await collectUnique(ids, () => findByRequisiteInn(innRaw));
  }
  if (ids.length === 1) {
    return NextResponse.redirect(`${portal}/crm/company/details/${ids[0]}/`, { status: 302 });
  }

  // --- 2) company.list: точное совпадение по одному UF-полю (равенство)
  await collectUnique(ids, () => findByUfInn(innDigits));
  if (ids.length !== 1 && innDigits !== innRaw) {
    await collectUnique(ids, () => findByUfInn(innRaw));
  }
  if (ids.length === 1) {
    return NextResponse.redirect(`${portal}/crm/company/details/${ids[0]}/`, { status: 302 });
  }

  // --- дубль или пусто: pick (ID-шки) или list с FIND
  if (ids.length > 1 && mode === 'pick') {
    const html = renderPickByIds(ids, portal, innRaw);
    return new NextResponse(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

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
  for (const id of found) if (target.indexOf(id) === -1) target.push(id);
}

function renderPickByIds(ids: string[], portal: string, inn: string) {
  const items = ids
    .map(
      (id) => `
      <a class="item" href="${portal}/crm/company/details/${id}/" target="_blank" rel="noopener">
        <div class="title">Компания ID: ${id}</div>
      </a>`,
    )
    .join('');
  return `<!doctype html>
<html lang="ru"><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Найдено несколько компаний по ИНН ${escapeHtml(inn)}</title>
<style>
  :root { color-scheme: light dark }
  body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:24px}
  h1{margin:0 0 16px;font-size:18px}
  .grid{display:grid;gap:8px}
  .item{display:block;padding:12px;border:1px solid #e5e7eb;border-radius:10px;text-decoration:none;color:inherit}
  .item:hover{background:#f9fafb}
  @media (prefers-color-scheme: dark){ .item{border-color:#374151}.item:hover{background:#111827} }
</style>
<h1>Несколько совпадений по ИНН ${escapeHtml(inn)}</h1>
<div class="grid">${items}</div>
</html>`;
}
function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!),
  );
}

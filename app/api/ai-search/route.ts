// app/api/ai-search/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const BASE = process.env.AI_SEARCH_BASE ?? 'http://37.221.125.221:8090/';
// ожидаем что сервис ест { q: string } и возвращает JSON

type AnyRow = Record<string, any>;
type AiRawResponse = {
  goods?: AnyRow[]; // произвольные ключи — ниже нормализуем
  equipment?: AnyRow[];
  prodclasses?: AnyRow[];
  // или может вернуть единый массив — тоже обработаем
  data?: {
    goods?: AnyRow[];
    equipment?: AnyRow[];
    prodclasses?: AnyRow[];
  };
};

function normGoods(rows: AnyRow[] | undefined) {
  return (rows ?? [])
    .map((r) => ({
      id: Number(r.id ?? r.goods_id ?? r.gid ?? 0),
      name:
        String(r.name ?? r.goods_name ?? r.goods_type ?? r.title ?? r.label ?? '') ||
        'Без названия',
    }))
    .filter((x) => x.id > 0);
}

function normEquipment(rows: AnyRow[] | undefined) {
  return (rows ?? [])
    .map((r) => ({
      id: Number(r.id ?? r.equipment_id ?? r.eid ?? 0),
      equipment_name: String(r.equipment_name ?? r.name ?? r.title ?? '').trim() || 'Оборудование',
      industry_id: Number(r.industry_id ?? r.iid ?? 0),
      industry: String(r.industry ?? r.industry_name ?? '') || '',
      prodclass_id: Number(r.prodclass_id ?? r.pc_id ?? 0),
      prodclass: String(r.prodclass ?? r.prodclass_name ?? '') || '',
      workshop_id: Number(r.workshop_id ?? r.wid ?? 0),
      workshop_name: String(r.workshop_name ?? r.workshop ?? '') || '',
    }))
    .filter((x) => x.id > 0);
}

function normProdclasses(rows: AnyRow[] | undefined) {
  return (rows ?? [])
    .map((r) => ({
      id: Number(r.id ?? r.prodclass_id ?? r.pcid ?? 0),
      prodclass: String(r.prodclass ?? r.name ?? r.title ?? '') || 'Класс',
      industry_id: Number(r.industry_id ?? r.iid ?? 0),
      industry: String(r.industry ?? r.industry_name ?? '') || '',
    }))
    .filter((x) => x.id > 0);
}

export async function POST(req: NextRequest) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000); // 15s таймаут

  try {
    const { q } = await req.json().catch(() => ({}));
    const query = String(q ?? '').trim();
    if (!query) {
      return NextResponse.json({ goods: [], equipment: [], prodclasses: [] });
    }

    // проксируем на внешний сервис
    const upstream = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query }),
      signal: ctrl.signal,
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return NextResponse.json(
        { error: `Upstream ${upstream.status}: ${text.slice(0, 400)}` },
        { status: 502 },
      );
    }

    const raw: AiRawResponse = await upstream.json();
    const payload = raw?.data ?? raw ?? {};

    const goods = normGoods(payload.goods);
    const equipment = normEquipment(payload.equipment);
    const prodclasses = normProdclasses(payload.prodclasses);

    return NextResponse.json({ goods, equipment, prodclasses });
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return NextResponse.json(
      { error: aborted ? 'Timeout while calling upstream' : String(err?.message ?? err) },
      { status: 504 },
    );
  } finally {
    clearTimeout(t);
  }
}

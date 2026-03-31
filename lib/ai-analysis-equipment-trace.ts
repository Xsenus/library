export type EquipmentTraceOrigin = 'site' | 'okved' | 'product';

export type EquipmentScoreTrace = {
  equipment_id: string;
  equipment_name?: string | null;
  final_score?: number | null;
  final_source?: string | null;
  calculation_path?: string | null;
  bd_score?: number | null;
  vector_score?: number | null;
  gen_score?: number | null;
  factor?: number | null;
  matched_site_equipment?: string | null;
  matched_site_equipment_score?: number | null;
  matched_product_name?: string | null;
  origin_kind?: EquipmentTraceOrigin | null;
  origin_name?: string | null;
};

type AnyRecord = Record<string, unknown>;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function recordFrom(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null;
}

function normalizeId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized ? normalized : null;
  }
  return null;
}

function readArray(payload: AnyRecord, key: string): AnyRecord[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.map((item) => recordFrom(item)).filter((item): item is AnyRecord => Boolean(item));
}

function inferOriginFromSource(source: string | null | undefined, selectionStrategy: string | null | undefined): EquipmentTraceOrigin | null {
  const normalizedSource = String(source ?? '').trim().toLowerCase();
  if (normalizedSource === '2way') return 'product';
  if (normalizedSource === '3way') return 'site';
  if (normalizedSource === '1way') {
    return String(selectionStrategy ?? '').trim().toLowerCase() === 'okved' ? 'okved' : 'site';
  }
  return null;
}

export function normalizeEquipmentTracePayload(payload: unknown): EquipmentScoreTrace[] {
  const root = recordFrom(payload);
  if (!root) return [];

  const equipmentAll = readArray(root, 'equipment_all');
  const oneWayDetails = readArray(root, 'equipment_1way_details');
  const twoWayDetails = readArray(root, 'equipment_2way_details');
  const threeWayDetails = readArray(root, 'equipment_3way_details');
  const siteEquipment = readArray(root, 'site_equipment');
  const goodsTypes = readArray(root, 'goods_types');
  const selectionStrategy = toText(root.selection_strategy);

  const goodsTypeNames = new Map<string, string>();
  for (const item of goodsTypes) {
    const goodsTypeId = normalizeId(item.goods_type_id ?? item.id);
    const goodsTypeName = toText(item.goods_type ?? item.name ?? item.title);
    if (goodsTypeId && goodsTypeName && !goodsTypeNames.has(goodsTypeId)) {
      goodsTypeNames.set(goodsTypeId, goodsTypeName);
    }
  }

  const byId = new Map<string, EquipmentScoreTrace>();

  const ensure = (equipmentId: string): EquipmentScoreTrace => {
    const existing = byId.get(equipmentId);
    if (existing) return existing;
    const created: EquipmentScoreTrace = { equipment_id: equipmentId };
    byId.set(equipmentId, created);
    return created;
  };

  for (const item of equipmentAll) {
    const equipmentId = normalizeId(item.id ?? item.equipment_id);
    if (!equipmentId) continue;
    const target = ensure(equipmentId);
    target.equipment_name = toText(item.equipment_name) ?? target.equipment_name ?? null;
    target.final_score = toFiniteNumber(item.score);
    target.final_source = toText(item.source);
    target.origin_kind = inferOriginFromSource(target.final_source, selectionStrategy);
    if (target.origin_kind === 'okved') {
      target.origin_name = target.origin_name ?? 'Подбор по ОКВЭД';
    }
  }

  for (const item of oneWayDetails) {
    const equipmentId = normalizeId(item.id ?? item.equipment_id);
    if (!equipmentId) continue;
    const target = ensure(equipmentId);
    target.equipment_name = toText(item.equipment_name) ?? target.equipment_name ?? null;
    target.bd_score = toFiniteNumber(item.db_score ?? item.equipment_score_max);
    target.gen_score = toFiniteNumber(item.gen_score ?? item.score_1 ?? item.SCORE_1);
    target.factor = toFiniteNumber(item.factor);
    if (target.final_score == null) {
      target.final_score = toFiniteNumber(item.final_score ?? item.score_e1 ?? item.SCORE_E1);
    }
    target.calculation_path = toText(item.path);
    if (target.origin_kind == null) {
      target.origin_kind = selectionStrategy === 'okved' ? 'okved' : 'site';
      target.origin_name = target.origin_kind === 'okved' ? 'Подбор по ОКВЭД' : target.origin_name ?? null;
    }
  }

  for (const item of twoWayDetails) {
    const equipmentId = normalizeId(item.equipment_id ?? item.id);
    if (!equipmentId) continue;
    const target = ensure(equipmentId);
    const scoreE2 = toFiniteNumber(item.final_score ?? item.score_e2 ?? item.SCORE_E2);
    const currentFinal = toFiniteNumber(target.final_score);
    const goodsTypeId = normalizeId(item.goods_type_id);
    const matchedProductName =
      toText(item.goods_type_name) ??
      (goodsTypeId ? goodsTypeNames.get(goodsTypeId) ?? null : null);

    target.equipment_name = toText(item.equipment_name) ?? target.equipment_name ?? null;

    if (target.calculation_path == null || (currentFinal != null && scoreE2 != null && scoreE2 >= currentFinal - 1e-9)) {
      target.calculation_path = '2way';
    }

    if (target.bd_score == null) {
      target.bd_score = toFiniteNumber(item.db_score ?? item.crore_3 ?? item.CRORE_3);
    }
    if (target.vector_score == null) {
      target.vector_score = toFiniteNumber(item.vector_score ?? item.crore_2 ?? item.CRORE_2);
    }
    if (target.gen_score == null) {
      target.gen_score = toFiniteNumber(item.gen_score);
    }
    if (target.factor == null) {
      target.factor = toFiniteNumber(item.factor) ?? 1;
    }
    if (target.final_score == null) {
      target.final_score = scoreE2;
    }
    if (matchedProductName) {
      target.matched_product_name = matchedProductName;
      target.origin_kind = 'product';
      target.origin_name = matchedProductName;
    }
  }

  for (const item of threeWayDetails) {
    const equipmentId = normalizeId(item.equipment_id ?? item.id);
    if (!equipmentId) continue;
    const target = ensure(equipmentId);
    target.vector_score = toFiniteNumber(item.vector_score ?? item.equipment_score);
    if (target.factor == null) {
      target.factor = toFiniteNumber(item.factor) ?? 1;
    }
    if (target.final_score == null) {
      target.final_score = toFiniteNumber(item.final_score ?? item.score_e3 ?? item.SCORE_E3);
    }
    if (target.origin_kind == null) {
      target.origin_kind = 'site';
    }
  }

  for (const item of siteEquipment) {
    const equipmentId = normalizeId(item.equipment_id ?? item.id);
    if (!equipmentId) continue;
    const target = ensure(equipmentId);
    const siteScore = toFiniteNumber(item.equipment_score);
    const currentScore = toFiniteNumber(target.matched_site_equipment_score);
    if (currentScore != null && siteScore != null && currentScore > siteScore) continue;
    target.matched_site_equipment = toText(item.equipment) ?? target.matched_site_equipment ?? null;
    target.matched_site_equipment_score = siteScore;
    if (target.vector_score == null && siteScore != null) {
      target.vector_score = siteScore;
    }
    if (target.origin_kind == null) {
      target.origin_kind = 'site';
    }
    if (target.origin_name == null) {
      target.origin_name = target.matched_site_equipment ?? null;
    }
  }

  for (const item of Array.from(byId.values())) {
    if (item.origin_kind == null) {
      item.origin_kind = inferOriginFromSource(item.final_source, selectionStrategy);
    }
    if (item.origin_name == null) {
      if (item.origin_kind === 'site') item.origin_name = item.matched_site_equipment ?? null;
      if (item.origin_kind === 'okved') item.origin_name = 'Подбор по ОКВЭД';
      if (item.origin_kind === 'product') item.origin_name = item.matched_product_name ?? null;
    }
  }

  return Array.from(byId.values()).sort((left, right) => {
    const leftScore = toFiniteNumber(left.final_score) ?? -1;
    const rightScore = toFiniteNumber(right.final_score) ?? -1;
    return rightScore - leftScore;
  });
}

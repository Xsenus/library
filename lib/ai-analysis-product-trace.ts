export type ProductTraceEquipmentLink = {
  equipment_id: string;
  equipment_name?: string | null;
  final_score?: number | null;
  db_score?: number | null;
  factor?: number | null;
};

export type ProductTraceItem = {
  lookup_key: string;
  goods_type_id?: string | null;
  goods_type_name?: string | null;
  goods_types_score?: number | null;
  goods_type_source?: string | null;
  factor?: number | null;
  linked_equipment_count: number;
  top_equipment_name?: string | null;
  top_equipment_score?: number | null;
  linked_equipment: ProductTraceEquipmentLink[];
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

function createLookupKey(goodsTypeId: string | null | undefined, goodsTypeName: string | null | undefined): string | null {
  const normalizedId = normalizeId(goodsTypeId);
  if (normalizedId) return `id:${normalizedId}`;
  const normalizedName = toText(goodsTypeName)?.toLowerCase() ?? null;
  return normalizedName ? `name:${normalizedName}` : null;
}

export function normalizeProductTracePayload(payload: unknown): ProductTraceItem[] {
  const root = recordFrom(payload);
  if (!root) return [];

  const goodsTypes = readArray(root, 'goods_types');
  const goodsTypeScores = readArray(root, 'goods_type_scores');
  const goodsLinks = (() => {
    const twoWayDetails = readArray(root, 'equipment_2way_details');
    return twoWayDetails.length ? twoWayDetails : readArray(root, 'goods_links');
  })();

  const byKey = new Map<string, ProductTraceItem>();

  const ensure = (goodsTypeId: string | null | undefined, goodsTypeName: string | null | undefined): ProductTraceItem | null => {
    const lookupKey = createLookupKey(goodsTypeId, goodsTypeName);
    if (!lookupKey) return null;
    const existing = byKey.get(lookupKey);
    if (existing) return existing;

    const created: ProductTraceItem = {
      lookup_key: lookupKey,
      goods_type_id: normalizeId(goodsTypeId),
      goods_type_name: toText(goodsTypeName),
      goods_types_score: null,
      goods_type_source: null,
      factor: null,
      linked_equipment_count: 0,
      top_equipment_name: null,
      top_equipment_score: null,
      linked_equipment: [],
    };
    byKey.set(lookupKey, created);
    return created;
  };

  for (const item of goodsTypes) {
    const entry = ensure(
      normalizeId(item.goods_type_id ?? item.id),
      toText(item.goods_type ?? item.name ?? item.title),
    );
    if (!entry) continue;

    entry.goods_type_id = entry.goods_type_id ?? normalizeId(item.goods_type_id ?? item.id);
    entry.goods_type_name = entry.goods_type_name ?? toText(item.goods_type ?? item.name ?? item.title);

    const score = toFiniteNumber(item.goods_types_score);
    if (score != null && (entry.goods_types_score == null || score > entry.goods_types_score)) {
      entry.goods_types_score = score;
    }

    entry.goods_type_source =
      entry.goods_type_source ??
      toText(item.goods_source ?? item.source ?? item.origin);
  }

  for (const item of goodsTypeScores) {
    const entry = ensure(normalizeId(item.goods_type_id), null);
    if (!entry) continue;
    const score = toFiniteNumber(item.crore_2 ?? item.goods_types_score);
    if (score != null && (entry.goods_types_score == null || score > entry.goods_types_score)) {
      entry.goods_types_score = score;
    }
  }

  for (const item of goodsLinks) {
    const goodsTypeId = normalizeId(item.goods_type_id);
    const goodsTypeName = toText(item.goods_type_name ?? item.goods_type ?? item.name);
    const entry = ensure(goodsTypeId, goodsTypeName);
    if (!entry) continue;

    entry.goods_type_id = entry.goods_type_id ?? goodsTypeId;
    entry.goods_type_name = entry.goods_type_name ?? goodsTypeName;

    const score = toFiniteNumber(item.vector_score ?? item.crore_2 ?? item.goods_types_score);
    if (score != null && (entry.goods_types_score == null || score > entry.goods_types_score)) {
      entry.goods_types_score = score;
    }

    if (entry.factor == null) {
      entry.factor = toFiniteNumber(item.factor);
    }

    const equipmentId = normalizeId(item.equipment_id ?? item.id);
    if (!equipmentId) continue;

    const link: ProductTraceEquipmentLink = {
      equipment_id: equipmentId,
      equipment_name: toText(item.equipment_name),
      final_score: toFiniteNumber(item.final_score ?? item.score_e2 ?? item.SCORE_E2),
      db_score: toFiniteNumber(item.gen_score ?? item.db_score ?? item.crore_3 ?? item.CRORE_3),
      factor: toFiniteNumber(item.factor),
    };

    const existingIndex = entry.linked_equipment.findIndex((candidate) => candidate.equipment_id === equipmentId);
    if (existingIndex === -1) {
      entry.linked_equipment.push(link);
      continue;
    }

    const existing = entry.linked_equipment[existingIndex];
    const nextScore = link.final_score ?? -1;
    const currentScore = existing.final_score ?? -1;
    if (nextScore > currentScore) {
      entry.linked_equipment[existingIndex] = {
        ...existing,
        ...link,
      };
    }
  }

  for (const entry of Array.from(byKey.values())) {
    entry.linked_equipment.sort((left, right) => {
      const leftScore = left.final_score ?? -1;
      const rightScore = right.final_score ?? -1;
      if (leftScore !== rightScore) return rightScore - leftScore;
      return String(left.equipment_name ?? left.equipment_id).localeCompare(String(right.equipment_name ?? right.equipment_id), 'ru');
    });

    entry.linked_equipment_count = entry.linked_equipment.length;
    entry.top_equipment_name = entry.linked_equipment[0]?.equipment_name ?? null;
    entry.top_equipment_score = entry.linked_equipment[0]?.final_score ?? null;
  }

  return Array.from(byKey.values()).sort((left, right) => {
    const leftScore = left.goods_types_score ?? -1;
    const rightScore = right.goods_types_score ?? -1;
    if (leftScore !== rightScore) return rightScore - leftScore;
    const leftTop = left.top_equipment_score ?? -1;
    const rightTop = right.top_equipment_score ?? -1;
    if (leftTop !== rightTop) return rightTop - leftTop;
    return String(left.goods_type_name ?? left.goods_type_id ?? '').localeCompare(String(right.goods_type_name ?? right.goods_type_id ?? ''), 'ru');
  });
}

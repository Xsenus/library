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

export type EquipmentPathTrace = {
  equipment_id: string;
  equipment_name?: string | null;
  final_score?: number | null;
  db_score?: number | null;
  vector_score?: number | null;
  gen_score?: number | null;
  factor?: number | null;
  calculation_path?: string | null;
  matched_site_equipment?: string | null;
  matched_site_equipment_score?: number | null;
  matched_product_id?: string | null;
  matched_product_name?: string | null;
};

export type EquipmentTracePaths = {
  site_equipment: EquipmentPathTrace[];
  okved_equipment: EquipmentPathTrace[];
};

type AnyRecord = Record<string, unknown>;
type TraceSource = '1way' | '2way' | '3way';

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

function scoreOrNull(item: AnyRecord | null | undefined, ...keys: string[]): number | null {
  if (!item) return null;
  for (const key of keys) {
    const score = toFiniteNumber(item[key]);
    if (score != null) return score;
  }
  return null;
}

function bestScore(source: TraceSource): number {
  if (source === '1way') return 3;
  if (source === '2way') return 2;
  return 1;
}

function shouldReplaceRecord(current: AnyRecord | undefined, candidate: AnyRecord, ...scoreKeys: string[]): boolean {
  if (!current) return true;
  const currentScore = scoreOrNull(current, ...scoreKeys) ?? -1;
  const candidateScore = scoreOrNull(candidate, ...scoreKeys) ?? -1;
  return candidateScore > currentScore;
}

function deriveVectorScore(item: AnyRecord | null | undefined, source: TraceSource): number | null {
  if (!item) return null;

  const direct = scoreOrNull(item, 'vector_score');
  if (direct != null) return direct;

  const factor = scoreOrNull(item, 'factor') ?? 1;
  if (source === '1way') {
    const score1 = scoreOrNull(item, 'score_1', 'SCORE_1');
    return score1 == null ? null : score1 * factor;
  }
  if (source === '2way') {
    const goodsScore = scoreOrNull(item, 'crore_2', 'CRORE_2');
    return goodsScore == null ? null : goodsScore * factor;
  }
  const siteScore = scoreOrNull(item, 'equipment_score');
  return siteScore == null ? null : siteScore * factor;
}

function createTraceFromWinner(
  equipmentId: string,
  finalRow: AnyRecord,
  winnerSource: TraceSource,
  selectionStrategy: string | null,
  oneWayById: Map<string, AnyRecord>,
  twoWayById: Map<string, AnyRecord>,
  threeWayById: Map<string, AnyRecord>,
  siteById: Map<string, { name: string | null; score: number | null }>,
  goodsTypeNames: Map<string, string>,
): EquipmentScoreTrace {
  const item: EquipmentScoreTrace = {
    equipment_id: equipmentId,
    equipment_name: toText(finalRow.equipment_name) ?? null,
    final_score: toFiniteNumber(finalRow.score),
    final_source: toText(finalRow.source),
    calculation_path: null,
    bd_score: null,
    vector_score: null,
    gen_score: null,
    factor: null,
    matched_site_equipment: null,
    matched_site_equipment_score: null,
    matched_product_name: null,
    origin_kind: inferOriginFromSource(finalRow.source as string | null | undefined, selectionStrategy),
    origin_name: null,
  };

  if (winnerSource === '1way') {
    const detail = oneWayById.get(equipmentId);
    item.equipment_name = toText(detail?.equipment_name) ?? item.equipment_name ?? null;
    item.calculation_path = toText(detail?.path);
    item.bd_score = scoreOrNull(detail, 'db_score', 'clean_score', 'equipment_score_max');
    item.vector_score = deriveVectorScore(detail, '1way');
    item.gen_score = scoreOrNull(detail, 'gen_score', 'clean_score', 'db_score', 'equipment_score_max');
    item.factor = scoreOrNull(detail, 'factor');
    if (item.final_score == null) {
      item.final_score = scoreOrNull(detail, 'final_score', 'score_e1', 'SCORE_E1');
    }
    if (item.origin_kind === 'okved') {
      item.origin_name = 'Подбор по ОКВЭД';
    }
    return item;
  }

  if (winnerSource === '2way') {
    const detail = twoWayById.get(equipmentId);
    const goodsTypeId = normalizeId(detail?.goods_type_id);
    const matchedProductName =
      toText(detail?.goods_type_name) ??
      (goodsTypeId ? goodsTypeNames.get(goodsTypeId) ?? null : null);

    item.equipment_name = toText(detail?.equipment_name) ?? item.equipment_name ?? null;
    item.calculation_path = '2way';
    item.bd_score = scoreOrNull(detail, 'db_score', 'gen_score', 'crore_3', 'CRORE_3');
    item.vector_score = deriveVectorScore(detail, '2way');
    item.gen_score = scoreOrNull(detail, 'gen_score', 'db_score', 'crore_3', 'CRORE_3');
    item.factor = scoreOrNull(detail, 'factor') ?? 1;
    if (item.final_score == null) {
      item.final_score = scoreOrNull(detail, 'final_score', 'score_e2', 'SCORE_E2');
    }
    item.matched_product_name = matchedProductName;
    item.origin_kind = 'product';
    item.origin_name = matchedProductName;
    return item;
  }

  const detail = threeWayById.get(equipmentId);
  const siteMatch = siteById.get(equipmentId);
  const rawSiteScore = siteMatch?.score ?? scoreOrNull(detail, 'equipment_score');

  item.calculation_path = '3way';
  item.bd_score = scoreOrNull(detail, 'db_score', 'gen_score', 'clean_score', 'crore_3', 'CRORE_3');
  item.vector_score = deriveVectorScore(detail, '3way');
  item.gen_score = scoreOrNull(detail, 'gen_score', 'db_score', 'clean_score', 'crore_3', 'CRORE_3');
  item.factor = scoreOrNull(detail, 'factor') ?? 1;
  if (item.final_score == null) {
    item.final_score = scoreOrNull(detail, 'final_score', 'score_e3', 'SCORE_E3');
  }
  item.matched_site_equipment = siteMatch?.name ?? null;
  item.matched_site_equipment_score = rawSiteScore;
  item.origin_kind = 'site';
  item.origin_name = item.matched_site_equipment ?? null;
  return item;
}

function sortPathRows(left: EquipmentPathTrace, right: EquipmentPathTrace): number {
  const leftScore = left.final_score ?? left.vector_score ?? left.matched_site_equipment_score ?? -1;
  const rightScore = right.final_score ?? right.vector_score ?? right.matched_site_equipment_score ?? -1;
  if (leftScore !== rightScore) return rightScore - leftScore;
  return String(left.equipment_name ?? left.equipment_id).localeCompare(String(right.equipment_name ?? right.equipment_id), 'ru');
}

export function normalizeEquipmentTracePaths(payload: unknown): EquipmentTracePaths {
  const root = recordFrom(payload);
  if (!root) return { site_equipment: [], okved_equipment: [] };

  const oneWayDetails = readArray(root, 'equipment_1way_details');
  const threeWayDetails = readArray(root, 'equipment_3way_details');
  const siteEquipment = readArray(root, 'site_equipment');

  const siteByEquipmentId = new Map<string, { name: string | null; score: number | null }>();
  for (const item of siteEquipment) {
    const equipmentId = normalizeId(item.equipment_id ?? item.id);
    if (!equipmentId) continue;
    const candidate = {
      name: toText(item.equipment ?? item.equipment_site ?? item.name),
      score: scoreOrNull(item, 'equipment_score', 'score', 'match_score'),
    };
    const current = siteByEquipmentId.get(equipmentId);
    if (!current || (candidate.score ?? -1) > (current.score ?? -1)) {
      siteByEquipmentId.set(equipmentId, candidate);
    }
  }

  const siteRows = threeWayDetails.reduce<EquipmentPathTrace[]>((acc, item) => {
    const equipmentId = normalizeId(item.equipment_id ?? item.id);
    if (!equipmentId) return acc;
    const siteMatch = siteByEquipmentId.get(equipmentId);
    acc.push({
      equipment_id: equipmentId,
      equipment_name: toText(item.equipment_name) ?? null,
      final_score: scoreOrNull(item, 'final_score', 'score_e3', 'SCORE_E3'),
      db_score: scoreOrNull(item, 'db_score', 'gen_score', 'clean_score', 'crore_3', 'CRORE_3'),
      vector_score: deriveVectorScore(item, '3way'),
      gen_score: scoreOrNull(item, 'gen_score', 'db_score', 'clean_score', 'crore_3', 'CRORE_3'),
      factor: scoreOrNull(item, 'factor') ?? 1,
      calculation_path: '3way',
      matched_site_equipment: siteMatch?.name ?? toText(item.equipment ?? item.equipment_site) ?? null,
      matched_site_equipment_score: siteMatch?.score ?? scoreOrNull(item, 'equipment_score', 'score', 'match_score'),
      matched_product_id: null,
      matched_product_name: null,
    });
    return acc;
  }, []);

  const okvedRows = oneWayDetails.reduce<EquipmentPathTrace[]>((acc, item) => {
    const equipmentId = normalizeId(item.id ?? item.equipment_id);
    if (!equipmentId) return acc;
    acc.push({
      equipment_id: equipmentId,
      equipment_name: toText(item.equipment_name) ?? null,
      final_score: scoreOrNull(item, 'final_score', 'score_e1', 'SCORE_E1'),
      db_score: scoreOrNull(item, 'db_score', 'clean_score', 'equipment_score_max'),
      vector_score: deriveVectorScore(item, '1way'),
      gen_score: scoreOrNull(item, 'gen_score', 'clean_score', 'db_score', 'equipment_score_max'),
      factor: scoreOrNull(item, 'factor'),
      calculation_path: toText(item.path) ?? '1way',
      matched_site_equipment: null,
      matched_site_equipment_score: null,
      matched_product_id: null,
      matched_product_name: null,
    });
    return acc;
  }, []);

  siteRows.sort(sortPathRows);
  okvedRows.sort(sortPathRows);

  return {
    site_equipment: siteRows,
    okved_equipment: okvedRows,
  };
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

  const oneWayById = new Map<string, AnyRecord>();
  for (const item of oneWayDetails) {
    const equipmentId = normalizeId(item.id ?? item.equipment_id);
    if (!equipmentId) continue;
    const current = oneWayById.get(equipmentId);
    if (shouldReplaceRecord(current, item, 'final_score', 'score_e1', 'SCORE_E1')) {
      oneWayById.set(equipmentId, item);
    }
  }

  const twoWayById = new Map<string, AnyRecord>();
  for (const item of twoWayDetails) {
    const equipmentId = normalizeId(item.equipment_id ?? item.id);
    if (!equipmentId) continue;
    const current = twoWayById.get(equipmentId);
    if (shouldReplaceRecord(current, item, 'final_score', 'score_e2', 'SCORE_E2')) {
      twoWayById.set(equipmentId, item);
    }
  }

  const threeWayById = new Map<string, AnyRecord>();
  for (const item of threeWayDetails) {
    const equipmentId = normalizeId(item.equipment_id ?? item.id);
    if (!equipmentId) continue;
    const current = threeWayById.get(equipmentId);
    if (shouldReplaceRecord(current, item, 'final_score', 'score_e3', 'SCORE_E3')) {
      threeWayById.set(equipmentId, item);
    }
  }

  const siteById = new Map<string, { name: string | null; score: number | null }>();
  for (const item of siteEquipment) {
    const equipmentId = normalizeId(item.equipment_id ?? item.id);
    if (!equipmentId) continue;
    const candidate = {
      name: toText(item.equipment),
      score: scoreOrNull(item, 'equipment_score'),
    };
    const current = siteById.get(equipmentId);
    if (!current || (candidate.score ?? -1) > (current.score ?? -1)) {
      siteById.set(equipmentId, candidate);
    }
  }

  if (!equipmentAll.length) return [];

  const traces: EquipmentScoreTrace[] = equipmentAll
    .map((finalRow) => {
      const equipmentId = normalizeId(finalRow.id ?? finalRow.equipment_id);
      const finalSource = toText(finalRow.source);
      const winnerSource =
        finalSource === '1way' || finalSource === '2way' || finalSource === '3way'
          ? finalSource
          : null;

      if (!equipmentId || !winnerSource) return null;
      return createTraceFromWinner(
        equipmentId,
        finalRow,
        winnerSource,
        selectionStrategy,
        oneWayById,
        twoWayById,
        threeWayById,
        siteById,
        goodsTypeNames,
      );
    })
    .filter((item): item is EquipmentScoreTrace => Boolean(item));

  traces.sort((left, right) => {
    const leftScore = left.final_score ?? -1;
    const rightScore = right.final_score ?? -1;
    if (leftScore !== rightScore) return rightScore - leftScore;

    const leftPriority = bestScore((left.final_source as TraceSource | null) ?? '3way');
    const rightPriority = bestScore((right.final_source as TraceSource | null) ?? '3way');
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;

    return String(left.equipment_name ?? left.equipment_id).localeCompare(
      String(right.equipment_name ?? right.equipment_id),
      'ru',
    );
  });

  return traces;
}

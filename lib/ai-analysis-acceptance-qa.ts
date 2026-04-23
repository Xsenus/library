export type AcceptanceTraceSource = '1way' | '2way' | '3way';

export type AcceptanceTraceItem = {
  equipment_id?: string | number | null;
  equipment_name?: string | null;
  final_score?: number | string | null;
  final_source?: string | null;
  calculation_path?: string | null;
  bd_score?: number | string | null;
  vector_score?: number | string | null;
  gen_score?: number | string | null;
  factor?: number | string | null;
  matched_site_equipment?: string | null;
  matched_site_equipment_score?: number | string | null;
  matched_product_name?: string | null;
  origin_kind?: string | null;
  origin_name?: string | null;
};

export type AcceptanceTracePayload = {
  items?: AcceptanceTraceItem[];
  selection_strategy?: string | null;
  selection_reason?: string | null;
};

export type AcceptanceCaseConfig = {
  name: string;
  inn: string;
  requiredSource: AcceptanceTraceSource;
  expectedSelectionStrategy?: string;
  expectedOriginKind?: 'site' | 'okved' | 'product';
  requireMatchedProduct?: boolean;
  requireMatchedSite?: boolean;
};

export type AcceptanceCaseResult = {
  name: string;
  inn: string;
  ok: boolean;
  selectionStrategy: string | null;
  selectionReason: string | null;
  itemCount: number;
  sourceCount: number;
  selectedItem: {
    equipmentId: string | null;
    equipmentName: string | null;
    finalSource: string | null;
    finalScore: number | null;
    vectorScore: number | null;
    genScore: number | null;
    bdScore: number | null;
    factor: number | null;
    originKind: string | null;
    originName: string | null;
    matchedProductName: string | null;
    matchedSiteEquipment: string | null;
    matchedSiteEquipmentScore: number | null;
    formulaDelta: number | null;
  };
};

const FORMULA_TOLERANCE = 0.002;
const CLEAN_SCORE_TOLERANCE = 0.0001;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function trimText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function looksLikeCyrillicMojibake(value: string | null): boolean {
  if (!value) {
    return false;
  }
  return /(Рџ|Рћ|Рљ|Р’|Р”|Рґ|Р±|Рѕ|Рё|СЂ|СЃ|С‚|СЊ|СЌ|СЋ|СЏ|вЂ|袩|芯|写|斜|褉)/.test(value);
}

function sortedByFinalScore(items: AcceptanceTraceItem[]): AcceptanceTraceItem[] {
  return [...items].sort((left, right) => {
    const leftScore = toFiniteNumber(left.final_score) ?? -1;
    const rightScore = toFiniteNumber(right.final_score) ?? -1;
    return rightScore - leftScore;
  });
}

export function validateAcceptanceTraceCase(
  config: AcceptanceCaseConfig,
  payload: AcceptanceTracePayload,
): AcceptanceCaseResult {
  const items = Array.isArray(payload.items) ? payload.items : [];
  ensure(items.length > 0, `${config.name}: equipment trace should contain rows`);

  const selectionStrategy = trimText(payload.selection_strategy);
  if (config.expectedSelectionStrategy) {
    ensure(
      normalizeText(selectionStrategy) === normalizeText(config.expectedSelectionStrategy),
      `${config.name}: selection_strategy should be ${config.expectedSelectionStrategy}, got ${selectionStrategy ?? 'null'}`,
    );
  }

  const sourceItems = items.filter(
    (item) => normalizeText(item.final_source) === config.requiredSource,
  );
  ensure(
    sourceItems.length > 0,
    `${config.name}: expected at least one ${config.requiredSource} trace row`,
  );

  const selectedItem = sortedByFinalScore(sourceItems)[0];
  const finalScore = toFiniteNumber(selectedItem.final_score);
  const vectorScore = toFiniteNumber(selectedItem.vector_score);
  const genScore = toFiniteNumber(selectedItem.gen_score);
  const bdScore = toFiniteNumber(selectedItem.bd_score);
  const factor = toFiniteNumber(selectedItem.factor);
  const matchedProductName = trimText(selectedItem.matched_product_name);
  const matchedSiteEquipment = trimText(selectedItem.matched_site_equipment);
  const matchedSiteEquipmentScore = toFiniteNumber(selectedItem.matched_site_equipment_score);
  const originKind = trimText(selectedItem.origin_kind);
  const originName = trimText(selectedItem.origin_name);

  ensure(finalScore != null, `${config.name}: final_score should be numeric`);
  ensure(vectorScore != null, `${config.name}: vector_score should be numeric`);
  ensure(genScore != null, `${config.name}: gen_score should be numeric`);
  ensure(genScore >= 0 && genScore <= 1, `${config.name}: gen_score should look like clean_score`);

  if (bdScore != null) {
    ensure(
      Math.abs(genScore - bdScore) <= CLEAN_SCORE_TOLERANCE,
      `${config.name}: gen_score should match bd_score clean_score semantics`,
    );
  }

  const formulaDelta = Math.abs(finalScore - vectorScore * genScore);
  ensure(
    formulaDelta <= FORMULA_TOLERANCE,
    `${config.name}: final_score should match VECTOR x GEN, delta=${formulaDelta.toFixed(6)}`,
  );

  if (config.expectedOriginKind) {
    ensure(
      normalizeText(originKind) === config.expectedOriginKind,
      `${config.name}: origin_kind should be ${config.expectedOriginKind}, got ${originKind ?? 'null'}`,
    );
  }
  if (config.requireMatchedProduct) {
    ensure(Boolean(matchedProductName), `${config.name}: 2way row should expose matched product`);
    ensure(!matchedSiteEquipment, `${config.name}: 2way row should not borrow site match`);
  }
  if (config.requireMatchedSite) {
    ensure(Boolean(matchedSiteEquipment), `${config.name}: 3way row should expose matched site equipment`);
    ensure(
      matchedSiteEquipmentScore != null && matchedSiteEquipmentScore >= 0 && matchedSiteEquipmentScore <= 1,
      `${config.name}: 3way row should expose raw site match score`,
    );
    ensure(!matchedProductName, `${config.name}: 3way row should not borrow product match`);
  }
  if (config.expectedOriginKind === 'okved') {
    ensure(!matchedProductName, `${config.name}: okved row should not borrow product match`);
    ensure(!matchedSiteEquipment, `${config.name}: okved row should not borrow site match`);
    ensure(originName === 'Подбор по ОКВЭД', `${config.name}: okved origin_name should be readable`);
  }
  ensure(!looksLikeCyrillicMojibake(originName), `${config.name}: origin_name should not contain mojibake`);

  return {
    name: config.name,
    inn: config.inn,
    ok: true,
    selectionStrategy,
    selectionReason: trimText(payload.selection_reason),
    itemCount: items.length,
    sourceCount: sourceItems.length,
    selectedItem: {
      equipmentId: selectedItem.equipment_id == null ? null : String(selectedItem.equipment_id),
      equipmentName: trimText(selectedItem.equipment_name),
      finalSource: trimText(selectedItem.final_source),
      finalScore,
      vectorScore,
      genScore,
      bdScore,
      factor,
      originKind,
      originName,
      matchedProductName,
      matchedSiteEquipment,
      matchedSiteEquipmentScore,
      formulaDelta,
    },
  };
}

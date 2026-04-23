export type EquipmentCardOrigin = 'site' | 'okved' | 'product';

export type EquipmentCardTrace = {
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
  origin_kind?: EquipmentCardOrigin | null;
  origin_name?: string | null;
};

export type EquipmentCardViewInput = {
  itemName?: string | null;
  itemScore?: number | null;
  trace?: EquipmentCardTrace | null;
  showOkvedFallbackBadge?: boolean;
};

export type EquipmentCardContext =
  | {
      kind: 'product' | 'site' | 'okved' | 'origin';
      value: string;
      scoreLabel?: string | null;
    }
  | null;

export type EquipmentCardMetric = {
  value: number | null;
  displayLabel: string;
};

export type EquipmentCardBreakdown = {
  vector: EquipmentCardMetric;
  gen: EquipmentCardMetric;
  factor: EquipmentCardMetric;
  final: EquipmentCardMetric;
};

export type EquipmentCardViewModel = {
  equipmentName: string;
  displayFinalScore: number | null;
  scoreLabel: string;
  context: EquipmentCardContext;
  breakdown: EquipmentCardBreakdown | null;
  calcPathLabel: string | null;
  finalSourceLabel: string | null;
  originLabel: string | null;
};

function trimText(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

function formatMatchScore(score: number | string | null | undefined): string | null {
  if (score == null) return null;
  const value = Number(score);
  if (!Number.isFinite(value)) return null;
  if (value === 0) return '0%';
  if (value > 0 && value <= 1) return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(2);
}

function formatRawScore(score: number | string | null | undefined): string | null {
  if (score == null) return null;
  const value = Number(score);
  if (!Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return value.toFixed(3);
  return value.toFixed(2);
}

function formatSimilarityScore(score: number | string | null | undefined): string | null {
  if (score == null) return null;
  const value = Number(score);
  if (!Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return `${(value * 100).toFixed(1)}%`;
  if (value > 1 && value <= 100) return `${value.toFixed(1)}%`;
  return value.toFixed(2);
}

function formatEquipmentCalcPath(path: string | null | undefined): string | null {
  const normalized = String(path ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === '1way') return 'Через prodclass';
  if (normalized === '2way') return 'Через продукцию';
  if (normalized === '3way') return 'Через сайт';
  if (normalized === 'direct') return 'Прямой путь';
  if (normalized === 'fallback') return 'Фолбэк по отрасли';
  if (normalized === 'fallback_missing_industry') return 'Фолбэк без отрасли';
  if (normalized === 'fallback_no_workshops') return 'Фолбэк без цехов';
  return normalized;
}

function formatEquipmentSource(source: string | null | undefined): string | null {
  const normalized = String(source ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === '1way') return 'SCORE_E1';
  if (normalized === '2way') return 'SCORE_E2';
  if (normalized === '3way') return 'SCORE_E3';
  return normalized.toUpperCase();
}

function formatEquipmentOrigin(origin: EquipmentCardTrace['origin_kind']): string | null {
  if (origin === 'site') return 'Источник: сайт';
  if (origin === 'okved') return 'Источник: ОКВЭД';
  if (origin === 'product') return 'Источник: продукция';
  return null;
}

function buildMetric(value: number | null, formatter: (value: number | null) => string | null): EquipmentCardMetric {
  return {
    value,
    displayLabel: formatter(value) ?? '—',
  };
}

export function buildEquipmentCardView(input: EquipmentCardViewInput): EquipmentCardViewModel {
  const trace = input.trace ?? null;
  const displayFinalScore = trace?.final_score ?? input.itemScore ?? null;
  const matchedSiteEquipment = trimText(trace?.matched_site_equipment);
  const matchedProductName = trimText(trace?.matched_product_name);
  const originName = trimText(trace?.origin_name);
  const matchedSiteScoreLabel = formatMatchScore(trace?.matched_site_equipment_score ?? null);
  const displayVectorScore = trace?.vector_score ?? null;
  const displayGenScore = trace?.gen_score ?? trace?.bd_score ?? null;
  const displayFactor = trace?.factor ?? null;
  const hasTraceBreakdown = [
    displayVectorScore,
    displayGenScore,
    displayFactor,
    displayFinalScore,
  ].some((value) => value != null);

  let context: EquipmentCardContext = null;
  if (matchedProductName) {
    context = { kind: 'product', value: matchedProductName };
  } else if (matchedSiteEquipment) {
    context = {
      kind: 'site',
      value: matchedSiteEquipment,
      scoreLabel: matchedSiteScoreLabel,
    };
  } else if (trace?.origin_kind === 'okved' || input.showOkvedFallbackBadge) {
    context = {
      kind: 'okved',
      value: originName ?? 'по ОКВЭД',
    };
  } else if (originName) {
    context = {
      kind: 'origin',
      value: originName,
    };
  }

  return {
    equipmentName: trimText(trace?.equipment_name) ?? trimText(input.itemName) ?? '—',
    displayFinalScore,
    scoreLabel: formatSimilarityScore(displayFinalScore) ?? formatRawScore(displayFinalScore) ?? '—',
    context,
    breakdown: hasTraceBreakdown
      ? {
          vector: buildMetric(displayVectorScore, (value) => formatSimilarityScore(value) ?? formatRawScore(value)),
          gen: buildMetric(displayGenScore, (value) => formatSimilarityScore(value) ?? formatRawScore(value)),
          factor: buildMetric(displayFactor, formatRawScore),
          final: buildMetric(displayFinalScore, (value) => formatSimilarityScore(value) ?? formatRawScore(value)),
        }
      : null,
    calcPathLabel: formatEquipmentCalcPath(trace?.calculation_path),
    finalSourceLabel: formatEquipmentSource(trace?.final_source),
    originLabel: formatEquipmentOrigin(trace?.origin_kind),
  };
}

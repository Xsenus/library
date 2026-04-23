import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEquipmentCardView } from '../lib/ai-analysis-equipment-card-view';

test('buildEquipmentCardView keeps raw site score separate from vector score for 3way winners', () => {
  const view = buildEquipmentCardView({
    itemName: 'Fallback name',
    itemScore: 0.2,
    trace: {
      equipment_name: 'Bottle line',
      final_score: 0.7097,
      final_source: '3way',
      calculation_path: '3way',
      vector_score: 0.91,
      gen_score: 0.78,
      factor: 0.85,
      matched_site_equipment: 'Bottle filling line on site',
      matched_site_equipment_score: 0.53,
      origin_kind: 'site',
    },
  });

  assert.equal(view.equipmentName, 'Bottle line');
  assert.equal(view.scoreLabel, '71.0%');
  assert.deepEqual(view.context, {
    kind: 'site',
    value: 'Bottle filling line on site',
    scoreLabel: '53.0%',
  });
  assert.equal(view.breakdown?.vector.value, 0.91);
  assert.equal(view.breakdown?.gen.value, 0.78);
  assert.equal(view.breakdown?.factor.value, 0.85);
  assert.equal(view.breakdown?.final.value, 0.7097);
  assert.equal(view.calcPathLabel, 'Через сайт');
  assert.equal(view.finalSourceLabel, 'SCORE_E3');
  assert.equal(view.originLabel, 'Источник: сайт');
});

test('buildEquipmentCardView uses product winner semantics for 2way rows', () => {
  const view = buildEquipmentCardView({
    itemName: 'Fallback freeze dryer',
    trace: {
      equipment_name: 'Lyophilizer',
      final_score: 0.6004,
      final_source: '2way',
      calculation_path: '2way',
      vector_score: 0.619,
      bd_score: 0.4,
      gen_score: 0.97,
      factor: 0.8,
      matched_product_name: 'Вакцины',
      origin_kind: 'product',
      origin_name: 'Вакцины',
    },
  });

  assert.equal(view.context?.kind, 'product');
  assert.equal(view.context?.value, 'Вакцины');
  assert.equal(view.breakdown?.gen.value, 0.97);
  assert.equal(view.breakdown?.gen.displayLabel, '97.0%');
  assert.equal(view.breakdown?.factor.displayLabel, '0.800');
  assert.equal(view.finalSourceLabel, 'SCORE_E2');
  assert.equal(view.originLabel, 'Источник: продукция');
});

test('buildEquipmentCardView falls back to bd_score when legacy payload has no gen_score', () => {
  const view = buildEquipmentCardView({
    itemName: 'Legacy row',
    trace: {
      final_score: 0.55,
      vector_score: 0.61,
      bd_score: 0.9,
      factor: 0.75,
      final_source: '1way',
      calculation_path: 'fallback',
      origin_kind: 'site',
    },
  });

  assert.equal(view.breakdown?.gen.value, 0.9);
  assert.equal(view.breakdown?.gen.displayLabel, '90.0%');
  assert.equal(view.calcPathLabel, 'Фолбэк по отрасли');
});

test('buildEquipmentCardView keeps okved context when fallback badge is forced', () => {
  const view = buildEquipmentCardView({
    itemName: 'Isolator',
    itemScore: 0.534,
    showOkvedFallbackBadge: true,
    trace: {
      vector_score: 0.6675,
      gen_score: 0.8,
      factor: 0.75,
      final_source: '1way',
      calculation_path: 'fallback',
    },
  });

  assert.deepEqual(view.context, {
    kind: 'okved',
    value: 'по ОКВЭД',
  });
  assert.equal(view.scoreLabel, '53.4%');
  assert.equal(view.breakdown?.gen.displayLabel, '80.0%');
});

test('buildEquipmentCardView falls back to item values when trace is absent', () => {
  const view = buildEquipmentCardView({
    itemName: 'Cartoner',
    itemScore: 0.42,
  });

  assert.equal(view.equipmentName, 'Cartoner');
  assert.equal(view.scoreLabel, '42.0%');
  assert.equal(view.breakdown?.vector.displayLabel, '—');
  assert.equal(view.breakdown?.final.displayLabel, '42.0%');
  assert.equal(view.context, null);
});

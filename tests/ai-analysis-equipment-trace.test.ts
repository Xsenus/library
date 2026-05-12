import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeEquipmentTracePaths, normalizeEquipmentTracePayload } from '../lib/ai-analysis-equipment-trace';

test('normalizeEquipmentTracePayload keeps only winner-path data for 3way equipment', () => {
  const items = normalizeEquipmentTracePayload({
    selection_strategy: 'site',
    equipment_all: [{ id: 12, equipment_name: 'Filling machine', score: 0.7097, source: '3way' }],
    equipment_1way_details: [{ id: 12, db_score: 0.87, score_1: 0.91, factor: 0.7, path: 'direct' }],
    equipment_3way_details: [
      {
        equipment_id: 12,
        equipment_score: 0.83,
        vector_score: 0.747,
        db_score: 0.95,
        gen_score: 0.95,
        score_e3: 0.7097,
        factor: 0.9,
      },
    ],
    site_equipment: [
      { id: 100, equipment_id: 12, equipment: 'Site filling line', equipment_score: 0.81 },
      { id: 101, equipment_id: 12, equipment: 'Older match', equipment_score: 0.52 },
    ],
  });

  assert.deepEqual(items, [
    {
      equipment_id: '12',
      equipment_name: 'Filling machine',
      final_score: 0.7097,
      final_source: '3way',
      calculation_path: '3way',
      bd_score: 0.95,
      vector_score: 0.747,
      gen_score: 0.95,
      factor: 0.9,
      matched_site_equipment: 'Site filling line',
      matched_site_equipment_score: 0.81,
      matched_product_name: null,
      origin_kind: 'site',
      origin_name: 'Site filling line',
    },
  ]);
});

test('normalizeEquipmentTracePayload does not mix 1way fields into 3way winners', () => {
  const items = normalizeEquipmentTracePayload({
    selection_strategy: 'site',
    equipment_all: [{ id: 12, equipment_name: 'Filling machine', score: 0.48, source: '3way' }],
    equipment_1way_details: [
      {
        id: 12,
        db_score: 0.11,
        gen_score: 0.11,
        vector_score: 0.22,
        final_score: 0.0242,
        factor: 0.33,
        path: 'direct',
      },
    ],
    equipment_3way_details: [
      {
        equipment_id: 12,
        equipment_score: 0.6,
        db_score: 0.8,
        gen_score: 0.8,
        final_score: 0.48,
        factor: 1,
      },
    ],
  });

  assert.equal(items[0]?.final_source, '3way');
  assert.equal(items[0]?.calculation_path, '3way');
  assert.equal(items[0]?.vector_score, 0.6);
  assert.equal(items[0]?.gen_score, 0.8);
  assert.equal(items[0]?.factor, 1);
  assert.equal(items[0]?.bd_score, 0.8);
});

test('normalizeEquipmentTracePayload does not borrow site trace for 1way winners', () => {
  const items = normalizeEquipmentTracePayload({
    selection_strategy: 'site',
    equipment_all: [{ id: 7, score: 0.3075, source: '1way' }],
    equipment_1way_details: [
      { id: 7, db_score: 0.75, gen_score: 0.75, score_1: 0.82, factor: 0.5, path: 'fallback' },
    ],
    site_equipment: [{ id: 55, equipment_id: 7, equipment: 'Capping machine', equipment_score: 0.61 }],
  });

  assert.equal(items[0]?.equipment_id, '7');
  assert.equal(items[0]?.calculation_path, 'fallback');
  assert.equal(items[0]?.vector_score, 0.41);
  assert.equal(items[0]?.gen_score, 0.75);
  assert.equal(items[0]?.matched_site_equipment, null);
  assert.equal(items[0]?.matched_site_equipment_score, null);
});

test('normalizeEquipmentTracePayload resolves matched product names and clean score for 2way rows', () => {
  const items = normalizeEquipmentTracePayload({
    equipment_all: [{ id: 44, equipment_name: 'Lyophilizer', score: 0.6004, source: '2way' }],
    goods_types: [{ goods_type_id: 11, goods_type: 'Вакцины' }],
    equipment_1way_details: [{ id: 44, db_score: 0.11, gen_score: 0.11, score_1: 0.22, factor: 0.5, path: 'direct' }],
    equipment_2way_details: [
      {
        equipment_id: 44,
        goods_type_id: 11,
        crore_2: 0.774,
        crore_3: 0.97,
        score_e2: 0.6004,
        vector_score: 0.619,
        db_score: 0.97,
        gen_score: 0.97,
        final_score: 0.6004,
        factor: 0.8,
      },
    ],
  });

  assert.deepEqual(items, [
    {
      equipment_id: '44',
      equipment_name: 'Lyophilizer',
      final_score: 0.6004,
      final_source: '2way',
      calculation_path: '2way',
      bd_score: 0.97,
      vector_score: 0.619,
      gen_score: 0.97,
      factor: 0.8,
      matched_site_equipment: null,
      matched_site_equipment_score: null,
      matched_product_name: 'Вакцины',
      origin_kind: 'product',
      origin_name: 'Вакцины',
    },
  ]);
});

test('normalizeEquipmentTracePayload marks okved sourced equipment when strategy is okved', () => {
  const items = normalizeEquipmentTracePayload({
    selection_strategy: 'okved',
    equipment_all: [{ id: 99, equipment_name: 'Isolator', score: 0.534, source: '1way' }],
    equipment_1way_details: [{ id: 99, db_score: 0.8, gen_score: 0.8, score_1: 0.89, factor: 0.75, path: 'fallback' }],
  });

  assert.deepEqual(items, [
    {
      equipment_id: '99',
      equipment_name: 'Isolator',
      final_score: 0.534,
      final_source: '1way',
      calculation_path: 'fallback',
      bd_score: 0.8,
      vector_score: 0.6675,
      gen_score: 0.8,
      factor: 0.75,
      matched_site_equipment: null,
      matched_site_equipment_score: null,
      matched_product_name: null,
      origin_kind: 'okved',
      origin_name: 'Подбор по ОКВЭД',
    },
  ]);
});

test('normalizeEquipmentTracePaths exposes site and okved path rows separately', () => {
  const paths = normalizeEquipmentTracePaths({
    site_equipment: [{ equipment_id: 12, equipment: 'Site filling line', equipment_score: 0.81 }],
    equipment_3way_details: [
      {
        equipment_id: 12,
        equipment_name: 'Filling machine',
        equipment_score: 0.83,
        db_score: 0.95,
        score_e3: 0.7097,
        factor: 0.9,
      },
    ],
    equipment_1way_details: [
      {
        id: 99,
        equipment_name: 'Isolator',
        db_score: 0.8,
        score_1: 0.89,
        score_e1: 0.534,
        factor: 0.75,
        path: 'fallback',
      },
    ],
  });

  assert.deepEqual(paths.site_equipment, [
    {
      equipment_id: '12',
      equipment_name: 'Filling machine',
      final_score: 0.7097,
      db_score: 0.95,
      vector_score: 0.747,
      gen_score: 0.95,
      factor: 0.9,
      calculation_path: '3way',
      matched_site_equipment: 'Site filling line',
      matched_site_equipment_score: 0.81,
      matched_product_id: null,
      matched_product_name: null,
    },
  ]);

  assert.deepEqual(paths.okved_equipment, [
    {
      equipment_id: '99',
      equipment_name: 'Isolator',
      final_score: 0.534,
      db_score: 0.8,
      vector_score: 0.6675,
      gen_score: 0.8,
      factor: 0.75,
      calculation_path: 'fallback',
      matched_site_equipment: null,
      matched_site_equipment_score: null,
      matched_product_id: null,
      matched_product_name: null,
    },
  ]);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeEquipmentTracePayload } from '../lib/ai-analysis-equipment-trace';

test('normalizeEquipmentTracePayload merges final score and scoring inputs by equipment id', () => {
  const items = normalizeEquipmentTracePayload({
    equipment_all: [{ id: 12, equipment_name: 'Filling machine', score: 0.99, source: '3way' }],
    equipment_1way_details: [{ id: 12, equipment_score_max: 0.87, score_1: 0.91, factor: 0.7, path: 'direct' }],
    equipment_3way_details: [{ equipment_id: 12, equipment_score: 0.83, score_e3: 0.76 }],
    site_equipment: [
      { id: 100, equipment_id: 12, equipment: 'Site filling line', equipment_score: 0.81 },
      { id: 101, equipment_id: 12, equipment: 'Older match', equipment_score: 0.52 },
    ],
  });

  assert.deepEqual(items, [
    {
      equipment_id: '12',
      final_score: 0.99,
      final_source: '3way',
      calculation_path: 'direct',
      bd_score: 0.87,
      vector_score: 0.83,
      gen_score: 0.91,
      factor: 0.7,
      matched_site_equipment: 'Site filling line',
      matched_site_equipment_score: 0.81,
    },
  ]);
});

test('normalizeEquipmentTracePayload falls back to site equipment score when 3way details are absent', () => {
  const items = normalizeEquipmentTracePayload({
    equipment_all: [{ id: 7, score: 0.64, source: '1way' }],
    equipment_1way_details: [{ id: 7, equipment_score_max: 0.75, score_1: 0.82, factor: 0.5, path: 'fallback' }],
    site_equipment: [{ id: 55, equipment_id: 7, equipment: 'Capping machine', equipment_score: 0.61 }],
  });

  assert.equal(items[0]?.equipment_id, '7');
  assert.equal(items[0]?.vector_score, 0.61);
  assert.equal(items[0]?.matched_site_equipment, 'Capping machine');
});

test('normalizeEquipmentTracePayload prefers explicit upstream trace fields for 2way scores', () => {
  const items = normalizeEquipmentTracePayload({
    equipment_all: [{ id: 44, score: 0.97, source: '2way' }],
    equipment_2way_details: [
      {
        equipment_id: 44,
        goods_type_id: 11,
        crore_2: 0.12,
        crore_3: 0.34,
        score_e2: 0.04,
        vector_score: 0.619,
        db_score: 0.97,
        final_score: 0.97,
      },
    ],
  });

  assert.deepEqual(items, [
    {
      equipment_id: '44',
      final_score: 0.97,
      final_source: '2way',
      calculation_path: '2way',
      bd_score: 0.97,
      vector_score: 0.619,
      gen_score: 0.12,
      factor: 1,
    },
  ]);
});

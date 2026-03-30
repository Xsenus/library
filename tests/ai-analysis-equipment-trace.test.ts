import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeEquipmentTracePayload } from '../lib/ai-analysis-equipment-trace';

test('normalizeEquipmentTracePayload merges final score and scoring inputs by equipment id', () => {
  const items = normalizeEquipmentTracePayload({
    equipment_all: [
      { id: 12, equipment_name: 'Машина розлива', score: 0.99, source: '3way' },
    ],
    equipment_1way_details: [
      { id: 12, equipment_score_max: 0.87, score_1: 0.91, factor: 0.7, path: 'direct' },
    ],
    equipment_3way_details: [
      { equipment_id: 12, equipment_score: 0.83, score_e3: 0.76 },
    ],
    site_equipment: [
      { id: 100, equipment_id: 12, equipment: 'Линия розлива с сайта', equipment_score: 0.81 },
      { id: 101, equipment_id: 12, equipment: 'Старое совпадение', equipment_score: 0.52 },
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
      matched_site_equipment: 'Линия розлива с сайта',
      matched_site_equipment_score: 0.81,
    },
  ]);
});

test('normalizeEquipmentTracePayload falls back to site equipment score when 3way details are absent', () => {
  const items = normalizeEquipmentTracePayload({
    equipment_all: [{ id: 7, score: 0.64, source: '1way' }],
    equipment_1way_details: [{ id: 7, equipment_score_max: 0.75, score_1: 0.82, factor: 0.5, path: 'fallback' }],
    site_equipment: [{ id: 55, equipment_id: 7, equipment: 'Укупорочная машина', equipment_score: 0.61 }],
  });

  assert.equal(items[0]?.equipment_id, '7');
  assert.equal(items[0]?.vector_score, 0.61);
  assert.equal(items[0]?.matched_site_equipment, 'Укупорочная машина');
});

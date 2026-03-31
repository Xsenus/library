import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProductTracePayload } from '../lib/ai-analysis-product-trace';

test('normalizeProductTracePayload merges goods score with linked equipment rows', () => {
  const items = normalizeProductTracePayload({
    goods_types: [{ goods_type_id: 11, goods_type: 'Вакцины', goods_types_score: 0.66 }],
    equipment_2way_details: [
      {
        goods_type_id: 11,
        goods_type_name: 'Вакцины',
        equipment_id: 44,
        equipment_name: 'Лиофильная сушильная камера',
        vector_score: 0.66,
        db_score: 0.91,
        factor: 0.8,
        final_score: 0.48,
      },
      {
        goods_type_id: 11,
        goods_type_name: 'Вакцины',
        equipment_id: 13,
        equipment_name: 'Изолятор',
        vector_score: 0.66,
        db_score: 0.71,
        factor: 0.8,
        final_score: 0.31,
      },
    ],
  });

  assert.deepEqual(items, [
    {
      lookup_key: 'id:11',
      goods_type_id: '11',
      goods_type_name: 'Вакцины',
      goods_types_score: 0.66,
      goods_type_source: null,
      factor: 0.8,
      linked_equipment_count: 2,
      top_equipment_name: 'Лиофильная сушильная камера',
      top_equipment_score: 0.48,
      linked_equipment: [
        {
          equipment_id: '44',
          equipment_name: 'Лиофильная сушильная камера',
          final_score: 0.48,
          db_score: 0.91,
          factor: 0.8,
        },
        {
          equipment_id: '13',
          equipment_name: 'Изолятор',
          final_score: 0.31,
          db_score: 0.71,
          factor: 0.8,
        },
      ],
    },
  ]);
});

test('normalizeProductTracePayload falls back to goods_type_scores when goods_types rows are absent', () => {
  const items = normalizeProductTracePayload({
    goods_type_scores: [{ goods_type_id: 91, crore_2: 0.52 }],
    goods_links: [
      {
        goods_type_id: 91,
        goods_type_name: 'Ампулы',
        equipment_id: 7,
        equipment_name: 'Укупорочная машина',
        score_e2: 0.29,
        crore_3: 0.55,
      },
    ],
  });

  assert.deepEqual(items, [
    {
      lookup_key: 'id:91',
      goods_type_id: '91',
      goods_type_name: 'Ампулы',
      goods_types_score: 0.52,
      goods_type_source: null,
      factor: null,
      linked_equipment_count: 1,
      top_equipment_name: 'Укупорочная машина',
      top_equipment_score: 0.29,
      linked_equipment: [
        {
          equipment_id: '7',
          equipment_name: 'Укупорочная машина',
          final_score: 0.29,
          db_score: 0.55,
          factor: null,
        },
      ],
    },
  ]);
});

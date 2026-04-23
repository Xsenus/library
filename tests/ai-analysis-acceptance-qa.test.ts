import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAcceptanceTraceCase } from '../lib/ai-analysis-acceptance-qa';

test('validateAcceptanceTraceCase accepts okved 1way clean_score semantics', () => {
  const result = validateAcceptanceTraceCase(
    {
      name: 'okved-1way',
      inn: '1841109992',
      requiredSource: '1way',
      expectedSelectionStrategy: 'okved',
      expectedOriginKind: 'okved',
    },
    {
      selection_strategy: 'okved',
      selection_reason: 'fallback',
      items: [
        {
          equipment_id: '323',
          equipment_name: 'Anilox',
          final_source: '1way',
          final_score: 0.99,
          vector_score: 1,
          gen_score: 0.99,
          bd_score: 0.99,
          factor: 1,
          origin_kind: 'okved',
          origin_name: 'Подбор по ОКВЭД',
        },
      ],
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.selectedItem.formulaDelta, 0);
  assert.equal(result.selectedItem.originKind, 'okved');
  assert.equal(result.selectedItem.originName, 'Подбор по ОКВЭД');
});

test('validateAcceptanceTraceCase rejects mojibake okved origin labels', () => {
  assert.throws(
    () =>
      validateAcceptanceTraceCase(
        {
          name: 'okved-1way',
          inn: '1841109992',
          requiredSource: '1way',
          expectedOriginKind: 'okved',
        },
        {
          items: [
            {
              equipment_id: '323',
              final_source: '1way',
              final_score: 0.99,
              vector_score: 1,
              gen_score: 0.99,
              bd_score: 0.99,
              origin_kind: 'okved',
              origin_name: 'РџРѕРґР±РѕСЂ РїРѕ РћРљР’Р­Р”',
            },
          ],
        },
      ),
    /origin_name should be readable/,
  );
});

test('validateAcceptanceTraceCase rejects cross-path leakage in product 2way rows', () => {
  assert.throws(
    () =>
      validateAcceptanceTraceCase(
        {
          name: 'product-2way',
          inn: '6320002223',
          requiredSource: '2way',
          expectedOriginKind: 'product',
          requireMatchedProduct: true,
        },
        {
          items: [
            {
              equipment_id: '2972',
              final_source: '2way',
              final_score: 0.834,
              vector_score: 0.851,
              gen_score: 0.98,
              bd_score: 0.98,
              matched_product_name: 'Cars',
              matched_site_equipment: 'Borrowed site row',
              origin_kind: 'product',
            },
          ],
        },
      ),
    /should not borrow site match/,
  );
});

test('validateAcceptanceTraceCase accepts raw site score for 3way rows', () => {
  const result = validateAcceptanceTraceCase(
    {
      name: 'site-3way',
      inn: '3444070534',
      requiredSource: '3way',
      expectedSelectionStrategy: 'site',
      expectedOriginKind: 'site',
      requireMatchedSite: true,
    },
    {
      selection_strategy: 'site',
      items: [
        {
          equipment_id: '2247',
          equipment_name: 'Oil filtration',
          final_source: '3way',
          final_score: 0.4876,
          vector_score: 0.53,
          gen_score: 0.92,
          bd_score: 0.92,
          factor: 1,
          matched_site_equipment: 'Oil refining equipment',
          matched_site_equipment_score: 0.53,
          origin_kind: 'site',
        },
      ],
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.selectedItem.matchedSiteEquipmentScore, 0.53);
});

test('validateAcceptanceTraceCase rejects broken FINAL = VECTOR x GEN formula', () => {
  assert.throws(
    () =>
      validateAcceptanceTraceCase(
        {
          name: 'broken-formula',
          inn: '0000000000',
          requiredSource: '3way',
          expectedOriginKind: 'site',
          requireMatchedSite: true,
        },
        {
          items: [
            {
              equipment_id: '1',
              final_source: '3way',
              final_score: 0.9,
              vector_score: 0.5,
              gen_score: 0.9,
              bd_score: 0.9,
              matched_site_equipment: 'Site equipment',
              matched_site_equipment_score: 0.5,
              origin_kind: 'site',
            },
          ],
        },
      ),
    /VECTOR x GEN/,
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractMeaningfulText,
  normalizeOkvedEntries,
  parseDisplayString,
  stripLargeAnalysisFields,
} from '../lib/ai-analysis-value-normalizer';

test('parseDisplayString does not stringify plain objects into object placeholder', () => {
  assert.equal(parseDisplayString('[object Object]'), null);
  assert.equal(parseDisplayString({ value: 'test' }), null);
  assert.equal(parseDisplayString(['test']), null);
  assert.equal(parseDisplayString(42), '42');
});

test('extractMeaningfulText resolves nested product names from fallback payloads', () => {
  const payload = {
    goods_type: {
      label: '[object Object]',
      value: {
        name: 'Линия порошковой окраски',
      },
    },
    match_id: 54,
  };

  assert.equal(
    extractMeaningfulText(payload, {
      preferredKeys: ['goods_type', 'goods', 'name', 'title', 'product', 'label', 'value', 'text'],
    }),
    'Линия порошковой окраски',
  );
});

test('extractMeaningfulText skips object placeholders and finds nested tnved code', () => {
  const payload = {
    tnved_code: {
      label: '[object Object]',
      value: ['8479.89.970.8'],
    },
    goods: {
      title: '[object Object]',
    },
  };

  assert.equal(
    extractMeaningfulText(payload, {
      preferredKeys: ['tnved_code', 'goods_type_code', 'tnved', 'code', 'tn_ved', 'tnvedCode'],
    }),
    '8479.89.970.8',
  );
});

test('normalizeOkvedEntries preserves code and human readable names', () => {
  const entries = normalizeOkvedEntries([
    { code: '49.20', name: 'Грузовые железнодорожные перевозки', main: true },
    { code: '16.10', name: 'Распиловка и строгание древесины', main: false },
  ]);

  assert.deepEqual(entries, [
    { code: '49.20', name: 'Грузовые железнодорожные перевозки', main: true },
    { code: '16.10', name: 'Распиловка и строгание древесины', main: false },
  ]);
});

test('stripLargeAnalysisFields removes vectors and raw prompt payloads recursively', () => {
  const sanitized = stripLargeAnalysisFields({
    name: 'Товар',
    text_vector: '[1,2,3]',
    nested: {
      prompt_raw: 'very long prompt',
      product: {
        name: 'Вложенный товар',
        embedding: [0.1, 0.2],
      },
    },
  });

  assert.deepEqual(sanitized, {
    name: 'Товар',
    nested: {
      product: {
        name: 'Вложенный товар',
      },
    },
  });
});

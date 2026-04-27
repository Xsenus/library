import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const componentSource = fs.readFileSync(
  path.join(process.cwd(), 'components/library/ai-company-analysis-tab.tsx'),
  'utf8',
);

test('AI analysis companies tab exposes nested list modes and visible search', () => {
  assert.match(componentSource, /type CompanyListMode = 'all' \| 'analyzed'/);
  assert.match(componentSource, /data-testid="ai-analysis-subtab-all"/);
  assert.match(componentSource, /data-testid="ai-analysis-subtab-analyzed"/);
  assert.match(componentSource, /data-testid="ai-analysis-company-search"/);
  assert.match(componentSource, /id="ai-analysis-company-search"/);
});

test('AI analysis company header keeps controls compact', () => {
  assert.doesNotMatch(componentSource, /Активных сейчас/);
  assert.doesNotMatch(componentSource, /Всего компаний/);
  assert.match(componentSource, />Компаний</);
  assert.match(componentSource, /title=\{integrationAddressTitle\}/);
  assert.match(componentSource, /Очередь\{queuedTotal > 0/);
  assert.match(componentSource, /aria-label="Запустить выбранные"/);
  assert.match(componentSource, /<Play className="h-4 w-4" \/>/);
  assert.match(componentSource, /aria-label="Остановить анализ"/);
  assert.match(componentSource, /<Square className="h-4 w-4" \/>/);
});

test('AI analysis company toolbar keeps filter state from shifting controls', () => {
  assert.match(componentSource, /2xl:grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(componentSource, /lg:grid-cols-\[minmax\(220px,1fr\)_auto_auto_minmax\(220px,320px\)\]/);
  assert.match(componentSource, /!hasFilters && 'invisible pointer-events-none'/);
  assert.match(componentSource, /tabIndex=\{hasFilters \? 0 : -1\}/);
  assert.match(componentSource, /className="h-9 w-full min-w-0 text-sm"/);
});

test('equipment settings dialog explains every calculation coefficient', () => {
  assert.match(componentSource, /type EquipmentSettingHelp/);
  assert.match(componentSource, /const equipmentSettingsHelp/);
  assert.match(componentSource, /CircleHelp/);
  assert.equal((componentSource.match(/<EquipmentSettingLabel/g) ?? []).length, 8);
  assert.match(componentSource, /description_okved_score/);
  assert.match(componentSource, /prodclass_by_okved/);
  assert.match(componentSource, /SCORE_E1 = SCORE_1 \* K direct \* clean_score/);
  assert.match(componentSource, /SCORE_E1 = SCORE_1 \* K fallback \* clean_score/);
  assert.match(componentSource, /SCORE_E2 = goods_types_score \* K E2 \* clean_score/);
  assert.match(componentSource, /SCORE_E3 = equipment_score \* K E3 \* clean_score/);
  assert.match(componentSource, /min_product_score/);
});

test('analyzed companies mode requests successful analyses sorted by finish history', () => {
  assert.match(
    componentSource,
    /requestSortBy = companyListMode === 'analyzed' \? 'analysis_finished_desc' : sortBy/,
  );
  assert.match(
    componentSource,
    /requestStatusFilters = companyListMode === 'analyzed' \? \['success'\] : statusFilters/,
  );
  assert.match(componentSource, /params\.set\('q', debouncedSearch\)/);
});

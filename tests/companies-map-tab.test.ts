import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const componentSource = fs.readFileSync(
  path.join(process.cwd(), 'components/library/companies-map-tab.tsx'),
  'utf8',
);

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'app/api/ai-analysis/companies-map/route.ts'),
  'utf8',
);

test('companies map exposes requested filter controls and heatmap mode', () => {
  assert.match(componentSource, /Popover open=\{responsibleOpen\}/);
  assert.match(componentSource, /CommandInput placeholder="Найти ФИО"/);
  assert.match(componentSource, /Select value=\{prodclassId\}/);
  assert.match(componentSource, /Select value=\{enterpriseType\}/);
  assert.match(componentSource, /Размер бизнеса/);
  assert.match(componentSource, /Искать по основному ОКВЭД/);
  assert.match(componentSource, /Выручка в рост/);
  assert.match(componentSource, /Точки/);
  assert.match(componentSource, /Тепловая карта/);
});

test('companies map uses the redesigned commercial filter layout', () => {
  assert.match(componentSource, /function FilterField/);
  assert.match(componentSource, /function ModernCheckbox/);
  assert.match(componentSource, /function SegmentedControl/);
  assert.match(componentSource, /function StatBadge/);
  assert.match(componentSource, /rounded-2xl border border-slate-200 bg-white/);
  assert.match(componentSource, /shadow-\[0_18px_50px_rgba\(15,23,42,0\.08\)\]/);
  assert.match(componentSource, /aria-label="Режим отображения карты"/);
});

test('companies map keeps success filter in the top controls and reuses map layers on mode switch', () => {
  assert.match(componentSource, /<ModernCheckbox checked=\{successOnly\}[\s\S]*?<SegmentedControl value=\{mapMode\}/);
  assert.match(componentSource, /objectManagerAttachedRef/);
  assert.match(componentSource, /objectManagerDataKeyRef/);
  assert.match(componentSource, /heatmapDataKeyRef/);
  assert.match(componentSource, /Готовим тепловую карту/);
});

test('companies map auto-scales heatmap intensity by maximum local density', () => {
  assert.match(componentSource, /function buildAutoScaledHeatmapFeatureCollection/);
  assert.match(componentSource, /HEATMAP_LAT_CELL_DEGREES/);
  assert.match(componentSource, /HEATMAP_LON_CELL_DEGREES/);
  assert.match(componentSource, /maxCellCount/);
  assert.match(componentSource, /company_count: cell\.count/);
  assert.match(componentSource, /max_company_count: maxCellCount/);
  assert.match(componentSource, /Math\.max\(0\.03/);
  assert.match(componentSource, /Math\.pow\(normalizedDensity, 1\.8\)/);
  assert.match(componentSource, /intensityOfMidpoint: 0\.72/);
});

test('companies map balloon includes company website as external link', () => {
  assert.match(componentSource, /extractFirstSite\(company\.web_sites\)/);
  assert.match(componentSource, /siteHref\(site\)/);
  assert.match(componentSource, /target="_blank"/);
  assert.match(componentSource, /rel="noopener noreferrer"/);
});

test('companies map API supports enterprise type main OKVED and revenue growth filters', () => {
  assert.match(routeSource, /searchParams\.get\('prodclassId'\)/);
  assert.match(routeSource, /getOkvedCodesForProdclass\(prodclassId\)/);
  assert.match(routeSource, /searchParams\.get\('enterpriseType'\)/);
  assert.match(routeSource, /searchParams\.get\('mainOkvedOnly'\) !== '0'/);
  assert.match(routeSource, /searchParams\.get\('revenueGrowing'\) === '1'/);
  assert.match(routeSource, /d\.smb_category = \$\$\{args\.length\}/);
  assert.match(routeSource, /TRIM\(d\.main_okved\) = \$\$\{param\}/);
  assert.match(routeSource, /d\.revenue > d\."revenue-1"/);
  assert.match(routeSource, /d\.web_sites/);
});

test('companies map uses industry to type to okved cascade', () => {
  assert.match(componentSource, /type ProdclassItem/);
  assert.match(componentSource, /scope=okved/);
  assert.match(componentSource, /setProdclassId\('all'\)/);
  assert.match(componentSource, /params\.set\('prodclassId', prodclassId\)/);
  assert.match(componentSource, /disabled=\{industryId === 'all'/);
});

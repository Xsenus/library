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

const okvedRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'app/api/okved/route.ts'),
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
  assert.match(componentSource, /grid gap-4 md:grid-cols-2 xl:grid-cols-4/);
  assert.match(componentSource, /label="Отрасль" className="order-1"/);
  assert.match(componentSource, /label="Тип предприятия" className="order-2"/);
  assert.match(componentSource, /label="ОКВЭД" className="order-3"/);
  assert.match(componentSource, /label="Ответственный" className="order-4"/);
  assert.match(componentSource, /label="Размер бизнеса" className="order-5"/);
  assert.match(componentSource, /label="Скор" className="order-6"/);
  assert.match(componentSource, /label="Выручка, млн" className="order-7"/);
  assert.match(componentSource, /className="order-8 flex min-w-0 items-end"/);
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
  assert.match(componentSource, /HEATMAP_CLUSTER_CELL_KM = 12/);
  assert.match(componentSource, /HEATMAP_DENSITY_RADIUS_KM = 28/);
  assert.match(componentSource, /HEATMAP_REGIONAL_RADIUS_KM = 110/);
  assert.match(componentSource, /HEATMAP_GRID_CELL_DEGREES/);
  assert.match(componentSource, /buildHeatmapDensityCells/);
  assert.match(componentSource, /buildHeatmapCellIndex/);
  assert.match(componentSource, /countNearbyHeatmapCells/);
  assert.match(componentSource, /getApproxDistanceKmSq/);
  assert.match(componentSource, /maxCellCount/);
  assert.match(componentSource, /maxLocalDensity/);
  assert.match(componentSource, /maxRegionalDensity/);
  assert.match(componentSource, /company_count: cell\.count/);
  assert.match(componentSource, /local_density: densities\[index\]\.local/);
  assert.match(componentSource, /regional_density: densities\[index\]\.regional/);
  assert.match(componentSource, /max_cell_count: maxCellCount/);
  assert.match(componentSource, /max_local_density: maxLocalDensity/);
  assert.match(componentSource, /max_regional_density: maxRegionalDensity/);
  assert.match(componentSource, /HEATMAP_LOCAL_DENSITY_POWER = 3\.8/);
  assert.match(componentSource, /HEATMAP_REGIONAL_DENSITY_POWER = 1\.2/);
  assert.match(componentSource, /HEATMAP_CELL_COUNT_POWER = 0\.85/);
  assert.match(componentSource, /Math\.max\(0\.0001/);
  assert.match(componentSource, /cell\.count \/ maxCellCount/);
  assert.match(componentSource, /Math\.pow\(normalizedCellCount, HEATMAP_CELL_COUNT_POWER\)/);
  assert.match(componentSource, /Math\.pow\(normalizedLocalDensity, HEATMAP_LOCAL_DENSITY_POWER\)/);
  assert.match(componentSource, /Math\.pow\(normalizedRegionalDensity, HEATMAP_REGIONAL_DENSITY_POWER\)/);
  assert.match(componentSource, /dissipating: true/);
  assert.match(componentSource, /radius: 28/);
  assert.match(componentSource, /intensityOfMidpoint: 0\.965/);
  assert.match(componentSource, /0\.94: 'rgba\(249, 115, 22, 0\.78\)'/);
  assert.match(componentSource, /0\.985: 'rgba\(220, 38, 38, 0\.92\)'/);
  assert.match(componentSource, /1\.0: 'rgba\(127, 29, 29, 0\.98\)'/);
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
  assert.match(componentSource, /pageSize=100&scope=okved/);
  assert.match(componentSource, /setProdclassId\('all'\)/);
  assert.match(componentSource, /params\.set\('prodclassId', prodclassId\)/);
  assert.match(componentSource, /disabled=\{industryId === 'all'/);
});

test('companies map hides okved options without displayable companies', () => {
  assert.match(componentSource, /params\.set\('onlyWithCompanies', '1'\)/);
  assert.match(componentSource, /params\.set\('onlyWithGeo', '1'\)/);
  assert.match(componentSource, /params\.set\('mainOkvedOnly', mainOkvedOnly \? '1' : '0'\)/);
  assert.match(componentSource, /\[industryId, mainOkvedOnly, prodclassId\]/);
  assert.match(okvedRouteSource, /import \{ dbBitrix \} from '@\/lib\/db-bitrix'/);
  assert.match(okvedRouteSource, /filterOkvedItemsByCompanies/);
  assert.match(okvedRouteSource, /getOkvedRootsForIndustry/);
  assert.match(okvedRouteSource, /searchParams\.get\('onlyWithCompanies'\) === '1'/);
  assert.match(okvedRouteSource, /d\.geo_lat BETWEEN -90 AND 90/);
  assert.match(okvedRouteSource, /split_part\(d\.main_okved, '\.', 1\) = ANY\(\$2::text\[\]\)/);
  assert.match(okvedRouteSource, /TRIM\(d\.main_okved\) = selected\.code/);
});

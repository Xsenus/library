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
  assert.match(componentSource, /Select value=\{enterpriseType\}/);
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

test('companies map balloon includes company website as external link', () => {
  assert.match(componentSource, /extractFirstSite\(company\.web_sites\)/);
  assert.match(componentSource, /siteHref\(site\)/);
  assert.match(componentSource, /target="_blank"/);
  assert.match(componentSource, /rel="noopener noreferrer"/);
});

test('companies map API supports enterprise type main OKVED and revenue growth filters', () => {
  assert.match(routeSource, /searchParams\.get\('enterpriseType'\)/);
  assert.match(routeSource, /searchParams\.get\('mainOkvedOnly'\) !== '0'/);
  assert.match(routeSource, /searchParams\.get\('revenueGrowing'\) === '1'/);
  assert.match(routeSource, /d\.smb_category = \$\$\{args\.length\}/);
  assert.match(routeSource, /TRIM\(d\.main_okved\) = \$\$\{param\}/);
  assert.match(routeSource, /d\.revenue > d\."revenue-1"/);
  assert.match(routeSource, /d\.web_sites/);
});

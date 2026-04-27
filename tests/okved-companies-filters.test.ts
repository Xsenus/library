import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { okvedCompaniesQuerySchema } from '../lib/validators';

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'app/api/okved/companies/route.ts'),
  'utf8',
);
const componentSource = fs.readFileSync(
  path.join(process.cwd(), 'components/library/okved-tab.tsx'),
  'utf8',
);

test('okved companies query accepts responsible filter', () => {
  const parsed = okvedCompaniesQuerySchema.parse({
    page: '2',
    pageSize: '25',
    okved: '10.51',
    responsible: 'manager',
  });

  assert.equal(parsed.page, 2);
  assert.equal(parsed.pageSize, 25);
  assert.equal(parsed.okved, '10.51');
  assert.equal(parsed.responsible, 'manager');
});

test('okved companies API filters by cached Bitrix responsible', () => {
  assert.match(routeSource, /responsible:\s*searchParams\.get\('responsible'\)/);
  assert.match(routeSource, /ensureCompanyMetaTable\(\)/);
  assert.match(routeSource, /COALESCE\(assigned_name,\s*''\)\s+ILIKE\s+\$1/);
  assert.match(routeSource, /d\.inn\s*=\s*ANY\(\$\$\{i\}::text\[\]\)/);
});

test('okved companies API supports prodclass filter between industry and okved', () => {
  assert.match(routeSource, /searchParams\.get\('prodclassId'\)/);
  assert.match(routeSource, /getOkvedCodesForProdclass\(prodclassId\)/);
  assert.match(routeSource, /TRIM\(d\.main_okved\) = ANY\(\$\$\{i\}::text\[\]\)/);
});

test('okved companies UI exposes responsible filter and company sites column', () => {
  assert.match(componentSource, /data-testid="okved-companies-responsible-filter"/);
  assert.match(componentSource, /url\.searchParams\.set\('responsible',\s*responsibleFilter\.trim\(\)\)/);
  assert.match(componentSource, /\/api\/b24\/contacts\?maxAgeMinutes=\$\{CONTACTS_MAX_AGE_MINUTES\}/);
  assert.match(componentSource, /companySites\[c\.inn\]\s*\?\?/);
  assert.match(componentSource, /showSitesToggle/);
  assert.match(componentSource, /href=\{siteHref\(site\)\}/);
});

test('okved companies UI exposes three step industry type okved filter', () => {
  assert.match(componentSource, /type ProdclassItem/);
  assert.match(componentSource, /initialProdclassId/);
  assert.match(componentSource, /pageSize=100&scope=okved/);
  assert.match(componentSource, /url\.searchParams\.set\('prodclassId', prodclassId\)/);
  assert.match(componentSource, /qs\.set\('prodclassId', prodclassId\)/);
  assert.match(componentSource, /Все типы предприятий/);
});

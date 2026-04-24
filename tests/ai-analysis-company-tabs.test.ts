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

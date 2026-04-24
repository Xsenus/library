import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const routeSource = fs.readFileSync(
  path.join(process.cwd(), 'app/api/ai-analysis/run/route.ts'),
  'utf8',
);

test('AI analysis run passes library contact sites into parse-site requests', () => {
  assert.match(routeSource, /refreshCompanyContacts/);
  assert.match(routeSource, /contact_hints:\s*contactHintsPayload/);
  assert.match(routeSource, /parse_domains/);
  assert.match(routeSource, /parse_emails/);
  assert.match(routeSource, /runStep\(inn,\s*step,\s*stepTimeoutMs,\s*runtimeFlags,\s*contactHints\)/);
  assert.match(routeSource, /runFullPipeline\(inn,\s*overallTimeoutMs,\s*contactHints\)/);
});

test('AI analysis full pipeline preview includes the same contact hints as queued runs', () => {
  assert.match(routeSource, /applyContactHintsToBody\(\{\s*inn:\s*sampleInn\s*\},\s*sampleContactHints\)/);
  assert.match(routeSource, /def\.primary\.body\?\.\(sampleInn,\s*sampleStepContext\)/);
});

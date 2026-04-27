import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const componentSource = fs.readFileSync(
  path.join(process.cwd(), 'components/library/ai-company-analysis-tab.tsx'),
  'utf8',
);

const stopRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'app/api/ai-analysis/stop/route.ts'),
  'utf8',
);

const queueRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'app/api/ai-analysis/queue/route.ts'),
  'utf8',
);

test('AI analysis filter enqueue requires confirmation before POSTing the real queue request', () => {
  assert.match(componentSource, /handleRequestFilterEnqueue/);
  assert.match(componentSource, /dryRun:\s*true/);
  assert.match(componentSource, /setFilterConfirmOpen\(true\)/);
  assert.match(componentSource, /Подтвердить массовый запуск/);
  assert.match(componentSource, /handleFilterPreview\(true\)/);
});

test('AI analysis queue modal supports selected and all cancellation actions', () => {
  assert.match(componentSource, /queueSelected/);
  assert.match(componentSource, /Отменить выбранные/);
  assert.match(componentSource, /Отменить все/);
  assert.match(componentSource, /queue-cancel-selected/);
  assert.match(componentSource, /queue-cancel-all/);
  assert.match(componentSource, /all:\s*source === 'all'/);
});

test('AI analysis stop API can resolve every queued or running company for cancel all', () => {
  assert.match(stopRouteSource, /all\?:\s*unknown/);
  assert.match(stopRouteSource, /body\?\.all === true/);
  assert.match(stopRouteSource, /findAllQueuedOrRunningInns/);
  assert.match(stopRouteSource, /SELECT inn FROM ai_analysis_queue WHERE state IN \('queued', 'running'\)/);
  assert.match(stopRouteSource, /findAllRunningInns/);
});

test('AI analysis queue filter POST uses discovered dadata status columns', () => {
  assert.match(queueRouteSource, /const columns = await getDadataColumns\(\)/);
  assert.match(queueRouteSource, /buildStatusConditions\(requestedStatuses,\s*columns,\s*existingColumns\)/);
  assert.match(queueRouteSource, /columns\.startedAt \? `d\.\$\{quoteIdent\(columns\.startedAt\)\}` : 'NULL::timestamptz'/);
  assert.doesNotMatch(queueRouteSource, /d\.analysis_started_at > now\(\) - interval/);
  assert.doesNotMatch(queueRouteSource, /ORDER BY COALESCE\(q\.queued_at, d\.analysis_started_at\)/);
});

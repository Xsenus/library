import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const workflowSource = fs.readFileSync(
  path.join(process.cwd(), '.github/workflows/deploy.yml'),
  'utf8',
);

test('GitHub deploy workflow delegates to the resilient library rollout script', () => {
  assert.match(workflowSource, /appleboy\/ssh-action@v1\.2\.0/);
  assert.match(workflowSource, /git fetch origin main/);
  assert.match(workflowSource, /working tree has local changes; refusing to reset/);
  assert.match(workflowSource, /git reset --hard origin\/main/);
  assert.match(workflowSource, /bash deploy\/library-rollout\.sh/);
  assert.doesNotMatch(workflowSource, /appleboy\/scp-action/);
  assert.doesNotMatch(workflowSource, /\bnpm ci\b/);
  assert.doesNotMatch(workflowSource, /\bnpm prune\b/);
  assert.doesNotMatch(workflowSource, /systemctl restart library/);
});

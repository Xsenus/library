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
  assert.match(workflowSource, /appleboy\/scp-action@v0\.1\.7/);
  assert.match(workflowSource, /git archive --format=tar\.gz --output=library-source\.tgz HEAD/);
  assert.match(workflowSource, /tar -xzf \/tmp\/library-deploy\/library-source\.tgz/);
  assert.match(workflowSource, /LIBRARY_ROLLOUT_SKIP_GIT_PULL=1 bash deploy\/library-rollout\.sh/);
  assert.match(workflowSource, /bash deploy\/library-rollout\.sh/);
  assert.doesNotMatch(workflowSource, /git fetch origin main/);
  assert.doesNotMatch(workflowSource, /git reset --hard origin\/main/);
  assert.doesNotMatch(workflowSource, /\bnpm ci\b/);
  assert.doesNotMatch(workflowSource, /\bnpm prune\b/);
  assert.doesNotMatch(workflowSource, /systemctl restart library/);
});

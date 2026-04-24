import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isTimestampedArtifactRunDirectory,
  parseArtifactRetentionCount,
  pruneArtifactEntries,
} from '../lib/artifact-retention';

function setMtime(targetPath: string, offsetMs: number): void {
  const time = new Date(Date.now() + offsetMs);
  fs.utimesSync(targetPath, time, time);
}

test('parseArtifactRetentionCount keeps non-negative integers and falls back on invalid input', () => {
  assert.equal(parseArtifactRetentionCount(undefined, 14), 14);
  assert.equal(parseArtifactRetentionCount('9', 14), 9);
  assert.equal(parseArtifactRetentionCount('0', 14), 0);
  assert.equal(parseArtifactRetentionCount('-1', 14), 14);
  assert.equal(parseArtifactRetentionCount('abc', 14), 14);
});

test('isTimestampedArtifactRunDirectory matches sanitized ISO run directories', () => {
  assert.equal(isTimestampedArtifactRunDirectory('2026-04-23T12-00-00-000Z'), true);
  assert.equal(isTimestampedArtifactRunDirectory('latest.json'), false);
  assert.equal(isTimestampedArtifactRunDirectory('ai-analysis-ui-qa-health-2026-04-23T12-00-00-000Z.json'), false);
});

test('pruneArtifactEntries keeps newest timestamped run directories', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-retention-runs-'));
  const newestRun = path.join(rootDir, '2026-04-23T12-00-00-000Z');
  const middleRun = path.join(rootDir, '2026-04-22T12-00-00-000Z');
  const oldestRun = path.join(rootDir, '2026-04-21T12-00-00-000Z');

  for (const runDir of [oldestRun, middleRun, newestRun]) {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'summary.json'), '{}\n', 'utf8');
  }
  fs.writeFileSync(path.join(rootDir, 'latest.json'), '{}\n', 'utf8');

  setMtime(oldestRun, -3_000);
  setMtime(middleRun, -2_000);
  setMtime(newestRun, -1_000);

  const deleted = await pruneArtifactEntries({
    rootDir,
    keepLatest: 2,
    preserveNames: ['latest.json'],
    matchEntry: (entry) => entry.isDirectory && isTimestampedArtifactRunDirectory(entry.name),
  });

  assert.deepEqual(deleted, [oldestRun]);
  assert.equal(fs.existsSync(oldestRun), false);
  assert.equal(fs.existsSync(middleRun), true);
  assert.equal(fs.existsSync(newestRun), true);
  assert.equal(fs.existsSync(path.join(rootDir, 'latest.json')), true);
});

test('pruneArtifactEntries keeps newest timestamped health files only', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-retention-files-'));
  const oldestFile = path.join(rootDir, 'ai-analysis-ui-qa-health-2026-04-21T12-00-00-000Z.json');
  const middleFile = path.join(rootDir, 'ai-analysis-ui-qa-health-2026-04-22T12-00-00-000Z.json');
  const newestFile = path.join(rootDir, 'ai-analysis-ui-qa-health-2026-04-23T12-00-00-000Z.json');
  const noteFile = path.join(rootDir, 'note.txt');
  const latestFile = path.join(rootDir, 'latest.json');

  for (const filePath of [oldestFile, middleFile, newestFile, noteFile, latestFile]) {
    fs.writeFileSync(filePath, '{}\n', 'utf8');
  }

  setMtime(oldestFile, -3_000);
  setMtime(middleFile, -2_000);
  setMtime(newestFile, -1_000);

  const deleted = await pruneArtifactEntries({
    rootDir,
    keepLatest: 1,
    preserveNames: ['latest.json'],
    matchEntry: (entry) =>
      !entry.isDirectory &&
      /^ai-analysis-ui-qa-health-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/i.test(entry.name),
  });

  assert.deepEqual(deleted.sort(), [middleFile, oldestFile].sort());
  assert.equal(fs.existsSync(oldestFile), false);
  assert.equal(fs.existsSync(middleFile), false);
  assert.equal(fs.existsSync(newestFile), true);
  assert.equal(fs.existsSync(noteFile), true);
  assert.equal(fs.existsSync(latestFile), true);
});

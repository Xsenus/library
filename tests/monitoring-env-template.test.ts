import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT_DIR = path.resolve(__dirname, '..');
const MONITORING_SOURCE_FILES = [
  'scripts/library-system-healthcheck.ts',
  'scripts/ai-analysis-acceptance-healthcheck.ts',
  'scripts/ai-analysis-ui-smoke-healthcheck.ts',
  'scripts/ai-analysis-ui-qa-healthcheck.ts',
] as const;
const MONITORING_PREFIXES = [
  'LIBRARY_SYSTEM_HEALTH_',
  'AI_ANALYSIS_ACCEPTANCE_',
  'AI_ANALYSIS_ACCEPTANCE_HEALTH_',
  'AI_ANALYSIS_UI_SMOKE_',
  'AI_ANALYSIS_UI_SMOKE_HEALTH_',
  'AI_ANALYSIS_UI_QA_',
  'AI_ANALYSIS_UI_QA_HEALTH_',
] as const;

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function parseEnvKeys(relativePath: string): Set<string> {
  const pattern = /^\s*#?\s*([A-Z0-9_]+)\s*=/gm;
  const keys = new Set<string>();
  for (const match of readText(relativePath).matchAll(pattern)) {
    keys.add(match[1]);
  }
  return keys;
}

function extractMonitoringEnvKeys(): Set<string> {
  const keys = new Set<string>();
  const patterns = [/process\.env\.([A-Z0-9_]+)/g, /envBool\('([A-Z0-9_]+)'/g];

  for (const relativePath of MONITORING_SOURCE_FILES) {
    const content = readText(relativePath);

    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        const key = match[1];
        if (MONITORING_PREFIXES.some((prefix) => key.startsWith(prefix))) {
          keys.add(key);
        }
      }
    }
  }

  return keys;
}

test('library monitoring env template covers health and browser monitoring variables', () => {
  const expected = extractMonitoringEnvKeys();
  const actual = parseEnvKeys('deploy/systemd/library-monitoring.env.example');

  for (const key of expected) {
    assert.equal(actual.has(key), true, `missing ${key} in library monitoring env template`);
  }
});

test('library monitoring keys are documented in .env.example', () => {
  const expected = extractMonitoringEnvKeys();
  const actual = parseEnvKeys('.env.example');

  for (const key of expected) {
    assert.equal(actual.has(key), true, `missing ${key} in library .env.example`);
  }
});

test('library monitoring services use the shared environment file path', () => {
  const expected = 'EnvironmentFile=-/etc/default/library-monitoring';
  const serviceFiles = [
    'deploy/systemd/library-system-healthcheck.service',
    'deploy/systemd/ai-analysis-acceptance-healthcheck.service',
    'deploy/systemd/ai-analysis-ui-smoke-healthcheck.service',
    'deploy/systemd/ai-analysis-ui-qa-healthcheck.service',
  ];

  for (const relativePath of serviceFiles) {
    assert.match(readText(relativePath), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('library systemd installer tracks monitoring env template and bootstrap targets', () => {
  const installer = readText('deploy/install-library-systemd-units.sh');

  assert.match(installer, /library-monitoring\.env\.example/);
  assert.match(installer, /\/etc\/default\/library-monitoring\.example/);
  assert.match(installer, /\/etc\/default\/library-monitoring/);
  assert.match(installer, /LIBRARY_SYSTEMD_BOOTSTRAP_ENV_FILE/);
});

test('library systemd installer keeps authenticated browser QA timer optional', () => {
  const installer = readText('deploy/install-library-systemd-units.sh');

  assert.match(installer, /ai-analysis-ui-smoke-healthcheck\.timer/);
  assert.match(installer, /Playwright Chromium/);
  assert.match(installer, /ai-analysis-ui-qa-healthcheck\.timer/);
  assert.match(installer, /AI_ANALYSIS_UI_QA_LOGIN/);
  assert.match(installer, /AI_ANALYSIS_UI_SMOKE_LOGIN/);
  assert.match(installer, /skipping automatic enable for .*UI QA credentials/i);
});

test('library rollout loads shared monitoring env and skips QA timer without credentials', () => {
  const rollout = readText('deploy/library-rollout.sh');

  assert.match(rollout, /LIBRARY_ROLLOUT_MONITORING_ENV_FILE/);
  assert.match(rollout, /\/etc\/default\/library-monitoring/);
  assert.match(rollout, /source "\$MONITORING_ENV_FILE"/);
  assert.match(rollout, /ai-analysis-ui-smoke-healthcheck\.timer/);
  assert.match(rollout, /chromium\.launch/);
  assert.match(rollout, /skipping optional systemd unit until Playwright Chromium is available/);
  assert.match(rollout, /ai-analysis-ui-qa-healthcheck\.timer/);
  assert.match(rollout, /skipping optional systemd unit until worker credentials are configured/);
  assert.match(rollout, /node_modules validation failed after npm ci/);
  assert.match(rollout, /rm -rf node_modules failed, retrying with Python shutil\.rmtree/);
  assert.match(rollout, /remove_node_modules_tree/);
  assert.match(rollout, /LIBRARY_ROLLOUT_UI_QA_ATTEMPTS/);
  assert.match(rollout, /browser UI QA failed on attempt/);
});

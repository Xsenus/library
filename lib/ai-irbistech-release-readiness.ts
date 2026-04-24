import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  resolvePlaywrightChromiumStatus,
  type AiIrbistechAcceptanceSuitePrerequisiteStatus,
} from './ai-irbistech-acceptance-suite';

export type AiIrbistechReleaseReadinessCheckStatus = 'pass' | 'warn' | 'fail' | 'missing';
export type AiIrbistechReleaseReadinessOverallStatus = 'ready' | 'ready_with_warnings' | 'not_ready' | 'incomplete';
export type AiIrbistechReleaseReadinessCategory = 'backend' | 'frontend' | 'service_chain' | 'ops';

export type AiIrbistechReleaseReadinessCheckId =
  | 'aiIntegrationEnvFile'
  | 'libraryEnvFile'
  | 'aiSiteAnalyzerEnvFile'
  | 'libraryPlaywrightChromium'
  | 'aiIntegrationWebhooks'
  | 'libraryWebhooks'
  | 'aiSiteAnalyzerWebhooks'
  | 'libraryUiQaCredentials'
  | 'aiSiteAnalyzerBillingKey'
  | 'aiIntegrationTimers'
  | 'libraryTimers'
  | 'aiSiteAnalyzerTimers'
  | 'aiIntegrationArtifacts'
  | 'libraryArtifacts'
  | 'aiSiteAnalyzerArtifacts';

export type AiIrbistechReleaseReadinessCheck = {
  id: AiIrbistechReleaseReadinessCheckId;
  title: string;
  category: AiIrbistechReleaseReadinessCategory;
  status: AiIrbistechReleaseReadinessCheckStatus;
  summary: string;
  details: string[];
};

export type AiIrbistechReleaseReadinessSnapshot = {
  generatedAt: string;
  overallStatus: AiIrbistechReleaseReadinessOverallStatus;
  releaseReady: boolean;
  counts: Record<AiIrbistechReleaseReadinessCheckStatus, number>;
  checks: AiIrbistechReleaseReadinessCheck[];
  passedCheckIds: string[];
  warningCheckIds: string[];
  failedCheckIds: string[];
  missingCheckIds: string[];
};

export type AiIrbistechReleaseReadinessCommand = {
  executable: string;
  args: string[];
  cwd: string;
};

export type AiIrbistechReleaseReadinessCommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
};

export type AiIrbistechReleaseReadinessOptions = {
  cwd?: string;
  generatedAt?: string;
  aiIntegrationEnvFile?: string;
  libraryEnvFile?: string;
  aiSiteAnalyzerEnvFile?: string;
  libraryUiSmokeRequired?: boolean;
  libraryUiQaRequired?: boolean;
  useSystemctl?: boolean;
  systemctlExecutable?: string;
  commandRunner?: (
    command: AiIrbistechReleaseReadinessCommand,
  ) => Promise<AiIrbistechReleaseReadinessCommandResult>;
  playwrightChromiumStatus?: AiIrbistechAcceptanceSuitePrerequisiteStatus;
};

export type AiIrbistechReleaseReadinessEnvFileInfo = {
  path: string;
  exists: boolean;
  values: Record<string, string>;
  error: string | null;
};

type TimerExpectation = {
  unit: string;
  required: boolean;
};

type TimerProbe = {
  unit: string;
  required: boolean;
  enabled: boolean | null;
  active: boolean | null;
  unavailableReason: string | null;
  detail: string | null;
};

type ArtifactExpectation = {
  label: string;
  required: boolean;
  latestPath: string;
  maxAgeMs?: number | null;
};

type ArtifactProbe = {
  label: string;
  required: boolean;
  latestPath: string;
  exists: boolean;
  checkedAt: string | null;
  ok: boolean | null;
  reason: string | null;
  detail: string | null;
  ageMs: number | null;
  maxAgeMs: number | null;
  stale: boolean;
};

const DEFAULT_AI_INTEGRATION_ENV_FILE = '/etc/default/ai-integration-monitoring';
const DEFAULT_LIBRARY_ENV_FILE = '/etc/default/library-monitoring';
const DEFAULT_AI_SITE_ANALYZER_ENV_FILE = '/etc/default/ai-site-analyzer-monitoring';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePath(value: string): string {
  return path.resolve(value).replace(/\\/g, '/');
}

function parseEnvFileText(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const match = normalized.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/u);
    if (!match) {
      continue;
    }
    let value = match[2] ?? '';
    value = value.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]!] = value;
  }

  return values;
}

export function loadAiIrbistechReleaseReadinessEnvFile(filePath: string): AiIrbistechReleaseReadinessEnvFileInfo {
  const resolvedPath = normalizePath(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return {
      path: resolvedPath,
      exists: false,
      values: {},
      error: null,
    };
  }

  try {
    return {
      path: resolvedPath,
      exists: true,
      values: parseEnvFileText(fs.readFileSync(resolvedPath, 'utf8')),
      error: null,
    };
  } catch (error) {
    return {
      path: resolvedPath,
      exists: true,
      values: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resolveAiIrbistechReleaseReadinessEnvValue(
  info: AiIrbistechReleaseReadinessEnvFileInfo,
  key: string,
): string | null {
  const value = info.values[key];
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function envValue(info: AiIrbistechReleaseReadinessEnvFileInfo, key: string): string | null {
  return resolveAiIrbistechReleaseReadinessEnvValue(info, key);
}

function hasEnvValue(info: AiIrbistechReleaseReadinessEnvFileInfo, key: string): boolean {
  return resolveAiIrbistechReleaseReadinessEnvValue(info, key) !== null;
}

function redactUrl(value: string | null): string {
  if (!value) {
    return 'missing';
  }
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}/...`;
  } catch {
    return 'configured';
  }
}

async function runCommand(
  command: AiIrbistechReleaseReadinessCommand,
): Promise<AiIrbistechReleaseReadinessCommandResult> {
  return await new Promise<AiIrbistechReleaseReadinessCommandResult>((resolve) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: process.env,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        exitCode: null,
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        exitCode,
        stdout,
        stderr,
        error: null,
      });
    });
  });
}

function resolveArtifactLatestPath(value: string): string {
  const normalized = value.trim();
  const absolute = path.isAbsolute(normalized) ? normalized : path.resolve(normalized);
  try {
    if (fs.statSync(absolute).isFile()) {
      return normalizePath(absolute);
    }
  } catch {
    // Fall through to the conventional latest.json path for directories or not-yet-created paths.
  }
  if (absolute.toLowerCase().endsWith('.json')) {
    return normalizePath(absolute);
  }
  return normalizePath(path.join(absolute, 'latest.json'));
}

function formatAgeMs(value: number): string {
  if (value < MINUTE_MS) {
    return `${Math.round(value / 1000)}s`;
  }
  if (value < HOUR_MS) {
    return `${Math.round(value / MINUTE_MS)}m`;
  }
  return `${(value / HOUR_MS).toFixed(value >= 10 * HOUR_MS ? 0 : 1)}h`;
}

function readArtifactProbe(expectation: ArtifactExpectation, referenceTimeMs: number): ArtifactProbe {
  if (!fs.existsSync(expectation.latestPath)) {
    return {
      label: expectation.label,
      required: expectation.required,
      latestPath: expectation.latestPath,
      exists: false,
      checkedAt: null,
      ok: null,
      reason: null,
      detail: 'latest.json is missing',
      ageMs: null,
      maxAgeMs: expectation.maxAgeMs ?? null,
      stale: false,
    };
  }

  try {
    const payload = JSON.parse(fs.readFileSync(expectation.latestPath, 'utf8')) as Record<string, unknown>;
    const checkedAtRaw = payload.checked_at ?? payload.checkedAt ?? null;
    const reasonRaw = payload.reason ?? payload.severity ?? null;
    const checkedAt =
      typeof checkedAtRaw === 'string' && checkedAtRaw.trim() ? checkedAtRaw.trim() : null;
    const checkedAtMs = checkedAt ? Date.parse(checkedAt) : Number.NaN;
    const ageMs =
      checkedAt && Number.isFinite(checkedAtMs)
        ? Math.max(0, referenceTimeMs - checkedAtMs)
        : null;
    const maxAgeMs = expectation.maxAgeMs ?? null;
    const stale = maxAgeMs !== null && ageMs !== null && ageMs > maxAgeMs;
    const detail =
      checkedAt && ageMs === null
        ? `checked_at is invalid: ${checkedAt}`
        : stale
          ? `artifact is stale: age=${formatAgeMs(ageMs)}, max_age=${formatAgeMs(maxAgeMs)}`
          : null;
    return {
      label: expectation.label,
      required: expectation.required,
      latestPath: expectation.latestPath,
      exists: true,
      checkedAt,
      ok: typeof payload.ok === 'boolean' ? payload.ok : null,
      reason: typeof reasonRaw === 'string' && reasonRaw.trim() ? reasonRaw.trim() : null,
      detail,
      ageMs,
      maxAgeMs,
      stale,
    };
  } catch (error) {
    return {
      label: expectation.label,
      required: expectation.required,
      latestPath: expectation.latestPath,
      exists: true,
      checkedAt: null,
      ok: null,
      reason: null,
      detail: error instanceof Error ? error.message : String(error),
      ageMs: null,
      maxAgeMs: expectation.maxAgeMs ?? null,
      stale: false,
    };
  }
}

function buildEnvFileCheck(
  id: AiIrbistechReleaseReadinessCheckId,
  title: string,
  category: AiIrbistechReleaseReadinessCategory,
  envFile: AiIrbistechReleaseReadinessEnvFileInfo,
): AiIrbistechReleaseReadinessCheck {
  if (!envFile.exists) {
    return {
      id,
      title,
      category,
      status: 'fail',
      summary: 'monitoring env file is missing',
      details: [`Expected env file: ${envFile.path}`],
    };
  }
  if (envFile.error) {
    return {
      id,
      title,
      category,
      status: 'fail',
      summary: `env file could not be parsed: ${envFile.error}`,
      details: [`Env file: ${envFile.path}`],
    };
  }
  return {
    id,
    title,
    category,
    status: 'pass',
    summary: 'monitoring env file is present',
    details: [`Env file: ${envFile.path}`],
  };
}

function buildWebhookCheck(
  id: AiIrbistechReleaseReadinessCheckId,
  title: string,
  category: AiIrbistechReleaseReadinessCategory,
  envFile: AiIrbistechReleaseReadinessEnvFileInfo,
  items: Array<{ key: string; label: string }>,
): AiIrbistechReleaseReadinessCheck {
  if (!envFile.exists) {
    return {
      id,
      title,
      category,
      status: 'missing',
      summary: 'monitoring env file is missing, webhook configuration cannot be inspected',
      details: [`Env file: ${envFile.path}`],
    };
  }

  const configured = items.filter((item) => hasEnvValue(envFile, item.key));
  const status: AiIrbistechReleaseReadinessCheckStatus =
    configured.length === items.length ? 'pass' : 'warn';

  return {
    id,
    title,
    category,
    status,
    summary: `configured=${configured.length}/${items.length}`,
    details: items.map((item) => `${item.label}: ${redactUrl(envValue(envFile, item.key))}`),
  };
}

function resolveUiQaCredentialsConfigured(
  envFile: AiIrbistechReleaseReadinessEnvFileInfo,
): boolean {
  const directLogin = envValue(envFile, 'AI_ANALYSIS_UI_QA_LOGIN');
  const directPassword = envValue(envFile, 'AI_ANALYSIS_UI_QA_PASSWORD');
  if (directLogin && directPassword) {
    return true;
  }
  const fallbackLogin = envValue(envFile, 'AI_ANALYSIS_UI_SMOKE_LOGIN');
  const fallbackPassword = envValue(envFile, 'AI_ANALYSIS_UI_SMOKE_PASSWORD');
  return Boolean(fallbackLogin && fallbackPassword);
}

function buildUiQaCredentialsCheck(
  envFile: AiIrbistechReleaseReadinessEnvFileInfo,
): AiIrbistechReleaseReadinessCheck {
  if (!envFile.exists) {
    return {
      id: 'libraryUiQaCredentials',
      title: 'library: UI QA credentials',
      category: 'frontend',
      status: 'missing',
      summary: 'monitoring env file is missing, UI QA credentials cannot be inspected',
      details: [`Env file: ${envFile.path}`],
    };
  }

  const directConfigured = Boolean(
    envValue(envFile, 'AI_ANALYSIS_UI_QA_LOGIN') && envValue(envFile, 'AI_ANALYSIS_UI_QA_PASSWORD'),
  );
  const fallbackConfigured = Boolean(
    envValue(envFile, 'AI_ANALYSIS_UI_SMOKE_LOGIN') &&
      envValue(envFile, 'AI_ANALYSIS_UI_SMOKE_PASSWORD'),
  );

  return {
    id: 'libraryUiQaCredentials',
    title: 'library: UI QA credentials',
    category: 'frontend',
    status: directConfigured || fallbackConfigured ? 'pass' : 'warn',
    summary: directConfigured
      ? 'dedicated UI QA credentials are configured'
      : fallbackConfigured
        ? 'fallback smoke credentials are configured'
        : 'UI QA credentials are not configured',
    details: [
      `AI_ANALYSIS_UI_QA_LOGIN/PASSWORD: ${directConfigured ? 'configured' : 'missing'}`,
      `AI_ANALYSIS_UI_SMOKE_LOGIN/PASSWORD fallback: ${fallbackConfigured ? 'configured' : 'missing'}`,
    ],
  };
}

function buildBillingKeyCheck(
  envFile: AiIrbistechReleaseReadinessEnvFileInfo,
): AiIrbistechReleaseReadinessCheck {
  if (!envFile.exists) {
    return {
      id: 'aiSiteAnalyzerBillingKey',
      title: 'ai-site-analyzer: billing admin key',
      category: 'service_chain',
      status: 'missing',
      summary: 'monitoring env file is missing, billing key cannot be inspected',
      details: [`Env file: ${envFile.path}`],
    };
  }

  const configured = hasEnvValue(envFile, 'OPENAI_ADMIN_KEY');
  return {
    id: 'aiSiteAnalyzerBillingKey',
    title: 'ai-site-analyzer: billing admin key',
    category: 'service_chain',
    status: configured ? 'pass' : 'warn',
    summary: configured
      ? 'OPENAI_ADMIN_KEY is configured'
      : 'OPENAI_ADMIN_KEY is missing, billing may remain degraded',
    details: [
      `OPENAI_ADMIN_KEY: ${configured ? 'configured' : 'missing'}`,
    ],
  };
}

function buildPlaywrightCheck(
  status: AiIrbistechAcceptanceSuitePrerequisiteStatus,
): AiIrbistechReleaseReadinessCheck {
  return {
    id: 'libraryPlaywrightChromium',
    title: 'library: Playwright Chromium runtime',
    category: 'frontend',
    status: status.ok ? 'pass' : 'warn',
    summary: status.ok ? 'Playwright Chromium is available' : 'Playwright Chromium is unavailable',
    details: [status.reason ?? (status.ok ? 'Chromium launch probe succeeded.' : 'Chromium launch probe failed.')],
  };
}

async function probeTimer(
  unit: string,
  required: boolean,
  options: {
    cwd: string;
    systemctlExecutable: string;
    commandRunner: (
      command: AiIrbistechReleaseReadinessCommand,
    ) => Promise<AiIrbistechReleaseReadinessCommandResult>;
  },
): Promise<TimerProbe> {
  const enabledResult = await options.commandRunner({
    executable: options.systemctlExecutable,
    args: ['is-enabled', unit],
    cwd: options.cwd,
  });
  const activeResult = await options.commandRunner({
    executable: options.systemctlExecutable,
    args: ['is-active', unit],
    cwd: options.cwd,
  });

  const unavailableReason =
    enabledResult.error ??
    activeResult.error ??
    null;
  if (unavailableReason) {
    return {
      unit,
      required,
      enabled: null,
      active: null,
      unavailableReason,
      detail: null,
    };
  }

  const enabledText = `${enabledResult.stdout}\n${enabledResult.stderr}`.trim().toLowerCase();
  const activeText = `${activeResult.stdout}\n${activeResult.stderr}`.trim().toLowerCase();
  const enabled = enabledResult.exitCode === 0 && enabledText.includes('enabled');
  const active = activeResult.exitCode === 0 && activeText.includes('active');

  return {
    unit,
    required,
    enabled,
    active,
    unavailableReason: null,
    detail: [
      `enabled=${enabled ? 'yes' : 'no'}`,
      `active=${active ? 'yes' : 'no'}`,
      enabledText ? `enabled_output=${enabledText}` : null,
      activeText ? `active_output=${activeText}` : null,
    ]
      .filter((item): item is string => Boolean(item))
      .join(', '),
  };
}

async function buildTimerCheck(
  id: AiIrbistechReleaseReadinessCheckId,
  title: string,
  category: AiIrbistechReleaseReadinessCategory,
  expectations: TimerExpectation[],
  options: {
    cwd: string;
    useSystemctl: boolean;
    systemctlExecutable: string;
    commandRunner: (
      command: AiIrbistechReleaseReadinessCommand,
    ) => Promise<AiIrbistechReleaseReadinessCommandResult>;
  },
): Promise<AiIrbistechReleaseReadinessCheck> {
  if (!options.useSystemctl) {
    return {
      id,
      title,
      category,
      status: 'warn',
      summary: 'systemctl verification is disabled',
      details: expectations.map((expectation) => `${expectation.unit}: required=${expectation.required ? 'yes' : 'no'}`),
    };
  }

  const probes = await Promise.all(
    expectations.map((expectation) =>
      probeTimer(expectation.unit, expectation.required, options),
    ),
  );

  const unavailable = probes.find((probe) => probe.unavailableReason);
  if (unavailable) {
    return {
      id,
      title,
      category,
      status: 'warn',
      summary: `systemctl is unavailable: ${unavailable.unavailableReason}`,
      details: probes.map((probe) => `${probe.unit}: ${probe.unavailableReason ?? probe.detail ?? 'n/a'}`),
    };
  }

  const requiredFailed = probes.filter((probe) => probe.required && (!probe.enabled || !probe.active));
  const optionalFailed = probes.filter((probe) => !probe.required && (!probe.enabled || !probe.active));

  return {
    id,
    title,
    category,
    status: requiredFailed.length > 0 ? 'fail' : optionalFailed.length > 0 ? 'warn' : 'pass',
    summary: `required_failed=${requiredFailed.length}, optional_failed=${optionalFailed.length}`,
    details: probes.map(
      (probe) =>
        `${probe.unit}: required=${probe.required ? 'yes' : 'no'}, ${probe.detail ?? 'n/a'}`,
    ),
  };
}

function buildArtifactCheck(
  id: AiIrbistechReleaseReadinessCheckId,
  title: string,
  category: AiIrbistechReleaseReadinessCategory,
  expectations: ArtifactExpectation[],
  referenceTimeMs: number,
): AiIrbistechReleaseReadinessCheck {
  const probes = expectations.map((expectation) => readArtifactProbe(expectation, referenceTimeMs));
  const requiredMissing = probes.filter((probe) => probe.required && !probe.exists);
  const optionalMissing = probes.filter((probe) => !probe.required && !probe.exists);
  const requiredUnhealthy = probes.filter((probe) => probe.required && probe.exists && probe.ok === false);
  const optionalUnhealthy = probes.filter((probe) => !probe.required && probe.exists && probe.ok === false);
  const requiredIndeterminate = probes.filter((probe) => probe.required && probe.exists && probe.ok === null);
  const optionalIndeterminate = probes.filter((probe) => !probe.required && probe.exists && probe.ok === null);
  const requiredStale = probes.filter((probe) => probe.required && probe.exists && probe.stale);
  const optionalStale = probes.filter((probe) => !probe.required && probe.exists && probe.stale);

  let status: AiIrbistechReleaseReadinessCheckStatus;
  if (requiredUnhealthy.length > 0) {
    status = 'fail';
  } else if (requiredMissing.length > 0 || requiredIndeterminate.length > 0 || requiredStale.length > 0) {
    status = 'missing';
  } else if (
    optionalMissing.length > 0 ||
    optionalUnhealthy.length > 0 ||
    optionalIndeterminate.length > 0 ||
    optionalStale.length > 0
  ) {
    status = 'warn';
  } else {
    status = 'pass';
  }

  return {
    id,
    title,
    category,
    status,
    summary: [
      `required_missing=${requiredMissing.length}`,
      `required_unhealthy=${requiredUnhealthy.length}`,
      `required_indeterminate=${requiredIndeterminate.length}`,
      `required_stale=${requiredStale.length}`,
      `optional_missing=${optionalMissing.length}`,
      `optional_unhealthy=${optionalUnhealthy.length}`,
      `optional_indeterminate=${optionalIndeterminate.length}`,
      `optional_stale=${optionalStale.length}`,
    ].join(', '),
    details: probes.map((probe) => {
      const state = probe.exists ? 'present' : 'missing';
      const okState =
        probe.ok === null ? 'n/a' : probe.ok ? 'ok' : 'not_ok';
      return [
        `${probe.label}: required=${probe.required ? 'yes' : 'no'}`,
        `state=${state}`,
        `ok=${okState}`,
        `checked_at=${probe.checkedAt ?? 'n/a'}`,
        `age=${probe.ageMs === null ? 'n/a' : formatAgeMs(probe.ageMs)}`,
        `max_age=${probe.maxAgeMs === null ? 'n/a' : formatAgeMs(probe.maxAgeMs)}`,
        `reason=${probe.reason ?? probe.detail ?? 'n/a'}`,
        `path=${probe.latestPath}`,
      ].join(', ');
    }),
  };
}

export function resolveAiIrbistechReleaseReadinessExitCode(
  snapshot: AiIrbistechReleaseReadinessSnapshot,
  {
    requireReady = false,
    requireClean = false,
  }: {
    requireReady?: boolean;
    requireClean?: boolean;
  } = {},
): number {
  if (requireClean && snapshot.overallStatus !== 'ready') {
    return 1;
  }
  if (requireReady && !snapshot.releaseReady) {
    return 1;
  }
  return 0;
}

export async function buildAiIrbistechReleaseReadinessSnapshot(
  options: AiIrbistechReleaseReadinessOptions = {},
): Promise<AiIrbistechReleaseReadinessSnapshot> {
  const cwd = options.cwd ?? process.cwd();
  const generatedAt = options.generatedAt ?? nowIso();
  const referenceTimeMs = Date.parse(generatedAt);
  const commandRunner = options.commandRunner ?? runCommand;
  const useSystemctl = options.useSystemctl ?? true;
  const systemctlExecutable = options.systemctlExecutable ?? 'systemctl';
  const aiIntegrationEnv = loadAiIrbistechReleaseReadinessEnvFile(
    options.aiIntegrationEnvFile ?? DEFAULT_AI_INTEGRATION_ENV_FILE,
  );
  const libraryEnv = loadAiIrbistechReleaseReadinessEnvFile(
    options.libraryEnvFile ?? DEFAULT_LIBRARY_ENV_FILE,
  );
  const aiSiteAnalyzerEnv = loadAiIrbistechReleaseReadinessEnvFile(
    options.aiSiteAnalyzerEnvFile ?? DEFAULT_AI_SITE_ANALYZER_ENV_FILE,
  );
  const playwrightStatus = options.playwrightChromiumStatus ?? (await resolvePlaywrightChromiumStatus());
  const uiQaConfigured = resolveUiQaCredentialsConfigured(libraryEnv);
  const libraryUiSmokeRequired = options.libraryUiSmokeRequired ?? playwrightStatus.ok;
  const libraryUiQaRequired = options.libraryUiQaRequired ?? (playwrightStatus.ok && uiQaConfigured);

  const checks: AiIrbistechReleaseReadinessCheck[] = [
    buildEnvFileCheck('aiIntegrationEnvFile', 'ai-integration: monitoring env file', 'backend', aiIntegrationEnv),
    buildEnvFileCheck('libraryEnvFile', 'library: monitoring env file', 'frontend', libraryEnv),
    buildEnvFileCheck('aiSiteAnalyzerEnvFile', 'ai-site-analyzer: monitoring env file', 'service_chain', aiSiteAnalyzerEnv),
    buildPlaywrightCheck(playwrightStatus),
    buildWebhookCheck('aiIntegrationWebhooks', 'ai-integration: webhook destinations', 'backend', aiIntegrationEnv, [
      { key: 'ANALYSIS_SCORE_SYNC_ALERT_WEBHOOK_URL', label: 'analysis_score sync' },
      { key: 'ANALYSIS_SCORE_SQL_READINESS_ALERT_WEBHOOK_URL', label: 'analysis_score SQL readiness' },
      { key: 'EQUIPMENT_SCORE_ACCEPTANCE_ALERT_WEBHOOK_URL', label: 'equipment acceptance' },
    ]),
    buildWebhookCheck('libraryWebhooks', 'library: webhook destinations', 'frontend', libraryEnv, [
      { key: 'LIBRARY_SYSTEM_HEALTH_ALERT_WEBHOOK_URL', label: '/api/health' },
      { key: 'AI_ANALYSIS_ACCEPTANCE_HEALTH_ALERT_WEBHOOK_URL', label: 'acceptance healthcheck' },
      { key: 'AI_ANALYSIS_UI_SMOKE_HEALTH_ALERT_WEBHOOK_URL', label: 'UI smoke healthcheck' },
      { key: 'AI_ANALYSIS_UI_QA_HEALTH_ALERT_WEBHOOK_URL', label: 'UI QA healthcheck' },
    ]),
    buildWebhookCheck('aiSiteAnalyzerWebhooks', 'ai-site-analyzer: webhook destinations', 'service_chain', aiSiteAnalyzerEnv, [
      { key: 'AI_SITE_ANALYZER_HEALTHCHECK_ALERT_WEBHOOK_URL', label: 'system healthcheck' },
    ]),
    buildUiQaCredentialsCheck(libraryEnv),
    buildBillingKeyCheck(aiSiteAnalyzerEnv),
    await buildTimerCheck('aiIntegrationTimers', 'ai-integration: systemd timers', 'ops', [
      { unit: 'analysis-score-sync-healthcheck.timer', required: true },
      { unit: 'analysis-score-sql-readiness-check.timer', required: true },
      { unit: 'equipment-score-acceptance-check.timer', required: true },
    ], {
      cwd,
      useSystemctl,
      systemctlExecutable,
      commandRunner,
    }),
    await buildTimerCheck('libraryTimers', 'library: systemd timers', 'ops', [
      { unit: 'library-system-healthcheck.timer', required: true },
      { unit: 'ai-analysis-acceptance-healthcheck.timer', required: true },
      { unit: 'ai-analysis-ui-smoke-healthcheck.timer', required: libraryUiSmokeRequired },
      { unit: 'ai-analysis-ui-qa-healthcheck.timer', required: libraryUiQaRequired },
    ], {
      cwd,
      useSystemctl,
      systemctlExecutable,
      commandRunner,
    }),
    await buildTimerCheck('aiSiteAnalyzerTimers', 'ai-site-analyzer: systemd timers', 'ops', [
      { unit: 'ai-site-analyzer-healthcheck.timer', required: true },
    ], {
      cwd,
      useSystemctl,
      systemctlExecutable,
      commandRunner,
    }),
    buildArtifactCheck('aiIntegrationArtifacts', 'ai-integration: monitoring artifacts', 'backend', [
      {
        label: 'analysis_score sync',
        required: true,
        latestPath: resolveArtifactLatestPath(envValue(aiIntegrationEnv, 'ANALYSIS_SCORE_SYNC_ARTIFACT_PATH') ?? '/var/lib/ai-integration/analysis-score-sync-health'),
        maxAgeMs: 20 * MINUTE_MS,
      },
      {
        label: 'analysis_score SQL readiness',
        required: true,
        latestPath: resolveArtifactLatestPath(envValue(aiIntegrationEnv, 'ANALYSIS_SCORE_SQL_READINESS_ARTIFACT_PATH') ?? '/var/lib/ai-integration/analysis-score-sql-readiness'),
        maxAgeMs: 2 * HOUR_MS,
      },
      {
        label: 'equipment acceptance',
        required: true,
        latestPath: resolveArtifactLatestPath(envValue(aiIntegrationEnv, 'EQUIPMENT_SCORE_ACCEPTANCE_ARTIFACT_PATH') ?? '/var/lib/ai-integration/equipment-score-acceptance'),
        maxAgeMs: 2 * HOUR_MS,
      },
    ], referenceTimeMs),
    buildArtifactCheck('libraryArtifacts', 'library: monitoring artifacts', 'frontend', [
      {
        label: '/api/health',
        required: true,
        latestPath: resolveArtifactLatestPath(envValue(libraryEnv, 'LIBRARY_SYSTEM_HEALTH_ARTIFACT_DIR') ?? '/var/lib/library/library-system-health'),
        maxAgeMs: 20 * MINUTE_MS,
      },
      {
        label: 'acceptance healthcheck',
        required: true,
        latestPath: resolveArtifactLatestPath(envValue(libraryEnv, 'AI_ANALYSIS_ACCEPTANCE_HEALTH_ARTIFACT_DIR') ?? '/var/lib/library/ai-analysis-acceptance-health'),
        maxAgeMs: 2 * HOUR_MS,
      },
      {
        label: 'UI smoke healthcheck',
        required: libraryUiSmokeRequired,
        latestPath: resolveArtifactLatestPath(envValue(libraryEnv, 'AI_ANALYSIS_UI_SMOKE_HEALTH_ARTIFACT_DIR') ?? '/var/lib/library/ai-analysis-ui-smoke-health'),
        maxAgeMs: 3 * HOUR_MS,
      },
      {
        label: 'UI QA healthcheck',
        required: libraryUiQaRequired,
        latestPath: resolveArtifactLatestPath(envValue(libraryEnv, 'AI_ANALYSIS_UI_QA_HEALTH_ARTIFACT_DIR') ?? '/var/lib/library/ai-analysis-ui-qa-health'),
        maxAgeMs: 24 * HOUR_MS,
      },
    ], referenceTimeMs),
    buildArtifactCheck('aiSiteAnalyzerArtifacts', 'ai-site-analyzer: monitoring artifacts', 'service_chain', [
      {
        label: 'system healthcheck',
        required: true,
        latestPath: resolveArtifactLatestPath(envValue(aiSiteAnalyzerEnv, 'AI_SITE_ANALYZER_HEALTHCHECK_ARTIFACT_DIR') ?? '/var/lib/ai-site-analyzer/system-health'),
        maxAgeMs: 20 * MINUTE_MS,
      },
    ], referenceTimeMs),
  ];

  const counts: Record<AiIrbistechReleaseReadinessCheckStatus, number> = {
    pass: 0,
    warn: 0,
    fail: 0,
    missing: 0,
  };
  for (const check of checks) {
    counts[check.status] += 1;
  }

  const passedCheckIds = checks.filter((check) => check.status === 'pass').map((check) => check.id);
  const warningCheckIds = checks.filter((check) => check.status === 'warn').map((check) => check.id);
  const failedCheckIds = checks.filter((check) => check.status === 'fail').map((check) => check.id);
  const missingCheckIds = checks.filter((check) => check.status === 'missing').map((check) => check.id);

  let overallStatus: AiIrbistechReleaseReadinessOverallStatus;
  if (counts.fail > 0) {
    overallStatus = 'not_ready';
  } else if (counts.missing > 0) {
    overallStatus = 'incomplete';
  } else if (counts.warn > 0) {
    overallStatus = 'ready_with_warnings';
  } else {
    overallStatus = 'ready';
  }

  return {
    generatedAt,
    overallStatus,
    releaseReady: counts.fail === 0 && counts.missing === 0,
    counts,
    checks,
    passedCheckIds,
    warningCheckIds,
    failedCheckIds,
    missingCheckIds,
  };
}

function overallStatusDescription(status: AiIrbistechReleaseReadinessOverallStatus): string {
  switch (status) {
    case 'ready':
      return 'ready';
    case 'ready_with_warnings':
      return 'ready_with_warnings';
    case 'not_ready':
      return 'not_ready';
    case 'incomplete':
      return 'incomplete';
    default:
      return status;
  }
}

export function renderAiIrbistechReleaseReadinessMarkdown(
  snapshot: AiIrbistechReleaseReadinessSnapshot,
): string {
  const lines: string[] = [
    '# AI IRBISTECH 1.1 Release Readiness',
    '',
    '## Summary',
    '',
    `- generated at: \`${snapshot.generatedAt}\``,
    `- overall status: \`${overallStatusDescription(snapshot.overallStatus)}\``,
    `- release ready: \`${snapshot.releaseReady ? 'yes' : 'no'}\``,
    `- passed checks: \`${snapshot.counts.pass}\``,
    `- warning checks: \`${snapshot.counts.warn}\``,
    `- failed checks: \`${snapshot.counts.fail}\``,
    `- missing checks: \`${snapshot.counts.missing}\``,
    '',
    '## Checks',
    '',
  ];

  for (const check of snapshot.checks) {
    lines.push(`### ${check.title}`);
    lines.push(`- status: \`${check.status}\``);
    lines.push(`- category: \`${check.category}\``);
    lines.push(`- summary: ${check.summary}`);
    for (const detail of check.details) {
      lines.push(`- ${detail}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_ARTIFACT_RETENTION,
  pruneArtifactEntries,
} from './artifact-retention';
import {
  validateAcceptanceTraceCase,
  type AcceptanceCaseConfig,
  type AcceptanceCaseResult,
  type AcceptanceTracePayload,
} from './ai-analysis-acceptance-qa';

export type AiAnalysisAcceptanceHealthState = 'healthy' | 'unhealthy';

export type AiAnalysisAcceptanceHealthCase = {
  name: string;
  inn: string;
  ok: boolean;
  finalSource: string | null;
  finalScore: number | null;
  formulaDelta: number | null;
  originKind: string | null;
  originName: string | null;
  error: string | null;
};

export type AiAnalysisAcceptanceHealthSummary = {
  checkedAt: string;
  baseUrl: string;
  ok: boolean;
  reason: string;
  health: {
    ok: boolean;
    severity: string | null;
    error: string | null;
  };
  failedCases: string[];
  cases: AiAnalysisAcceptanceHealthCase[];
  artifactPath?: string | null;
};

type RunProbeOptions = {
  baseUrl: string;
  timeoutMs: number;
  cases: AcceptanceCaseConfig[];
};

type RunHealthcheckOptions = RunProbeOptions & {
  webhookUrl?: string | null;
  stateFile: string;
  alertOnRecovery: boolean;
  artifactDir?: string | null;
  artifactRetentionCount?: number | null;
};

export function normalizeAcceptanceBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function buildDefaultAcceptanceCases({
  okvedInn = '1841109992',
  twoWayInn = '6320002223',
  threeWayInn = '3444070534',
}: {
  okvedInn?: string;
  twoWayInn?: string;
  threeWayInn?: string;
} = {}): AcceptanceCaseConfig[] {
  return [
    {
      name: 'okved-1way',
      inn: okvedInn,
      requiredSource: '1way',
      expectedSelectionStrategy: 'okved',
      expectedOriginKind: 'okved',
    },
    {
      name: 'product-2way',
      inn: twoWayInn,
      requiredSource: '2way',
      expectedSelectionStrategy: 'site',
      expectedOriginKind: 'product',
      requireMatchedProduct: true,
    },
    {
      name: 'site-3way',
      inn: threeWayInn,
      requiredSource: '3way',
      expectedSelectionStrategy: 'site',
      expectedOriginKind: 'site',
      requireMatchedSite: true,
    },
  ];
}

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function caseFromResult(result: AcceptanceCaseResult): AiAnalysisAcceptanceHealthCase {
  return {
    name: result.name,
    inn: result.inn,
    ok: true,
    finalSource: result.selectedItem.finalSource,
    finalScore: result.selectedItem.finalScore,
    formulaDelta: result.selectedItem.formulaDelta,
    originKind: result.selectedItem.originKind,
    originName: result.selectedItem.originName,
    error: null,
  };
}

function failedCase(config: AcceptanceCaseConfig, error: unknown): AiAnalysisAcceptanceHealthCase {
  return {
    name: config.name,
    inn: config.inn,
    ok: false,
    finalSource: null,
    finalScore: null,
    formulaDelta: null,
    originKind: null,
    originName: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as T | null;
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }
    if (!payload || typeof payload !== 'object') {
      throw new Error(`${url} returned invalid JSON payload`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkHealth(baseUrl: string, timeoutMs: number): Promise<AiAnalysisAcceptanceHealthSummary['health']> {
  try {
    const payload = await fetchJson<{ ok?: boolean; severity?: unknown }>(`${baseUrl}/api/health`, timeoutMs);
    const ok = payload.ok === true;
    return {
      ok,
      severity: stringValue(payload.severity),
      error: ok ? null : '/api/health reported ok=false',
    };
  } catch (error) {
    return {
      ok: false,
      severity: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkCase(
  baseUrl: string,
  timeoutMs: number,
  config: AcceptanceCaseConfig,
): Promise<AiAnalysisAcceptanceHealthCase> {
  try {
    const payload = await fetchJson<AcceptanceTracePayload>(
      `${baseUrl}/api/ai-analysis/equipment-trace/${encodeURIComponent(config.inn)}`,
      timeoutMs,
    );
    return caseFromResult(validateAcceptanceTraceCase(config, payload));
  } catch (error) {
    return failedCase(config, error);
  }
}

export async function runAiAnalysisAcceptanceProbe({
  baseUrl,
  timeoutMs,
  cases,
}: RunProbeOptions): Promise<AiAnalysisAcceptanceHealthSummary> {
  const normalizedBaseUrl = normalizeAcceptanceBaseUrl(baseUrl);
  const [health, caseResults] = await Promise.all([
    checkHealth(normalizedBaseUrl, timeoutMs),
    Promise.all(cases.map((config) => checkCase(normalizedBaseUrl, timeoutMs, config))),
  ]);
  const failedCases = caseResults.filter((item) => !item.ok).map((item) => item.name);
  const ok = health.ok && failedCases.length === 0;

  return {
    checkedAt: nowIso(),
    baseUrl: normalizedBaseUrl,
    ok,
    reason: ok
      ? 'ok'
      : !health.ok
        ? `health_error:${health.error ?? 'reported_unhealthy'}`
        : `failed_cases:${failedCases.join(',')}`,
    health,
    failedCases,
    cases: caseResults,
  };
}

export function currentAiAnalysisAcceptanceState(ok: boolean): AiAnalysisAcceptanceHealthState {
  return ok ? 'healthy' : 'unhealthy';
}

export function shouldSendAiAnalysisAcceptanceAlert({
  previousStatus,
  currentStatus,
  alertOnRecovery,
}: {
  previousStatus?: string | null;
  currentStatus: AiAnalysisAcceptanceHealthState;
  alertOnRecovery: boolean;
}): boolean {
  if (currentStatus === 'unhealthy') {
    return previousStatus !== 'unhealthy';
  }
  return alertOnRecovery && previousStatus === 'unhealthy';
}

export function buildAiAnalysisAcceptanceAlertText(summary: AiAnalysisAcceptanceHealthSummary): string {
  const parts = [
    `ai-analysis acceptance is ${summary.ok ? 'OK' : 'NOT OK'}`,
    `reason=${summary.reason}`,
    `base_url=${summary.baseUrl}`,
  ];

  if (!summary.health.ok) {
    parts.push(`health=${summary.health.error ?? 'not_ok'}`);
  }
  if (summary.failedCases.length) {
    parts.push(`failed=${summary.failedCases.join(',')}`);
  }

  const failedDetails = summary.cases
    .filter((item) => !item.ok)
    .map((item) => `${item.name}:${item.error ?? 'unknown_error'}`);
  if (failedDetails.length) {
    parts.push(`cases=${failedDetails.join(';')}`);
  }

  return parts.join(' | ');
}

export function summaryToJson(summary: AiAnalysisAcceptanceHealthSummary): Record<string, unknown> {
  return {
    checkedAt: summary.checkedAt,
    baseUrl: summary.baseUrl,
    ok: summary.ok,
    reason: summary.reason,
    health: summary.health,
    failedCases: summary.failedCases,
    cases: summary.cases,
    artifactPath: summary.artifactPath ?? null,
  };
}

async function loadState(stateFile: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(stateFile, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function saveState(stateFile: string, state: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function writeArtifact(
  artifactDir: string | null | undefined,
  summary: AiAnalysisAcceptanceHealthSummary,
): Promise<string | null> {
  if (!artifactDir) {
    return null;
  }
  const runDir = path.resolve(artifactDir);
  await mkdir(runDir, { recursive: true });
  const fileName = `ai-analysis-acceptance-health-${sanitizeSegment(summary.checkedAt.replace(/[:.]/g, '-'))}.json`;
  const artifactPath = path.join(runDir, fileName);
  const payload = JSON.stringify(summaryToJson({ ...summary, artifactPath }), null, 2);
  await writeFile(artifactPath, `${payload}\n`, 'utf8');
  await writeFile(path.join(runDir, 'latest.json'), `${payload}\n`, 'utf8');
  return artifactPath;
}

const ACCEPTANCE_HEALTH_ARTIFACT_PATTERN =
  /^ai-analysis-acceptance-health-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/i;

async function pruneAcceptanceArtifacts(
  artifactDir: string | null | undefined,
  artifactRetentionCount: number,
): Promise<void> {
  if (!artifactDir) {
    return;
  }

  await pruneArtifactEntries({
    rootDir: path.resolve(artifactDir),
    keepLatest: artifactRetentionCount,
    preserveNames: ['latest.json'],
    matchEntry: (entry) => !entry.isDirectory && ACCEPTANCE_HEALTH_ARTIFACT_PATTERN.test(entry.name),
  });
}

async function sendWebhook(webhookUrl: string, summary: AiAnalysisAcceptanceHealthSummary): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: buildAiAnalysisAcceptanceAlertText(summary),
      status: currentAiAnalysisAcceptanceState(summary.ok),
      summary: summaryToJson(summary),
    }),
  });

  if (!response.ok) {
    throw new Error(`webhook_status:${response.status}`);
  }
}

export async function runAiAnalysisAcceptanceHealthcheck({
  baseUrl,
  timeoutMs,
  cases,
  webhookUrl,
  stateFile,
  alertOnRecovery,
  artifactDir,
  artifactRetentionCount = DEFAULT_ARTIFACT_RETENTION,
}: RunHealthcheckOptions): Promise<AiAnalysisAcceptanceHealthSummary> {
  const retentionCount = artifactRetentionCount ?? DEFAULT_ARTIFACT_RETENTION;
  const summary = await runAiAnalysisAcceptanceProbe({ baseUrl, timeoutMs, cases });
  const artifactPath = await writeArtifact(artifactDir, summary);
  await pruneAcceptanceArtifacts(artifactDir, retentionCount).catch(() => undefined);
  const summaryWithArtifact = artifactPath ? { ...summary, artifactPath } : summary;
  const previousState = await loadState(stateFile);
  const previousStatus = typeof previousState.status === 'string' ? previousState.status : null;
  const currentStatus = currentAiAnalysisAcceptanceState(summaryWithArtifact.ok);
  let webhookError: string | null = null;

  if (
    webhookUrl &&
    shouldSendAiAnalysisAcceptanceAlert({
      previousStatus,
      currentStatus,
      alertOnRecovery,
    })
  ) {
    try {
      await sendWebhook(webhookUrl, summaryWithArtifact);
    } catch (error) {
      webhookError = error instanceof Error ? error.message : String(error);
    }
  }

  await saveState(stateFile, {
    status: currentStatus,
    checkedAt: summaryWithArtifact.checkedAt,
    ok: summaryWithArtifact.ok,
    reason: summaryWithArtifact.reason,
    failedCases: summaryWithArtifact.failedCases,
    artifactPath: summaryWithArtifact.artifactPath ?? null,
    webhookError,
  });

  if (webhookError && summaryWithArtifact.ok) {
    return {
      ...summaryWithArtifact,
      ok: false,
      reason: `webhook_error:${webhookError}`,
    };
  }

  return summaryWithArtifact;
}

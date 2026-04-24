import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_ARTIFACT_RETENTION, pruneArtifactEntries } from './artifact-retention';

export type LibraryHealthcheckState = 'healthy' | 'unhealthy';

export type LibraryHealthcheckService = {
  required?: boolean;
  status?: string;
  detail?: string | null;
  latencyMs?: number | null;
};

export type LibraryHealthcheckPayload = {
  ok?: boolean;
  severity?: string;
  failedServices?: unknown;
  degradedServices?: unknown;
  services?: unknown;
};

export type LibrarySystemHealthcheckSummary = {
  checkedAt: string;
  url: string;
  ok: boolean;
  httpStatus: number | null;
  severity: string;
  reason: string;
  failedServices: string[];
  degradedServices: string[];
  services: Record<string, LibraryHealthcheckService>;
  artifactPath?: string | null;
};

type NormalizeOptions = {
  url: string;
  httpStatus: number | null;
  payload: unknown;
  reason?: string;
};

type RunOptions = {
  url: string;
  timeoutMs: number;
  webhookUrl?: string | null;
  stateFile: string;
  alertOnRecovery: boolean;
  artifactDir?: string | null;
  artifactRetentionCount?: number | null;
};

const SERVICE_KEYS_FOR_ALERT = ['main_db', 'bitrix_db', 'ai_integration', 'analysis_score_sync'];
const LIBRARY_SYSTEM_HEALTH_ARTIFACT_PATTERN = /^library-system-health-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/i;

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeServices(value: unknown): Record<string, LibraryHealthcheckService> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([name, service]) => {
      if (!isRecord(service)) {
        return [];
      }
      return [
        [
          name,
          {
            required: typeof service.required === 'boolean' ? service.required : undefined,
            status: typeof service.status === 'string' ? service.status : undefined,
            detail: typeof service.detail === 'string' || service.detail === null ? service.detail : undefined,
            latencyMs: typeof service.latencyMs === 'number' ? service.latencyMs : undefined,
          },
        ],
      ];
    }),
  );
}

function deriveFailedServices(services: Record<string, LibraryHealthcheckService>): string[] {
  return Object.entries(services)
    .filter(([, service]) => service.required !== false && service.status !== 'ok')
    .map(([name]) => name);
}

function deriveDegradedServices(services: Record<string, LibraryHealthcheckService>): string[] {
  return Object.entries(services)
    .filter(([, service]) => service.required === false && service.status === 'error')
    .map(([name]) => name);
}

export function normalizeLibrarySystemHealthPayload({
  url,
  httpStatus,
  payload,
  reason,
}: NormalizeOptions): LibrarySystemHealthcheckSummary {
  if (!isRecord(payload)) {
    return {
      checkedAt: nowIso(),
      url,
      ok: false,
      httpStatus,
      severity: 'failed',
      reason: reason ?? 'invalid_payload',
      failedServices: [],
      degradedServices: [],
      services: {},
    };
  }

  const services = normalizeServices(payload.services);
  const failedServices = stringArray(payload.failedServices);
  const degradedServices = stringArray(payload.degradedServices);
  const effectiveFailedServices = failedServices.length ? failedServices : deriveFailedServices(services);
  const effectiveDegradedServices = degradedServices.length ? degradedServices : deriveDegradedServices(services);
  const ok = payload.ok === true && (httpStatus === null || httpStatus < 400);

  return {
    checkedAt: nowIso(),
    url,
    ok,
    httpStatus,
    severity:
      typeof payload.severity === 'string'
        ? payload.severity
        : effectiveFailedServices.length
          ? 'failed'
          : effectiveDegradedServices.length
            ? 'degraded'
            : ok
              ? 'ok'
              : 'failed',
    reason: reason ?? (ok ? 'ok' : 'reported_unhealthy'),
    failedServices: effectiveFailedServices,
    degradedServices: effectiveDegradedServices,
    services,
  };
}

export function currentLibraryHealthState(ok: boolean): LibraryHealthcheckState {
  return ok ? 'healthy' : 'unhealthy';
}

export function shouldSendLibraryHealthAlert({
  previousStatus,
  currentStatus,
  alertOnRecovery,
}: {
  previousStatus?: string | null;
  currentStatus: LibraryHealthcheckState;
  alertOnRecovery: boolean;
}): boolean {
  if (currentStatus === 'unhealthy') {
    return previousStatus !== 'unhealthy';
  }
  return alertOnRecovery && previousStatus === 'unhealthy';
}

export function buildLibrarySystemHealthAlertText(summary: LibrarySystemHealthcheckSummary): string {
  const parts = [
    `library health is ${summary.ok ? 'OK' : 'NOT OK'}`,
    `reason=${summary.reason}`,
    `severity=${summary.severity}`,
  ];

  if (summary.httpStatus !== null) {
    parts.push(`http_status=${summary.httpStatus}`);
  }
  if (summary.failedServices.length) {
    parts.push(`failed=${summary.failedServices.join(',')}`);
  }
  if (summary.degradedServices.length) {
    parts.push(`degraded=${summary.degradedServices.join(',')}`);
  }

  const serviceNotes = SERVICE_KEYS_FOR_ALERT.flatMap((name) => {
    const service = summary.services[name];
    if (!service || service.status === 'ok') {
      return [];
    }
    return [`${name}:${service.status ?? 'unknown'}${service.detail ? `:${service.detail}` : ''}`];
  });

  if (serviceNotes.length) {
    parts.push(`services=${serviceNotes.join(';')}`);
  }

  return parts.join(' | ');
}

export function summaryToJson(summary: LibrarySystemHealthcheckSummary): Record<string, unknown> {
  return {
    checkedAt: summary.checkedAt,
    url: summary.url,
    ok: summary.ok,
    httpStatus: summary.httpStatus,
    severity: summary.severity,
    reason: summary.reason,
    failedServices: summary.failedServices,
    degradedServices: summary.degradedServices,
    services: summary.services,
    artifactPath: summary.artifactPath ?? null,
  };
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function writeArtifact(
  artifactDir: string | null | undefined,
  summary: LibrarySystemHealthcheckSummary,
): Promise<string | null> {
  if (!artifactDir) {
    return null;
  }

  const runDir = path.resolve(artifactDir);
  await mkdir(runDir, { recursive: true });
  const fileName = `library-system-health-${sanitizeSegment(summary.checkedAt.replace(/[:.]/g, '-'))}.json`;
  const artifactPath = path.join(runDir, fileName);
  const payload = JSON.stringify(summaryToJson({ ...summary, artifactPath }), null, 2);
  await writeFile(artifactPath, `${payload}\n`, 'utf8');
  await writeFile(path.join(runDir, 'latest.json'), `${payload}\n`, 'utf8');
  return artifactPath;
}

async function pruneHealthArtifacts(
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
    matchEntry: (entry) => !entry.isDirectory && LIBRARY_SYSTEM_HEALTH_ARTIFACT_PATTERN.test(entry.name),
  });
}

export async function fetchLibrarySystemHealth(url: string, timeoutMs: number): Promise<LibrarySystemHealthcheckSummary> {
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
    const payload = (await response.json().catch(() => null)) as unknown;

    return normalizeLibrarySystemHealthPayload({
      url,
      httpStatus: response.status,
      payload,
      reason: response.status >= 400 ? `http_status:${response.status}` : undefined,
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    return normalizeLibrarySystemHealthPayload({
      url,
      httpStatus: null,
      payload: null,
      reason: `http_error:${errorName}`,
    });
  } finally {
    clearTimeout(timeout);
  }
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

async function sendWebhook(webhookUrl: string, summary: LibrarySystemHealthcheckSummary): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: buildLibrarySystemHealthAlertText(summary),
      status: currentLibraryHealthState(summary.ok),
      summary: summaryToJson(summary),
    }),
  });

  if (!response.ok) {
    throw new Error(`webhook_status:${response.status}`);
  }
}

export async function runLibrarySystemHealthcheck({
  url,
  timeoutMs,
  webhookUrl,
  stateFile,
  alertOnRecovery,
  artifactDir,
  artifactRetentionCount = DEFAULT_ARTIFACT_RETENTION,
}: RunOptions): Promise<LibrarySystemHealthcheckSummary> {
  const retentionCount = artifactRetentionCount ?? DEFAULT_ARTIFACT_RETENTION;
  const summary = await fetchLibrarySystemHealth(url, timeoutMs);
  const artifactPath = await writeArtifact(artifactDir, summary);
  await pruneHealthArtifacts(artifactDir, retentionCount).catch(() => undefined);
  const summaryWithArtifact = artifactPath ? { ...summary, artifactPath } : summary;
  const previousState = await loadState(stateFile);
  const previousStatus = typeof previousState.status === 'string' ? previousState.status : null;
  const currentStatus = currentLibraryHealthState(summaryWithArtifact.ok);
  let webhookError: string | null = null;

  if (
    webhookUrl &&
    shouldSendLibraryHealthAlert({
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
    httpStatus: summaryWithArtifact.httpStatus,
    severity: summaryWithArtifact.severity,
    reason: summaryWithArtifact.reason,
    artifactPath: summaryWithArtifact.artifactPath ?? null,
    webhookError,
  });

  if (webhookError && summaryWithArtifact.ok) {
    return {
      ...summaryWithArtifact,
      ok: false,
      severity: 'failed',
      reason: `webhook_error:${webhookError}`,
    };
  }

  return summaryWithArtifact;
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_ARTIFACT_RETENTION,
  pruneArtifactEntries,
} from './artifact-retention';

export type AiSiteAnalyzerRemoteHealthSummary = {
  checked_at: string;
  base_url: string;
  health_url: string;
  billing_url: string;
  ok: boolean;
  severity: 'ok' | 'degraded' | 'unhealthy';
  reason: string;
  health_http_status: number | null;
  billing_http_status: number | null;
  billing_configured: boolean | null;
  billing_error: string | null;
  billing_currency: string | null;
  billing_spent_usd: number | null;
  billing_remaining_usd: number | null;
};

export type RunAiSiteAnalyzerRemoteHealthcheckOptions = {
  baseUrl: string;
  healthUrl?: string | null;
  billingUrl?: string | null;
  timeoutMs: number;
  artifactDir: string;
  artifactRetentionCount?: number;
  stateFile?: string | null;
};

type ProbeResult = {
  url: string;
  httpStatus: number | null;
  payload: unknown;
  reason: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, '');
}

function buildUrl(baseUrl: string, suffix: string, override?: string | null): string {
  const normalizedOverride = override?.trim();
  if (normalizedOverride) {
    return normalizedOverride;
  }
  return `${cleanBaseUrl(baseUrl)}${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function fetchJson(url: string, timeoutMs: number): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.status >= 400) {
      return {
        url,
        httpStatus: response.status,
        payload,
        reason: `http_status:${response.status}`,
      };
    }
    if (payload === null) {
      return {
        url,
        httpStatus: response.status,
        payload: null,
        reason: 'invalid_json',
      };
    }
    return {
      url,
      httpStatus: response.status,
      payload,
      reason: null,
    };
  } catch (error) {
    return {
      url,
      httpStatus: null,
      payload: null,
      reason: `http_error:${error instanceof Error ? error.name : 'Error'}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildAiSiteAnalyzerRemoteHealthSummary({
  baseUrl,
  healthProbe,
  billingProbe,
  checkedAt = nowIso(),
}: {
  baseUrl: string;
  healthProbe: ProbeResult;
  billingProbe: ProbeResult;
  checkedAt?: string;
}): AiSiteAnalyzerRemoteHealthSummary {
  if (healthProbe.reason) {
    return {
      checked_at: checkedAt,
      base_url: baseUrl,
      health_url: healthProbe.url,
      billing_url: billingProbe.url,
      ok: false,
      severity: 'unhealthy',
      reason: `health_${healthProbe.reason}`,
      health_http_status: healthProbe.httpStatus,
      billing_http_status: billingProbe.httpStatus,
      billing_configured: null,
      billing_error: null,
      billing_currency: null,
      billing_spent_usd: null,
      billing_remaining_usd: null,
    };
  }

  const healthPayload = isRecord(healthProbe.payload) ? healthProbe.payload : null;
  if (healthPayload === null || healthPayload.ok !== true) {
    return {
      checked_at: checkedAt,
      base_url: baseUrl,
      health_url: healthProbe.url,
      billing_url: billingProbe.url,
      ok: false,
      severity: 'unhealthy',
      reason: 'health_not_ok',
      health_http_status: healthProbe.httpStatus,
      billing_http_status: billingProbe.httpStatus,
      billing_configured: null,
      billing_error: null,
      billing_currency: null,
      billing_spent_usd: null,
      billing_remaining_usd: null,
    };
  }

  if (billingProbe.reason) {
    return {
      checked_at: checkedAt,
      base_url: baseUrl,
      health_url: healthProbe.url,
      billing_url: billingProbe.url,
      ok: false,
      severity: 'unhealthy',
      reason: `billing_${billingProbe.reason}`,
      health_http_status: healthProbe.httpStatus,
      billing_http_status: billingProbe.httpStatus,
      billing_configured: null,
      billing_error: null,
      billing_currency: null,
      billing_spent_usd: null,
      billing_remaining_usd: null,
    };
  }

  const billingPayload = isRecord(billingProbe.payload) ? billingProbe.payload : null;
  if (billingPayload === null) {
    return {
      checked_at: checkedAt,
      base_url: baseUrl,
      health_url: healthProbe.url,
      billing_url: billingProbe.url,
      ok: false,
      severity: 'unhealthy',
      reason: 'billing_invalid_payload',
      health_http_status: healthProbe.httpStatus,
      billing_http_status: billingProbe.httpStatus,
      billing_configured: null,
      billing_error: null,
      billing_currency: null,
      billing_spent_usd: null,
      billing_remaining_usd: null,
    };
  }

  const billingConfigured = typeof billingPayload.configured === 'boolean' ? billingPayload.configured : null;
  const billingError = stringOrNull(billingPayload.error);
  const billingCurrency = typeof billingPayload.currency === 'string' ? billingPayload.currency : null;
  const billingSpentUsd = numberOrNull(billingPayload.spent_usd);
  const billingRemainingUsd = numberOrNull(billingPayload.remaining_usd);
  const degraded = billingConfigured === false || billingError !== null;

  return {
    checked_at: checkedAt,
    base_url: baseUrl,
    health_url: healthProbe.url,
    billing_url: billingProbe.url,
    ok: true,
    severity: degraded ? 'degraded' : 'ok',
    reason: degraded ? 'billing_degraded' : 'ok',
    health_http_status: healthProbe.httpStatus,
    billing_http_status: billingProbe.httpStatus,
    billing_configured: billingConfigured,
    billing_error: billingError,
    billing_currency: billingCurrency,
    billing_spent_usd: billingSpentUsd,
    billing_remaining_usd: billingRemainingUsd,
  };
}

async function saveState(stateFile: string | null | undefined, summary: AiSiteAnalyzerRemoteHealthSummary): Promise<void> {
  if (!stateFile) {
    return;
  }
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(
    stateFile,
    `${JSON.stringify(
      {
        status: summary.severity,
        checked_at: summary.checked_at,
        ok: summary.ok,
        reason: summary.reason,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

const HEALTH_ARTIFACT_PATTERN = /^ai-site-analyzer-health-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/i;

async function writeArtifacts(
  artifactDir: string,
  summary: AiSiteAnalyzerRemoteHealthSummary,
  artifactRetentionCount: number,
): Promise<string> {
  const targetDir = path.resolve(artifactDir);
  await mkdir(targetDir, { recursive: true });
  const payload = `${JSON.stringify(summary, null, 2)}\n`;
  const artifactPath = path.join(
    targetDir,
    `ai-site-analyzer-health-${sanitizeSegment(summary.checked_at.replace(/[:.]/g, '-'))}.json`,
  );
  await writeFile(artifactPath, payload, 'utf8');
  await writeFile(path.join(targetDir, 'latest.json'), payload, 'utf8');
  await pruneArtifactEntries({
    rootDir: targetDir,
    keepLatest: artifactRetentionCount,
    preserveNames: ['latest.json'],
    matchEntry: (entry) => !entry.isDirectory && HEALTH_ARTIFACT_PATTERN.test(entry.name),
  }).catch(() => undefined);
  return artifactPath;
}

export async function runAiSiteAnalyzerRemoteHealthcheck({
  baseUrl,
  healthUrl,
  billingUrl,
  timeoutMs,
  artifactDir,
  artifactRetentionCount = DEFAULT_ARTIFACT_RETENTION,
  stateFile,
}: RunAiSiteAnalyzerRemoteHealthcheckOptions): Promise<AiSiteAnalyzerRemoteHealthSummary & { artifact_path: string }> {
  const normalizedBaseUrl = cleanBaseUrl(baseUrl);
  const resolvedHealthUrl = buildUrl(normalizedBaseUrl, '/health', healthUrl);
  const resolvedBillingUrl = buildUrl(normalizedBaseUrl, '/v1/billing/remaining', billingUrl);
  const [healthProbe, billingProbe] = await Promise.all([
    fetchJson(resolvedHealthUrl, timeoutMs),
    fetchJson(resolvedBillingUrl, timeoutMs),
  ]);
  const summary = buildAiSiteAnalyzerRemoteHealthSummary({
    baseUrl: normalizedBaseUrl,
    healthProbe,
    billingProbe,
  });
  const artifactPath = await writeArtifacts(artifactDir, summary, artifactRetentionCount);
  await saveState(stateFile, summary);
  return {
    ...summary,
    artifact_path: artifactPath,
  };
}

export async function loadAiSiteAnalyzerRemoteHealthState(stateFile: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(stateFile, 'utf8')) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_ARTIFACT_RETENTION,
  pruneArtifactEntries,
} from './artifact-retention';
import {
  resolveAiAnalysisUiQaOptions,
  runAiAnalysisUiQa,
  type AiAnalysisUiQaSummary,
} from './ai-analysis-ui-qa';

export type AiAnalysisUiQaHealthState = 'healthy' | 'unhealthy';

export type RunAiAnalysisUiQaHealthcheckOptions = {
  baseUrl: string;
  login: string;
  password: string;
  timeoutMs: number;
  capture: boolean;
  headless: boolean;
  artifactDir: string;
  artifactRetentionCount: number;
  webhookUrl?: string | null;
  stateFile: string;
  alertOnRecovery: boolean;
  okvedInn?: string | null;
  twoWayInn?: string | null;
  threeWayInn?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function currentAiAnalysisUiQaState(ok: boolean): AiAnalysisUiQaHealthState {
  return ok ? 'healthy' : 'unhealthy';
}

export function shouldSendAiAnalysisUiQaAlert({
  previousStatus,
  currentStatus,
  alertOnRecovery,
}: {
  previousStatus?: string | null;
  currentStatus: AiAnalysisUiQaHealthState;
  alertOnRecovery: boolean;
}): boolean {
  if (currentStatus === 'unhealthy') {
    return previousStatus !== 'unhealthy';
  }
  return alertOnRecovery && previousStatus === 'unhealthy';
}

export function buildAiAnalysisUiQaAlertText(summary: AiAnalysisUiQaSummary): string {
  const parts = [
    `ai-analysis ui qa is ${summary.ok ? 'OK' : 'NOT OK'}`,
    `base_url=${summary.baseUrl}`,
    `authenticated=${summary.authenticated ? 'yes' : 'no'}`,
  ];

  if (summary.publicRedirectPath) {
    parts.push(`redirect=${summary.publicRedirectPath}`);
  }
  if (summary.error) {
    parts.push(`error=${summary.error}`);
  }

  const failedCases = summary.cases.filter((item) => !item.ok);
  if (failedCases.length) {
    parts.push(`failed=${failedCases.map((item) => item.name).join(',')}`);
    parts.push(
      `cases=${failedCases.map((item) => `${item.name}:${item.error ?? 'unknown_error'}`).join(';')}`,
    );
  }

  return parts.join(' | ');
}

export function summaryToJson(summary: AiAnalysisUiQaSummary): Record<string, unknown> {
  return {
    checkedAt: summary.checkedAt,
    ok: summary.ok,
    baseUrl: summary.baseUrl,
    authenticated: summary.authenticated,
    publicRedirectPath: summary.publicRedirectPath,
    artifactDir: summary.artifactDir,
    artifactPath: summary.artifactPath,
    cases: summary.cases,
    screenshots: summary.screenshots,
    error: summary.error,
  };
}

async function writeArtifact(
  artifactDir: string,
  summary: AiAnalysisUiQaSummary,
): Promise<string> {
  const runDir = path.resolve(artifactDir);
  await mkdir(runDir, { recursive: true });
  const fileName = `ai-analysis-ui-qa-health-${sanitizeSegment(summary.checkedAt.replace(/[:.]/g, '-'))}.json`;
  const artifactPath = path.join(runDir, fileName);
  const payload = JSON.stringify(summaryToJson(summary), null, 2);
  await writeFile(artifactPath, `${payload}\n`, 'utf8');
  await writeFile(path.join(runDir, 'latest.json'), `${payload}\n`, 'utf8');
  return artifactPath;
}

const UI_QA_HEALTH_ARTIFACT_PATTERN = /^ai-analysis-ui-qa-health-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/i;

async function pruneHealthArtifacts(artifactDir: string, artifactRetentionCount: number): Promise<void> {
  await pruneArtifactEntries({
    rootDir: path.resolve(artifactDir),
    keepLatest: artifactRetentionCount,
    preserveNames: ['latest.json'],
    matchEntry: (entry) => !entry.isDirectory && UI_QA_HEALTH_ARTIFACT_PATTERN.test(entry.name),
  });
}

async function sendWebhook(webhookUrl: string, summary: AiAnalysisUiQaSummary): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: buildAiAnalysisUiQaAlertText(summary),
      status: currentAiAnalysisUiQaState(summary.ok),
      summary: summaryToJson(summary),
    }),
  });

  if (!response.ok) {
    throw new Error(`webhook_status:${response.status}`);
  }
}

export async function runAiAnalysisUiQaHealthcheck({
  baseUrl,
  login,
  password,
  timeoutMs,
  capture,
  headless,
  artifactDir,
  artifactRetentionCount = DEFAULT_ARTIFACT_RETENTION,
  webhookUrl,
  stateFile,
  alertOnRecovery,
  okvedInn,
  twoWayInn,
  threeWayInn,
}: RunAiAnalysisUiQaHealthcheckOptions): Promise<AiAnalysisUiQaSummary> {
  const resolved = resolveAiAnalysisUiQaOptions(
    {
      AI_ANALYSIS_UI_QA_BASE_URL: baseUrl,
      AI_ANALYSIS_UI_QA_LOGIN: login,
      AI_ANALYSIS_UI_QA_PASSWORD: password,
      AI_ANALYSIS_UI_QA_TIMEOUT_MS: String(timeoutMs),
      AI_ANALYSIS_UI_QA_CAPTURE: String(capture),
      AI_ANALYSIS_UI_QA_HEADLESS: String(headless),
      AI_ANALYSIS_UI_QA_ARTIFACT_DIR: artifactDir,
      AI_ANALYSIS_UI_QA_ARTIFACT_RETENTION: String(artifactRetentionCount),
      AI_ANALYSIS_UI_QA_OKVED_INN: okvedInn ?? undefined,
      AI_ANALYSIS_UI_QA_2WAY_INN: twoWayInn ?? undefined,
      AI_ANALYSIS_UI_QA_3WAY_INN: threeWayInn ?? undefined,
    },
    process.cwd(),
  );

  const summary = await runAiAnalysisUiQa(resolved);
  const healthArtifactPath = await writeArtifact(artifactDir, summary);
  await pruneHealthArtifacts(artifactDir, artifactRetentionCount).catch(() => undefined);
  const previousState = await loadState(stateFile);
  const previousStatus = typeof previousState.status === 'string' ? previousState.status : null;
  const currentStatus = currentAiAnalysisUiQaState(summary.ok);
  let webhookError: string | null = null;

  if (
    webhookUrl &&
    shouldSendAiAnalysisUiQaAlert({
      previousStatus,
      currentStatus,
      alertOnRecovery,
    })
  ) {
    try {
      await sendWebhook(webhookUrl, summary);
    } catch (error) {
      webhookError = error instanceof Error ? error.message : String(error);
    }
  }

  await saveState(stateFile, {
    status: currentStatus,
    checkedAt: summary.checkedAt,
    ok: summary.ok,
    authenticated: summary.authenticated,
    artifactPath: summary.artifactPath,
    healthArtifactPath,
    failedCases: summary.cases.filter((item) => !item.ok).map((item) => item.name),
    error: summary.error,
    webhookError,
  });

  if (webhookError && summary.ok) {
    return {
      ...summary,
      ok: false,
      error: `webhook_error:${webhookError}`,
    };
  }

  return summary;
}

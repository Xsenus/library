import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_ARTIFACT_RETENTION } from './artifact-retention';
import { runAiAnalysisUiSmoke, type AiAnalysisUiSmokeSummary } from './ai-analysis-ui-smoke';

export type AiAnalysisUiSmokeHealthState = 'healthy' | 'unhealthy';

export type RunAiAnalysisUiSmokeHealthcheckOptions = {
  baseUrl: string;
  login?: string | null;
  password?: string | null;
  capture: boolean;
  headless: boolean;
  requireAuth: boolean;
  timeoutMs: number;
  artifactDir: string;
  artifactRetentionCount: number;
  webhookUrl?: string | null;
  stateFile: string;
  alertOnRecovery: boolean;
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

export function currentAiAnalysisUiSmokeState(ok: boolean): AiAnalysisUiSmokeHealthState {
  return ok ? 'healthy' : 'unhealthy';
}

export function shouldSendAiAnalysisUiSmokeAlert({
  previousStatus,
  currentStatus,
  alertOnRecovery,
}: {
  previousStatus?: string | null;
  currentStatus: AiAnalysisUiSmokeHealthState;
  alertOnRecovery: boolean;
}): boolean {
  if (currentStatus === 'unhealthy') {
    return previousStatus !== 'unhealthy';
  }
  return alertOnRecovery && previousStatus === 'unhealthy';
}

export function buildAiAnalysisUiSmokeAlertText(summary: AiAnalysisUiSmokeSummary): string {
  const parts = [
    `ai-analysis ui smoke is ${summary.ok ? 'OK' : 'NOT OK'}`,
    `mode=${summary.mode}`,
    `base_url=${summary.baseUrl}`,
  ];

  if (summary.publicRedirectPath) {
    parts.push(`redirect=${summary.publicRedirectPath}`);
  }
  if (summary.mode === 'authenticated' || summary.requireAuth) {
    parts.push(`authenticated=${summary.authenticated ? 'yes' : 'no'}`);
    parts.push(`ai_analysis=${summary.aiAnalysisLoaded ? 'loaded' : 'not_loaded'}`);
    parts.push(`dialog=${summary.companyDialogOpened ? 'opened' : 'not_opened'}`);
  }
  if (summary.error) {
    parts.push(`error=${summary.error}`);
  }

  return parts.join(' | ');
}

export function summaryToJson(summary: AiAnalysisUiSmokeSummary): Record<string, unknown> {
  return {
    checkedAt: summary.checkedAt,
    ok: summary.ok,
    mode: summary.mode,
    baseUrl: summary.baseUrl,
    authenticated: summary.authenticated,
    requireAuth: summary.requireAuth,
    publicRedirectPath: summary.publicRedirectPath,
    aiAnalysisLoaded: summary.aiAnalysisLoaded,
    companyDialogOpened: summary.companyDialogOpened,
    dialogTitle: summary.dialogTitle,
    artifactDir: summary.artifactDir,
    artifactPath: summary.artifactPath,
    screenshots: summary.screenshots,
    error: summary.error,
  };
}

async function sendWebhook(webhookUrl: string, summary: AiAnalysisUiSmokeSummary): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: buildAiAnalysisUiSmokeAlertText(summary),
      status: currentAiAnalysisUiSmokeState(summary.ok),
      summary: summaryToJson(summary),
    }),
  });

  if (!response.ok) {
    throw new Error(`webhook_status:${response.status}`);
  }
}

export async function runAiAnalysisUiSmokeHealthcheck({
  baseUrl,
  login,
  password,
  capture,
  headless,
  requireAuth,
  timeoutMs,
  artifactDir,
  artifactRetentionCount = DEFAULT_ARTIFACT_RETENTION,
  webhookUrl,
  stateFile,
  alertOnRecovery,
}: RunAiAnalysisUiSmokeHealthcheckOptions): Promise<AiAnalysisUiSmokeSummary> {
  const summary = await runAiAnalysisUiSmoke({
    baseUrl,
    login,
    password,
    capture,
    headless,
    requireAuth,
    timeoutMs,
    artifactDir,
    artifactRetentionCount,
  });
  const previousState = await loadState(stateFile);
  const previousStatus = typeof previousState.status === 'string' ? previousState.status : null;
  const currentStatus = currentAiAnalysisUiSmokeState(summary.ok);
  let webhookError: string | null = null;

  if (
    webhookUrl &&
    shouldSendAiAnalysisUiSmokeAlert({
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
    mode: summary.mode,
    authenticated: summary.authenticated,
    requireAuth: summary.requireAuth,
    artifactPath: summary.artifactPath,
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

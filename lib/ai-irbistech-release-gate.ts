import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  runAiIrbistechAcceptanceSuite,
  type AiIrbistechAcceptanceSuiteOptions,
  type AiIrbistechAcceptanceSuiteSummary,
  type AiIrbistechAcceptanceSuiteTaskMode,
} from './ai-irbistech-acceptance-suite';
import {
  loadAiIrbistechReleaseReadinessEnvFile,
  resolveAiIrbistechReleaseReadinessEnvValue,
  type AiIrbistechReleaseReadinessEnvFileInfo,
  buildAiIrbistechReleaseReadinessSnapshot,
  renderAiIrbistechReleaseReadinessMarkdown,
  type AiIrbistechReleaseReadinessOptions,
  type AiIrbistechReleaseReadinessOverallStatus,
  type AiIrbistechReleaseReadinessSnapshot,
} from './ai-irbistech-release-readiness';

export type AiIrbistechReleaseGateSummary = {
  startedAt: string;
  finishedAt: string;
  reportName: string;
  outputDir: string;
  overallStatus: AiIrbistechReleaseReadinessOverallStatus;
  releaseReady: boolean;
  exitCode: number;
  resolvedInputs: {
    libraryBaseUrl: string | null;
    aiIntegrationBaseUrl: string | null;
    aiSiteAnalyzerBaseUrl: string | null;
    aiIntegrationEnvFile: string;
    libraryEnvFile: string;
    aiSiteAnalyzerEnvFile: string;
  };
  suite: {
    runId: string;
    overallStatus: AiIrbistechReleaseReadinessOverallStatus;
    releaseReady: boolean;
    exitCode: number;
    taskFailureExitCode: number;
    reportJsonPath: string;
    reportMarkdownPath: string;
    suiteJsonPath: string;
    suiteMarkdownPath: string;
    releaseReadinessJsonPath: string;
    releaseReadinessMarkdownPath: string;
  };
  liveReleaseReadiness: {
    overallStatus: AiIrbistechReleaseReadinessOverallStatus;
    releaseReady: boolean;
    exitCode: number;
    jsonPath: string;
    markdownPath: string;
  } | null;
  suiteSummary: AiIrbistechAcceptanceSuiteSummary;
  liveReleaseReadinessSnapshot: AiIrbistechReleaseReadinessSnapshot | null;
};

export type AiIrbistechReleaseGateOptions = {
  cwd?: string;
  outputDir?: string;
  suiteOutputDir?: string;
  suiteArtifactRootDir?: string;
  reportName?: string;
  runId?: string;
  pythonExecutable?: string;
  aiIntegrationPythonExecutable?: string;
  aiSiteAnalyzerPythonExecutable?: string;
  npmExecutable?: string;
  workspaceRoot?: string;
  libraryRoot?: string;
  aiIntegrationRoot?: string;
  aiSiteAnalyzerRoot?: string;
  libraryBaseUrl?: string | null;
  aiIntegrationBaseUrl?: string | null;
  aiSiteAnalyzerBaseUrl?: string | null;
  requirePostgresSqlTarget?: boolean;
  uiSmokeMode?: AiIrbistechAcceptanceSuiteTaskMode;
  uiQaMode?: AiIrbistechAcceptanceSuiteTaskMode;
  requireReady?: boolean;
  requireClean?: boolean;
  skipLiveReadiness?: boolean;
  liveAiIntegrationEnvFile?: string;
  liveLibraryEnvFile?: string;
  liveAiSiteAnalyzerEnvFile?: string;
  liveUseSystemctl?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  acceptanceSuiteRunner?: (
    options: AiIrbistechAcceptanceSuiteOptions,
  ) => Promise<AiIrbistechAcceptanceSuiteSummary>;
  liveReleaseReadinessBuilder?: (
    options: AiIrbistechReleaseReadinessOptions,
  ) => Promise<AiIrbistechReleaseReadinessSnapshot>;
};

const DEFAULT_OUTPUT_DIR = 'docs/ai-irbistech-release-gate';
const DEFAULT_REPORT_NAME = 'latest';
const DEFAULT_AI_INTEGRATION_ENV_FILE = '/etc/default/ai-integration-monitoring';
const DEFAULT_LIBRARY_ENV_FILE = '/etc/default/library-monitoring';
const DEFAULT_AI_SITE_ANALYZER_ENV_FILE = '/etc/default/ai-site-analyzer-monitoring';

type ReleaseGateEnvBaseUrlCandidate = {
  key: string;
  kind: 'base' | 'url';
};

type AiIrbistechReleaseGateResolvedInputs = {
  libraryBaseUrl: string | null;
  aiIntegrationBaseUrl: string | null;
  aiSiteAnalyzerBaseUrl: string | null;
  aiIntegrationEnvFile: string;
  libraryEnvFile: string;
  aiSiteAnalyzerEnvFile: string;
};

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function displayPath(value: string): string {
  return path.resolve(value).replace(/\\/g, '/');
}

function resolveInputPath(cwd: string, value: string | undefined, fallback: string): string {
  const candidate = value ?? fallback;
  return path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().replace(/\/+$/g, '');
  return normalized || null;
}

function baseUrlFromAbsoluteUrl(value: string | null | undefined): string | null {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = new URL(normalized);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return normalized;
  }
}

function resolveBaseUrlFromEnvFile(
  info: AiIrbistechReleaseReadinessEnvFileInfo,
  candidates: readonly ReleaseGateEnvBaseUrlCandidate[],
): string | null {
  for (const candidate of candidates) {
    const value = resolveAiIrbistechReleaseReadinessEnvValue(info, candidate.key);
    if (!value) {
      continue;
    }
    const resolved =
      candidate.kind === 'url' ? baseUrlFromAbsoluteUrl(value) : normalizeBaseUrl(value);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function resolveAiIrbistechReleaseGateInputs(
  cwd: string,
  options: AiIrbistechReleaseGateOptions,
): AiIrbistechReleaseGateResolvedInputs {
  const aiIntegrationEnvFile = resolveInputPath(
    cwd,
    options.liveAiIntegrationEnvFile,
    DEFAULT_AI_INTEGRATION_ENV_FILE,
  );
  const libraryEnvFile = resolveInputPath(
    cwd,
    options.liveLibraryEnvFile,
    DEFAULT_LIBRARY_ENV_FILE,
  );
  const aiSiteAnalyzerEnvFile = resolveInputPath(
    cwd,
    options.liveAiSiteAnalyzerEnvFile,
    DEFAULT_AI_SITE_ANALYZER_ENV_FILE,
  );

  const aiIntegrationEnv = loadAiIrbistechReleaseReadinessEnvFile(aiIntegrationEnvFile);
  const libraryEnv = loadAiIrbistechReleaseReadinessEnvFile(libraryEnvFile);
  const aiSiteAnalyzerEnv =
    loadAiIrbistechReleaseReadinessEnvFile(aiSiteAnalyzerEnvFile);

  return {
    libraryBaseUrl:
      normalizeBaseUrl(options.libraryBaseUrl) ??
      resolveBaseUrlFromEnvFile(libraryEnv, [
        { key: 'AI_ANALYSIS_ACCEPTANCE_BASE_URL', kind: 'base' },
        { key: 'AI_ANALYSIS_ACCEPTANCE_HEALTH_BASE_URL', kind: 'base' },
        { key: 'AI_ANALYSIS_UI_SMOKE_BASE_URL', kind: 'base' },
        { key: 'AI_ANALYSIS_UI_QA_BASE_URL', kind: 'base' },
        { key: 'LIBRARY_HEALTH_BASE_URL', kind: 'base' },
        { key: 'LIBRARY_SYSTEM_HEALTH_BASE_URL', kind: 'base' },
      ]),
    aiIntegrationBaseUrl:
      normalizeBaseUrl(options.aiIntegrationBaseUrl) ??
      resolveBaseUrlFromEnvFile(aiIntegrationEnv, [
        { key: 'EQUIPMENT_SCORE_ACCEPTANCE_BASE_URL', kind: 'base' },
        { key: 'AI_INTEGRATION_ROLLOUT_ACCEPTANCE_BASE_URL', kind: 'base' },
        { key: 'ANALYSIS_SCORE_SYNC_HEALTH_URL', kind: 'url' },
      ]),
    aiSiteAnalyzerBaseUrl:
      normalizeBaseUrl(options.aiSiteAnalyzerBaseUrl) ??
      resolveBaseUrlFromEnvFile(aiSiteAnalyzerEnv, [
        { key: 'AI_SITE_ANALYZER_HEALTHCHECK_BASE_URL', kind: 'base' },
      ]),
    aiIntegrationEnvFile,
    libraryEnvFile,
    aiSiteAnalyzerEnvFile,
  };
}

function resolveCombinedStatus(
  statuses: AiIrbistechReleaseReadinessOverallStatus[],
): AiIrbistechReleaseReadinessOverallStatus {
  if (statuses.includes('not_ready')) {
    return 'not_ready';
  }
  if (statuses.includes('incomplete')) {
    return 'incomplete';
  }
  if (statuses.includes('ready_with_warnings')) {
    return 'ready_with_warnings';
  }
  return 'ready';
}

export function resolveAiIrbistechReleaseGateExitCode(
  overallStatus: AiIrbistechReleaseReadinessOverallStatus,
  {
    requireReady = true,
    requireClean = false,
  }: {
    requireReady?: boolean;
    requireClean?: boolean;
  } = {},
): number {
  if (requireClean && overallStatus !== 'ready') {
    return 1;
  }
  if (
    requireReady &&
    (overallStatus === 'incomplete' || overallStatus === 'not_ready')
  ) {
    return 1;
  }
  return 0;
}

export function renderAiIrbistechReleaseGateMarkdown(
  summary: AiIrbistechReleaseGateSummary,
): string {
  const lines: string[] = [];
  lines.push('# AI IRBISTECH 1.1 Release Gate');
  lines.push('');
  lines.push(`- started at: \`${summary.startedAt}\``);
  lines.push(`- finished at: \`${summary.finishedAt}\``);
  lines.push(`- overall status: \`${summary.overallStatus}\``);
  lines.push(`- release ready: \`${summary.releaseReady ? 'yes' : 'no'}\``);
  lines.push(`- exit code: \`${summary.exitCode}\``);
  lines.push('');
  lines.push('## Inputs');
  lines.push('');
  lines.push(`- library base URL: \`${summary.resolvedInputs.libraryBaseUrl ?? 'missing'}\``);
  lines.push(`- ai-integration base URL: \`${summary.resolvedInputs.aiIntegrationBaseUrl ?? 'missing'}\``);
  lines.push(`- ai-site-analyzer base URL: \`${summary.resolvedInputs.aiSiteAnalyzerBaseUrl ?? 'missing'}\``);
  lines.push(`- ai-integration env file: \`${displayPath(summary.resolvedInputs.aiIntegrationEnvFile)}\``);
  lines.push(`- library env file: \`${displayPath(summary.resolvedInputs.libraryEnvFile)}\``);
  lines.push(`- ai-site-analyzer env file: \`${displayPath(summary.resolvedInputs.aiSiteAnalyzerEnvFile)}\``);
  lines.push('');
  lines.push('## Acceptance Suite');
  lines.push('');
  lines.push(`- run id: \`${summary.suite.runId}\``);
  lines.push(`- overall status: \`${summary.suite.overallStatus}\``);
  lines.push(`- release ready: \`${summary.suite.releaseReady ? 'yes' : 'no'}\``);
  lines.push(`- exit code: \`${summary.suite.exitCode}\``);
  lines.push(`- task failure exit code: \`${summary.suite.taskFailureExitCode}\``);
  lines.push(`- report markdown: \`${displayPath(summary.suite.reportMarkdownPath)}\``);
  lines.push(`- report json: \`${displayPath(summary.suite.reportJsonPath)}\``);
  lines.push(`- suite markdown: \`${displayPath(summary.suite.suiteMarkdownPath)}\``);
  lines.push(`- suite json: \`${displayPath(summary.suite.suiteJsonPath)}\``);
  lines.push(`- suite release-readiness markdown: \`${displayPath(summary.suite.releaseReadinessMarkdownPath)}\``);
  lines.push(`- suite release-readiness json: \`${displayPath(summary.suite.releaseReadinessJsonPath)}\``);
  lines.push('');
  lines.push('## Live Release Readiness');
  lines.push('');
  if (!summary.liveReleaseReadiness) {
    lines.push('- skipped');
  } else {
    lines.push(`- overall status: \`${summary.liveReleaseReadiness.overallStatus}\``);
    lines.push(`- release ready: \`${summary.liveReleaseReadiness.releaseReady ? 'yes' : 'no'}\``);
    lines.push(`- exit code: \`${summary.liveReleaseReadiness.exitCode}\``);
    lines.push(`- markdown: \`${displayPath(summary.liveReleaseReadiness.markdownPath)}\``);
    lines.push(`- json: \`${displayPath(summary.liveReleaseReadiness.jsonPath)}\``);
  }
  lines.push('');
  return `${lines.join('\n').trimEnd()}\n`;
}

export async function runAiIrbistechReleaseGate(
  options: AiIrbistechReleaseGateOptions = {},
): Promise<AiIrbistechReleaseGateSummary> {
  const startedAt = nowIso(options.now);
  const reportName = sanitizeSegment(options.reportName ?? DEFAULT_REPORT_NAME) || DEFAULT_REPORT_NAME;
  const cwd = options.cwd ?? process.cwd();
  const outputDir = path.resolve(cwd, options.outputDir ?? DEFAULT_OUTPUT_DIR);
  fs.mkdirSync(outputDir, { recursive: true });
  const resolvedInputs = resolveAiIrbistechReleaseGateInputs(cwd, options);

  const suiteRunner = options.acceptanceSuiteRunner ?? runAiIrbistechAcceptanceSuite;
  const liveReleaseReadinessBuilder =
    options.liveReleaseReadinessBuilder ?? buildAiIrbistechReleaseReadinessSnapshot;

  const suiteSummary = await suiteRunner({
    cwd,
    outputDir: options.suiteOutputDir,
    artifactRootDir: options.suiteArtifactRootDir,
    reportName,
    runId: options.runId,
    pythonExecutable: options.pythonExecutable,
    aiIntegrationPythonExecutable: options.aiIntegrationPythonExecutable,
    aiSiteAnalyzerPythonExecutable: options.aiSiteAnalyzerPythonExecutable,
    npmExecutable: options.npmExecutable,
    roots: {
      workspaceRoot: options.workspaceRoot,
      libraryRoot: options.libraryRoot,
      aiIntegrationRoot: options.aiIntegrationRoot,
      aiSiteAnalyzerRoot: options.aiSiteAnalyzerRoot,
    },
    libraryBaseUrl: resolvedInputs.libraryBaseUrl,
    aiIntegrationBaseUrl: resolvedInputs.aiIntegrationBaseUrl,
    aiSiteAnalyzerBaseUrl: resolvedInputs.aiSiteAnalyzerBaseUrl,
    requirePostgresSqlTarget: options.requirePostgresSqlTarget,
    uiSmokeMode: options.uiSmokeMode,
    uiQaMode: options.uiQaMode,
    requireReleaseReady: false,
    requireClean: false,
    env: options.env,
    now: options.now,
  });

  let liveReleaseReadinessSnapshot: AiIrbistechReleaseReadinessSnapshot | null = null;
  let liveReleaseReadinessJsonPath: string | null = null;
  let liveReleaseReadinessMarkdownPath: string | null = null;

  if (!options.skipLiveReadiness) {
    liveReleaseReadinessSnapshot = await liveReleaseReadinessBuilder({
      cwd,
      generatedAt: nowIso(options.now),
      aiIntegrationEnvFile: resolvedInputs.aiIntegrationEnvFile,
      libraryEnvFile: resolvedInputs.libraryEnvFile,
      aiSiteAnalyzerEnvFile: resolvedInputs.aiSiteAnalyzerEnvFile,
      libraryUiSmokeRequired:
        options.uiSmokeMode === 'never' ? false : undefined,
      libraryUiQaRequired:
        options.uiQaMode === 'never' ? false : undefined,
      useSystemctl: options.liveUseSystemctl ?? true,
      playwrightChromiumStatus: suiteSummary.prerequisites.playwrightChromium,
    });

    liveReleaseReadinessJsonPath = path.join(outputDir, `${reportName}.live-release-readiness.json`);
    liveReleaseReadinessMarkdownPath = path.join(outputDir, `${reportName}.live-release-readiness.md`);
    fs.writeFileSync(
      liveReleaseReadinessJsonPath,
      `${JSON.stringify(liveReleaseReadinessSnapshot, null, 2)}\n`,
      'utf8',
    );
    fs.writeFileSync(
      liveReleaseReadinessMarkdownPath,
      renderAiIrbistechReleaseReadinessMarkdown(liveReleaseReadinessSnapshot),
      'utf8',
    );
  }

  const overallStatus = resolveCombinedStatus(
    [
      suiteSummary.report.overallStatus,
      suiteSummary.releaseReadiness.overallStatus,
      liveReleaseReadinessSnapshot?.overallStatus,
    ].filter((value): value is AiIrbistechReleaseReadinessOverallStatus => Boolean(value)),
  );
  const releaseReady =
    overallStatus === 'ready' || overallStatus === 'ready_with_warnings';
  const gateExitCode = resolveAiIrbistechReleaseGateExitCode(overallStatus, {
    requireReady: options.requireReady ?? true,
    requireClean: options.requireClean ?? false,
  });
  const exitCode = Math.max(suiteSummary.exitCode, gateExitCode);
  const finishedAt = nowIso(options.now);

  const summary: AiIrbistechReleaseGateSummary = {
    startedAt,
    finishedAt,
    reportName,
    outputDir,
    overallStatus,
    releaseReady,
    exitCode,
    resolvedInputs,
    suite: {
      runId: suiteSummary.runId,
      overallStatus: suiteSummary.report.overallStatus,
      releaseReady: suiteSummary.report.releaseReady,
      exitCode: suiteSummary.exitCode,
      taskFailureExitCode: suiteSummary.taskFailureExitCode,
      reportJsonPath: suiteSummary.report.jsonPath,
      reportMarkdownPath: suiteSummary.report.markdownPath,
      suiteJsonPath: suiteSummary.report.suiteJsonPath,
      suiteMarkdownPath: suiteSummary.report.suiteMarkdownPath,
      releaseReadinessJsonPath: suiteSummary.releaseReadiness.jsonPath,
      releaseReadinessMarkdownPath: suiteSummary.releaseReadiness.markdownPath,
    },
    liveReleaseReadiness: liveReleaseReadinessSnapshot
      ? {
          overallStatus: liveReleaseReadinessSnapshot.overallStatus,
          releaseReady: liveReleaseReadinessSnapshot.releaseReady,
          exitCode: resolveAiIrbistechReleaseGateExitCode(
            liveReleaseReadinessSnapshot.overallStatus,
            {
              requireReady: options.requireReady ?? true,
              requireClean: options.requireClean ?? false,
            },
          ),
          jsonPath: liveReleaseReadinessJsonPath!,
          markdownPath: liveReleaseReadinessMarkdownPath!,
        }
      : null,
    suiteSummary,
    liveReleaseReadinessSnapshot,
  };

  const jsonPath = path.join(outputDir, `${reportName}.json`);
  const markdownPath = path.join(outputDir, `${reportName}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, renderAiIrbistechReleaseGateMarkdown(summary), 'utf8');

  return summary;
}

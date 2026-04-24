import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  buildAiIrbistechAcceptanceReportSnapshot,
  renderAiIrbistechAcceptanceReportMarkdown,
  resolveAiIrbistechAcceptanceReportExitCode,
  type AiIrbistechAcceptanceReportSnapshot,
  type AiIrbistechAcceptanceReportSources,
} from './ai-irbistech-acceptance-report';
import {
  loadAiIrbistechAcceptanceReportSource,
  type AiIrbistechAcceptanceReportSourceKey,
} from './ai-irbistech-acceptance-report-discovery';
import {
  buildAiIrbistechReleaseReadinessSnapshot,
  renderAiIrbistechReleaseReadinessMarkdown,
  resolveAiIrbistechReleaseReadinessExitCode,
  type AiIrbistechReleaseReadinessSnapshot,
} from './ai-irbistech-release-readiness';

export type AiIrbistechAcceptanceSuiteTaskMode = 'always' | 'auto' | 'never';
export type AiIrbistechAcceptanceSuiteTaskStatus = 'passed' | 'failed' | 'skipped';
export type AiIrbistechAcceptanceSuitePrerequisiteStatus = {
  ok: boolean;
  reason: string | null;
};

export type AiIrbistechAcceptanceSuiteTaskId =
  | 'aiIntegrationSqlReadiness'
  | 'aiIntegrationSyncHealth'
  | 'aiIntegrationAcceptance'
  | 'libraryHealth'
  | 'libraryAcceptance'
  | 'libraryUiSmoke'
  | 'libraryUiQa'
  | 'aiSiteAnalyzerHealth';

export type AiIrbistechAcceptanceSuiteRoots = {
  workspaceRoot: string;
  libraryRoot: string;
  aiIntegrationRoot: string;
  aiSiteAnalyzerRoot: string;
};

export type AiIrbistechAcceptanceSuiteRunCommand = {
  taskId: AiIrbistechAcceptanceSuiteTaskId;
  title: string;
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type AiIrbistechAcceptanceSuiteCommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
};

export type AiIrbistechAcceptanceSuiteTaskResult = {
  taskId: AiIrbistechAcceptanceSuiteTaskId;
  sourceKey: AiIrbistechAcceptanceReportSourceKey;
  title: string;
  status: AiIrbistechAcceptanceSuiteTaskStatus;
  durationMs: number;
  exitCode: number | null;
  skipReason: string | null;
  error: string | null;
  artifactInputPath: string | null;
  artifactResolvedPath: string | null;
  artifactLoadError: string | null;
  stdoutPath: string | null;
  stderrPath: string | null;
  cwd: string;
  commandLine: string | null;
};

export type AiIrbistechAcceptanceSuiteSummary = {
  startedAt: string;
  finishedAt: string;
  runId: string;
  reportName: string;
  outputDir: string;
  artifactRootDir: string;
  requireReleaseReady: boolean;
  requireClean: boolean;
  prerequisites: {
    playwrightChromium: AiIrbistechAcceptanceSuitePrerequisiteStatus;
    uiQaCredentials: AiIrbistechAcceptanceSuitePrerequisiteStatus;
  };
  counts: Record<AiIrbistechAcceptanceSuiteTaskStatus, number>;
  tasks: AiIrbistechAcceptanceSuiteTaskResult[];
  report: {
    jsonPath: string;
    markdownPath: string;
    suiteJsonPath: string;
    suiteMarkdownPath: string;
    overallStatus: AiIrbistechAcceptanceReportSnapshot['overallStatus'];
    releaseReady: boolean;
    exitCode: number;
  };
  releaseReadiness: {
    jsonPath: string;
    markdownPath: string;
    overallStatus: AiIrbistechReleaseReadinessSnapshot['overallStatus'];
    releaseReady: boolean;
    exitCode: number;
  };
  taskFailureExitCode: number;
  exitCode: number;
  snapshot: AiIrbistechAcceptanceReportSnapshot;
  releaseReadinessSnapshot: AiIrbistechReleaseReadinessSnapshot;
};

export type AiIrbistechAcceptanceSuiteOptions = {
  roots?: Partial<AiIrbistechAcceptanceSuiteRoots>;
  cwd?: string;
  outputDir?: string;
  artifactRootDir?: string;
  reportName?: string;
  runId?: string;
  pythonExecutable?: string;
  aiIntegrationPythonExecutable?: string;
  aiSiteAnalyzerPythonExecutable?: string;
  npmExecutable?: string;
  libraryBaseUrl?: string | null;
  aiIntegrationBaseUrl?: string | null;
  aiSiteAnalyzerBaseUrl?: string | null;
  requirePostgresSqlTarget?: boolean;
  uiSmokeMode?: AiIrbistechAcceptanceSuiteTaskMode;
  uiQaMode?: AiIrbistechAcceptanceSuiteTaskMode;
  requireReleaseReady?: boolean;
  requireClean?: boolean;
  env?: NodeJS.ProcessEnv;
  playwrightChromiumStatus?: AiIrbistechAcceptanceSuitePrerequisiteStatus;
  commandRunner?: (command: AiIrbistechAcceptanceSuiteRunCommand) => Promise<AiIrbistechAcceptanceSuiteCommandResult>;
  now?: Date;
};

type SuiteTaskDefinition = {
  taskId: AiIrbistechAcceptanceSuiteTaskId;
  sourceKey: AiIrbistechAcceptanceReportSourceKey;
  title: string;
  artifactDirName: string;
  stateFileName: string;
  shouldSkip: (context: SuiteBuildContext) => string | null | Promise<string | null>;
  buildCommand: (context: SuiteBuildContext) => AiIrbistechAcceptanceSuiteRunCommand;
};

type SuiteBuildContext = {
  roots: AiIrbistechAcceptanceSuiteRoots;
  artifactRunRoot: string;
  stateRoot: string;
  pythonExecutable: string;
  aiIntegrationPythonExecutable: string;
  aiSiteAnalyzerPythonExecutable: string;
  npmExecutable: string;
  env: NodeJS.ProcessEnv;
  libraryBaseUrl: string | null;
  aiIntegrationBaseUrl: string | null;
  aiSiteAnalyzerBaseUrl: string | null;
  uiSmokeMode: AiIrbistechAcceptanceSuiteTaskMode;
  uiQaMode: AiIrbistechAcceptanceSuiteTaskMode;
  requirePostgresSqlTarget: boolean;
  playwrightChromiumStatus: AiIrbistechAcceptanceSuitePrerequisiteStatus;
  uiQaCredentialsStatus: AiIrbistechAcceptanceSuitePrerequisiteStatus;
};

const DEFAULT_OUTPUT_DIR = 'docs/ai-irbistech-acceptance-report';
const DEFAULT_ARTIFACT_ROOT_DIR = 'artifacts/ai-irbistech-acceptance-suite';
const DEFAULT_REPORT_NAME = 'latest';
const DEFAULT_UI_SMOKE_MODE: AiIrbistechAcceptanceSuiteTaskMode = 'auto';
const DEFAULT_UI_QA_MODE: AiIrbistechAcceptanceSuiteTaskMode = 'auto';

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function displayPath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return path.resolve(value).replace(/\\/g, '/');
}

function trimSlash(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().replace(/\/+$/g, '');
  return normalized || null;
}

function quoteCommandPart(value: string): string {
  return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function formatCommandLine(executable: string, args: string[]): string {
  return [executable, ...args].map(quoteCommandPart).join(' ');
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  return `${(durationMs / 1000).toFixed(2)} s`;
}

export function resolveUiQaCredentialsStatus(env: NodeJS.ProcessEnv): { ok: boolean; reason: string | null } {
  const login = (
    env.AI_ANALYSIS_UI_QA_LOGIN ??
    env.AI_ANALYSIS_UI_SMOKE_LOGIN ??
    ''
  ).trim();
  const password = (
    env.AI_ANALYSIS_UI_QA_PASSWORD ??
    env.AI_ANALYSIS_UI_SMOKE_PASSWORD ??
    ''
  ).trim();
  if (login && password) {
    return { ok: true, reason: null };
  }
  return {
    ok: false,
    reason: 'missing AI_ANALYSIS_UI_QA_LOGIN/PASSWORD or fallback AI_ANALYSIS_UI_SMOKE_LOGIN/PASSWORD',
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message || error.name;
  }
  return String(error);
}

export async function resolvePlaywrightChromiumStatus(): Promise<AiIrbistechAcceptanceSuitePrerequisiteStatus> {
  try {
    const playwright = await import('playwright');
    let browser: { close: () => Promise<void> } | null = null;
    try {
      browser = await playwright.chromium.launch({ headless: true });
      return {
        ok: true,
        reason: null,
      };
    } catch (error) {
      return {
        ok: false,
        reason: `Playwright Chromium is not available: ${normalizeErrorMessage(error)}`,
      };
    } finally {
      await browser?.close().catch(() => undefined);
    }
  } catch (error) {
    return {
      ok: false,
      reason: `playwright module is not available: ${normalizeErrorMessage(error)}`,
    };
  }
}

function resolveSuiteTaskMode(value: string | null | undefined, fallback: AiIrbistechAcceptanceSuiteTaskMode): AiIrbistechAcceptanceSuiteTaskMode {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'always' || normalized === 'auto' || normalized === 'never') {
    return normalized;
  }
  return fallback;
}

export function resolveAiIrbistechAcceptanceSuiteRoots(
  cwd = process.cwd(),
  overrides: Partial<AiIrbistechAcceptanceSuiteRoots> = {},
): AiIrbistechAcceptanceSuiteRoots {
  const resolvedCwd = path.resolve(cwd);
  const libraryRoot =
    overrides.libraryRoot ??
    (path.basename(resolvedCwd).toLowerCase() === 'library' ? resolvedCwd : path.resolve(__dirname, '..'));
  const workspaceRoot = overrides.workspaceRoot ?? path.resolve(libraryRoot, '..');

  return {
    workspaceRoot: path.resolve(workspaceRoot),
    libraryRoot: path.resolve(libraryRoot),
    aiIntegrationRoot: path.resolve(overrides.aiIntegrationRoot ?? path.join(workspaceRoot, 'ai-integration')),
    aiSiteAnalyzerRoot: path.resolve(overrides.aiSiteAnalyzerRoot ?? path.join(workspaceRoot, 'ai-site-analyzer')),
  };
}

export async function runAiIrbistechAcceptanceSuiteCommand(
  command: AiIrbistechAcceptanceSuiteRunCommand,
): Promise<AiIrbistechAcceptanceSuiteCommandResult> {
  return await new Promise<AiIrbistechAcceptanceSuiteCommandResult>((resolve) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: command.env,
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

const SUITE_TASK_DEFINITIONS: SuiteTaskDefinition[] = [
  {
    taskId: 'aiIntegrationSqlReadiness',
    sourceKey: 'aiIntegrationSqlReadiness',
    title: 'ai-integration: SQL readiness analysis_score',
    artifactDirName: 'ai-integration-sql-readiness',
    stateFileName: 'ai-integration-sql-readiness.json',
    shouldSkip: () => null,
    buildCommand: (context) => {
      const artifactDir = path.join(context.artifactRunRoot, 'ai-integration-sql-readiness');
      const stateFile = path.join(context.stateRoot, 'ai-integration-sql-readiness.json');
      const args = [
        '-m',
        'app.jobs.analysis_score_sql_readiness_check',
        '--json',
        '--artifact-path',
        artifactDir,
        '--state-file',
        stateFile,
      ];
      if (context.requirePostgresSqlTarget) {
        args.push('--require-postgres-target');
      }
      return {
        taskId: 'aiIntegrationSqlReadiness',
        title: 'ai-integration: SQL readiness analysis_score',
        executable: context.aiIntegrationPythonExecutable,
        args,
        cwd: context.roots.aiIntegrationRoot,
        env: context.env,
      };
    },
  },
  {
    taskId: 'aiIntegrationSyncHealth',
    sourceKey: 'aiIntegrationSyncHealth',
    title: 'ai-integration: health sync analysis_score',
    artifactDirName: 'ai-integration-sync-health',
    stateFileName: 'ai-integration-sync-health.json',
    shouldSkip: () => null,
    buildCommand: (context) => {
      const artifactDir = path.join(context.artifactRunRoot, 'ai-integration-sync-health');
      const stateFile = path.join(context.stateRoot, 'ai-integration-sync-health.json');
      const args = [
        '-m',
        'app.jobs.analysis_score_sync_healthcheck',
        '--json',
        '--artifact-path',
        artifactDir,
        '--state-file',
        stateFile,
      ];
      if (context.aiIntegrationBaseUrl) {
        args.push(
          '--url',
          `${context.aiIntegrationBaseUrl}/v1/equipment-selection/analysis-score-sync-health`,
        );
      }
      return {
        taskId: 'aiIntegrationSyncHealth',
        title: 'ai-integration: health sync analysis_score',
        executable: context.aiIntegrationPythonExecutable,
        args,
        cwd: context.roots.aiIntegrationRoot,
        env: context.env,
      };
    },
  },
  {
    taskId: 'aiIntegrationAcceptance',
    sourceKey: 'aiIntegrationAcceptance',
    title: 'ai-integration: acceptance проверки формулы',
    artifactDirName: 'ai-integration-acceptance',
    stateFileName: 'ai-integration-acceptance.json',
    shouldSkip: () => null,
    buildCommand: (context) => {
      const artifactDir = path.join(context.artifactRunRoot, 'ai-integration-acceptance');
      const stateFile = path.join(context.stateRoot, 'ai-integration-acceptance.json');
      const args = [
        '-m',
        'app.jobs.equipment_score_acceptance_check',
        '--json',
        '--artifact-path',
        artifactDir,
        '--state-file',
        stateFile,
      ];
      if (context.aiIntegrationBaseUrl) {
        args.push('--base-url', context.aiIntegrationBaseUrl);
      }
      return {
        taskId: 'aiIntegrationAcceptance',
        title: 'ai-integration: acceptance проверки формулы',
        executable: context.aiIntegrationPythonExecutable,
        args,
        cwd: context.roots.aiIntegrationRoot,
        env: context.env,
      };
    },
  },
  {
    taskId: 'libraryHealth',
    sourceKey: 'libraryHealth',
    title: 'library: /api/health',
    artifactDirName: 'library-health',
    stateFileName: 'library-health.json',
    shouldSkip: () => null,
    buildCommand: (context) => {
      const artifactDir = path.join(context.artifactRunRoot, 'library-health');
      const stateFile = path.join(context.stateRoot, 'library-health.json');
      const args = [
        'run',
        'healthcheck',
        '--',
        '--json',
        '--artifact-dir',
        artifactDir,
        '--state-file',
        stateFile,
      ];
      if (context.libraryBaseUrl) {
        args.push('--url', `${context.libraryBaseUrl}/api/health`);
      }
      return {
        taskId: 'libraryHealth',
        title: 'library: /api/health',
        executable: context.npmExecutable,
        args,
        cwd: context.roots.libraryRoot,
        env: context.env,
      };
    },
  },
  {
    taskId: 'libraryAcceptance',
    sourceKey: 'libraryAcceptance',
    title: 'library: acceptance trace healthcheck',
    artifactDirName: 'library-acceptance',
    stateFileName: 'library-acceptance.json',
    shouldSkip: () => null,
    buildCommand: (context) => {
      const artifactDir = path.join(context.artifactRunRoot, 'library-acceptance');
      const stateFile = path.join(context.stateRoot, 'library-acceptance.json');
      const args = [
        'run',
        'acceptance:healthcheck',
        '--',
        '--json',
        '--artifact-dir',
        artifactDir,
        '--state-file',
        stateFile,
      ];
      if (context.libraryBaseUrl) {
        args.push('--base-url', context.libraryBaseUrl);
      }
      return {
        taskId: 'libraryAcceptance',
        title: 'library: acceptance trace healthcheck',
        executable: context.npmExecutable,
        args,
        cwd: context.roots.libraryRoot,
        env: context.env,
      };
    },
  },
  {
    taskId: 'libraryUiSmoke',
    sourceKey: 'libraryUiSmoke',
    title: 'library: AI Analysis UI smoke',
    artifactDirName: 'library-ui-smoke',
    stateFileName: 'library-ui-smoke.json',
    shouldSkip: (context) => {
      if (context.uiSmokeMode === 'never') {
        return 'ui smoke disabled by mode=never';
      }
      if (context.uiSmokeMode === 'auto' && !context.playwrightChromiumStatus.ok) {
        return context.playwrightChromiumStatus.reason ?? 'Playwright Chromium is not available';
      }
      return null;
    },
    buildCommand: (context) => {
      const artifactDir = path.join(context.artifactRunRoot, 'library-ui-smoke');
      const stateFile = path.join(context.stateRoot, 'library-ui-smoke.json');
      const args = [
        'run',
        'ui:smoke:healthcheck',
        '--',
        '--json',
        '--artifact-dir',
        artifactDir,
        '--state-file',
        stateFile,
      ];
      if (context.libraryBaseUrl) {
        args.push('--base-url', context.libraryBaseUrl);
      }
      return {
        taskId: 'libraryUiSmoke',
        title: 'library: AI Analysis UI smoke',
        executable: context.npmExecutable,
        args,
        cwd: context.roots.libraryRoot,
        env: context.env,
      };
    },
  },
  {
    taskId: 'libraryUiQa',
    sourceKey: 'libraryUiQa',
    title: 'library: AI Analysis UI QA',
    artifactDirName: 'library-ui-qa',
    stateFileName: 'library-ui-qa.json',
    shouldSkip: (context) => {
      if (context.uiQaMode === 'never') {
        return 'ui qa disabled by mode=never';
      }
      if (context.uiQaMode === 'auto') {
        if (!context.playwrightChromiumStatus.ok) {
          return context.playwrightChromiumStatus.reason ?? 'Playwright Chromium is not available';
        }
        return context.uiQaCredentialsStatus.reason;
      }
      return null;
    },
    buildCommand: (context) => {
      const artifactDir = path.join(context.artifactRunRoot, 'library-ui-qa');
      const stateFile = path.join(context.stateRoot, 'library-ui-qa.json');
      const args = [
        'run',
        'ui:qa:healthcheck',
        '--',
        '--json',
        '--artifact-dir',
        artifactDir,
        '--state-file',
        stateFile,
      ];
      if (context.libraryBaseUrl) {
        args.push('--base-url', context.libraryBaseUrl);
      }
      return {
        taskId: 'libraryUiQa',
        title: 'library: AI Analysis UI QA',
        executable: context.npmExecutable,
        args,
        cwd: context.roots.libraryRoot,
        env: context.env,
      };
    },
  },
  {
    taskId: 'aiSiteAnalyzerHealth',
    sourceKey: 'aiSiteAnalyzerHealth',
    title: 'ai-site-analyzer: system health',
    artifactDirName: 'ai-site-analyzer-health',
    stateFileName: 'ai-site-analyzer-health.json',
    shouldSkip: (context) => {
      if (fs.existsSync(context.roots.aiSiteAnalyzerRoot)) {
        return null;
      }
      return context.aiSiteAnalyzerBaseUrl
        ? null
        : 'ai-site-analyzer root is missing and ai-site-analyzer base URL is not configured';
    },
    buildCommand: (context) => {
      const artifactDir = path.join(context.artifactRunRoot, 'ai-site-analyzer-health');
      const stateFile = path.join(context.stateRoot, 'ai-site-analyzer-health.json');
      if (!fs.existsSync(context.roots.aiSiteAnalyzerRoot)) {
        const args = [
          'run',
          'ai-site-analyzer:remote-healthcheck',
          '--',
          '--json',
          '--artifact-dir',
          artifactDir,
          '--state-file',
          stateFile,
        ];
        if (context.aiSiteAnalyzerBaseUrl) {
          args.push('--base-url', context.aiSiteAnalyzerBaseUrl);
        }
        return {
          taskId: 'aiSiteAnalyzerHealth',
          title: 'ai-site-analyzer: system health',
          executable: context.npmExecutable,
          args,
          cwd: context.roots.libraryRoot,
          env: context.env,
        };
      }

      const args = [
        '-m',
        'app.jobs.system_healthcheck',
        '--json',
        '--artifact-dir',
        artifactDir,
        '--state-file',
        stateFile,
      ];
      if (context.aiSiteAnalyzerBaseUrl) {
        args.push('--base-url', context.aiSiteAnalyzerBaseUrl);
      }
      return {
        taskId: 'aiSiteAnalyzerHealth',
        title: 'ai-site-analyzer: system health',
        executable: context.aiSiteAnalyzerPythonExecutable,
        args,
        cwd: context.roots.aiSiteAnalyzerRoot,
        env: context.env,
      };
    },
  },
];

function ensureDirectory(value: string): void {
  fs.mkdirSync(value, { recursive: true });
}

function writeLogFile(filePath: string, content: string): string | null {
  if (!content) {
    return null;
  }
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function buildSuiteContext(options: AiIrbistechAcceptanceSuiteOptions): {
  context: SuiteBuildContext;
  outputDir: string;
  artifactRootDir: string;
  runId: string;
  reportName: string;
} {
  const roots = resolveAiIrbistechAcceptanceSuiteRoots(options.cwd, options.roots);
  const reportName = sanitizeSegment(options.reportName ?? DEFAULT_REPORT_NAME) || DEFAULT_REPORT_NAME;
  const runId =
    sanitizeSegment(options.runId ?? nowIso(options.now).replace(/[:.]/g, '-')) ||
    sanitizeSegment(nowIso(options.now).replace(/[:.]/g, '-')) ||
    'run';
  const artifactRootDir = path.resolve(
    roots.libraryRoot,
    options.artifactRootDir ?? DEFAULT_ARTIFACT_ROOT_DIR,
  );
  const artifactRunRoot = path.join(artifactRootDir, runId);
  const stateRoot = path.join(artifactRunRoot, 'state');

  ensureDirectory(artifactRunRoot);
  ensureDirectory(stateRoot);

  return {
    context: {
      roots,
      artifactRunRoot,
      stateRoot,
      pythonExecutable: options.pythonExecutable ?? 'python',
      aiIntegrationPythonExecutable:
        options.aiIntegrationPythonExecutable ?? options.pythonExecutable ?? 'python',
      aiSiteAnalyzerPythonExecutable:
        options.aiSiteAnalyzerPythonExecutable ?? options.pythonExecutable ?? 'python',
      npmExecutable:
        options.npmExecutable ?? (process.platform === 'win32' ? 'npm.cmd' : 'npm'),
      env: options.env ?? process.env,
      libraryBaseUrl: trimSlash(options.libraryBaseUrl),
      aiIntegrationBaseUrl: trimSlash(options.aiIntegrationBaseUrl),
      aiSiteAnalyzerBaseUrl: trimSlash(options.aiSiteAnalyzerBaseUrl),
      uiSmokeMode: options.uiSmokeMode ?? DEFAULT_UI_SMOKE_MODE,
      uiQaMode: options.uiQaMode ?? DEFAULT_UI_QA_MODE,
      requirePostgresSqlTarget: options.requirePostgresSqlTarget ?? false,
      playwrightChromiumStatus: options.playwrightChromiumStatus ?? {
        ok: false,
        reason: 'playwright preflight was not evaluated',
      },
      uiQaCredentialsStatus: resolveUiQaCredentialsStatus(options.env ?? process.env),
    },
    outputDir: path.resolve(roots.libraryRoot, options.outputDir ?? DEFAULT_OUTPUT_DIR),
    artifactRootDir,
    runId,
    reportName,
  };
}

function loadReportSources(
  tasks: AiIrbistechAcceptanceSuiteTaskResult[],
  cwd: string,
): AiIrbistechAcceptanceReportSources {
  const sources: AiIrbistechAcceptanceReportSources = {};

  for (const task of tasks) {
    if (!task.artifactInputPath || !fs.existsSync(task.artifactInputPath)) {
      continue;
    }
    try {
      const source = loadAiIrbistechAcceptanceReportSource(task.artifactInputPath, cwd);
      sources[task.sourceKey] = source;
      task.artifactResolvedPath = source.inputPath ?? null;
    } catch (error) {
      task.artifactLoadError = error instanceof Error ? error.message : String(error);
    }
  }

  return sources;
}

function envLine(key: string, value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim();
  if (!normalized) {
    return null;
  }
  return `${key}=${normalized.replace(/\\/g, '/')}`;
}

function writeEnvFile(filePath: string, lines: Array<string | null>): string {
  ensureDirectory(path.dirname(filePath));
  const content = lines.filter((line): line is string => Boolean(line)).join('\n');
  fs.writeFileSync(filePath, content ? `${content}\n` : '', 'utf8');
  return filePath;
}

function findTaskArtifactPath(
  tasks: AiIrbistechAcceptanceSuiteTaskResult[],
  taskId: AiIrbistechAcceptanceSuiteTaskId,
): string {
  const task = tasks.find((item) => item.taskId === taskId);
  if (!task?.artifactInputPath) {
    throw new Error(`artifact input path is missing for suite task ${taskId}`);
  }
  return task.artifactResolvedPath ?? task.artifactInputPath;
}

function buildSyntheticReleaseReadinessEnvFiles(
  context: SuiteBuildContext,
  tasks: AiIrbistechAcceptanceSuiteTaskResult[],
): {
  aiIntegrationEnvFile: string;
  libraryEnvFile: string;
  aiSiteAnalyzerEnvFile: string;
} {
  const envRoot = path.join(context.artifactRunRoot, 'release-readiness-env');
  ensureDirectory(envRoot);

  const aiIntegrationEnvFile = writeEnvFile(path.join(envRoot, 'ai-integration.env'), [
    envLine('ANALYSIS_SCORE_SYNC_ARTIFACT_PATH', findTaskArtifactPath(tasks, 'aiIntegrationSyncHealth')),
    envLine('ANALYSIS_SCORE_SQL_READINESS_ARTIFACT_PATH', findTaskArtifactPath(tasks, 'aiIntegrationSqlReadiness')),
    envLine('EQUIPMENT_SCORE_ACCEPTANCE_ARTIFACT_PATH', findTaskArtifactPath(tasks, 'aiIntegrationAcceptance')),
    envLine('ANALYSIS_SCORE_SYNC_ALERT_WEBHOOK_URL', context.env.ANALYSIS_SCORE_SYNC_ALERT_WEBHOOK_URL ?? null),
    envLine('ANALYSIS_SCORE_SQL_READINESS_ALERT_WEBHOOK_URL', context.env.ANALYSIS_SCORE_SQL_READINESS_ALERT_WEBHOOK_URL ?? null),
    envLine('EQUIPMENT_SCORE_ACCEPTANCE_ALERT_WEBHOOK_URL', context.env.EQUIPMENT_SCORE_ACCEPTANCE_ALERT_WEBHOOK_URL ?? null),
  ]);

  const libraryEnvFile = writeEnvFile(path.join(envRoot, 'library.env'), [
    envLine('LIBRARY_SYSTEM_HEALTH_ARTIFACT_DIR', findTaskArtifactPath(tasks, 'libraryHealth')),
    envLine('AI_ANALYSIS_ACCEPTANCE_HEALTH_ARTIFACT_DIR', findTaskArtifactPath(tasks, 'libraryAcceptance')),
    envLine('AI_ANALYSIS_UI_SMOKE_HEALTH_ARTIFACT_DIR', findTaskArtifactPath(tasks, 'libraryUiSmoke')),
    envLine('AI_ANALYSIS_UI_QA_HEALTH_ARTIFACT_DIR', findTaskArtifactPath(tasks, 'libraryUiQa')),
    envLine('LIBRARY_SYSTEM_HEALTH_ALERT_WEBHOOK_URL', context.env.LIBRARY_SYSTEM_HEALTH_ALERT_WEBHOOK_URL ?? null),
    envLine('AI_ANALYSIS_ACCEPTANCE_HEALTH_ALERT_WEBHOOK_URL', context.env.AI_ANALYSIS_ACCEPTANCE_HEALTH_ALERT_WEBHOOK_URL ?? null),
    envLine('AI_ANALYSIS_UI_SMOKE_HEALTH_ALERT_WEBHOOK_URL', context.env.AI_ANALYSIS_UI_SMOKE_HEALTH_ALERT_WEBHOOK_URL ?? null),
    envLine('AI_ANALYSIS_UI_QA_HEALTH_ALERT_WEBHOOK_URL', context.env.AI_ANALYSIS_UI_QA_HEALTH_ALERT_WEBHOOK_URL ?? null),
    envLine('AI_ANALYSIS_UI_QA_LOGIN', context.env.AI_ANALYSIS_UI_QA_LOGIN ?? null),
    envLine('AI_ANALYSIS_UI_QA_PASSWORD', context.env.AI_ANALYSIS_UI_QA_PASSWORD ?? null),
    envLine('AI_ANALYSIS_UI_SMOKE_LOGIN', context.env.AI_ANALYSIS_UI_SMOKE_LOGIN ?? null),
    envLine('AI_ANALYSIS_UI_SMOKE_PASSWORD', context.env.AI_ANALYSIS_UI_SMOKE_PASSWORD ?? null),
  ]);

  const aiSiteAnalyzerEnvFile = writeEnvFile(path.join(envRoot, 'ai-site-analyzer.env'), [
    envLine('AI_SITE_ANALYZER_HEALTHCHECK_ARTIFACT_DIR', findTaskArtifactPath(tasks, 'aiSiteAnalyzerHealth')),
    envLine('AI_SITE_ANALYZER_HEALTHCHECK_ALERT_WEBHOOK_URL', context.env.AI_SITE_ANALYZER_HEALTHCHECK_ALERT_WEBHOOK_URL ?? null),
    envLine('OPENAI_ADMIN_KEY', context.env.OPENAI_ADMIN_KEY ?? null),
  ]);

  return {
    aiIntegrationEnvFile,
    libraryEnvFile,
    aiSiteAnalyzerEnvFile,
  };
}

function resolveSuiteReleaseReadinessRequirement(
  mode: AiIrbistechAcceptanceSuiteTaskMode,
  autoRequirement: boolean,
): boolean {
  if (mode === 'always') {
    return true;
  }
  if (mode === 'never') {
    return false;
  }
  return autoRequirement;
}

export function renderAiIrbistechAcceptanceSuiteMarkdown(summary: AiIrbistechAcceptanceSuiteSummary): string {
  const lines: string[] = [];

  lines.push('# AI IRBISTECH 1.1 Acceptance Suite');
  lines.push('');
  lines.push(`- started at: \`${summary.startedAt}\``);
  lines.push(`- finished at: \`${summary.finishedAt}\``);
  lines.push(`- run id: \`${summary.runId}\``);
  lines.push(`- task counts: passed=\`${summary.counts.passed}\`, failed=\`${summary.counts.failed}\`, skipped=\`${summary.counts.skipped}\``);
  lines.push(`- report status: \`${summary.report.overallStatus}\``);
  lines.push(`- release ready: \`${summary.report.releaseReady}\``);
  lines.push(`- release-readiness status: \`${summary.releaseReadiness.overallStatus}\``);
  lines.push(`- release-readiness ready: \`${summary.releaseReadiness.releaseReady}\``);
  lines.push(`- suite exit code: \`${summary.exitCode}\``);
  lines.push('');
  lines.push('## Prerequisites');
  lines.push('');
  lines.push(
    `- Playwright Chromium: \`${summary.prerequisites.playwrightChromium.ok ? 'ok' : 'missing'}\`${summary.prerequisites.playwrightChromium.reason ? ` — ${summary.prerequisites.playwrightChromium.reason}` : ''}`,
  );
  lines.push(
    `- UI QA credentials: \`${summary.prerequisites.uiQaCredentials.ok ? 'configured' : 'missing'}\`${summary.prerequisites.uiQaCredentials.reason ? ` — ${summary.prerequisites.uiQaCredentials.reason}` : ''}`,
  );
  lines.push('');
  lines.push('## Tasks');
  lines.push('');

  for (const task of summary.tasks) {
    lines.push(`### ${task.title}`);
    lines.push(`- status: \`${task.status}\``);
    lines.push(`- duration: \`${formatDurationMs(task.durationMs)}\``);
    if (task.commandLine) {
      lines.push(`- command: \`${task.commandLine}\``);
    }
    lines.push(`- cwd: \`${displayPath(task.cwd) ?? task.cwd}\``);
    if (task.exitCode !== null) {
      lines.push(`- exit code: \`${task.exitCode}\``);
    }
    if (task.skipReason) {
      lines.push(`- skip reason: ${task.skipReason}`);
    }
    if (task.error) {
      lines.push(`- error: ${task.error}`);
    }
    if (task.artifactInputPath) {
      lines.push(`- artifact input: \`${displayPath(task.artifactInputPath) ?? task.artifactInputPath}\``);
    }
    if (task.artifactResolvedPath) {
      lines.push(`- artifact resolved: \`${displayPath(task.artifactResolvedPath) ?? task.artifactResolvedPath}\``);
    }
    if (task.artifactLoadError) {
      lines.push(`- artifact load error: ${task.artifactLoadError}`);
    }
    if (task.stdoutPath) {
      lines.push(`- stdout log: \`${displayPath(task.stdoutPath) ?? task.stdoutPath}\``);
    }
    if (task.stderrPath) {
      lines.push(`- stderr log: \`${displayPath(task.stderrPath) ?? task.stderrPath}\``);
    }
    lines.push('');
  }

  lines.push('## Report Files');
  lines.push('');
  lines.push(`- markdown: \`${displayPath(summary.report.markdownPath) ?? summary.report.markdownPath}\``);
  lines.push(`- json: \`${displayPath(summary.report.jsonPath) ?? summary.report.jsonPath}\``);
  lines.push(`- suite markdown: \`${displayPath(summary.report.suiteMarkdownPath) ?? summary.report.suiteMarkdownPath}\``);
  lines.push(`- suite json: \`${displayPath(summary.report.suiteJsonPath) ?? summary.report.suiteJsonPath}\``);
  lines.push('');
  lines.push('## Release Readiness');
  lines.push('');
  lines.push(`- status: \`${summary.releaseReadiness.overallStatus}\``);
  lines.push(`- release ready: \`${summary.releaseReadiness.releaseReady}\``);
  lines.push(`- exit code: \`${summary.releaseReadiness.exitCode}\``);
  lines.push(`- markdown: \`${displayPath(summary.releaseReadiness.markdownPath) ?? summary.releaseReadiness.markdownPath}\``);
  lines.push(`- json: \`${displayPath(summary.releaseReadiness.jsonPath) ?? summary.releaseReadiness.jsonPath}\``);
  lines.push('');

  return `${lines.join('\n').trimEnd()}\n`;
}

export async function runAiIrbistechAcceptanceSuite(
  options: AiIrbistechAcceptanceSuiteOptions = {},
): Promise<AiIrbistechAcceptanceSuiteSummary> {
  const startedAt = nowIso(options.now);
  const {
    context,
    outputDir,
    artifactRootDir,
    runId,
    reportName,
  } = buildSuiteContext(options);
  const requireReleaseReady = options.requireReleaseReady ?? true;
  const requireClean = options.requireClean ?? false;
  const runner = options.commandRunner ?? runAiIrbistechAcceptanceSuiteCommand;
  const tasks: AiIrbistechAcceptanceSuiteTaskResult[] = [];
  const logRoot = path.join(context.artifactRunRoot, 'logs');
  const shouldCheckPlaywright =
    context.uiSmokeMode !== 'never' || context.uiQaMode !== 'never';
  const playwrightChromiumStatus =
    options.playwrightChromiumStatus ??
    (shouldCheckPlaywright
      ? await resolvePlaywrightChromiumStatus()
      : {
          ok: false,
          reason: 'playwright checks disabled because browser tasks are set to never',
        });
  context.playwrightChromiumStatus = playwrightChromiumStatus;
  context.uiQaCredentialsStatus = resolveUiQaCredentialsStatus(context.env);

  ensureDirectory(outputDir);
  ensureDirectory(logRoot);

  for (const definition of SUITE_TASK_DEFINITIONS) {
    const skipReason = await definition.shouldSkip(context);
    const artifactInputPath = path.join(context.artifactRunRoot, definition.artifactDirName);
    if (skipReason) {
      tasks.push({
        taskId: definition.taskId,
        sourceKey: definition.sourceKey,
        title: definition.title,
        status: 'skipped',
        durationMs: 0,
        exitCode: null,
        skipReason,
        error: null,
        artifactInputPath,
        artifactResolvedPath: null,
        artifactLoadError: null,
        stdoutPath: null,
        stderrPath: null,
        cwd:
          definition.taskId.startsWith('aiIntegration')
            ? context.roots.aiIntegrationRoot
            : definition.taskId.startsWith('aiSiteAnalyzer')
              ? context.roots.aiSiteAnalyzerRoot
              : context.roots.libraryRoot,
        commandLine: null,
      });
      continue;
    }

    const command = definition.buildCommand(context);
    const commandLine = formatCommandLine(command.executable, command.args);
    const taskStartedAt = Date.now();
    const result = await runner(command);
    const durationMs = Date.now() - taskStartedAt;

    const stdoutPath = writeLogFile(path.join(logRoot, `${definition.taskId}.stdout.log`), result.stdout);
    const stderrPath = writeLogFile(path.join(logRoot, `${definition.taskId}.stderr.log`), result.stderr);
    const failed = result.exitCode !== 0 || result.error !== null;

    tasks.push({
      taskId: definition.taskId,
      sourceKey: definition.sourceKey,
      title: definition.title,
      status: failed ? 'failed' : 'passed',
      durationMs,
      exitCode: result.exitCode,
      skipReason: null,
      error: result.error,
      artifactInputPath,
      artifactResolvedPath: null,
      artifactLoadError: null,
      stdoutPath,
      stderrPath,
      cwd: command.cwd,
      commandLine,
    });
  }

  const sources = loadReportSources(tasks, context.roots.libraryRoot);
  const snapshot = buildAiIrbistechAcceptanceReportSnapshot(sources, {
    generatedAt: nowIso(options.now),
  });
  const reportMarkdown = renderAiIrbistechAcceptanceReportMarkdown(snapshot);
  const reportExitCode = resolveAiIrbistechAcceptanceReportExitCode(snapshot, {
    requireReleaseReady,
    requireClean,
  });
  const releaseReadinessEnvFiles = buildSyntheticReleaseReadinessEnvFiles(context, tasks);
  const releaseReadinessSnapshot = await buildAiIrbistechReleaseReadinessSnapshot({
    cwd: context.roots.libraryRoot,
    generatedAt: nowIso(options.now),
    aiIntegrationEnvFile: releaseReadinessEnvFiles.aiIntegrationEnvFile,
    libraryEnvFile: releaseReadinessEnvFiles.libraryEnvFile,
    aiSiteAnalyzerEnvFile: releaseReadinessEnvFiles.aiSiteAnalyzerEnvFile,
    libraryUiSmokeRequired: resolveSuiteReleaseReadinessRequirement(
      context.uiSmokeMode,
      context.playwrightChromiumStatus.ok,
    ),
    libraryUiQaRequired: resolveSuiteReleaseReadinessRequirement(
      context.uiQaMode,
      context.playwrightChromiumStatus.ok && context.uiQaCredentialsStatus.ok,
    ),
    useSystemctl: false,
    playwrightChromiumStatus: context.playwrightChromiumStatus,
  });
  const releaseReadinessMarkdown = renderAiIrbistechReleaseReadinessMarkdown(releaseReadinessSnapshot);
  const releaseReadinessExitCode = resolveAiIrbistechReleaseReadinessExitCode(releaseReadinessSnapshot, {
    requireReady: requireReleaseReady,
    requireClean,
  });
  const taskFailureExitCode = tasks.some((task) => task.status === 'failed') ? 1 : 0;
  const exitCode = Math.max(taskFailureExitCode, reportExitCode, releaseReadinessExitCode);
  const finishedAt = nowIso(options.now);

  const reportJsonPath = path.join(outputDir, `${reportName}.json`);
  const reportMarkdownPath = path.join(outputDir, `${reportName}.md`);
  const suiteJsonPath = path.join(outputDir, `${reportName}.suite.json`);
  const suiteMarkdownPath = path.join(outputDir, `${reportName}.suite.md`);
  const releaseReadinessJsonPath = path.join(outputDir, `${reportName}.release-readiness.json`);
  const releaseReadinessMarkdownPath = path.join(outputDir, `${reportName}.release-readiness.md`);

  fs.writeFileSync(reportJsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  fs.writeFileSync(reportMarkdownPath, reportMarkdown, 'utf8');
  fs.writeFileSync(releaseReadinessJsonPath, `${JSON.stringify(releaseReadinessSnapshot, null, 2)}\n`, 'utf8');
  fs.writeFileSync(releaseReadinessMarkdownPath, releaseReadinessMarkdown, 'utf8');

  const counts: Record<AiIrbistechAcceptanceSuiteTaskStatus, number> = {
    passed: tasks.filter((task) => task.status === 'passed').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    skipped: tasks.filter((task) => task.status === 'skipped').length,
  };

  const summary: AiIrbistechAcceptanceSuiteSummary = {
    startedAt,
    finishedAt,
    runId,
    reportName,
    outputDir,
    artifactRootDir,
    requireReleaseReady,
    requireClean,
    prerequisites: {
      playwrightChromium: context.playwrightChromiumStatus,
      uiQaCredentials: context.uiQaCredentialsStatus,
    },
    counts,
    tasks,
    report: {
      jsonPath: reportJsonPath,
      markdownPath: reportMarkdownPath,
      suiteJsonPath,
      suiteMarkdownPath,
      overallStatus: snapshot.overallStatus,
      releaseReady: snapshot.releaseReady,
      exitCode: reportExitCode,
    },
    releaseReadiness: {
      jsonPath: releaseReadinessJsonPath,
      markdownPath: releaseReadinessMarkdownPath,
      overallStatus: releaseReadinessSnapshot.overallStatus,
      releaseReady: releaseReadinessSnapshot.releaseReady,
      exitCode: releaseReadinessExitCode,
    },
    taskFailureExitCode,
    exitCode,
    snapshot,
    releaseReadinessSnapshot,
  };

  fs.writeFileSync(suiteJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(suiteMarkdownPath, renderAiIrbistechAcceptanceSuiteMarkdown(summary), 'utf8');

  return summary;
}

import path from 'node:path';
import process from 'node:process';

import {
  runAiIrbistechAcceptanceSuite,
  type AiIrbistechAcceptanceSuiteTaskMode,
} from '../lib/ai-irbistech-acceptance-suite';

const DEFAULT_OUTPUT_DIR = 'docs/ai-irbistech-acceptance-report';
const DEFAULT_ARTIFACT_ROOT_DIR = 'artifacts/ai-irbistech-acceptance-suite';
const DEFAULT_REPORT_NAME = 'latest';

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  return value && !value.startsWith('-') ? value : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function normalizeMode(
  value: string | undefined,
  fallback: AiIrbistechAcceptanceSuiteTaskMode,
): AiIrbistechAcceptanceSuiteTaskMode {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'always' || normalized === 'auto' || normalized === 'never') {
    return normalized;
  }
  return fallback;
}

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

function printHelp(): void {
  console.log(`Run the local AI IRBISTECH 1.1 smoke/acceptance suite and assemble one final report.

Examples:
  npm run acceptance:suite
  npm run acceptance:suite -- --library-base-url https://ai.irbistech.com --ai-integration-base-url https://api.irbistech.com --ai-site-analyzer-base-url https://site-analyzer.irbistech.com
  npm run acceptance:suite -- --ui-qa-mode never --no-require-release-ready

Options:
  --output-dir <path>              Directory for report JSON/markdown. Defaults to ${DEFAULT_OUTPUT_DIR}
  --artifact-root-dir <path>       Directory for per-run artifacts/logs. Defaults to ${DEFAULT_ARTIFACT_ROOT_DIR}
  --name <value>                   Output file prefix. Defaults to ${DEFAULT_REPORT_NAME}
  --run-id <value>                 Optional suite run id. Defaults to a sanitized UTC timestamp.
  --python <path>                  Fallback Python executable for Python jobs.
  --ai-integration-python <path>   Python executable for ai-integration jobs.
  --ai-site-analyzer-python <path> Python executable for local ai-site-analyzer jobs.
  --npm <path>                     npm executable for library jobs.
  --workspace-root <path>          Workspace root for split deployments.
  --library-root <path>            Library root. Defaults to the current package root.
  --ai-integration-root <path>     ai-integration root. Useful when it is outside the library parent dir.
  --ai-site-analyzer-root <path>   ai-site-analyzer root. If missing and base URL is set, suite uses remote HTTP healthcheck.
  --library-base-url <url>         Base URL for library acceptance and UI checks.
  --ai-integration-base-url <url>  Base URL for ai-integration health/acceptance jobs.
  --ai-site-analyzer-base-url <url> Base URL for ai-site-analyzer health job.
  --require-postgres-sql-target    Require postgres target inside ai-integration SQL readiness check.
  --no-require-postgres-sql-target Keep postgres target optional inside ai-integration SQL readiness check.
  --ui-smoke-mode <always|auto|never> Control browser smoke execution. Defaults to auto.
  --ui-qa-mode <always|auto|never> Control browser QA execution. Defaults to auto.
  --require-release-ready          Exit with code 1 when the final report is not release-ready. Enabled by default.
  --no-require-release-ready       Allow incomplete/not-ready report without failing on report status.
  --require-clean                  Exit with code 1 unless the final report status is exactly ready.
  --json                           Print the full suite summary JSON.
  --help                           Show this help.

The suite always continues after individual task failures so the consolidated report can still be built.
Browser auto-mode skips execution when Playwright Chromium is unavailable.
UI QA auto-mode also skips execution when worker credentials are absent.
The suite also writes an auxiliary release-readiness markdown/json report from the freshly collected suite artifacts.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help')) {
    printHelp();
    return;
  }

  const requireReleaseReady = hasFlag(args, '--no-require-release-ready')
    ? false
    : hasFlag(args, '--require-release-ready')
      ? true
      : envBool('AI_IRBISTECH_ACCEPTANCE_SUITE_REQUIRE_RELEASE_READY', true);
  const requireClean = hasFlag(args, '--require-clean') || envBool('AI_IRBISTECH_ACCEPTANCE_SUITE_REQUIRE_CLEAN', false);
  const requirePostgresSqlTarget = hasFlag(args, '--no-require-postgres-sql-target')
    ? false
    : hasFlag(args, '--require-postgres-sql-target')
      ? true
      : envBool('AI_IRBISTECH_ACCEPTANCE_SUITE_REQUIRE_POSTGRES_SQL_TARGET', false);
  const shouldPrintJson = hasFlag(args, '--json') || envBool('AI_IRBISTECH_ACCEPTANCE_SUITE_JSON', false);
  const uiSmokeMode = normalizeMode(
    readOption(args, '--ui-smoke-mode') ?? process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_UI_SMOKE_MODE,
    'auto',
  );
  const uiQaMode = normalizeMode(
    readOption(args, '--ui-qa-mode') ?? process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_UI_QA_MODE,
    'auto',
  );

  const summary = await runAiIrbistechAcceptanceSuite({
    cwd: process.cwd(),
    outputDir:
      readOption(args, '--output-dir') ??
      process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_OUTPUT_DIR ??
      DEFAULT_OUTPUT_DIR,
    artifactRootDir:
      readOption(args, '--artifact-root-dir') ??
      process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_ARTIFACT_ROOT_DIR ??
      DEFAULT_ARTIFACT_ROOT_DIR,
    reportName:
      readOption(args, '--name') ??
      process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_REPORT_NAME ??
      DEFAULT_REPORT_NAME,
    runId:
      readOption(args, '--run-id') ??
      process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_RUN_ID,
    pythonExecutable:
      readOption(args, '--python') ??
      process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_PYTHON_BIN,
    aiIntegrationPythonExecutable:
      readOption(args, '--ai-integration-python') ??
      process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_AI_INTEGRATION_PYTHON_BIN,
    aiSiteAnalyzerPythonExecutable:
      readOption(args, '--ai-site-analyzer-python') ??
      process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_AI_SITE_ANALYZER_PYTHON_BIN,
    npmExecutable:
      readOption(args, '--npm') ??
      process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_NPM_BIN,
    roots: {
      workspaceRoot:
        readOption(args, '--workspace-root') ??
        process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_WORKSPACE_ROOT,
      libraryRoot:
        readOption(args, '--library-root') ??
        process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_LIBRARY_ROOT,
      aiIntegrationRoot:
        readOption(args, '--ai-integration-root') ??
        process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_AI_INTEGRATION_ROOT,
      aiSiteAnalyzerRoot:
        readOption(args, '--ai-site-analyzer-root') ??
        process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_AI_SITE_ANALYZER_ROOT,
    },
    libraryBaseUrl:
      readOption(args, '--library-base-url') ??
      process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_LIBRARY_BASE_URL ??
      null,
    aiIntegrationBaseUrl:
      readOption(args, '--ai-integration-base-url') ??
      process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_AI_INTEGRATION_BASE_URL ??
      null,
    aiSiteAnalyzerBaseUrl:
      readOption(args, '--ai-site-analyzer-base-url') ??
      process.env.AI_IRBISTECH_ACCEPTANCE_SUITE_AI_SITE_ANALYZER_BASE_URL ??
      null,
    requirePostgresSqlTarget,
    uiSmokeMode,
    uiQaMode,
    requireReleaseReady,
    requireClean,
  });

  if (shouldPrintJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      [
        `suite run=${summary.runId}`,
        `tasks=${summary.counts.passed} passed/${summary.counts.failed} failed/${summary.counts.skipped} skipped`,
        `report=${summary.report.overallStatus}`,
        `release_ready=${summary.report.releaseReady}`,
        `release_readiness=${summary.releaseReadiness.overallStatus}`,
        `release_readiness_ready=${summary.releaseReadiness.releaseReady}`,
        `exit_code=${summary.exitCode}`,
      ].join(' | '),
    );
    console.log(`report markdown: ${path.resolve(summary.report.markdownPath)}`);
    console.log(`report json: ${path.resolve(summary.report.jsonPath)}`);
    console.log(`release-readiness markdown: ${path.resolve(summary.releaseReadiness.markdownPath)}`);
    console.log(`release-readiness json: ${path.resolve(summary.releaseReadiness.jsonPath)}`);
    console.log(`suite markdown: ${path.resolve(summary.report.suiteMarkdownPath)}`);
    console.log(`suite json: ${path.resolve(summary.report.suiteJsonPath)}`);
    console.log(
      `playwright=${summary.prerequisites.playwrightChromium.ok ? 'available' : 'missing'}; ui_qa_credentials=${summary.prerequisites.uiQaCredentials.ok ? 'configured' : 'missing'}`,
    );
    if (summary.counts.skipped > 0) {
      console.log(`ui smoke mode=${uiSmokeMode}; ui qa mode=${uiQaMode}`);
    }
  }

  process.exit(summary.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

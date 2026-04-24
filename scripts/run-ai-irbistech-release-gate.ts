import path from 'node:path';
import process from 'node:process';

import {
  runAiIrbistechReleaseGate,
} from '../lib/ai-irbistech-release-gate';
import type { AiIrbistechAcceptanceSuiteTaskMode } from '../lib/ai-irbistech-acceptance-suite';

const DEFAULT_OUTPUT_DIR = 'docs/ai-irbistech-release-gate';
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
  console.log(`Run the full AI IRBISTECH 1.1 release gate: acceptance suite plus live release-readiness audit.

Examples:
  npm run release:gate
  npm run release:gate -- --library-base-url https://ai.irbistech.com --ai-integration-base-url https://api.irbistech.com --ai-site-analyzer-base-url https://site-analyzer.irbistech.com
  npm run release:gate -- --ui-qa-mode never --skip-live-readiness --no-require-ready

Options:
  --output-dir <path>              Directory for gate JSON/markdown. Defaults to ${DEFAULT_OUTPUT_DIR}
  --suite-output-dir <path>        Directory for nested acceptance-suite reports.
  --suite-artifact-root-dir <path> Directory for acceptance-suite per-run artifacts/logs.
  --name <value>                   Output file prefix. Defaults to ${DEFAULT_REPORT_NAME}
  --run-id <value>                 Optional shared run id passed into acceptance suite.
  --python <path>                  Python executable for ai-integration and ai-site-analyzer jobs.
  --npm <path>                     npm executable for library jobs.
  --library-base-url <url>         Base URL for library acceptance and UI checks.
  --ai-integration-base-url <url>  Base URL for ai-integration health/acceptance jobs.
  --ai-site-analyzer-base-url <url> Base URL for ai-site-analyzer health job.
  --require-postgres-sql-target    Require postgres target inside ai-integration SQL readiness check.
  --no-require-postgres-sql-target Keep postgres target optional inside ai-integration SQL readiness check.
  --ui-smoke-mode <always|auto|never> Control browser smoke execution. Defaults to auto.
  --ui-qa-mode <always|auto|never> Control browser QA execution. Defaults to auto.
  --ai-integration-env-file <path> Live ai-integration monitoring env file for release-readiness.
  --library-env-file <path>        Live library monitoring env file for release-readiness.
  --ai-site-analyzer-env-file <path> Live ai-site-analyzer monitoring env file for release-readiness.
  --skip-systemctl                 Skip systemd timer verification in live release-readiness.
  --skip-live-readiness            Skip the separate live release-readiness audit.
  --require-ready                  Exit with code 1 when the combined gate is not release-ready. Enabled by default.
  --no-require-ready               Allow incomplete/not-ready combined status without failing the gate.
  --require-clean                  Exit with code 1 unless the combined gate status is exactly ready.
  --json                           Print the full gate JSON.
  --help                           Show this help.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help')) {
    printHelp();
    return;
  }

  const requireReady = hasFlag(args, '--no-require-ready')
    ? false
    : hasFlag(args, '--require-ready')
      ? true
      : envBool('AI_IRBISTECH_RELEASE_GATE_REQUIRE_READY', true);
  const requireClean = hasFlag(args, '--require-clean') || envBool('AI_IRBISTECH_RELEASE_GATE_REQUIRE_CLEAN', false);
  const requirePostgresSqlTarget = hasFlag(args, '--no-require-postgres-sql-target')
    ? false
    : hasFlag(args, '--require-postgres-sql-target')
      ? true
      : envBool('AI_IRBISTECH_RELEASE_GATE_REQUIRE_POSTGRES_SQL_TARGET', false);
  const skipSystemctl = hasFlag(args, '--skip-systemctl') || envBool('AI_IRBISTECH_RELEASE_GATE_SKIP_SYSTEMCTL', false);
  const skipLiveReadiness = hasFlag(args, '--skip-live-readiness') || envBool('AI_IRBISTECH_RELEASE_GATE_SKIP_LIVE_READINESS', false);
  const shouldPrintJson = hasFlag(args, '--json') || envBool('AI_IRBISTECH_RELEASE_GATE_JSON', false);
  const uiSmokeMode = normalizeMode(
    readOption(args, '--ui-smoke-mode') ?? process.env.AI_IRBISTECH_RELEASE_GATE_UI_SMOKE_MODE,
    'auto',
  );
  const uiQaMode = normalizeMode(
    readOption(args, '--ui-qa-mode') ?? process.env.AI_IRBISTECH_RELEASE_GATE_UI_QA_MODE,
    'auto',
  );

  const summary = await runAiIrbistechReleaseGate({
    cwd: process.cwd(),
    outputDir:
      readOption(args, '--output-dir') ??
      process.env.AI_IRBISTECH_RELEASE_GATE_OUTPUT_DIR ??
      DEFAULT_OUTPUT_DIR,
    suiteOutputDir:
      readOption(args, '--suite-output-dir') ??
      process.env.AI_IRBISTECH_RELEASE_GATE_SUITE_OUTPUT_DIR,
    suiteArtifactRootDir:
      readOption(args, '--suite-artifact-root-dir') ??
      process.env.AI_IRBISTECH_RELEASE_GATE_SUITE_ARTIFACT_ROOT_DIR,
    reportName:
      readOption(args, '--name') ??
      process.env.AI_IRBISTECH_RELEASE_GATE_REPORT_NAME ??
      DEFAULT_REPORT_NAME,
    runId:
      readOption(args, '--run-id') ??
      process.env.AI_IRBISTECH_RELEASE_GATE_RUN_ID,
    pythonExecutable:
      readOption(args, '--python') ??
      process.env.AI_IRBISTECH_RELEASE_GATE_PYTHON_BIN,
    npmExecutable:
      readOption(args, '--npm') ??
      process.env.AI_IRBISTECH_RELEASE_GATE_NPM_BIN,
    libraryBaseUrl:
      readOption(args, '--library-base-url') ??
      process.env.AI_IRBISTECH_RELEASE_GATE_LIBRARY_BASE_URL ??
      null,
    aiIntegrationBaseUrl:
      readOption(args, '--ai-integration-base-url') ??
      process.env.AI_IRBISTECH_RELEASE_GATE_AI_INTEGRATION_BASE_URL ??
      null,
    aiSiteAnalyzerBaseUrl:
      readOption(args, '--ai-site-analyzer-base-url') ??
      process.env.AI_IRBISTECH_RELEASE_GATE_AI_SITE_ANALYZER_BASE_URL ??
      null,
    requirePostgresSqlTarget,
    uiSmokeMode,
    uiQaMode,
    requireReady,
    requireClean,
    skipLiveReadiness,
    liveAiIntegrationEnvFile:
      readOption(args, '--ai-integration-env-file') ??
      process.env.AI_IRBISTECH_RELEASE_GATE_AI_INTEGRATION_ENV_FILE,
    liveLibraryEnvFile:
      readOption(args, '--library-env-file') ??
      process.env.AI_IRBISTECH_RELEASE_GATE_LIBRARY_ENV_FILE,
    liveAiSiteAnalyzerEnvFile:
      readOption(args, '--ai-site-analyzer-env-file') ??
      process.env.AI_IRBISTECH_RELEASE_GATE_AI_SITE_ANALYZER_ENV_FILE,
    liveUseSystemctl: !skipSystemctl,
  });

  if (shouldPrintJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      [
        `gate_status=${summary.overallStatus}`,
        `release_ready=${summary.releaseReady}`,
        `suite=${summary.suite.overallStatus}`,
        `suite_release_readiness=${summary.suiteSummary.releaseReadiness.overallStatus}`,
        `live_release_readiness=${summary.liveReleaseReadiness?.overallStatus ?? 'skipped'}`,
        `exit_code=${summary.exitCode}`,
      ].join(' | '),
    );
    console.log(`gate markdown: ${path.resolve(summary.outputDir, `${summary.reportName}.md`)}`);
    console.log(`gate json: ${path.resolve(summary.outputDir, `${summary.reportName}.json`)}`);
    console.log(`suite markdown: ${path.resolve(summary.suite.suiteMarkdownPath)}`);
    console.log(`suite report markdown: ${path.resolve(summary.suite.reportMarkdownPath)}`);
    console.log(`suite release-readiness markdown: ${path.resolve(summary.suite.releaseReadinessMarkdownPath)}`);
    if (summary.liveReleaseReadiness) {
      console.log(`live release-readiness markdown: ${path.resolve(summary.liveReleaseReadiness.markdownPath)}`);
    }
  }

  process.exit(summary.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  buildAiIrbistechReleaseReadinessSnapshot,
  renderAiIrbistechReleaseReadinessMarkdown,
  resolveAiIrbistechReleaseReadinessExitCode,
} from '../lib/ai-irbistech-release-readiness';

const DEFAULT_OUTPUT_DIR = 'docs/ai-irbistech-release-readiness';
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

function readPositionalArgs(args: string[]): string[] {
  const optionsWithValues = new Set([
    '--output-dir',
    '--name',
    '--ai-integration-env-file',
    '--library-env-file',
    '--ai-site-analyzer-env-file',
  ]);
  const flags = new Set([
    '--skip-systemctl',
    '--require-ready',
    '--require-clean',
    '--json',
    '--help',
  ]);
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (optionsWithValues.has(value)) {
      index += 1;
      continue;
    }
    if (flags.has(value)) {
      continue;
    }
    if (value.startsWith('-')) {
      continue;
    }
    positionals.push(value);
  }
  return positionals;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

function printHelp(): void {
  console.log(`Build an AI IRBISTECH 1.1 release-readiness audit from env files, systemd timers, and monitoring artifacts.

Examples:
  npm run release:readiness
  npm run release:readiness -- --skip-systemctl --library-env-file deploy/systemd/library-monitoring.env.example
  npx tsx scripts/export-ai-irbistech-release-readiness.ts --skip-systemctl --ai-integration-env-file ../ai-integration/deploy/systemd/ai-integration-monitoring.env.example
  npx tsx scripts/export-ai-irbistech-release-readiness.ts ../ai-integration/deploy/systemd/ai-integration-monitoring.env.example deploy/systemd/library-monitoring.env.example ../ai-site-analyzer/deploy/systemd/ai-site-analyzer-monitoring.env.example

Options:
  --output-dir <path>               Directory for generated JSON/markdown. Defaults to ${DEFAULT_OUTPUT_DIR}
  --name <value>                    Output file prefix. Defaults to ${DEFAULT_REPORT_NAME}
  --ai-integration-env-file <path>  Path to ai-integration monitoring env file.
  --library-env-file <path>         Path to library monitoring env file.
  --ai-site-analyzer-env-file <path> Path to ai-site-analyzer monitoring env file.
  --skip-systemctl                  Skip systemd timer verification.
  --require-ready                   Exit with code 1 when the audit is not release-ready.
  --require-clean                   Exit with code 1 unless the audit status is exactly ready.
  --json                            Print the full audit JSON to stdout.
  --help                            Show this help.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positionalArgs = readPositionalArgs(args);
  if (hasFlag(args, '--help')) {
    printHelp();
    return;
  }

  const outputDir = path.resolve(
    process.cwd(),
    readOption(args, '--output-dir') ??
      process.env.AI_IRBISTECH_RELEASE_READINESS_OUTPUT_DIR ??
      DEFAULT_OUTPUT_DIR,
  );
  const reportName = sanitizeSegment(
    readOption(args, '--name') ??
      process.env.AI_IRBISTECH_RELEASE_READINESS_NAME ??
      DEFAULT_REPORT_NAME,
  );
  if (!reportName) {
    throw new Error('report name must not be empty');
  }

  const requireReady = hasFlag(args, '--require-ready') || envBool('AI_IRBISTECH_RELEASE_READINESS_REQUIRE_READY', false);
  const requireClean = hasFlag(args, '--require-clean') || envBool('AI_IRBISTECH_RELEASE_READINESS_REQUIRE_CLEAN', false);
  const shouldPrintJson = hasFlag(args, '--json') || envBool('AI_IRBISTECH_RELEASE_READINESS_JSON', false);

  const snapshot = await buildAiIrbistechReleaseReadinessSnapshot({
    cwd: process.cwd(),
    aiIntegrationEnvFile:
      readOption(args, '--ai-integration-env-file') ??
      positionalArgs[0] ??
      process.env.AI_IRBISTECH_RELEASE_READINESS_AI_INTEGRATION_ENV_FILE,
    libraryEnvFile:
      readOption(args, '--library-env-file') ??
      positionalArgs[1] ??
      process.env.AI_IRBISTECH_RELEASE_READINESS_LIBRARY_ENV_FILE,
    aiSiteAnalyzerEnvFile:
      readOption(args, '--ai-site-analyzer-env-file') ??
      positionalArgs[2] ??
      process.env.AI_IRBISTECH_RELEASE_READINESS_AI_SITE_ANALYZER_ENV_FILE,
    useSystemctl: !hasFlag(args, '--skip-systemctl'),
  });

  const markdown = renderAiIrbistechReleaseReadinessMarkdown(snapshot);
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${reportName}.json`);
  const markdownPath = path.join(outputDir, `${reportName}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, markdown, 'utf8');

  const exitCode = resolveAiIrbistechReleaseReadinessExitCode(snapshot, {
    requireReady,
    requireClean,
  });

  if (shouldPrintJson) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log(
      [
        `overall=${snapshot.overallStatus}`,
        `release_ready=${snapshot.releaseReady}`,
        `pass=${snapshot.counts.pass}`,
        `warn=${snapshot.counts.warn}`,
        `fail=${snapshot.counts.fail}`,
        `missing=${snapshot.counts.missing}`,
        `exit_code=${exitCode}`,
      ].join(' | '),
    );
    console.log(`markdown: ${markdownPath}`);
    console.log(`json: ${jsonPath}`);
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

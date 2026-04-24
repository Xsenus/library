import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  buildAiIrbistechAcceptanceReportSnapshot,
  renderAiIrbistechAcceptanceReportMarkdown,
  resolveAiIrbistechAcceptanceReportExitCode,
  type AiIrbistechAcceptanceReportSources,
} from '../lib/ai-irbistech-acceptance-report';
import {
  AI_IRBISTECH_ACCEPTANCE_REPORT_SOURCE_OPTIONS,
  discoverAiIrbistechAcceptanceReportInputPaths,
  loadAiIrbistechAcceptanceReportSource,
  resolveAiIrbistechAcceptanceReportDiscoveryRoots,
} from '../lib/ai-irbistech-acceptance-report-discovery';

const DEFAULT_OUTPUT_DIR = 'docs/ai-irbistech-acceptance-report';
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

function readRawNpmConfig(name: string): string | undefined {
  const value = process.env[`npm_config_${name}`];
  return value === undefined || value === '' ? undefined : value;
}

function npmConfigBool(name: string, defaultValue: boolean): boolean {
  const raw = readRawNpmConfig(name);
  if (raw === undefined) {
    return defaultValue;
  }
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function printHelp(): void {
  console.log(`Build a consolidated AI IRBISTECH 1.1 acceptance report from JSON artifacts.

Examples:
  npm run acceptance:report
  npm run acceptance:report -- \\
    --ai-integration-acceptance ../ai-integration/artifacts/equipment-score-acceptance \\
    --ai-integration-sql-readiness ../ai-integration/artifacts/analysis-score-sql-readiness/latest.json \\
    --ai-integration-sync-health ../ai-integration/artifacts/analysis-score-sync-health/latest.json \\
    --library-health artifacts/library-system-health/latest.json \\
    --library-acceptance artifacts/ai-analysis-acceptance-health/latest.json \\
    --library-ui-smoke artifacts/ai-analysis-ui-smoke/2026-04-24T10-00-00-000Z/summary.json \\
    --library-ui-qa artifacts/ai-analysis-ui-qa-health/latest.json \\
    --ai-site-analyzer-health ../ai-site-analyzer/artifacts/system-health/latest.json

Options:
  --ai-integration-acceptance <path>   JSON file or directory for ai-integration acceptance artifacts.
  --ai-integration-sql-readiness <path> JSON file or directory for ai-integration SQL readiness artifacts.
  --ai-integration-sync-health <path>  JSON file or directory for analysis_score sync health artifacts.
  --library-health <path>              JSON file or directory for library /api/health artifacts.
  --library-acceptance <path>          JSON file or directory for library acceptance artifacts.
  --library-ui-smoke <path>            JSON file or directory for AI Analysis UI smoke artifacts.
  --library-ui-qa <path>               JSON file or directory for AI Analysis UI QA artifacts.
  --ai-site-analyzer-health <path>     JSON file or directory for ai-site-analyzer health artifacts.
  --output-dir <path>                  Directory for the generated report. Defaults to ${DEFAULT_OUTPUT_DIR}
  --name <value>                       Output file prefix. Defaults to ${DEFAULT_REPORT_NAME}
  --require-release-ready              Exit with code 1 when the assembled report is not release-ready.
  --require-clean                      Exit with code 1 unless the report status is exactly ready (no warnings).
  --help                               Show this help.

If a directory is provided, the script prefers latest.json, then summary.json, then the newest JSON file by name.
If a source path is omitted, the script tries to auto-discover standard artifact locations in the workspace and /var/lib.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help')) {
    printHelp();
    return;
  }

  const outputDir = path.resolve(
    process.cwd(),
    readOption(args, '--output-dir') ??
      process.env.AI_IRBISTECH_ACCEPTANCE_REPORT_OUTPUT_DIR ??
      DEFAULT_OUTPUT_DIR,
  );
  const reportName = sanitizeSegment(
    readOption(args, '--name') ??
      process.env.AI_IRBISTECH_ACCEPTANCE_REPORT_NAME ??
      DEFAULT_REPORT_NAME,
  );
  if (!reportName) {
    throw new Error('report name must not be empty');
  }
  const requireReleaseReady = hasFlag(args, '--require-release-ready') || npmConfigBool('require_release_ready', false);
  const requireClean = hasFlag(args, '--require-clean') || npmConfigBool('require_clean', false);

  const discoveryRoots = resolveAiIrbistechAcceptanceReportDiscoveryRoots(process.cwd());
  const autoDiscoveredInputs = discoverAiIrbistechAcceptanceReportInputPaths(discoveryRoots);
  const sources: AiIrbistechAcceptanceReportSources = {};
  const discoveredSourceKeys: string[] = [];

  for (const sourceOption of AI_IRBISTECH_ACCEPTANCE_REPORT_SOURCE_OPTIONS) {
    const explicitInputPath = readOption(args, sourceOption.option) ?? process.env[sourceOption.env] ?? '';
    const inputPath = explicitInputPath.trim() || autoDiscoveredInputs[sourceOption.key] || '';
    if (!inputPath.trim()) {
      continue;
    }
    sources[sourceOption.key] = loadAiIrbistechAcceptanceReportSource(inputPath, process.cwd());
    if (!explicitInputPath.trim()) {
      discoveredSourceKeys.push(sourceOption.key);
    }
  }

  if (Object.keys(sources).length === 0) {
    throw new Error('at least one source artifact is required; no explicit or auto-discovered artifacts were found');
  }

  const snapshot = buildAiIrbistechAcceptanceReportSnapshot(sources);
  const markdown = renderAiIrbistechAcceptanceReportMarkdown(snapshot);

  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${reportName}.json`);
  const markdownPath = path.join(outputDir, `${reportName}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, markdown, 'utf8');

  console.log(
    JSON.stringify({
      ok: true,
      outputDir,
      reportName,
      files: [jsonPath, markdownPath],
      providedSources: Object.keys(sources),
      autoDiscoveredSources: discoveredSourceKeys,
      overallStatus: snapshot.overallStatus,
      releaseReady: snapshot.releaseReady,
      exitCode: resolveAiIrbistechAcceptanceReportExitCode(snapshot, {
        requireReleaseReady,
        requireClean,
      }),
    }),
  );

  process.exit(
    resolveAiIrbistechAcceptanceReportExitCode(snapshot, {
      requireReleaseReady,
      requireClean,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

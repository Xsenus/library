import {
  DEFAULT_ARTIFACT_RETENTION,
  parseArtifactRetentionCount,
} from '../lib/artifact-retention';
import { runAiSiteAnalyzerRemoteHealthcheck } from '../lib/ai-site-analyzer-remote-healthcheck';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8123';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STATE_FILE = '/var/lib/ai-site-analyzer/system-health-state.json';
const DEFAULT_ARTIFACT_DIR = '/var/lib/ai-site-analyzer/system-health';

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

function readNpmConfig(name: string): string | undefined {
  const value = readRawNpmConfig(name);
  if (value === undefined || value === 'true' || value === 'false') {
    return undefined;
  }
  return value;
}

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

function printHelp(): void {
  console.log(`Remote HTTP healthcheck for ai-site-analyzer.

Examples:
  npm run ai-site-analyzer:remote-healthcheck -- --json --base-url http://37.221.125.221:8123

Options:
  --base-url <url>         ai-site-analyzer base URL. Defaults to AI_SITE_ANALYZER_HEALTHCHECK_BASE_URL or ${DEFAULT_BASE_URL}
  --health-url <url>       Optional absolute health URL override.
  --billing-url <url>      Optional absolute billing URL override.
  --timeout-ms <ms>        Request timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}
  --state-file <path>      State file for monitoring metadata.
  --artifact-dir <path>    Directory for latest.json and timestamped JSON artifacts.
  --artifact-retention <n> Keep the newest N timestamped artifact files. 0 disables pruning.
  --json                   Print full JSON summary.
  --help                   Show this help.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positionalArgs = args.filter((arg) => !arg.startsWith('-'));
  if (hasFlag(args, '--help')) {
    printHelp();
    return;
  }

  const timeoutMs = Number(
    readOption(args, '--timeout-ms') ??
      readNpmConfig('timeout_ms') ??
      process.env.AI_SITE_ANALYZER_HEALTHCHECK_TIMEOUT_MS ??
      process.env.AI_SITE_ANALYZER_HEALTHCHECK_TIMEOUT ??
      DEFAULT_TIMEOUT_MS,
  );
  const artifactRetentionCount = parseArtifactRetentionCount(
    readOption(args, '--artifact-retention') ??
      readNpmConfig('artifact_retention') ??
      process.env.AI_SITE_ANALYZER_HEALTHCHECK_ARTIFACT_RETENTION,
    DEFAULT_ARTIFACT_RETENTION,
  );
  const summary = await runAiSiteAnalyzerRemoteHealthcheck({
    baseUrl:
      readOption(args, '--base-url') ??
      positionalArgs[0] ??
      readNpmConfig('base_url') ??
      process.env.AI_SITE_ANALYZER_HEALTHCHECK_BASE_URL ??
      DEFAULT_BASE_URL,
    healthUrl:
      readOption(args, '--health-url') ??
      readNpmConfig('health_url') ??
      process.env.AI_SITE_ANALYZER_HEALTHCHECK_HEALTH_URL ??
      null,
    billingUrl:
      readOption(args, '--billing-url') ??
      readNpmConfig('billing_url') ??
      process.env.AI_SITE_ANALYZER_HEALTHCHECK_BILLING_URL ??
      null,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    artifactDir:
      readOption(args, '--artifact-dir') ??
      readNpmConfig('artifact_dir') ??
      positionalArgs[1] ??
      process.env.AI_SITE_ANALYZER_HEALTHCHECK_ARTIFACT_DIR ??
      DEFAULT_ARTIFACT_DIR,
    stateFile:
      readOption(args, '--state-file') ??
      readNpmConfig('state_file') ??
      positionalArgs[2] ??
      process.env.AI_SITE_ANALYZER_HEALTHCHECK_STATE_FILE ??
      DEFAULT_STATE_FILE,
    artifactRetentionCount,
  });

  if (hasFlag(args, '--json') || envBool('AI_SITE_ANALYZER_HEALTHCHECK_JSON', false)) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`ai-site-analyzer status=${summary.severity} | reason=${summary.reason} | health=${summary.health_http_status} billing=${summary.billing_http_status}`);
  }

  process.exit(summary.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

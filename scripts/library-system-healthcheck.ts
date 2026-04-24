import {
  buildLibrarySystemHealthAlertText,
  runLibrarySystemHealthcheck,
  summaryToJson,
} from '../lib/library-system-healthcheck';
import { DEFAULT_ARTIFACT_RETENTION, parseArtifactRetentionCount } from '../lib/artifact-retention';

const DEFAULT_HEALTH_URL = 'http://127.0.0.1:8090/api/health';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STATE_FILE = '/var/lib/library/library-system-health-state.json';
const DEFAULT_ARTIFACT_DIR = '/var/lib/library/library-system-health';

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

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

function npmConfigBool(name: string, defaultValue: boolean): boolean {
  const raw = readRawNpmConfig(name);
  if (raw === undefined) {
    return defaultValue;
  }
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

function printHelp(): void {
  console.log(`Standalone healthcheck for library /api/health.

Examples:
  npm run healthcheck -- --json
  npm run healthcheck -- --url https://ai.irbistech.com/api/health
  npm run healthcheck -- --webhook-url https://example.local/webhook

Options:
  --url <url>              Health endpoint URL. Defaults to LIBRARY_SYSTEM_HEALTH_URL or ${DEFAULT_HEALTH_URL}
  --timeout-ms <ms>        HTTP timeout in milliseconds. Defaults to LIBRARY_SYSTEM_HEALTH_TIMEOUT_MS or ${DEFAULT_TIMEOUT_MS}
  --webhook-url <url>      Optional webhook for unhealthy/recovery notifications.
  --state-file <path>      State file for alert deduplication.
  --artifact-dir <path>    Directory for latest and timestamped JSON artifacts.
  --artifact-retention <n> Keep the newest N timestamped health artifacts. 0 disables pruning.
  --json                   Print full JSON summary.
  --alert-on-recovery      Send recovery notification after an unhealthy state.
  --no-alert-on-recovery   Disable recovery notification.
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
      process.env.LIBRARY_SYSTEM_HEALTH_TIMEOUT_MS ??
      DEFAULT_TIMEOUT_MS,
  );
  const artifactRetentionCount = parseArtifactRetentionCount(
    readOption(args, '--artifact-retention') ??
      readNpmConfig('artifact_retention') ??
      process.env.LIBRARY_SYSTEM_HEALTH_ARTIFACT_RETENTION,
    DEFAULT_ARTIFACT_RETENTION,
  );
  const alertOnRecovery = hasFlag(args, '--alert-on-recovery')
    ? true
    : hasFlag(args, '--no-alert-on-recovery')
      ? false
      : readRawNpmConfig('alert_on_recovery') !== undefined
        ? npmConfigBool('alert_on_recovery', true)
        : envBool('LIBRARY_SYSTEM_HEALTH_ALERT_ON_RECOVERY', true);
  const shouldPrintJson = hasFlag(args, '--json') || npmConfigBool('json', false);

  const summary = await runLibrarySystemHealthcheck({
    url:
      readOption(args, '--url') ??
      positionalArgs[0] ??
      readNpmConfig('url') ??
      process.env.LIBRARY_SYSTEM_HEALTH_URL ??
      DEFAULT_HEALTH_URL,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
    webhookUrl:
      readOption(args, '--webhook-url') ??
      readNpmConfig('webhook_url') ??
      process.env.LIBRARY_SYSTEM_HEALTH_ALERT_WEBHOOK_URL ??
      null,
    stateFile:
      readOption(args, '--state-file') ??
      readNpmConfig('state_file') ??
      positionalArgs[1] ??
      process.env.LIBRARY_SYSTEM_HEALTH_STATE_FILE ??
      DEFAULT_STATE_FILE,
    artifactDir:
      readOption(args, '--artifact-dir') ??
      readNpmConfig('artifact_dir') ??
      process.env.LIBRARY_SYSTEM_HEALTH_ARTIFACT_DIR ??
      DEFAULT_ARTIFACT_DIR,
    artifactRetentionCount,
    alertOnRecovery,
  });

  if (shouldPrintJson) {
    console.log(JSON.stringify(summaryToJson(summary), null, 2));
  } else {
    console.log(buildLibrarySystemHealthAlertText(summary));
  }

  process.exit(summary.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  DEFAULT_ARTIFACT_RETENTION,
  isTimestampedArtifactRunDirectory,
  parseArtifactRetentionCount,
  pruneArtifactEntries,
} from '../lib/artifact-retention';
import {
  validateAcceptanceTraceCase,
  type AcceptanceCaseConfig,
  type AcceptanceTracePayload,
} from '../lib/ai-analysis-acceptance-qa';

type AcceptanceSummary = {
  ok: boolean;
  checkedAt: string;
  baseUrl: string;
  artifactPath: string;
  health?: {
    ok: boolean;
    severity: string | null;
  };
  cases: ReturnType<typeof validateAcceptanceTraceCase>[];
  error?: string;
};

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex < 0) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error(`${url} returned invalid JSON payload`);
  }
  return payload;
}

function buildCases(): AcceptanceCaseConfig[] {
  return [
    {
      name: 'okved-1way',
      inn: process.env.AI_ANALYSIS_ACCEPTANCE_OKVED_INN || '1841109992',
      requiredSource: '1way',
      expectedSelectionStrategy: 'okved',
      expectedOriginKind: 'okved',
    },
    {
      name: 'product-2way',
      inn: process.env.AI_ANALYSIS_ACCEPTANCE_2WAY_INN || '6320002223',
      requiredSource: '2way',
      expectedSelectionStrategy: 'site',
      expectedOriginKind: 'product',
      requireMatchedProduct: true,
    },
    {
      name: 'site-3way',
      inn: process.env.AI_ANALYSIS_ACCEPTANCE_3WAY_INN || '3444070534',
      requiredSource: '3way',
      expectedSelectionStrategy: 'site',
      expectedOriginKind: 'site',
      requireMatchedSite: true,
    },
  ];
}

async function main() {
  loadEnv(path.join(process.cwd(), '.env.local'));

  const baseUrl = trimTrailingSlash(
    String(process.env.AI_ANALYSIS_ACCEPTANCE_BASE_URL || 'https://ai.irbistech.com').trim(),
  );
  const artifactRoot = path.resolve(
    process.cwd(),
    process.env.AI_ANALYSIS_ACCEPTANCE_ARTIFACT_DIR || 'artifacts/ai-analysis-acceptance-qa',
  );
  const artifactRetentionCount = parseArtifactRetentionCount(
    process.env.AI_ANALYSIS_ACCEPTANCE_ARTIFACT_RETENTION,
    DEFAULT_ARTIFACT_RETENTION,
  );
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(artifactRoot, sanitizeSegment(runStamp));
  const artifactPath = path.join(runDir, 'summary.json');
  fs.mkdirSync(runDir, { recursive: true });

  const summary: AcceptanceSummary = {
    ok: false,
    checkedAt: new Date().toISOString(),
    baseUrl,
    artifactPath,
    cases: [],
  };

  let failure: unknown = null;

  try {
    const health = await fetchJson<{ ok?: boolean; severity?: string | null }>(`${baseUrl}/api/health`);
    if (health.ok !== true) {
      throw new Error(`/api/health should report ok=true, got ${String(health.ok)}`);
    }
    summary.health = {
      ok: true,
      severity: health.severity ?? null,
    };

    for (const config of buildCases()) {
      const payload = await fetchJson<AcceptanceTracePayload>(
        `${baseUrl}/api/ai-analysis/equipment-trace/${encodeURIComponent(config.inn)}`,
      );
      summary.cases.push(validateAcceptanceTraceCase(config, payload));
    }

    summary.ok = true;
  } catch (error) {
    summary.error = error instanceof Error ? error.message : String(error);
    failure = error;
  }

  fs.writeFileSync(artifactPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await pruneArtifactEntries({
    rootDir: artifactRoot,
    keepLatest: artifactRetentionCount,
    matchEntry: (entry) => entry.isDirectory && isTimestampedArtifactRunDirectory(entry.name),
  }).catch(() => undefined);

  if (failure) {
    throw failure;
  }

  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

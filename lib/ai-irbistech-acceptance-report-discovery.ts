import fs from 'node:fs';
import path from 'node:path';

import type {
  AiIrbistechAcceptanceReportSource,
  AiIrbistechAcceptanceReportSources,
} from './ai-irbistech-acceptance-report';

export type AiIrbistechAcceptanceReportSourceKey = keyof AiIrbistechAcceptanceReportSources;

export type AiIrbistechAcceptanceReportSourceOption = {
  key: AiIrbistechAcceptanceReportSourceKey;
  option: string;
  env: string;
};

export type AiIrbistechAcceptanceReportDiscoveryRoots = {
  includeSystemArtifactRoots?: boolean;
  libraryRoot: string;
  workspaceRoot: string;
};

type SourceDiscoveryDefinition = AiIrbistechAcceptanceReportSourceOption & {
  candidates: (roots: AiIrbistechAcceptanceReportDiscoveryRoots) => string[];
  fallbackRoots?: (roots: AiIrbistechAcceptanceReportDiscoveryRoots) => string[];
  fallbackPathSubstrings?: string[];
};

export const AI_IRBISTECH_ACCEPTANCE_REPORT_SOURCE_OPTIONS: AiIrbistechAcceptanceReportSourceOption[] = [
  {
    key: 'aiIntegrationAcceptance',
    option: '--ai-integration-acceptance',
    env: 'AI_IRBISTECH_ACCEPTANCE_REPORT_AI_INTEGRATION_ACCEPTANCE',
  },
  {
    key: 'aiIntegrationSqlReadiness',
    option: '--ai-integration-sql-readiness',
    env: 'AI_IRBISTECH_ACCEPTANCE_REPORT_AI_INTEGRATION_SQL_READINESS',
  },
  {
    key: 'aiIntegrationSyncHealth',
    option: '--ai-integration-sync-health',
    env: 'AI_IRBISTECH_ACCEPTANCE_REPORT_AI_INTEGRATION_SYNC_HEALTH',
  },
  {
    key: 'libraryHealth',
    option: '--library-health',
    env: 'AI_IRBISTECH_ACCEPTANCE_REPORT_LIBRARY_HEALTH',
  },
  {
    key: 'libraryAcceptance',
    option: '--library-acceptance',
    env: 'AI_IRBISTECH_ACCEPTANCE_REPORT_LIBRARY_ACCEPTANCE',
  },
  {
    key: 'libraryUiSmoke',
    option: '--library-ui-smoke',
    env: 'AI_IRBISTECH_ACCEPTANCE_REPORT_LIBRARY_UI_SMOKE',
  },
  {
    key: 'libraryUiQa',
    option: '--library-ui-qa',
    env: 'AI_IRBISTECH_ACCEPTANCE_REPORT_LIBRARY_UI_QA',
  },
  {
    key: 'aiSiteAnalyzerHealth',
    option: '--ai-site-analyzer-health',
    env: 'AI_IRBISTECH_ACCEPTANCE_REPORT_AI_SITE_ANALYZER_HEALTH',
  },
];

const SOURCE_DISCOVERY_DEFINITIONS: SourceDiscoveryDefinition[] = [
  {
    ...AI_IRBISTECH_ACCEPTANCE_REPORT_SOURCE_OPTIONS[0]!,
    candidates: (roots) => [
      path.join(roots.workspaceRoot, 'ai-integration', 'artifacts', 'equipment-score-acceptance'),
      ...systemArtifactCandidates(roots, '/var/lib/ai-integration/equipment-score-acceptance'),
    ],
    fallbackRoots: ({ workspaceRoot }) => [path.join(workspaceRoot, 'ai-integration', 'artifacts')],
    fallbackPathSubstrings: ['equipment-score-acceptance'],
  },
  {
    ...AI_IRBISTECH_ACCEPTANCE_REPORT_SOURCE_OPTIONS[1]!,
    candidates: (roots) => [
      path.join(roots.workspaceRoot, 'ai-integration', 'artifacts', 'analysis-score-sql-readiness'),
      ...systemArtifactCandidates(roots, '/var/lib/ai-integration/analysis-score-sql-readiness'),
    ],
    fallbackRoots: ({ workspaceRoot }) => [path.join(workspaceRoot, 'ai-integration', 'artifacts')],
    fallbackPathSubstrings: ['analysis-score-sql-readiness'],
  },
  {
    ...AI_IRBISTECH_ACCEPTANCE_REPORT_SOURCE_OPTIONS[2]!,
    candidates: (roots) => [
      path.join(roots.workspaceRoot, 'ai-integration', 'artifacts', 'analysis-score-sync-health'),
      ...systemArtifactCandidates(roots, '/var/lib/ai-integration/analysis-score-sync-health'),
    ],
    fallbackRoots: ({ workspaceRoot }) => [path.join(workspaceRoot, 'ai-integration', 'artifacts')],
    fallbackPathSubstrings: ['analysis-score-sync-health'],
  },
  {
    ...AI_IRBISTECH_ACCEPTANCE_REPORT_SOURCE_OPTIONS[3]!,
    candidates: (roots) => [
      path.join(roots.libraryRoot, 'artifacts', 'library-system-health'),
      ...systemArtifactCandidates(roots, '/var/lib/library/library-system-health'),
    ],
    fallbackRoots: ({ libraryRoot }) => [path.join(libraryRoot, 'artifacts')],
    fallbackPathSubstrings: ['library-system-health'],
  },
  {
    ...AI_IRBISTECH_ACCEPTANCE_REPORT_SOURCE_OPTIONS[4]!,
    candidates: (roots) => [
      path.join(roots.libraryRoot, 'artifacts', 'ai-analysis-acceptance-health'),
      path.join(roots.libraryRoot, 'artifacts', 'ai-analysis-acceptance-qa'),
      ...systemArtifactCandidates(roots, '/var/lib/library/ai-analysis-acceptance-health'),
    ],
    fallbackRoots: ({ libraryRoot }) => [path.join(libraryRoot, 'artifacts')],
    fallbackPathSubstrings: ['ai-analysis-acceptance-health', 'ai-analysis-acceptance-qa'],
  },
  {
    ...AI_IRBISTECH_ACCEPTANCE_REPORT_SOURCE_OPTIONS[5]!,
    candidates: (roots) => [
      path.join(roots.libraryRoot, 'artifacts', 'ai-analysis-ui-smoke-health'),
      path.join(roots.libraryRoot, 'artifacts', 'ai-analysis-ui-smoke'),
      ...systemArtifactCandidates(roots, '/var/lib/library/ai-analysis-ui-smoke-health'),
    ],
    fallbackRoots: ({ libraryRoot }) => [path.join(libraryRoot, 'artifacts')],
    fallbackPathSubstrings: ['ai-analysis-ui-smoke-health', 'ai-analysis-ui-smoke'],
  },
  {
    ...AI_IRBISTECH_ACCEPTANCE_REPORT_SOURCE_OPTIONS[6]!,
    candidates: (roots) => [
      path.join(roots.libraryRoot, 'artifacts', 'ai-analysis-ui-qa-health'),
      path.join(roots.libraryRoot, 'artifacts', 'ai-analysis-ui-qa'),
      ...systemArtifactCandidates(roots, '/var/lib/library/ai-analysis-ui-qa-health'),
    ],
    fallbackRoots: ({ libraryRoot }) => [path.join(libraryRoot, 'artifacts')],
    fallbackPathSubstrings: ['ai-analysis-ui-qa-health', 'ai-analysis-ui-qa'],
  },
  {
    ...AI_IRBISTECH_ACCEPTANCE_REPORT_SOURCE_OPTIONS[7]!,
    candidates: (roots) => [
      path.join(roots.workspaceRoot, 'ai-site-analyzer', 'artifacts', 'system-health'),
      ...systemArtifactCandidates(roots, '/var/lib/ai-site-analyzer/system-health'),
    ],
    fallbackRoots: ({ workspaceRoot }) => [path.join(workspaceRoot, 'ai-site-analyzer', 'artifacts')],
    fallbackPathSubstrings: ['system-health'],
  },
];

export function resolveAiIrbistechAcceptanceReportDiscoveryRoots(cwd: string): AiIrbistechAcceptanceReportDiscoveryRoots {
  const resolvedCwd = path.resolve(cwd);
  const libraryRoot =
    path.basename(resolvedCwd).toLowerCase() === 'library' ? resolvedCwd : path.resolve(__dirname, '..');
  const workspaceRoot = path.resolve(libraryRoot, '..');
  return {
    libraryRoot,
    workspaceRoot,
  };
}

export function resolveAiIrbistechAcceptanceReportInputJsonPath(inputPath: string, cwd = process.cwd()): string {
  const resolved = path.resolve(cwd, inputPath);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return resolved;
  }

  for (const candidate of ['latest.json', 'summary.json']) {
    const candidatePath = path.join(resolved, candidate);
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
      return candidatePath;
    }
  }

  const jsonFiles = fs
    .readdirSync(resolved)
    .filter((item) => item.toLowerCase().endsWith('.json'))
    .sort()
    .reverse();
  if (jsonFiles.length > 0) {
    return path.join(resolved, jsonFiles[0]!);
  }

  const runDirs = fs
    .readdirSync(resolved)
    .map((name) => ({
      name,
      fullPath: path.join(resolved, name),
    }))
    .filter((entry) => {
      try {
        return fs.statSync(entry.fullPath).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((left, right) => right.name.localeCompare(left.name));

  for (const runDir of runDirs) {
    for (const candidate of ['summary.json', 'latest.json']) {
      const candidatePath = path.join(runDir.fullPath, candidate);
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
        return candidatePath;
      }
    }
  }

  throw new Error(`no json artifact found in directory: ${resolved}`);
}

export function loadAiIrbistechAcceptanceReportSource(
  inputPath: string,
  cwd = process.cwd(),
): AiIrbistechAcceptanceReportSource {
  const resolvedPath = resolveAiIrbistechAcceptanceReportInputJsonPath(inputPath, cwd);
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  return {
    inputPath: resolvedPath,
    payload: JSON.parse(raw) as unknown,
  };
}

type FallbackCandidate = {
  fullPath: string;
  mtimeMs: number;
  score: number;
};

function systemArtifactCandidates(
  roots: AiIrbistechAcceptanceReportDiscoveryRoots,
  ...candidates: string[]
): string[] {
  return roots.includeSystemArtifactRoots === false ? [] : candidates;
}

function collectFallbackJsonArtifactCandidates(
  rootDir: string,
  pathSubstrings: string[],
  depth = 0,
): FallbackCandidate[] {
  if (depth > 4 || !fs.existsSync(rootDir)) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates: FallbackCandidate[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      candidates.push(...collectFallbackJsonArtifactCandidates(fullPath, pathSubstrings, depth + 1));
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
      continue;
    }

    const normalizedPath = fullPath.replace(/\\/g, '/').toLowerCase();
    if (!pathSubstrings.some((item) => normalizedPath.includes(item.toLowerCase()))) {
      continue;
    }

    let score = 0;
    if (entry.name.toLowerCase() === 'latest.json') {
      score += 300;
    } else if (entry.name.toLowerCase() === 'summary.json') {
      score += 200;
    } else {
      score += 100;
    }

    for (const substring of pathSubstrings) {
      if (normalizedPath.includes(substring.toLowerCase())) {
        score += 25;
      }
    }

    const stats = fs.statSync(fullPath);
    candidates.push({
      fullPath,
      mtimeMs: stats.mtimeMs,
      score,
    });
  }

  return candidates;
}

function discoverFallbackJsonArtifactPath(
  rootDirs: string[],
  pathSubstrings: string[],
): string | null {
  const candidates = rootDirs.flatMap((rootDir) => collectFallbackJsonArtifactCandidates(rootDir, pathSubstrings));
  candidates.sort((left, right) => right.score - left.score || right.mtimeMs - left.mtimeMs || right.fullPath.localeCompare(left.fullPath));
  return candidates[0]?.fullPath ?? null;
}

export function discoverAiIrbistechAcceptanceReportSourcePath(
  key: AiIrbistechAcceptanceReportSourceKey,
  roots: AiIrbistechAcceptanceReportDiscoveryRoots,
): string | null {
  const definition = SOURCE_DISCOVERY_DEFINITIONS.find((item) => item.key === key);
  if (!definition) {
    return null;
  }

  for (const candidate of definition.candidates(roots)) {
    try {
      const resolved = resolveAiIrbistechAcceptanceReportInputJsonPath(candidate, roots.libraryRoot);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
      }
    } catch {
      continue;
    }
  }

  if (definition.fallbackRoots && definition.fallbackPathSubstrings?.length) {
    const fallbackPath = discoverFallbackJsonArtifactPath(
      definition.fallbackRoots(roots),
      definition.fallbackPathSubstrings,
    );
    if (fallbackPath) {
      return fallbackPath;
    }
  }

  return null;
}

export function discoverAiIrbistechAcceptanceReportInputPaths(
  roots: AiIrbistechAcceptanceReportDiscoveryRoots,
): Partial<Record<AiIrbistechAcceptanceReportSourceKey, string>> {
  const resolved: Partial<Record<AiIrbistechAcceptanceReportSourceKey, string>> = {};

  for (const definition of SOURCE_DISCOVERY_DEFINITIONS) {
    const inputPath = discoverAiIrbistechAcceptanceReportSourcePath(definition.key, roots);
    if (inputPath) {
      resolved[definition.key] = inputPath;
    }
  }

  return resolved;
}

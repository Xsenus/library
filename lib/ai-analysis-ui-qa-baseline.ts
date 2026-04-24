import path from 'node:path';

import type { AiAnalysisUiQaSummary } from './ai-analysis-ui-qa';

export type AiAnalysisUiQaBaselineCase = {
  name: string;
  inn: string;
  ok: boolean;
  dialogTitle: string | null;
  selectionStrategy: string | null;
  finalSource: string | null;
  originKind: string | null;
  artifactDir: string;
  rowScreenshotPath: string | null;
  dialogScreenshotPath: string | null;
  equipmentScreenshotPath: string | null;
  companyArtifactPath: string | null;
  equipmentTraceArtifactPath: string | null;
  productTraceArtifactPath: string | null;
  error: string | null;
};

export type AiAnalysisUiQaBaselineSnapshot = {
  generatedAt: string;
  sourceCheckedAt: string;
  baseUrl: string;
  authenticated: boolean;
  publicRedirectPath: string | null;
  artifactRunId: string;
  sourceArtifactDir: string;
  sourceArtifactPath: string;
  screenshots: string[];
  cases: AiAnalysisUiQaBaselineCase[];
};

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

function toDisplayPath(targetPath: string | null | undefined, baseDir: string): string | null {
  if (!targetPath) {
    return null;
  }

  const absoluteTarget = path.resolve(targetPath);
  const absoluteBaseDir = path.resolve(baseDir);
  const relativePath = path.relative(absoluteBaseDir, absoluteTarget);
  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return normalizePathSeparators(relativePath);
  }

  return normalizePathSeparators(targetPath);
}

export function buildAiAnalysisUiQaBaselineSnapshot(
  summary: AiAnalysisUiQaSummary,
  {
    generatedAt = new Date().toISOString(),
  }: {
    generatedAt?: string;
  } = {},
): AiAnalysisUiQaBaselineSnapshot {
  const artifactRunId = path.basename(summary.artifactDir);

  return {
    generatedAt,
    sourceCheckedAt: summary.checkedAt,
    baseUrl: summary.baseUrl,
    authenticated: summary.authenticated,
    publicRedirectPath: summary.publicRedirectPath,
    artifactRunId,
    sourceArtifactDir: normalizePathSeparators(summary.artifactDir),
    sourceArtifactPath: normalizePathSeparators(summary.artifactPath),
    screenshots: summary.screenshots
      .map((item) => toDisplayPath(item, summary.artifactDir))
      .filter((item): item is string => Boolean(item)),
    cases: summary.cases.map((item) => ({
      name: item.name,
      inn: item.inn,
      ok: item.ok,
      dialogTitle: item.dialogTitle,
      selectionStrategy: item.selectionStrategy,
      finalSource: item.finalSource,
      originKind: item.originKind,
      artifactDir: toDisplayPath(item.artifactDir, summary.artifactDir) ?? normalizePathSeparators(item.artifactDir),
      rowScreenshotPath: toDisplayPath(item.rowScreenshotPath, summary.artifactDir),
      dialogScreenshotPath: toDisplayPath(item.dialogScreenshotPath, summary.artifactDir),
      equipmentScreenshotPath: toDisplayPath(item.equipmentScreenshotPath, summary.artifactDir),
      companyArtifactPath: toDisplayPath(item.companyArtifactPath, summary.artifactDir),
      equipmentTraceArtifactPath: toDisplayPath(item.equipmentTraceArtifactPath, summary.artifactDir),
      productTraceArtifactPath: toDisplayPath(item.productTraceArtifactPath, summary.artifactDir),
      error: item.error,
    })),
  };
}

export function renderAiAnalysisUiQaBaselineMarkdown(snapshot: AiAnalysisUiQaBaselineSnapshot): string {
  const lines = [
    '# AI Analysis UI QA Visual Baseline',
    '',
    '## Snapshot',
    '',
    `- generated at: \`${snapshot.generatedAt}\``,
    `- source checked at: \`${snapshot.sourceCheckedAt}\``,
    `- base URL: \`${snapshot.baseUrl}\``,
    `- authenticated: \`${snapshot.authenticated ? 'yes' : 'no'}\``,
    `- public redirect path: \`${snapshot.publicRedirectPath ?? 'n/a'}\``,
    `- artifact run id: \`${snapshot.artifactRunId}\``,
    `- source artifact dir: \`${snapshot.sourceArtifactDir}\``,
    `- source summary path: \`${snapshot.sourceArtifactPath}\``,
    '',
    '## Cases',
    '',
  ];

  for (const item of snapshot.cases) {
    lines.push(`### ${item.name}`);
    lines.push('');
    lines.push(`- INN: \`${item.inn}\``);
    lines.push(`- ok: \`${item.ok ? 'true' : 'false'}\``);
    lines.push(`- dialog title: \`${item.dialogTitle ?? 'n/a'}\``);
    lines.push(`- selection strategy: \`${item.selectionStrategy ?? 'n/a'}\``);
    lines.push(`- winning path: \`${item.finalSource ?? 'n/a'}\``);
    lines.push(`- origin kind: \`${item.originKind ?? 'n/a'}\``);
    lines.push(`- case artifact dir: \`${item.artifactDir}\``);
    lines.push(`- row screenshot: \`${item.rowScreenshotPath ?? 'n/a'}\``);
    lines.push(`- dialog screenshot: \`${item.dialogScreenshotPath ?? 'n/a'}\``);
    lines.push(`- equipment screenshot: \`${item.equipmentScreenshotPath ?? 'n/a'}\``);
    lines.push(`- company payload: \`${item.companyArtifactPath ?? 'n/a'}\``);
    lines.push(`- equipment trace payload: \`${item.equipmentTraceArtifactPath ?? 'n/a'}\``);
    lines.push(`- product trace payload: \`${item.productTraceArtifactPath ?? 'n/a'}\``);
    if (item.error) {
      lines.push(`- error: \`${item.error}\``);
    }
    lines.push('');
  }

  lines.push('## Strategy');
  lines.push('');
  lines.push('- This committed baseline stores reviewable metadata only; screenshot and JSON binaries remain outside git.');
  lines.push('- Refresh the baseline after every intentional UI/trace presentation change affecting `okved-1way`, `product-2way`, or `site-3way`.');
  lines.push('- Regenerate from a fresh `summary.json` via `npm run ui:qa:baseline -- --summary <path>` before updating the committed files.');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

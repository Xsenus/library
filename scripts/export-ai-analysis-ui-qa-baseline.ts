import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  buildAiAnalysisUiQaBaselineSnapshot,
  renderAiAnalysisUiQaBaselineMarkdown,
} from '../lib/ai-analysis-ui-qa-baseline';
import type { AiAnalysisUiQaSummary } from '../lib/ai-analysis-ui-qa';

const DEFAULT_OUTPUT_DIR = 'docs/ai-analysis-ui-qa-baseline';
const DEFAULT_BASELINE_NAME = 'latest';

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

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function printHelp(): void {
  console.log(`Export a committed metadata baseline from AI Analysis UI QA summary.json.

Examples:
  npm run ui:qa:baseline -- --summary artifacts/ai-analysis-ui-qa/2026-04-23T09-55-32-026Z/summary.json
  npm run ui:qa:baseline -- --summary /var/lib/library/ai-analysis-ui-qa-health/latest.json --name release-2026-04-23

Options:
  --summary <path>      Path to summary.json from test:ui:qa or ui:qa:healthcheck.
  --output-dir <path>   Directory for committed baseline metadata. Defaults to ${DEFAULT_OUTPUT_DIR}
  --name <value>        Baseline file name prefix. Defaults to ${DEFAULT_BASELINE_NAME}
  --help                Show this help.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (hasFlag(args, '--help')) {
    printHelp();
    return;
  }

  const summaryPathRaw =
    readOption(args, '--summary') ??
    process.env.AI_ANALYSIS_UI_QA_BASELINE_SUMMARY ??
    '';
  if (!summaryPathRaw) {
    throw new Error('summary path is required: pass --summary <path> or AI_ANALYSIS_UI_QA_BASELINE_SUMMARY');
  }

  const outputDir = path.resolve(
    process.cwd(),
    readOption(args, '--output-dir') ?? process.env.AI_ANALYSIS_UI_QA_BASELINE_DIR ?? DEFAULT_OUTPUT_DIR,
  );
  const baselineName = sanitizeSegment(
    readOption(args, '--name') ?? process.env.AI_ANALYSIS_UI_QA_BASELINE_NAME ?? DEFAULT_BASELINE_NAME,
  );
  if (!baselineName) {
    throw new Error('baseline name must not be empty');
  }

  const summaryPath = path.resolve(process.cwd(), summaryPathRaw);
  const raw = fs.readFileSync(summaryPath, 'utf8');
  const summary = JSON.parse(raw) as AiAnalysisUiQaSummary;
  const snapshot = buildAiAnalysisUiQaBaselineSnapshot(summary);
  const markdown = renderAiAnalysisUiQaBaselineMarkdown(snapshot);

  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${baselineName}.json`);
  const markdownPath = path.join(outputDir, `${baselineName}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, markdown, 'utf8');

  console.log(
    JSON.stringify({
      ok: true,
      summaryPath,
      outputDir,
      files: [jsonPath, markdownPath],
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { resolveAiAnalysisUiQaOptions, runAiAnalysisUiQa } from '../lib/ai-analysis-ui-qa';

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

async function main() {
  loadEnv(path.join(process.cwd(), '.env.local'));

  const options = resolveAiAnalysisUiQaOptions(process.env, process.cwd());
  const summary = await runAiAnalysisUiQa(options);
  console.log(JSON.stringify(summary));
  process.exit(summary.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

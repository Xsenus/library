import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { normalizeAiAnalysisUiSmokeBaseUrl, runAiAnalysisUiSmoke } from '../lib/ai-analysis-ui-smoke';

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

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

async function main() {
  loadEnv(path.join(process.cwd(), '.env.local'));

  const baseUrl = normalizeAiAnalysisUiSmokeBaseUrl(process.env.AI_ANALYSIS_UI_SMOKE_BASE_URL);
  const login = String(process.env.AI_ANALYSIS_UI_SMOKE_LOGIN ?? '').trim();
  const password = String(process.env.AI_ANALYSIS_UI_SMOKE_PASSWORD ?? '');
  const captureEnabled = envBoolean('AI_ANALYSIS_UI_SMOKE_CAPTURE', true);
  const headless = envBoolean('AI_ANALYSIS_UI_SMOKE_HEADLESS', true);
  const requireAuth = envBoolean('AI_ANALYSIS_UI_SMOKE_REQUIRE_AUTH', false);
  const timeoutMs = Number(
    process.env.AI_ANALYSIS_UI_SMOKE_TIMEOUT_MS && Number(process.env.AI_ANALYSIS_UI_SMOKE_TIMEOUT_MS) > 0
      ? process.env.AI_ANALYSIS_UI_SMOKE_TIMEOUT_MS
      : 30_000,
  );
  const artifactDir = path.resolve(
    process.cwd(),
    process.env.AI_ANALYSIS_UI_SMOKE_ARTIFACT_DIR || 'artifacts/ai-analysis-ui-smoke',
  );
  const summary = await runAiAnalysisUiSmoke({
    baseUrl,
    login,
    password,
    capture: captureEnabled,
    headless,
    requireAuth,
    artifactDir,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
  });

  console.log(JSON.stringify(summary));
  process.exit(summary.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

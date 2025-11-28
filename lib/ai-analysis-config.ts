import { DEFAULT_STEPS, type StepKey } from './ai-analysis-types';

function parseSteps(raw: string | undefined | null): StepKey[] {
  if (!raw) return DEFAULT_STEPS;
  const steps = raw
    .split(',')
    .map((v) => v.trim().toLowerCase().replace(/[-\s]+/g, '_') as StepKey)
    .filter((v) => DEFAULT_STEPS.includes(v));
  return steps.length ? steps : DEFAULT_STEPS;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : undefined;
}

export function getForcedLaunchMode(isClient = false): 'steps' | 'full' {
  const envName = isClient ? 'NEXT_PUBLIC_AI_ANALYSIS_LAUNCH_MODE' : 'AI_ANALYSIS_LAUNCH_MODE';
  const raw = readEnv(envName)?.toLowerCase();
  if (raw === 'full') return 'full';
  return 'steps';
}

export function getForcedSteps(isClient = false): StepKey[] {
  const envName = isClient ? 'NEXT_PUBLIC_AI_ANALYSIS_STEPS' : 'AI_ANALYSIS_STEPS';
  return parseSteps(readEnv(envName));
}

export function isLaunchModeLocked(isClient = false): boolean {
  const envName = isClient ? 'NEXT_PUBLIC_AI_ANALYSIS_LOCK_MODE' : 'AI_ANALYSIS_LOCK_MODE';
  const raw = readEnv(envName);
  if (!raw) return true;
  return raw.toLowerCase() !== 'false';
}

export function getStepTimeoutMs(): number {
  const raw = readEnv('AI_INTEGRATION_STEP_TIMEOUT_MS');
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 1000) return parsed;
  return 45000;
}

export function getOverallTimeoutMs(): number {
  const raw = readEnv('AI_INTEGRATION_OVERALL_TIMEOUT_MS');
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 1000) return parsed;
  return 60000;
}

export function getDefaultSteps() {
  return DEFAULT_STEPS;
}

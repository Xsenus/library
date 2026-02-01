import { randomUUID } from 'crypto';

const DEFAULT_TIMEOUT_MS = 15000;

export type AiIntegrationHealth = {
  base: string | null;
  available: boolean;
  detail?: string;
};

function readEnv(names: string[]): string | null {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  }
  return null;
}

export function getAiIntegrationBase(): string | null {
  const raw = readEnv(['AI_INTEGRATION_BASE', 'AI_ANALYZE_BASE', 'ANALYZE_BASE']);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export async function callAiIntegration<T = any>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: true; data: T; status: number } | { ok: false; status: number; error: string }> {
  const base = getAiIntegrationBase();
  if (!base)
    return {
      ok: false,
      status: 503,
      error: 'AI integration base URL is not configured (AI_INTEGRATION_BASE / AI_ANALYZE_BASE / ANALYZE_BASE)',
    };

  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const status = res.status;
    const data = (await res.json().catch(() => null)) as T | null;
    if (!res.ok) {
      const detail = (data as any)?.detail ?? (data as any)?.error;
      const error =
        typeof detail === 'string'
          ? detail
          : detail
            ? JSON.stringify(detail)
            : `HTTP ${status}`;
      return {
        ok: false,
        status,
        error,
      };
    }
    return { ok: true, data: data as T, status };
  } catch (error: any) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') {
      return { ok: false, status: 504, error: 'AI integration request timed out' };
    }
    return { ok: false, status: 500, error: error?.message ?? 'AI integration request failed' };
  }
}

export async function getAiIntegrationHealth(): Promise<AiIntegrationHealth> {
  const base = getAiIntegrationBase();
  if (!base) return { base: null, available: false, detail: 'AI_INTEGRATION_BASE не указан' };

  const res = await callAiIntegration<{ status: string; databases?: Record<string, boolean> }>('/health', {
    timeoutMs: 5000,
  });

  if (!res.ok) {
    return { base, available: false, detail: res.error };
  }

  const status = (res.data as any)?.status ?? (res.data as any)?.message;
  return { base, available: true, detail: status ? String(status) : undefined };
}

export function aiRequestId() {
  return randomUUID();
}

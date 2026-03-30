import { randomUUID } from 'crypto';

const DEFAULT_TIMEOUT_MS = 15000;

type AiIntegrationHealthResponse = {
  ok?: boolean;
  detail?: string;
  status?: string;
  message?: string;
  connections?: Record<string, unknown>;
};

export type AiIntegrationHealth = {
  base: string | null;
  available: boolean;
  ok?: boolean;
  detail?: string;
  connections?: Record<string, string>;
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

function normalizeHealthConnections(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value).flatMap(([key, raw]) =>
    typeof raw === 'string' && raw.trim() ? [[key, raw.trim()]] : [],
  );

  return entries.length ? Object.fromEntries(entries) : undefined;
}

function buildHealthDetail(payload: AiIntegrationHealthResponse | null, connections?: Record<string, string>): string | undefined {
  const explicit =
    typeof payload?.detail === 'string' && payload.detail.trim()
      ? payload.detail.trim()
      : typeof payload?.status === 'string' && payload.status.trim()
        ? payload.status.trim()
        : typeof payload?.message === 'string' && payload.message.trim()
          ? payload.message.trim()
          : null;
  if (explicit) return explicit;

  if (!connections) return undefined;

  const degraded = Object.entries(connections)
    .filter(([, status]) => status !== 'ok' && status !== 'disabled')
    .map(([name, status]) => `${name}: ${status}`);

  if (degraded.length) {
    return `Health check failed (${degraded.join(', ')})`;
  }

  return undefined;
}

export function getAiIntegrationBase(): string | null {
  const raw = readEnv(['AI_INTEGRATION_BASE_URL', 'AI_INTEGRATION_BASE']);
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
      error: 'AI integration base URL is not configured (AI_INTEGRATION_BASE_URL / AI_INTEGRATION_BASE)',
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
  if (!base) {
    return {
      base: null,
      available: false,
      ok: false,
      detail: 'AI_INTEGRATION_BASE_URL / AI_INTEGRATION_BASE is not configured',
    };
  }

  const res = await callAiIntegration<AiIntegrationHealthResponse>('/health', {
    timeoutMs: 5000,
  });

  if (!res.ok) {
    return { base, available: false, ok: false, detail: res.error };
  }

  const payload = (res.data ?? null) as AiIntegrationHealthResponse | null;
  const connections = normalizeHealthConnections(payload?.connections);
  const ok = payload?.ok !== false;

  return {
    base,
    available: ok,
    ok,
    connections,
    detail: buildHealthDetail(payload, connections),
  };
}

export function aiRequestId() {
  return randomUUID();
}

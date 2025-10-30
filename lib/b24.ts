// lib/b24.ts
const WEBHOOK = process.env.B24_WEBHOOK_URL ?? '';
const PORTAL_ORIGIN = process.env.B24_PORTAL_ORIGIN ?? '';
const SLASH_COLLAPSE_RE = new RegExp('(?<!:)//+', 'g');

if (!WEBHOOK) console.warn('B24_WEBHOOK_URL is not set');
if (!PORTAL_ORIGIN) console.warn('B24_PORTAL_ORIGIN is not set');

export function getPortalOrigin(): string {
  try {
    return PORTAL_ORIGIN || new URL(WEBHOOK).origin;
  } catch {
    return PORTAL_ORIGIN || '';
  }
}

type B24Response<T> = { result?: T; error?: string; error_description?: string };

export async function b24Call<T = unknown>(
  method: string,
  params: Record<string, any> = {},
): Promise<T> {
  if (!WEBHOOK) throw new Error('B24 webhook not configured');
  const body = toFormUrlEncoded(params);
  const url = resolveWebhookUrl(method);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
    cache: 'no-store',
  });
  const data = (await r.json()) as B24Response<T>;
  if ((data as any)?.error)
    throw new Error(`${(data as any).error}: ${(data as any).error_description ?? ''}`);
  return data.result as T;
}

/** JSON-вариант batch */
export async function b24BatchJson(cmd: Record<string, string>, halt = 0): Promise<any> {
  if (!WEBHOOK) throw new Error('B24 webhook not configured');
  const url = resolveWebhookUrl('batch');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ halt, cmd }),
    cache: 'no-store',
  });
  const data = await r.json();
  if (data?.error) throw new Error(`${data.error}: ${data.error_description ?? ''}`);
  return data;
}

function toFormUrlEncoded(obj: any): string {
  const sp = new URLSearchParams();

  const walk = (prefix: string, val: any) => {
    if (val === undefined || val === null) return;

    if (Array.isArray(val)) {
      const allPrimitive = val.every((v) => typeof v !== 'object' || v === null);
      if (allPrimitive) {
        for (const v of val) sp.append(`${prefix}[]`, String(v));
      } else {
        val.forEach((item, i) => walk(`${prefix}[${i}]`, item));
      }
      return;
    }

    if (typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) walk(`${prefix}[${k}]`, v);
      return;
    }

    sp.append(prefix, String(val));
  };

  for (const [k, v] of Object.entries(obj)) walk(k, v);
  return sp.toString();
}

/** разбиение на чанки */
export function chunk<T>(arr: T[], n: number): T[][] {
  if (!Array.isArray(arr) || n <= 0) return [arr || []];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function resolveWebhookUrl(method: string): string {
  const marker = '{{method}}';
  const methodPath = method.endsWith('.json') ? method : `${method}.json`;

  const trimmed = WEBHOOK.trim();
  if (!trimmed) throw new Error('B24 webhook not configured');

  if (trimmed.includes(marker)) {
    return trimmed.replace(new RegExp(marker, 'g'), methodPath);
  }

  try {
    const url = new URL(trimmed);
    if (!url.pathname.endsWith('.json')) {
      const basePath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
      const rawPath = `${basePath}${methodPath}`;
      url.pathname = rawPath.replace(SLASH_COLLAPSE_RE, '/');
    }
    return url.toString();
  } catch {
    const [base, query] = trimmed.split('?', 2);
    const baseWithSlash = base.endsWith('/') || base.endsWith('?') || base.endsWith('&')
      ? base
      : `${base}/`;
    const rawPath = `${baseWithSlash}${methodPath}`;
    const normalized = rawPath.replace(SLASH_COLLAPSE_RE, '/');
    if (query === undefined || query === '') return normalized;
    return `${normalized}?${query}`;
  }
}

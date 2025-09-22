// lib/b24.ts
const WEBHOOK = process.env.B24_WEBHOOK_URL ?? '';
const PORTAL_ORIGIN = process.env.B24_PORTAL_ORIGIN ?? '';

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
  const r = await fetch(`${WEBHOOK}${method}.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
    cache: 'no-store',
  });
  const data = (await r.json()) as B24Response<T>;
  if (data.error) throw new Error(`${data.error}: ${data.error_description ?? ''}`);
  return data.result as T;
}

// --- ВАЖНО: массив объектов разворачиваем как filter[0][...], а не JSON
function toFormUrlEncoded(obj: any): string {
  const sp = new URLSearchParams();

  const walk = (prefix: string, val: any) => {
    if (val === undefined || val === null) return;

    if (Array.isArray(val)) {
      // массив примитивов → key[]=a&key[]=b
      const allPrimitive = val.every((v) => typeof v !== 'object' || v === null);
      if (allPrimitive) {
        for (const v of val) sp.append(`${prefix}[]`, String(v));
      } else {
        // массив объектов → key[0][field]=...&key[1][field]=...
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

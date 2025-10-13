import { NextRequest } from 'next/server';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const envAllow = (process.env.SCREENSHOT_PROXY_ALLOWLIST ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const inferredAllow = (() => {
  const hosts = new Set<string>();
  const base = process.env.NEXT_PUBLIC_GPT_IMAGES_BASE;
  if (base) {
    try {
      const parsed = new URL(base, 'http://localhost');
      if (parsed.hostname && parsed.hostname !== 'localhost') {
        hosts.add(parsed.hostname.toLowerCase());
      }
    } catch {
      /* ignore invalid base */
    }
  }
  return hosts;
})();

function isHostAllowed(hostname: string, requestHost: string): boolean {
  const normalized = hostname.toLowerCase();
  if (!normalized) return false;
  if (normalized === requestHost.toLowerCase()) return true;
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]') return true;

  if (envAllow.length > 0) {
    return envAllow.some((pattern) => {
      const value = pattern.toLowerCase();
      if (!value) return false;
      if (value.startsWith('.')) {
        return normalized === value.slice(1) || normalized.endsWith(value);
      }
      return normalized === value;
    });
  }

  if (inferredAllow.size > 0 && inferredAllow.has(normalized)) {
    return true;
  }

  return envAllow.length === 0 && inferredAllow.size === 0;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const urlParam = request.nextUrl.searchParams.get('url');
  if (!urlParam) {
    return new Response('Missing url', { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(urlParam);
  } catch {
    return new Response('Invalid url', { status: 400 });
  }

  if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
    return new Response('Unsupported protocol', { status: 400 });
  }

  const requestHost = request.nextUrl.hostname;
  if (!isHostAllowed(target.hostname, requestHost)) {
    return new Response('Host is not allowed', { status: 403 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const upstream = await fetch(target.toString(), {
      signal: controller.signal,
      headers: {
        'user-agent': 'CryoNavigator Screenshot Proxy/1.0',
      },
    });

    if (!upstream.ok) {
      return new Response('Upstream error', { status: upstream.status });
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    const body = await upstream.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return new Response('Upstream timeout', { status: 504 });
    }
    return new Response('Failed to load resource', { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

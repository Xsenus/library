import { NextRequest } from 'next/server';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { requireApiAuth } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36';
const DEFAULT_ACCEPT = 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_HOSTS = (process.env.IMAGE_PROXY_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function isAllowedUrl(url: URL): boolean {
  return ALLOWED_PROTOCOLS.has(url.protocol);
}

function getRegistrableDomain(host: string): string {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return host;
  }
  return parts.slice(-2).join('.');
}

function resolveSecFetchSite(requestUrl: URL, target: URL): string {
  if (requestUrl.origin === target.origin) {
    return 'same-origin';
  }
  const requestDomain = getRegistrableDomain(requestUrl.hostname);
  const targetDomain = getRegistrableDomain(target.hostname);
  if (requestDomain === targetDomain) {
    return 'same-site';
  }
  return 'cross-site';
}

function buildBaseHeaders(req: NextRequest, target: URL, secFetchSite: string): Headers {
  const headers = new Headers();
  const acceptLanguage = req.headers.get('accept-language') ?? 'ru,en;q=0.9';
  const userAgent = req.headers.get('user-agent') ?? DEFAULT_USER_AGENT;

  headers.set('User-Agent', userAgent);
  headers.set('Accept', DEFAULT_ACCEPT);
  headers.set('Accept-Language', acceptLanguage);
  headers.set('Pragma', 'no-cache');
  headers.set('Cache-Control', 'no-cache');
  headers.set('Connection', 'keep-alive');
  headers.set('Sec-Fetch-Mode', 'no-cors');
  headers.set('Sec-Fetch-Dest', 'image');
  headers.set('Sec-Fetch-Site', secFetchSite);
  headers.set('X-Requested-With', 'XMLHttpRequest');

  if (target.origin) {
    headers.set('Referer', `${target.origin}/`);
  }

  return headers;
}

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map((x) => Number(x));
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('::ffff:127.')
  );
}

function isDisallowedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true;
}

function isDisallowedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');
}

function isHostAllowedByAllowlist(hostname: string): boolean {
  if (ALLOWED_HOSTS.length === 0) return true;
  const target = hostname.toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => target === allowed || target.endsWith(`.${allowed}`));
}

async function ensureHostIsSafe(target: URL): Promise<void> {
  if (isDisallowedHostname(target.hostname)) {
    throw new Error('Host is not allowed');
  }

  if (!isHostAllowedByAllowlist(target.hostname)) {
    throw new Error('Host is not in allowlist');
  }

  const targetIpVersion = isIP(target.hostname);
  if (targetIpVersion) {
    if (isDisallowedIp(target.hostname)) throw new Error('IP is not allowed');
    return;
  }

  const resolved = await lookup(target.hostname, { all: true, verbatim: true });
  if (!resolved.length) throw new Error('Unable to resolve hostname');

  for (const r of resolved) {
    if (isDisallowedIp(r.address)) {
      throw new Error('Resolved IP is not allowed');
    }
  }
}

async function tryFetch(url: URL, headers: Headers): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url.toString(), {
      cache: 'no-store',
      redirect: 'follow',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response;
  } catch {
    return null;
  }
}

async function readLimitedImage(upstream: Response): Promise<{ ok: true; data: Buffer } | { ok: false }> {
  const reader = upstream.body?.getReader();
  if (!reader) return { ok: false };

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > MAX_IMAGE_SIZE_BYTES) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }

  return { ok: true, data: Buffer.concat(chunks.map((v) => Buffer.from(v))) };
}

export async function GET(req: NextRequest) {
  try {
    const requestUrl = new URL(req.url);
    const isEmbedMode = requestUrl.searchParams.get('embed') === '1';

    if (!isEmbedMode) {
      const auth = await requireApiAuth();
      if (!auth.ok) return auth.response;
    }

    const raw = requestUrl.searchParams.get('url')?.trim();
    if (!raw) {
      return new Response('Missing url parameter', { status: 400 });
    }

    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return new Response('Invalid url parameter', { status: 400 });
    }

    if (!isAllowedUrl(target)) {
      return new Response('Unsupported protocol', { status: 400 });
    }

    try {
      await ensureHostIsSafe(target);
    } catch {
      return new Response('Target host is not allowed', { status: 400 });
    }

    const secFetchSite = resolveSecFetchSite(requestUrl, target);
    const baseHeaders = buildBaseHeaders(req, target, secFetchSite);

    const refererCandidates: Array<string | null> = [];

    if (baseHeaders.has('Referer')) {
      refererCandidates.push(baseHeaders.get('Referer'));
    }

    const incomingReferer = req.headers.get('referer');
    if (incomingReferer) {
      refererCandidates.push(incomingReferer);
    }

    refererCandidates.push(`${requestUrl.origin}/`);
    refererCandidates.push(null);

    let upstream: Response | null = null;
    let lastFailed: { status: number; statusText: string } | null = null;
    const seen = new Set<string | null>();

    for (const candidate of refererCandidates) {
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);

      const headers = new Headers(baseHeaders);
      if (candidate) {
        headers.set('Referer', candidate);
      } else {
        headers.delete('Referer');
      }

      const attempt = await tryFetch(target, headers);
      if (attempt && attempt.ok && attempt.body) {
        upstream = attempt;
        break;
      }

      if (attempt) {
        lastFailed = { status: attempt.status, statusText: attempt.statusText };
      }
    }

    if (!upstream || !upstream.body) {
      const status = lastFailed?.status ?? 502;
      const message = lastFailed?.statusText || 'Upstream error';
      const errorHeaders = new Headers();
      errorHeaders.set('Cache-Control', 'no-store');
      if (lastFailed?.status) {
        errorHeaders.set('X-Upstream-Status', String(lastFailed.status));
      }
      return new Response(message, { status, headers: errorHeaders });
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return new Response('Unsupported upstream content-type', { status: 415 });
    }

    const contentLengthRaw = upstream.headers.get('content-length');
    const contentLength = contentLengthRaw ? Number(contentLengthRaw) : 0;
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_SIZE_BYTES) {
      return new Response('Image too large', { status: 413 });
    }

    const limitedBody = await readLimitedImage(upstream);
    if (!limitedBody.ok) {
      return new Response('Image too large', { status: 413 });
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=60, s-maxage=60');

    return new Response(limitedBody.data, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Image proxy error:', error);
    return new Response('Failed to fetch image', { status: 500 });
  }
}

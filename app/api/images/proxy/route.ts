import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36';
const DEFAULT_ACCEPT = 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8';
const FORWARDED_CREDENTIAL_HEADERS: Array<[string, string]> = [
  ['cookie', 'Cookie'],
  ['authorization', 'Authorization'],
  ['x-api-key', 'x-api-key'],
  ['x-access-token', 'X-Access-Token'],
  ['x-client-info', 'X-Client-Info'],
  ['x-xsrf-token', 'X-XSRF-Token'],
  ['x-csrf-token', 'X-CSRF-Token'],
];

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
  headers.set('Accept-Encoding', 'gzip, deflate, br');
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

function applyCredentialHeaders(req: NextRequest, headers: Headers, secFetchSite: string): void {
  if (secFetchSite === 'cross-site') {
    return;
  }

  for (const [incoming, outgoing] of FORWARDED_CREDENTIAL_HEADERS) {
    const value = req.headers.get(incoming);
    if (value) {
      headers.set(outgoing, value);
    }
  }
}

async function tryFetch(url: URL, headers: Headers): Promise<Response | null> {
  try {
    return await fetch(url.toString(), {
      cache: 'no-store',
      redirect: 'follow',
      headers,
    });
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const requestUrl = new URL(req.url);
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

    const secFetchSite = resolveSecFetchSite(requestUrl, target);
    const baseHeaders = buildBaseHeaders(req, target, secFetchSite);
    applyCredentialHeaders(req, baseHeaders, secFetchSite);

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
      errorHeaders.set('Access-Control-Allow-Origin', '*');
      errorHeaders.set('Cache-Control', 'no-store');
      if (lastFailed?.status) {
        errorHeaders.set('X-Upstream-Status', String(lastFailed.status));
      }
      return new Response(message, { status, headers: errorHeaders });
    }

    const headers = new Headers();
    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      headers.set('Content-Type', contentType);
    }
    headers.set('Cache-Control', 'public, max-age=60, s-maxage=60');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Image proxy error:', error);
    return new Response('Failed to fetch image', { status: 500 });
  }
}

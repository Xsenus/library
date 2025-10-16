import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function isAllowedUrl(url: URL): boolean {
  return ALLOWED_PROTOCOLS.has(url.protocol);
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

    const upstream = await fetch(target.toString(), {
      cache: 'no-store',
      redirect: 'follow',
    });

    if (!upstream.ok || !upstream.body) {
      return new Response('Upstream error', { status: upstream.status || 502 });
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

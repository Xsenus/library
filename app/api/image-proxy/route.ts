import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
export const runtime = 'nodejs';

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get('url');

  if (!rawUrl) {
    return badRequest('Parameter "url" is required.');
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return badRequest('Parameter "url" must be a valid http(s) URL.');
  }

  if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
    return badRequest('Only http and https protocols are supported.');
  }

  const controller = new AbortController();
  request.signal.addEventListener('abort', () => controller.abort(), { once: true });

  const upstream = await fetch(target, {
    redirect: 'follow',
    signal: controller.signal,
  }).catch((error: unknown) => {
    console.error('image-proxy upstream fetch failed', target.toString(), error);
    throw error;
  });

  if (!upstream.ok || !upstream.body) {
    return badRequest(`Upstream request failed with status ${upstream.status}.`, upstream.status);
  }

  const headers = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) {
    headers.set('content-type', contentType);
  }
  headers.set('access-control-allow-origin', '*');
  headers.set('cache-control', 'public, max-age=60');

  return new NextResponse(upstream.body, {
    status: 200,
    headers,
  });
}

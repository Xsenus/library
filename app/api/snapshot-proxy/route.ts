import { NextResponse } from 'next/server';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB safety cap

function validateTargetUrl(raw: string | null): URL {
  if (!raw) {
    throw new Response('Missing url parameter', { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new Response('Invalid url parameter', { status: 400 });
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Response('Unsupported protocol', { status: 400 });
  }

  return target;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const target = validateTargetUrl(url.searchParams.get('url'));

    const upstream = await fetch(target, { cache: 'no-store' });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream responded with ${upstream.status}` },
        { status: 502 },
      );
    }

    const contentLength = upstream.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Image is too large' }, { status: 413 });
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'Unsupported content type' }, { status: 415 });
    }

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Image is too large' }, { status: 413 });
    }

    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const dataUrl = `data:${contentType};base64,${base64}`;

    return NextResponse.json({ dataUrl });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error('Snapshot proxy failed', error);
    return NextResponse.json({ error: 'Snapshot proxy failure' }, { status: 500 });
  }
}

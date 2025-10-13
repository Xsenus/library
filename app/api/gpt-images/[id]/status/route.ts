import { NextResponse } from 'next/server';

const DEFAULT_BASE = '/static/';

type Key = 'old' | 'cryo';

const SUFFIX: Record<Key, string> = {
  old: '_old.jpg',
  cryo: '_cryo.jpg',
};

function ensureTrailingSlash(input: string): string {
  return input.endsWith('/') ? input : `${input}/`;
}

function resolveBase(origin: string): string {
  const raw =
    process.env.NEXT_PUBLIC_GPT_IMAGES_BASE ?? process.env.GPT_IMAGES_BASE ?? DEFAULT_BASE;
  try {
    const resolved = new URL(raw, origin);
    return ensureTrailingSlash(resolved.toString());
  } catch {
    const fallback = new URL(DEFAULT_BASE, origin);
    return ensureTrailingSlash(fallback.toString());
  }
}

async function checkImage(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (head.ok) {
      return true;
    }
    if (head.status === 404) {
      return false;
    }
  } catch (error) {
    console.error('Failed to perform HEAD request for GPT image', error);
  }

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (response.ok) {
      return true;
    }
    if (response.status === 404) {
      return false;
    }
  } catch (error) {
    console.error('Failed to perform GET request for GPT image', error);
  }

  return false;
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const id = params.id?.trim();
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid equipment id' }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const base = resolveBase(origin);

  const targets = (['old', 'cryo'] as const).map((key) => `${base}${id}${SUFFIX[key]}`);

  const [old, cryo] = await Promise.all(targets.map((url) => checkImage(url)));

  return NextResponse.json(
    { old, cryo },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

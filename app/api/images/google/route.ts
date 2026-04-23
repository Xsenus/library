// app/api/images/google/route.ts
import { NextRequest } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;

type RateEntry = { count: number; resetAt: number };

declare global {
  var __libraryMainGoogleImageRateLimit: Map<string, RateEntry> | undefined;
}

const rateLimitStore =
  globalThis.__libraryMainGoogleImageRateLimit ?? new Map<string, RateEntry>();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__libraryMainGoogleImageRateLimit = rateLimitStore;
}

type GoogleItem = {
  link: string;
  title: string;
  mime: string;
  image: {
    contextLink: string;
    thumbnailLink: string;
    height: number;
    width: number;
  };
};

function buildRateKey(req: NextRequest, userId: number): string {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwardedFor || req.headers.get('x-real-ip') || 'unknown';
  return `u:${userId}|ip:${ip}`;
}

function checkRateLimit(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const current = rateLimitStore.get(key);

  if (!current || now >= current.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }

  current.count += 1;
  rateLimitStore.set(key, current);
  return { ok: true };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth();
    if (!auth.ok) return auth.response;

    const rateKey = buildRateKey(req, auth.session.id);
    const limited = checkRateLimit(rateKey);
    if (!limited.ok) {
      return Response.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
      );
    }

    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim() ?? '';
    const num = Math.min(Number(searchParams.get('num') ?? 10), 10);
    if (!q) return Response.json({ items: [] });

    const key = process.env.GOOGLE_CSE_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    if (!key || !cx) {
      return Response.json({ error: 'Image search is not configured' }, { status: 500 });
    }

    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', key);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', q);
    url.searchParams.set('searchType', 'image');
    url.searchParams.set('num', String(num));
    url.searchParams.set('safe', 'off');
    url.searchParams.set(
      'fields',
      'items(link,mime,title,image/contextLink,image/thumbnailLink,image/height,image/width),error',
    );

    const r = await fetch(url.toString(), {
      cache: 'no-store',
    });

    const raw = await r.text();

    if (!r.ok) {
      let message = raw;
      try {
        const parsed = JSON.parse(raw);
        message = parsed?.error?.message || message;
      } catch {}
      return Response.json({ error: { status: r.status, message, raw } }, { status: r.status });
    }

    const json = JSON.parse(raw);
    const items = Array.isArray(json.items)
      ? (json.items as GoogleItem[]).map((i) => ({
          link: i.link,
          thumbnail: i.image?.thumbnailLink,
          context: i.image?.contextLink,
          title: i.title,
          width: i.image?.width ?? 0,
          height: i.image?.height ?? 0,
          mime: i.mime ?? '',
        }))
      : [];

    return Response.json(
      { items },
      { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } },
    );
  } catch (e: any) {
    return Response.json({ error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

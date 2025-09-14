// app/api/images/google/route.ts
import { NextRequest } from 'next/server';
export const runtime = 'nodejs';

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

export async function GET(req: NextRequest) {
  try {
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

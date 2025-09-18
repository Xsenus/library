// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Cookie, который мы ставим при логине (из lib/auth.ts)
const COOKIE_NAME = 'cin_session';

// На эти пути пускаем без сессии
const PUBLIC_PATHS = [
  '/login',
  '/favicon.ico',
  '/_next', // статика Next
  '/static', // твои статические файлы, если есть
];

// утилита: является ли путь публичным?
function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // пропускаем публичные пути
  if (isPublic(pathname)) return NextResponse.next();

  // Только для страниц (API не трогаем этим middleware)
  // Если хочешь закрыть всё, см. блок config ниже.
  const isApi = pathname.startsWith('/api/');
  if (isApi) return NextResponse.next();

  const hasSession = Boolean(req.cookies.get(COOKIE_NAME)?.value);

  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname || '/');
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Матчим только ПАГИ (страницы), API не трогаем.
// Если хочешь закрыть ещё что-то, добавляй сюда.
export const config = {
  matcher: [
    // всё, кроме: /login, /_next/*, /static/*, /favicon.ico, /api/*
    '/((?!login|_next|static|favicon.ico|api/).*)',
  ],
};

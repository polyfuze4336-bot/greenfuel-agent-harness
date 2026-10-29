import { NextResponse, type NextRequest } from 'next/server';

// The Studio serves private repository content with no sign-in, so it must only answer on loopback. Binding to
// localhost keeps other machines out; this check also rejects DNS-rebinding attempts, where a hostile web page
// points its own hostname at 127.0.0.1 and tries to read the API from the user's browser.
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

export function proxy(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const extra = (process.env.STUDIO_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!LOOPBACK.test(host) && !extra.includes(host.toLowerCase())) {
    return new NextResponse('Forbidden: the Architecture Studio answers only on localhost.', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  return NextResponse.next();
}

export const config = { matcher: '/:path*' };

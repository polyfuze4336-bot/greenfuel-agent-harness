import { NextResponse, type NextRequest } from 'next/server';

// The Studio serves private repository content with no sign-in, so it must only answer on loopback. Binding to
// localhost keeps other machines out; this check also rejects DNS-rebinding attempts, where a hostile web page
// points its own hostname at 127.0.0.1 and tries to read the API from the user's browser.
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const WEBHOOK_PATH = '/api/v1/github/webhook';

const list = (v: string | undefined) => (v ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

export function proxy(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const deny = (why: string) => new NextResponse(`Forbidden: ${why}`, { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (LOOPBACK.test(host) || list(process.env.STUDIO_ALLOWED_HOSTS).includes(host.toLowerCase())) return NextResponse.next();
  // A tunnel host for GitHub webhooks may reach the webhook route and nothing else. The signature is checked in the route.
  if (list(process.env.STUDIO_WEBHOOK_HOSTS).includes(host.toLowerCase()) && req.method === 'POST' && req.nextUrl.pathname === WEBHOOK_PATH) return NextResponse.next();
  return deny('the Architecture Studio answers only on localhost.');
}

export const config = { matcher: '/:path*' };

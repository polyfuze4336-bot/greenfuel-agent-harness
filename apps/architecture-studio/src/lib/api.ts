import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { NextResponse } from 'next/server';
import { GitError } from './repo/index.ts';

const gzipAsync = promisify(gzip);
/** Below this a response is cheaper to send as it is. */
const GZIP_MIN_BYTES = 2048;

/**
 * Compresses a JSON response when the caller accepts gzip. Next compresses pages and static files but not the JSON of a route handler,
 * and the queue and register responses are several hundred kilobytes of repetitive text. Only JSON bodies are touched: downloads
 * (PowerPoint, PDF, images) already carry their own types and are passed through.
 */
async function withGzip(res: Response): Promise<Response> {
  try {
    return await compressJson(res);
  } catch {
    return res; // compression is an optimisation; a response that cannot be compressed is sent as it is
  }
}

async function compressJson(res: Response): Promise<Response> {
  if (res.headers.get('content-encoding') || !/json/i.test(res.headers.get('content-type') ?? '')) return res;
  const { headers } = await import('next/headers');
  if (!/\bgzip\b/i.test((await headers()).get('accept-encoding') ?? '')) return res;
  const body = Buffer.from(await res.arrayBuffer());
  const out = new Headers(res.headers);
  out.set('Vary', [out.get('Vary'), 'Accept-Encoding'].filter(Boolean).join(', '));
  if (body.length < GZIP_MIN_BYTES) return new Response(body, { status: res.status, headers: out });
  const gz = await gzipAsync(body, { level: 5 });
  out.set('Content-Encoding', 'gzip');
  out.set('Content-Length', String(gz.length));
  return new Response(gz, { status: res.status, headers: out });
}

export function problem(status: number, title: string, detail: string, code?: string) {
  return NextResponse.json({ type: 'about:blank', title, status, detail, ...(code ? { code } : {}) }, { status, headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' } });
}

export function ok(body: unknown) {
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Wraps every route. Unless it is marked public, the caller must be allowed to read: in Entra mode that means a live session whose
 * roles include one that can read. Routes that change something then apply their own, stricter, authorization in the service.
 */
export async function guard(fn: () => Promise<Response>, opts: { public?: boolean } = {}): Promise<Response> {
  try {
    if (!opts.public) {
      const { readGate } = await import('./auth/server.ts');
      const denied = await readGate();
      if (denied) return denied;
    }
    return await withGzip(await fn());
  } catch (e) {
    if (e instanceof GitError) {
      const client = e.code === 'BAD_PATH' || e.code === 'BAD_REF';
      // A bad path or ref is the caller's mistake and says so. Anything else is git's own output, which can name server paths, so it stays in the server log.
      if (!client) console.error(`[studio] repository error ${e.code}: ${e.message}`);
      return problem(client ? 400 : 503, 'Repository unavailable', client ? e.message : 'The repository could not be read. Try again, or refresh from GitHub.', e.code);
    }
    return problem(500, 'Unexpected error', 'The Studio could not complete the request.');
  }
}

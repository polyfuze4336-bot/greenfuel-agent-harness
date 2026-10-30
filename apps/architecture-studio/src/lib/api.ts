import { NextResponse } from 'next/server';
import { GitError } from './repo/index.ts';

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
    return await fn();
  } catch (e) {
    if (e instanceof GitError) {
      const status = e.code === 'BAD_PATH' || e.code === 'BAD_REF' ? 400 : 503;
      return problem(status, 'Repository unavailable', e.message, e.code);
    }
    return problem(500, 'Unexpected error', 'The Studio could not complete the request.');
  }
}

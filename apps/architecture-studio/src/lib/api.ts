import { NextResponse } from 'next/server';
import { GitError } from './repo/index.ts';

export function problem(status: number, title: string, detail: string, code?: string) {
  return NextResponse.json({ type: 'about:blank', title, status, detail, ...(code ? { code } : {}) }, { status, headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' } });
}

export function ok(body: unknown) {
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GitError) {
      const status = e.code === 'BAD_PATH' || e.code === 'BAD_REF' ? 400 : 503;
      return problem(status, 'Repository unavailable', e.message, e.code);
    }
    return problem(500, 'Unexpected error', 'The Studio could not complete the request.');
  }
}

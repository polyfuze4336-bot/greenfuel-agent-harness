import fs from 'node:fs';
import { guard, problem } from '@/lib/api.ts';
import { latestFilePath } from '@/lib/deck/server.ts';

export const dynamic = 'force-dynamic';

/** The image of one slide from the latest build. The number is parsed as an integer; no part of the path comes from the request. */
export function GET(_req: Request, ctx: { params: Promise<{ n: string }> }) {
  return guard(async () => {
    const { n } = await ctx.params;
    if (!/^\d{1,3}$/.test(n)) return problem(400, 'Bad slide number', 'The slide number must be a whole number.');
    const f = latestFilePath({ preview: Number(n) });
    if (!f || !fs.existsSync(f.file)) return problem(404, 'No preview', 'There is no rendered preview of this slide yet.');
    return new Response(new Uint8Array(fs.readFileSync(f.file)), { headers: { 'Content-Type': f.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  });
}

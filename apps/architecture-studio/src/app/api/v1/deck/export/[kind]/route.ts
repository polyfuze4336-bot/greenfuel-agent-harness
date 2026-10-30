import fs from 'node:fs';
import { guard, problem } from '@/lib/api.ts';
import { latestFilePath, readLatest } from '@/lib/deck/server.ts';

export const dynamic = 'force-dynamic';

/** Downloads the latest build as PowerPoint or PDF. A sample build is named and marked as a sample. */
export function GET(_req: Request, ctx: { params: Promise<{ kind: string }> }) {
  return guard(async () => {
    const { kind } = await ctx.params;
    if (kind !== 'pptx' && kind !== 'pdf') return problem(400, 'Unknown export', 'Choose pptx or pdf.');
    const f = latestFilePath(kind);
    if (!f || !fs.existsSync(f.file)) return problem(404, 'Nothing to export', kind === 'pdf' ? 'There is no PDF: it needs a build rendered with Microsoft PowerPoint.' : 'Build the deck first.');
    const l = readLatest();
    return new Response(new Uint8Array(fs.readFileSync(f.file)), {
      headers: { 'Content-Type': f.type, 'Content-Disposition': `attachment; filename="${f.name}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Deck-Mode': l?.mode ?? 'unknown' },
    });
  });
}

import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * The only place the Studio loads code from `harness/`. The harness owns the approval rules, the canonical JSON and the demo facts;
 * the Studio calls them and never copies them, so the two cannot drift. Everything else imports from here, and a test fails if any
 * other file under `src/` calls `createRequire`.
 *
 * `codeRoot` is the repository whose harness code runs. In CI it is the trusted base checkout, which is why it is a parameter and not
 * the folder the data is read from.
 */
export function requireHarness<T>(codeRoot: string, ...segments: string[]): T {
  if (!segments.length || segments.some((s) => s.includes('..') || path.isAbsolute(s))) throw new Error('A harness module is named by relative segments that stay inside harness/.');
  const req = createRequire(path.join(codeRoot, 'package.json'));
  return req(path.join(codeRoot, 'harness', ...segments)) as T;
}

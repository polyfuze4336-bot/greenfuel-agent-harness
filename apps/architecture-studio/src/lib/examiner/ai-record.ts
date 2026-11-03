import { scanText } from './safety.ts';
import { SECTION_KEYS, type AiChallenge, type AiClaim, type SectionKey } from './types.ts';

// An AI critic's challenge is a file in the repository, written by the architecture-critic or principal-architect agent (or a person
// using them) and merged by pull request: docs/architecture-studio/examiner/<decision id>.json. The Studio never writes it and never
// takes its word for anything. It checks the shape, then checks every claim against the files it cites: the file must exist, the
// line must be in it, and a quoted passage must really appear. A claim that fails any of these is shown as unsupported, apart, and
// is never counted toward anything.

export const EXAMINER_DIR = 'docs/architecture-studio/examiner/';

const TOP_KEYS = new Set(['decisionId', 'label', 'reviewState', 'generatedBy', 'basedOnCommit', 'entries', 'notAssessed']);
const ENTRY_KEYS = new Set(['section', 'text', 'evidence']);
const EVIDENCE_KEYS = new Set(['path', 'line', 'quote']);
const MAX_ENTRIES = 60;
const MAX_TEXT = 1200;

export interface FileAccess {
  read(path: string): string | null;
  has(path: string): boolean;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function validateAiChallenge(raw: unknown, path: string, decisionId: string, files: FileAccess): AiChallenge | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'is not a JSON object' };
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!TOP_KEYS.has(k)) return { error: `has an unknown field "${k}" (a challenge carries no status, approval or confidence)` };
  if (r.decisionId !== decisionId) return { error: `names ${String(r.decisionId)}, not ${decisionId}` };
  if (r.label !== 'AI CHALLENGE') return { error: 'label must be "AI CHALLENGE"' };
  if (r.reviewState !== 'unreviewed') return { error: 'reviewState must be "unreviewed": only a person may review it, outside this file' };
  const g = r.generatedBy as { kind?: string; agent?: string; tool?: string; date?: string } | undefined;
  if (!g || g.kind !== 'ai' || !g.agent || !g.tool || !/^\d{4}-\d\d-\d\d$/.test(g.date ?? '')) return { error: 'generatedBy must name the AI agent, the tool and the date' };
  if (!Array.isArray(r.entries) || r.entries.length === 0 || r.entries.length > MAX_ENTRIES) return { error: `entries must be a list of 1 to ${MAX_ENTRIES}` };
  const notAssessed = Array.isArray(r.notAssessed) ? r.notAssessed.map(String).slice(0, 20) : [];

  const problems: string[] = [];
  const claims: AiClaim[] = [];
  r.entries.forEach((e, i) => {
    const where = `entry ${i + 1}`;
    if (!e || typeof e !== 'object') return void problems.push(`${where} is not an object and was skipped`);
    const x = e as Record<string, unknown>;
    for (const k of Object.keys(x)) if (!ENTRY_KEYS.has(k)) return void problems.push(`${where} has an unknown field "${k}" and was skipped`);
    if (!SECTION_KEYS.includes(x.section as SectionKey)) return void problems.push(`${where} names a section that does not exist and was skipped`);
    if (typeof x.text !== 'string' || !x.text.trim() || x.text.length > MAX_TEXT) return void problems.push(`${where} has no text, or more than ${MAX_TEXT} characters, and was skipped`);
    const ev = Array.isArray(x.evidence) ? x.evidence : [];
    const evidence = ev.slice(0, 6).map((v) => {
      const y = (v ?? {}) as Record<string, unknown>;
      const bad = Object.keys(y).find((k) => !EVIDENCE_KEYS.has(k));
      const p = typeof y.path === 'string' ? y.path : '';
      const line = Number.isInteger(y.line) ? (y.line as number) : null;
      const quote = typeof y.quote === 'string' && y.quote.trim() ? y.quote : null;
      let problem: string | null = null;
      if (bad) problem = `unknown field "${bad}"`;
      else if (!p || p.includes('..') || p.startsWith('/')) problem = 'the path is not a repository-relative path';
      else if (!files.has(p)) problem = 'the file does not exist at this commit';
      else {
        const text = files.read(p) ?? '';
        const lines = text.split('\n').length;
        if (line === null) problem = 'no line number is given';
        else if (!quote) problem = 'no quoted text is given';
        else if (line < 1 || line > lines) problem = `line ${line} is outside the file (${lines} lines)`;
        else {
          // The quote must sit at the cited line, or run on from it: a quote found elsewhere in the file does not support this citation.
          const window = text.split('\n').slice(Math.max(0, line - 2), line + 5).join(' ');
          if (!norm(window).includes(norm(quote))) problem = norm(text).includes(norm(quote)) ? 'the quoted text is in the file but not at the cited line' : 'the quoted text does not appear in the file';
        }
      }
      return { path: p, line, quote, verified: problem === null, problem };
    });
    const supported = evidence.length > 0 && evidence.every((v) => v.verified);
    claims.push({ section: x.section as SectionKey, text: x.text.trim(), evidence, supported, injection: scanText(where, x.text).length > 0 });
  });
  return { path, agent: g.agent, tool: g.tool, date: g.date!, label: 'AI CHALLENGE', reviewState: 'unreviewed', claims, notAssessed, problems };
}

import { adrRefs, dRefs, field, parseAdr, parseRegister, parseRisks, parseRoadmap, parseTodo, plain, reqRefs, tableRows, type Row } from '../repo/parse.ts';
import type { Decision, Risk, Task } from '../repo/types.ts';
import type { Verdict } from './schema.ts';

// Per-file extraction. Each function is pure: the same file content always gives the same fragment, so a fragment can be
// cached by the git blob id of its file. That is what makes synchronisation incremental.

export type FragmentKind = 'adr' | 'register' | 'requirements' | 'trace' | 'assumptions' | 'risks' | 'todo' | 'roadmap' | 'design' | 'review' | 'approval' | 'evidence' | 'rubric' | 'suggestions' | 'doc';

export interface Fragment {
  kind: FragmentKind;
  path: string;
  oid: string;
  data: Record<string, unknown>;
}

export function classify(path: string): FragmentKind | null {
  if (/^docs\/adr\/\d{4}-.*\.md$/.test(path) && !path.startsWith('docs/adr/0000-')) return 'adr';
  if (path === 'docs/context/DECISION-REGISTER.md') return 'register';
  if (path === 'docs/context/REQUIREMENTS.md' || path === 'docs/context/NON-FUNCTIONAL-REQUIREMENTS.md') return 'requirements';
  if (path === 'docs/context/REQUIREMENTS-TRACEABILITY.md') return 'trace';
  if (path === 'docs/context/ASSUMPTIONS.md') return 'assumptions';
  if (path === 'docs/architecture/RISK-REGISTER.md') return 'risks';
  if (path === 'docs/state/TODO.md') return 'todo';
  if (path === 'docs/harness/IMPLEMENTATION-ROADMAP.md') return 'roadmap';
  if (/^docs\/architecture\/designs\/DES-.*\.md$/.test(path)) return 'design';
  if (/^docs\/architecture\/reviews\/RV-.*\.md$/.test(path)) return 'review';
  if (/^docs\/approvals\/[^/]+\.json$/.test(path)) return 'approval';
  if (/^docs\/evidence\/records\/EV-\d+\.json$/.test(path)) return 'evidence';
  if (path === 'docs/capstone/RUBRIC-TRACEABILITY.md') return 'rubric';
  if (/^docs\/architecture-studio\/suggestions\/[^/]+\.json$/.test(path)) return 'suggestions';
  if (/^docs\/.*\.md$/.test(path) && !/^docs\/state\/(runs|loops)\//.test(path) && !path.startsWith('docs/architecture-studio/')) return 'doc';
  return null;
}

const uniq = <T>(a: T[]): T[] => [...new Set(a)];

/** Decision citations in a document: D-nnn and ADR-nnnn. Used for the "cited by" index and for dependency edges. */
export function citations(text: string): string[] {
  return uniq([...dRefs(text), ...adrRefs(text).map((n) => `ADR-${n}`)]);
}

export interface SectionAt {
  text: string;
  line: number;
}

/** The body of a "## Heading" section and the line it starts on. */
export function sectionAt(text: string, heading: string): SectionAt | null {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^## ${heading}\\b`).test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end);
  const first = body.findIndex((l) => l.trim() !== '');
  if (first < 0) return null;
  return { text: body.slice(first).join('\n').trimEnd(), line: start + 2 + first };
}

export interface ParsedOption {
  key: string;
  name: string;
  summary: string | null;
  disposition: string | null;
  tradeoffs: string | null;
  line: number;
}

const DISPOSITION_BOLD = /\*\*(Rejected(?: \([^)]*\))?|Not selected(?: as [^.*]*)?|Deferred|Selected)\.?:?\*\*/i;
const DISPOSITION_PAREN = /\((selected|chosen|proposed)\)/i;
const DISPOSITION_PLAIN = /(?:^|[.:] )(Not selected(?: as [a-z ]+)?|Rejected(?: \([^)]*\))?|Deferred)(?=[.:\s]|$)/;

function disposition(line: string): string | null {
  const b = DISPOSITION_BOLD.exec(line)?.[1];
  if (b) return b.replace(/^./, (c) => c.toUpperCase()).replace(/\s+/g, ' ');
  const p = DISPOSITION_PAREN.exec(line)?.[1];
  if (p) return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  const r = DISPOSITION_PLAIN.exec(line)?.[1];
  return r ? r.replace(/\s+/g, ' ') : null;
}

export function parseOptions(sec: SectionAt | null): ParsedOption[] {
  if (!sec) return [];
  const out: ParsedOption[] = [];
  sec.text.split('\n').forEach((l, i) => {
    const m = /^(\d+)\.\s+(.*)$/.exec(l);
    if (!m) return;
    const body = m[2]!;
    const bold = /^\*\*(.+?)\*\*\s*(.*)$/.exec(body);
    let name = bold ? bold[1]! : body.split(/[.:]/)[0]!;
    const rest = bold ? bold[2]! : body.slice(name.length);
    const letter = /^([A-Z])\.\s+(.*)$/.exec(name);
    const paren = /\(option ([A-Z])\)/i.exec(name);
    let key = `#${m[1]}`;
    if (letter) {
      key = letter[1]!;
      name = letter[2]!;
    } else if (paren) key = paren[1]!.toUpperCase();
    const cleanName = plain(name.replace(/\((?:option [A-Z]|selected|chosen|proposed)\)/gi, '').replace(/[.:]\s*$/, ''));
    const tradeoff = /Trade-offs?:\s*(.*)$/i.exec(rest)?.[1] ?? null;
    const summary = plain(rest.replace(/Trade-offs?:.*$/i, '').replace(DISPOSITION_BOLD, '')).replace(/\s+$/, '');
    out.push({ key, name: cleanName, summary: summary || null, disposition: disposition(body), tradeoffs: tradeoff ? plain(tradeoff) : null, line: sec.line + i });
  });
  return out;
}

function extractAdr(path: string, text: string): Record<string, unknown> {
  const legacy: Decision = parseAdr(text, path);
  const sec = (h: string) => sectionAt(text, h);
  const consequences = sec('Consequences');
  const posneg = (kind: 'Positive' | 'Negative') =>
    (consequences?.text.split('\n') ?? []).flatMap((l, i) => (new RegExp(`^- ${kind}:`, 'i').test(l) ? [{ text: plain(l.replace(/^- \w+:\s*/, '')), line: consequences!.line + i }] : []));
  return {
    legacy,
    review: field(text, 'Review') ?? null,
    supersedes: field(text, 'Supersedes') ?? null,
    sections: Object.fromEntries(
      Object.entries({ context: 'Context', decision: 'Decision', why: 'Why this option is appropriate', requirements: 'Requirements addressed', consequences: 'Consequences', reliability: 'Reliability consequences', security: 'Security consequences', residency: 'Residency implications', cost: 'Cost and operational implications', reversibility: 'Reversibility', evidence: 'Evidence' }).map(([k, h]) => [k, sec(h)]),
    ),
    options: parseOptions(sec('Options considered')),
    positive: posneg('Positive'),
    negative: posneg('Negative'),
    evidenceIds: uniq(sec('Evidence')?.text.match(/\bEV-\d{4}\b/g) ?? []).concat(uniq(sec('Validation evidence')?.text.match(/\bEV-\d{4}\b/g) ?? [])),
    otherEvidence: uniq([...(sec('Evidence')?.text.match(/\b(?:RV|DES)-\d{4}\b/g) ?? []), ...(sec('Review gate')?.text.match(/\b(?:RV|DES)-\d{4}\b/g) ?? [])]),
    requirements: reqRefs(sec('Requirements addressed')?.text ?? ''),
  };
}

function verdictOf(cell: string): Verdict {
  if (/^Meets\b/i.test(cell)) return 'meets';
  if (/^Does not meet\b/i.test(cell)) return 'does-not-meet';
  if (/^Conditional\b/i.test(cell)) return 'conditional';
  return 'unknown';
}

function extractDesign(path: string, text: string): Record<string, unknown> {
  const id = field(text, 'Design ID') ?? null;
  const lines = text.split('\n');
  const head = lines.findIndex((l) => /^## \d+\. Alternatives comparison/.test(l));
  let comparison: Record<string, unknown> | null = null;
  if (head >= 0) {
    let end = lines.findIndex((l, i) => i > head && /^## /.test(l));
    if (end < 0) end = lines.length;
    const rows = tableRows(lines.slice(head, end).join('\n')).map((r: Row) => ({ cells: r.cells, line: head + r.line }));
    const header = rows[0]?.cells ?? [];
    const columns = header.slice(1);
    comparison = {
      line: head + 1,
      columns,
      rows: rows.slice(1).map((r) => ({
        criterion: plain(r.cells[0] ?? ''),
        line: r.line,
        cells: Object.fromEntries(columns.map((c, i) => [c, { verdict: verdictOf(r.cells[i + 1] ?? ''), text: plain(r.cells[i + 1] ?? '') }])),
      })),
    };
  }
  const optHead = lines.findIndex((l) => /^## \d+\. Options/.test(l));
  const options: { key: string; name: string; summary: string; disposition: string; line: number }[] = [];
  if (optHead >= 0) {
    let end = lines.findIndex((l, i) => i > optHead && /^## /.test(l));
    if (end < 0) end = lines.length;
    for (const r of tableRows(lines.slice(optHead, end).join('\n'))) {
      if (/^[A-Z]$/.test(r.cells[0] ?? '')) options.push({ key: r.cells[0]!, name: plain(r.cells[1] ?? ''), summary: plain(r.cells[2] ?? ''), disposition: plain(r.cells[3] ?? ''), line: optHead + r.line });
    }
  }
  return {
    id,
    review: field(text, 'Review') ?? null,
    adrs: (field(text, 'ADRs') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    tags: (field(text, 'Tags') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    title: plain((lines[0] ?? '').replace(/^# /, '')),
    idLine: lines.findIndex((l) => /Design ID/.test(l)) + 1 || 1,
    comparison,
    options,
  };
}

function extractReview(text: string): Record<string, unknown> {
  const lines = text.split('\n');
  return { id: field(text, 'Review ID') ?? null, design: field(text, 'Design') ?? null, declared: field(text, 'Status') ?? null, decider: field(text, 'Decider') ?? null, line: lines.findIndex((l) => /Review ID/.test(l)) + 1 || 1 };
}

function extractRubric(text: string): Record<string, unknown> {
  const mentions: { criterion: string; title: string; label: string; line: number; ids: string[] }[] = [];
  let cur: { id: string; title: string } | null = null;
  text.split('\n').forEach((l, i) => {
    const h = /^### ([A-D]\d+)\.\s*(.*)$/.exec(l);
    if (h) {
      cur = { id: h[1]!, title: plain(h[2]!) };
      return;
    }
    if (/^## /.test(l)) cur = null;
    if (!cur) return;
    const ids = uniq([...dRefs(l), ...adrRefs(l).map((n) => `ADR-${n}`), ...(l.match(/\b(?:DES|RV)-\d{4}\b/g) ?? [])]);
    if (!ids.length) return;
    const label = /^\s*-\s+\*\*([^:*]+):\*\*/.exec(l)?.[1] ?? 'Mentioned';
    mentions.push({ criterion: cur.id, title: cur.title, label, line: i + 1, ids });
  });
  return { mentions };
}

function extractSuggestions(text: string): Record<string, unknown> {
  let parsed: { suggestions?: Record<string, unknown>[] } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return { invalid: true, suggestions: [] };
  }
  const lines = text.split('\n');
  const list = (parsed.suggestions ?? []).map((s) => ({ ...s, line: lines.findIndex((l) => l.includes(`"id": "${String(s.id)}"`)) + 1 || 1 }));
  return { suggestions: list };
}

function extractApproval(text: string): Record<string, unknown> {
  try {
    const j = JSON.parse(text) as { schema?: string; id?: string; subject?: { type?: string; id?: string }; decision?: string; createdAt?: string; reason?: string; signatures?: unknown[] };
    return { schema: j.schema ?? null, id: j.id ?? null, subject: j.subject ?? null, decision: j.decision ?? null, createdAt: j.createdAt ?? null, reason: j.reason ?? null, signatures: Array.isArray(j.signatures) ? j.signatures.length : 0 };
  } catch {
    return { invalid: true };
  }
}

function extractEvidence(text: string): Record<string, unknown> {
  try {
    const j = JSON.parse(text) as { id?: string; claim?: string; exitCode?: number | null; startedAt?: string };
    return { id: j.id ?? null, claim: j.claim ?? null, exitCode: j.exitCode ?? null, startedAt: j.startedAt ?? null };
  } catch {
    return { invalid: true };
  }
}

export interface ReqRow {
  id: string;
  title: string;
  priority: string;
  line: number;
}
export interface TraceRow {
  id: string;
  decisions: string[];
  open: string[];
  verify: string[];
  line: number;
}
const REQ_ID = /^(?:BR|FR|SEC|DATA|AGT|NFR)-\d{3}$/;

export function extract(kind: FragmentKind, path: string, text: string): Record<string, unknown> {
  const cites = path.endsWith('.md') ? citations(text) : [];
  const title = path.endsWith('.md') ? plain((text.split('\n').find((l) => /^# /.test(l)) ?? '').replace(/^# /, '')) : '';
  let data: Record<string, unknown>;
  switch (kind) {
    case 'adr':
      data = extractAdr(path, text);
      break;
    case 'register':
      data = { rows: parseRegister(text, path) as Decision[] };
      break;
    case 'requirements':
      data = {
        rows: tableRows(text).filter((r) => REQ_ID.test(r.cells[0] ?? '')).map<ReqRow>((r) => ({ id: r.cells[0]!, title: plain(r.cells[2] ?? ''), priority: r.cells[4] ?? '', line: r.line })),
      };
      break;
    case 'trace':
      data = {
        rows: tableRows(text).filter((r) => REQ_ID.test(r.cells[0] ?? '')).map<TraceRow>((r) => ({ id: r.cells[0]!, decisions: dRefs(r.cells[4] ?? ''), open: dRefs(r.cells[6] ?? ''), verify: dRefs(r.cells[7] ?? ''), line: r.line })),
      };
      break;
    case 'assumptions':
      data = { rows: tableRows(text).filter((r) => /^AS-\d{3}$/.test(r.cells[0] ?? '')).map((r) => ({ id: r.cells[0]!, text: plain(r.cells[1] ?? ''), replacedBy: plain(r.cells[5] ?? ''), line: r.line })) };
      break;
    case 'risks':
      data = { rows: parseRisks(text, path) as Risk[] };
      break;
    case 'todo': {
      const log = tableRows(text)
        .filter((r) => /^\d{4}-\d\d-\d\d$/.test(r.cells[0] ?? ''))
        .map((r) => ({ date: r.cells[0]!, text: plain(r.cells.slice(1, 3).join(' ')), adrs: adrRefs(r.cells.slice(1).join(' ')), line: r.line }));
      data = { rows: parseTodo(text, path) as Task[], log };
      break;
    }
    case 'roadmap':
      data = { rows: parseRoadmap(text, path) as Task[] };
      break;
    case 'design':
      data = extractDesign(path, text);
      break;
    case 'review':
      data = extractReview(text);
      break;
    case 'approval':
      data = extractApproval(text);
      break;
    case 'evidence':
      data = extractEvidence(text);
      break;
    case 'rubric':
      data = extractRubric(text);
      break;
    case 'suggestions':
      data = extractSuggestions(text);
      break;
    default:
      data = {};
  }
  return { ...data, cites, title };
}

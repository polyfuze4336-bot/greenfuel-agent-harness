// Deterministic parsers for the repository documents that hold work the queue must show: capstone gaps, the prioritized backlog,
// the rubric traceability table, the security review, and the residency validation procedure. Pure functions over text; each row
// keeps the line it came from, so every work item can point at its authoritative source.
import { plain, tableRows } from '../repo/parse.ts';

export interface GapRow {
  id: string;
  title: string;
  text: string;
  severity: string;
  criteria: string[];
  evidence: string;
  modes: string[];
  closedBy: string[];
  line: number;
}

const ids = (s: string, re: RegExp) => [...new Set(s.match(re) ?? [])];
const MODE = /build|owner|live|publish/g;

export function parseGaps(text: string): GapRow[] {
  const out: GapRow[] = [];
  for (const { cells: c, line } of tableRows(text)) {
    if (!/^G-\d{2}$/.test(c[0] ?? '') || c.length < 7) continue;
    const full = plain(c[1] ?? '');
    const bold = /^\*\*(.+?)\*\*/.exec(c[1] ?? '')?.[1];
    out.push({
      id: c[0]!,
      title: plain(bold ?? full.split(/(?<=\.)\s/)[0] ?? full).replace(/\.$/, ''),
      text: full,
      severity: plain(c[2] ?? ''),
      criteria: ids(c[3] ?? '', /\b[A-D][1-9]\b/g),
      evidence: plain(c[4] ?? ''),
      modes: ids((c[5] ?? '').toLowerCase(), MODE),
      closedBy: ids(c[6] ?? '', /\bB-\d{2}\b/g),
      line,
    });
  }
  return out;
}

export interface BacklogRow {
  id: string;
  title: string;
  priority: string | null;
  modes: string[];
  fields: Record<string, { text: string; line: number }>;
  line: number;
}

export function parseBacklog(text: string): BacklogRow[] {
  const lines = text.split('\n');
  const out: BacklogRow[] = [];
  let cur: BacklogRow | null = null;
  lines.forEach((l, i) => {
    const h = /^### (B-\d{2}) (.+?) \(([^)]*)\)\s*$/.exec(l);
    if (h) {
      const params = h[3]!.toLowerCase();
      cur = { id: h[1]!, title: plain(h[2]!), priority: /\bp[0-3]\b/.exec(params)?.[0]?.toUpperCase() ?? null, modes: ids(params, MODE), fields: {}, line: i + 1 };
      out.push(cur);
      return;
    }
    if (/^#{1,3} /.test(l)) {
      cur = null;
      return;
    }
    const b = /^- \*\*([^*]+?):\*\*\s*(.*)$/.exec(l);
    if (b && cur) cur.fields[b[1]!.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase()] = { text: plain(b[2]!), line: i + 1 };
  });
  return out;
}

export interface RubricRow {
  id: string;
  title: string;
  assessment: string[];
  evidenceNow: string;
  floorExposure: string;
  mainGap: string;
  backlog: string[];
  priority: string | null;
  line: number;
}

export function parseRubric(text: string): RubricRow[] {
  const out: RubricRow[] = [];
  for (const { cells: c, line } of tableRows(text)) {
    if (!/^[A-D][1-9]$/.test(c[0] ?? '') || c.length < 8) continue;
    out.push({ id: c[0]!, title: plain(c[1] ?? ''), assessment: (c[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean), evidenceNow: plain(c[3] ?? ''), floorExposure: plain(c[4] ?? ''), mainGap: plain(c[5] ?? ''), backlog: ids(c[6] ?? '', /\bB-\d{2}\b/g), priority: /^P[0-3]$/.test(c[7] ?? '') ? c[7]! : null, line });
  }
  return out;
}

export interface SecurityFinding {
  id: string;
  pass: 'first' | 'second';
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  file: string;
  summary: string;
  outcome: string | null;
  changed: string | null;
  testedIn: string[];
  /** Fixed, with nothing in the remediation text that flags a remaining limit. */
  fullyFixed: boolean;
  line: number;
}

export interface SecurityOpenItem {
  id: string;
  item: string;
  owner: string;
  where: string;
  line: number;
}

const sev = (s: string): SecurityFinding['severity'] => (/HIGH/i.test(s) ? 'HIGH' : /MEDIUM/i.test(s) ? 'MEDIUM' : /LOW/i.test(s) ? 'LOW' : null);

/** A remediation counts as fully fixed only if it starts with "Fixed" and does not mark a remaining limit in bold. */
export function isFullyFixed(outcome: string, changed: string): boolean {
  return /^fixed\b/i.test(plain(outcome)) && !/\*\*/.test(changed) && !/\*\*/.test(outcome.replace(/^\*\*fixed\*\*/i, ''));
}

export function parseSecurity(text: string): { findings: SecurityFinding[]; open: SecurityOpenItem[] } {
  const lines = text.split('\n');
  const section = (i: number) => {
    for (let k = i; k >= 0; k--) {
      const m = /^## (\d+)\./.exec(lines[k] ?? '');
      if (m) return Number(m[1]);
    }
    return 0;
  };
  const findings = new Map<string, SecurityFinding>();
  const open: SecurityOpenItem[] = [];
  const remediation: { n: string; outcome: string; changed: string; tested: string; line: number }[] = [];
  for (const { cells: c, line } of tableRows(text)) {
    const s = section(line - 1);
    if (s === 2 && /^\d+$/.test(c[0] ?? '') && c.length >= 6) {
      const n = c[0]!.padStart(2, '0');
      findings.set(`SF-${n}`, { id: `SF-${n}`, pass: 'first', severity: sev(c[1] ?? ''), file: plain(c[2] ?? ''), summary: plain(c[4] ?? ''), outcome: null, changed: null, testedIn: [], fullyFixed: false, line });
    } else if (s === 3 && /^\d+$/.test(c[0] ?? '') && c.length >= 4) {
      remediation.push({ n: c[0]!.padStart(2, '0'), outcome: c[1] ?? '', changed: c[2] ?? '', tested: c[3] ?? '', line });
    } else if (s === 4 && /^N-\d+$/.test(c[0] ?? '') && c.length >= 5) {
      const id = `SF-N${c[0]!.slice(2)}`;
      findings.set(id, { id, pass: 'second', severity: sev(c[1] ?? ''), file: plain(c[2] ?? ''), summary: plain(c[3] ?? ''), outcome: plain(c[4] ?? ''), changed: c[4] ?? '', testedIn: [], fullyFixed: isFullyFixed(c[4] ?? '', c[4] ?? ''), line });
    } else if (s === 7 && c.length >= 3 && c[0] !== 'Item' && !/^\|?\s*-+/.test(c[0] ?? '')) {
      open.push({ id: `SO-${open.length + 1}`, item: plain(c[0] ?? ''), owner: plain(c[1] ?? ''), where: plain(c[2] ?? ''), line });
    }
  }
  for (const r of remediation) {
    const f = findings.get(`SF-${r.n}`);
    if (!f) continue;
    f.outcome = plain(r.outcome);
    f.changed = plain(r.changed);
    f.testedIn = [...r.tested.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!);
    f.fullyFixed = isFullyFixed(r.outcome, r.changed);
  }
  return { findings: [...findings.values()], open };
}

export interface ValidationRow {
  id: string;
  what: string;
  how: string;
  evidence: string;
  pass: string;
  line: number;
}

export function parseValidation(text: string): ValidationRow[] {
  const out: ValidationRow[] = [];
  for (const { cells: c, line } of tableRows(text)) {
    if (!/^V-\d{1,2}$/.test(c[0] ?? '') || c.length < 5) continue;
    out.push({ id: c[0]!, what: plain(c[1] ?? ''), how: plain(c[2] ?? ''), evidence: plain(c[3] ?? ''), pass: plain(c[4] ?? ''), line });
  }
  return out;
}

/** Explicit due dates only: "due 2026-11-02", "deadline: 2026-11-02", "due by 2 November" is NOT read (no year, no guess). */
export function explicitDueDate(text: string): string | null {
  const m = /\b(?:due(?: by| on| date)?|deadline)\b[:\s]+(\d{4}-\d{2}-\d{2})\b/i.exec(text);
  return m ? m[1]! : null;
}

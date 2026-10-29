import type { Assumption, Decision, DecisionStatus, Requirement, Risk, Task, TaskStatus } from './types.ts';

// Pure parsers over repository text. Each rule is the same rule the discovery script
// (harness/scripts/studio-inventory.mjs) used, so counts can be cross-checked against its snapshot.

export interface Row {
  cells: string[];
  line: number;
}

export const cells = (l: string): string[] =>
  l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());

const isSep = (c: string[]) => c.every((x) => /^:?-{3,}:?$/.test(x));

export function tableRows(text: string): Row[] {
  const out: Row[] = [];
  text.split('\n').forEach((l, i) => {
    if (!l.trim().startsWith('|')) return;
    const c = cells(l);
    if (!isSep(c)) out.push({ cells: c, line: i + 1 });
  });
  return out;
}

export const field = (t: string, name: string): string | undefined =>
  new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.*)$`, 'm').exec(t)?.[1]?.trim();

export function lineOf(text: string, re: RegExp): number {
  const i = text.split('\n').findIndex((l) => re.test(l));
  return i < 0 ? 1 : i + 1;
}

const uniq = <T>(a: T[]): T[] => [...new Set(a)];
export const dRefs = (s: string): string[] => uniq(s.match(/\bD-\d{3}\b/g) ?? []);
export const adrRefs = (s: string): string[] => uniq([...s.matchAll(/ADR[- ]?(\d{4})/g)].map((m) => m[1]!));
export const reqRefs = (s: string): string[] => uniq(s.match(/\b(?:BR|FR|SEC|DATA|AGT|NFR)-\d{3}\b/g) ?? []);
export const riskRefs = (s: string): string[] => uniq(s.match(/\bRK-\d{3}\b/g) ?? []);
export const assumptionRefs = (s: string): string[] => uniq(s.match(/\bAS-\d{3}\b/g) ?? []);
export const reviewRefs = (s: string): string[] => uniq(s.match(/\bRV-\d{4}\b/g) ?? []);
export const taskRefs = (s: string): string[] => uniq(s.match(/\bT\d{1,3}\b/g) ?? []);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
export const plain = (s: string) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();

export function sectionBody(text: string, heading: string): string {
  const m = new RegExp(`^## ${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`, 'm').exec(text);
  return m?.[1]?.trim() ?? '';
}

// ---- decision register

export function parseRegister(text: string, src: string): Decision[] {
  const out: Decision[] = [];
  for (const { cells: c, line } of tableRows(text)) {
    if (!/^D-\d{3}$/.test(c[0] ?? '')) continue;
    const statusRaw = c[7] ?? '';
    const review: string[] = [];
    let status: DecisionStatus = 'open';
    if (/^open$/i.test(statusRaw)) status = 'open';
    else {
      review.push(`Status "${statusRaw}" is not a recognised register status; shown as Open.`);
    }
    out.push({
      id: c[0]!,
      type: 'register',
      title: plain(c[2] ?? ''),
      status,
      statusRaw,
      kind: c[1],
      milestone: c[6],
      owner: c[5],
      summary: plain(c[3] ?? ''),
      whyItMatters: plain(c[3] ?? ''),
      options: (c[4] ?? '').split(';').map((s) => plain(s)).filter(Boolean),
      flags: { grandfathered: false, delegated: false, partialScope: false, signed: false, review },
      refs: { decisions: dRefs(`${c[2]} ${c[3]} ${c[4]}`).filter((d) => d !== c[0]), adrs: adrRefs(c.join(' ')), requirements: reqRefs(c.join(' ')), risks: [], assumptions: [], reviews: [], tasks: [] },
      src: { path: src, line },
    });
  }
  return out;
}

// ---- ADRs

const adrClass = (s: string): DecisionStatus | 'unclassified' =>
  /^Accepted/.test(s) ? 'accepted' : /^Proposed/.test(s) ? 'proposed' : /^Rejected/.test(s) ? 'rejected' : /^Superseded/.test(s) ? 'superseded' : /^Deferred/.test(s) ? 'deferred' : 'unclassified';

export function parseAdr(text: string, filePath: string): Decision {
  const file = filePath.split('/').pop() ?? filePath;
  const number = file.slice(0, 4);
  const statusRaw = field(text, 'Status') ?? '';
  const cls = adrClass(statusRaw);
  const review: string[] = [];
  const chatAccepted = /by instruction in chat/i.test(statusRaw);
  const delegated = /decision is the architect's|architect, on the owner's instruction/i.test(statusRaw);
  const partial = cls === 'accepted' && /deferred|not approved|excluded/i.test(statusRaw);
  if (cls === 'unclassified') review.push('Status line not recognised; shown as Proposed.');
  if (delegated) review.push("Accepted by the architect on the owner's instruction: confirm this is the owner's own decision.");
  if (partial) review.push('Accepted with part of the scope excluded or deferred: the Accepted label does not cover the whole subject.');
  const decisionPara = sectionBody(text, 'Decision').split(/\n\s*\n/)[0] ?? '';
  const contextPara = sectionBody(text, 'Context').split(/\n\s*\n/)[0] ?? '';
  const options = sectionBody(text, 'Options considered')
    .split('\n')
    .filter((l) => /^\d+\.\s/.test(l))
    .map((l) => clip(plain(l.replace(/^\d+\.\s*/, '')), 240));
  const full = text;
  return {
    id: `ADR-${number}`,
    type: 'adr',
    title: (text.split('\n')[0] ?? '').replace(/^# /, '').replace(/^ADR \d{4}:\s*/, ''),
    status: cls === 'unclassified' ? 'proposed' : cls,
    statusRaw,
    adrType: field(text, 'Type') ?? '(none: pre-Type)',
    date: field(text, 'Date'),
    owner: field(text, 'Deciders'),
    summary: clip(plain(decisionPara || contextPara), 600),
    options,
    flags: { grandfathered: chatAccepted, delegated, partialScope: partial, signed: false, review },
    refs: {
      decisions: dRefs(full),
      adrs: adrRefs(full).filter((n) => n !== number).map((n) => `ADR-${n}`),
      requirements: reqRefs(full),
      risks: riskRefs(full),
      assumptions: assumptionRefs(full),
      reviews: reviewRefs(full),
      tasks: [],
    },
    src: { path: filePath, line: 1 },
  };
}

// ---- tasks

const TASK_KEYWORD = /^\*\*(Decided|Done|Approved|Deferred|Open|Agreed|Not granted|Answered)\b/i;
const TOKENS = /\b(Deferred|Decided|Done|Approved|Open|Answered|Not granted|NOT RUN)\b/g;
const CLOSED: TaskStatus[] = ['done', 'decided', 'approved', 'agreed'];

export function blockedReason(status: TaskStatus, text: string): string | undefined {
  if (CLOSED.includes(status)) return undefined;
  if (status === 'not-granted') return 'Not granted: the approval or identity it needs has not been supplied.';
  const until = /\bUntil\b\s+([^.;|]{4,140})/.exec(text);
  if (until) return `Until ${plain(until[1]!).replace(/[,]+$/, '')}`;
  const by = /\bblocked (?:by|on)\s+([^.;|]{4,120})/i.exec(text);
  if (by) return `Blocked by ${plain(by[1]!)}`;
  return undefined;
}

export function parseTodo(text: string, src: string): Task[] {
  const out: Task[] = [];
  let section = '';
  text.split('\n').forEach((l, i) => {
    const h = /^## (.*)/.exec(l);
    if (h) {
      section = h[1]!;
      return;
    }
    if (!/^\| T\d+ \|/.test(l)) return;
    const c = cells(l);
    const body = c.slice(1).join(' | ');
    const lead = TASK_KEYWORD.exec(body)?.[1]?.toLowerCase();
    const tokens = uniq([...body.slice(0, 600).matchAll(TOKENS)].map((m) => m[1]!.toLowerCase()));
    let status = (lead ?? (section.startsWith('Owner has deferred') ? 'deferred' : 'unmarked')) as string;
    if (status === 'not granted') status = 'not-granted';
    if (status === 'answered') status = 'done';
    const ambiguous = status === 'unmarked' || (tokens.length > 2 && !lead) || (!!lead && tokens.filter((x) => x !== lead).length >= 3);
    const st = status as TaskStatus;
    const item = c[1] ?? '';
    const reason = blockedReason(st, item);
    out.push({
      id: c[0]!,
      family: 'owner-todo',
      title: clip(plain(item), 150),
      detail: plain(item),
      section,
      status: st,
      statusRecorded: !!lead || section.startsWith('Owner has deferred'),
      blocks: plain(c[3] ?? ''),
      blocked: !!reason,
      ...(reason ? { blockedBy: reason } : {}),
      ambiguous,
      refs: { decisions: dRefs(body), adrs: adrRefs(body), tasks: taskRefs(body).filter((t) => t !== c[0]) },
      src: { path: src, line: i + 1 },
    });
  });
  return out;
}

export function parseRoadmap(text: string, src: string): Task[] {
  const out: Task[] = [];
  for (const { cells: c, line } of tableRows(text)) {
    if (!/^R\d+b?$/.test(c[0] ?? '')) continue;
    out.push({
      id: c[0]!,
      family: 'roadmap',
      title: clip(plain(c[1] ?? ''), 160),
      detail: plain(`${c[1]} Exit criteria: ${c[2]}`),
      section: 'Implementation roadmap',
      status: 'unmarked',
      statusRecorded: false,
      blocks: '',
      approvalNeeded: plain(c[3] ?? ''),
      blocked: false,
      ambiguous: false,
      refs: { decisions: dRefs(c.join(' ')), adrs: adrRefs(c.join(' ')), tasks: taskRefs(c.join(' ')) },
      src: { path: src, line },
    });
  }
  return out;
}

// ---- requirements

export function parseRequirements(reqText: string, nfrText: string, traceText: string, reqPath: string, nfrPath: string, tracePath: string): Requirement[] {
  const trace = new Map<string, Row>();
  for (const r of tableRows(traceText)) if (/^(BR|FR|SEC|DATA|AGT|NFR)-\d{3}$/.test(r.cells[0] ?? '')) trace.set(r.cells[0]!, r);
  const out: Requirement[] = [];
  const add = (text: string, p: string) => {
    for (const { cells: c, line } of tableRows(text)) {
      if (!/^(BR|FR|SEC|DATA|AGT|NFR)-\d{3}$/.test(c[0] ?? '')) continue;
      const t = trace.get(c[0]!)?.cells ?? [];
      out.push({
        id: c[0]!,
        group: c[0]!.split('-')[0]!,
        title: plain(c[2] ?? ''),
        cls: c[3] ?? '',
        priority: c[4] ?? '',
        justification: plain(c[5] ?? ''),
        acceptance: plain(c[6] ?? ''),
        traceSource: plain(t[1] ?? ''),
        validation: plain(t[2] ?? ''),
        evidenceRequired: plain(t[3] ?? ''),
        decisions: dRefs(t[4] ?? ''),
        dependsOn: reqRefs(t[5] ?? ''),
        openClarifications: dRefs(t[6] ?? ''),
        verifyClaims: dRefs(t[7] ?? ''),
        src: { path: p, line },
      });
    }
  };
  add(reqText, reqPath);
  add(nfrText, nfrPath);
  void tracePath;
  return out;
}

// ---- risks and assumptions

export function parseRisks(text: string, src: string): Risk[] {
  return tableRows(text)
    .filter((r) => /^RK-\d{3}$/.test(r.cells[0] ?? ''))
    .map(({ cells: c, line }) => ({
      id: c[0]!,
      title: plain(c[1] ?? ''),
      cause: plain(c[2] ?? ''),
      impact: c[3] ?? '',
      likelihood: c[4] ?? '',
      mitigation: plain(c[5] ?? ''),
      owner: c[6] ?? '',
      status: c[7] ?? '',
      links: c[8] ?? '',
      decisions: dRefs(c[8] ?? ''),
      src: { path: src, line },
    }));
}

export function parseAssumptions(text: string, src: string, registerIds: Set<string>, acceptedAdrNumbers: Set<string>): Assumption[] {
  return tableRows(text)
    .filter((r) => /^AS-\d{3}$/.test(r.cells[0] ?? ''))
    .map(({ cells: c, line }) => {
      const replacedBy = c[5] ?? '';
      const specific = adrRefs(replacedBy);
      const resolved = !dRefs(replacedBy).some((d) => registerIds.has(d)) && specific.length > 0 && specific.every((n) => acceptedAdrNumbers.has(n));
      return { id: c[0]!, text: plain(c[1] ?? ''), basis: plain(c[2] ?? ''), riskIfWrong: plain(c[3] ?? ''), validation: plain(c[4] ?? ''), replacedBy: plain(replacedBy), resolved, src: { path: src, line } };
    });
}

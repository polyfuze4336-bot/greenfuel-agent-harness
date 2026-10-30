// Builds the Architecture Work Queue from repository records. Every item points at the file and line it came from.
// Nothing is invented: a field no source states is null and listed in `missing`; a due date exists only if a source states one;
// "Done" needs completion evidence; a dependency is "requires" only where a source's wording says so.
import crypto from 'node:crypto';
import type { NormalizedDecision } from '../intel/schema.ts';
import { canonicalJson } from '../workflow/events.ts';
import type { Requirement, Risk, StudioModel, Task } from '../repo/types.ts';
import { explicitDueDate, parseBacklog, parseGaps, parseRubric, parseSecurity, parseValidation } from './sources.ts';
import type { Edge, EvidenceLink, Flag, Link, Priority, Src, UnresolvedRef, WorkClass, WorkItem, WorkKind, WorkStatus } from './types.ts';

export const SOURCE_PATHS = {
  gaps: 'docs/capstone/CRITICAL-GAPS.md',
  backlog: 'docs/capstone/PRIORITIZED-BACKLOG.md',
  rubric: 'docs/capstone/RUBRIC-TRACEABILITY.md',
  security: 'docs/target-architecture/13-SECURITY-REVIEW.md',
  validation: 'docs/target-architecture/12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md',
} as const;

export interface DeriveInput {
  model: StudioModel;
  read(path: string): string | undefined;
  exists(path: string): boolean;
  /** Role aliases from the access policy, used to say which roles an owner text names. */
  roleAliases?: Record<string, string[]>;
}

export interface RefNode {
  id: string;
  kind: 'requirement';
  title: string;
  src: Src;
}

export interface DeriveResult {
  items: WorkItem[];
  edges: Edge[];
  refNodes: RefNode[];
  unresolved: UnresolvedRef[];
  sources: { path: string; count: number }[];
}

// ---- reference extraction

const ID_RE = /\b(?:ADR[- ]?\d{4}|RK-\d{3}|RV-\d{4}|BLK-\d|D-\d{3}|B-\d{2}|G-\d{2}|V-\d{1,2}|(?:BR|FR|SEC|DATA|AGT|NFR)-\d{3}|T\d{1,3}|R\d{1,2}[a-z]?)\b/g;
const normId = (s: string) => s.replace(/^ADR[ ]?(\d{4})$/, 'ADR-$1');
// A dependency word shortly before an id, in the same sentence, makes it a hard "requires".
const REQ_WORD = /\b(?:needs?|needed|requires?|required|depends? on|dependent on|blocked (?:by|on)|waiting (?:on|for)|until|once|after|prerequisite|closed by|blocks?d? on)\b/i;

export function extractRefs(text: string): { id: string; type: 'requires' | 'references' }[] {
  const out = new Map<string, 'requires' | 'references'>();
  for (const sentence of text.split(/(?<=[.;])\s+/)) {
    for (const m of sentence.matchAll(ID_RE)) {
      const id = normId(m[0]);
      const before = sentence.slice(Math.max(0, m.index! - 60), m.index);
      const type = REQ_WORD.test(before) ? 'requires' : 'references';
      if (out.get(id) !== 'requires') out.set(id, type);
    }
  }
  return [...out].map(([id, type]) => ({ id, type }));
}

export const rolesNamed = (text: string | null | undefined, aliases: Record<string, string[]> = {}): string[] => {
  const t = (text ?? '').toLowerCase();
  return Object.entries(aliases).filter(([, al]) => al.some((a) => t.includes(a))).map(([k]) => k);
};

const PRIORITY_OF: Record<string, Priority> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', must: 'High', should: 'Medium', could: 'Low', p0: 'Critical', p1: 'High', p2: 'Medium', p3: 'Low' };
export const priorityOf = (s: string | null | undefined): Priority | null => PRIORITY_OF[(s ?? '').trim().toLowerCase()] ?? null;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const uniq = <T>(a: T[]) => [...new Set(a)];

type Draft = Partial<WorkItem> & { id: string; kind: WorkKind; title: string; source: Src };

const classOfModes = (modes: string[]): WorkClass => (modes[0] === 'build' ? 'engineering' : modes[0] === 'owner' ? 'decision' : modes.length ? 'evidence-gap' : 'engineering');

export function deriveWork(input: DeriveInput): DeriveResult {
  const { model: m, read, exists } = input;
  const aliases = input.roleAliases ?? {};
  const drafts: Draft[] = [];
  const raw = new Map<string, { text: string; src: Src; forced?: string[] }[]>();
  const sources: { path: string; count: number }[] = [];

  const runs = new Map(m.evidence.runs.map((r) => [r.id, r]));
  const evidenceFrom = (text: string, src: Src): EvidenceLink[] =>
    uniq(text.match(/\bEV-\d{4}\b/g) ?? []).map((ref) => {
      const r = runs.get(ref);
      if (!r) return { ref, kind: 'evidence-record' as const, src, valid: false, note: 'The evidence record does not exist at this commit' };
      const ok = r.exitCode === 0;
      return { ref, kind: 'evidence-record' as const, src: r.src, valid: ok, note: ok ? null : `The recorded run exited with code ${r.exitCode}, so it does not show success` };
    });

  const add = (d: Draft, texts: { text: string; forced?: string[] }[] = []) => {
    drafts.push(d);
    raw.set(d.id, texts.map((t) => ({ ...t, src: d.source })));
  };

  const closedStatus = (valid: EvidenceLink[]): WorkStatus => (valid.some((e) => e.valid) ? 'Done' : 'Closed, no evidence');

  // ---- owner tasks and roadmap items
  const taskItem = (t: Task) => {
    const ev = evidenceFrom(t.detail, t.src);
    const closed = t.status === 'done' || t.status === 'approved' || t.status === 'decided' || t.status === 'agreed';
    let status: WorkStatus;
    let basis: string;
    if (t.status === 'deferred') [status, basis] = ['Deferred', 'The source marks the task Deferred'];
    else if (t.status === 'not-granted') [status, basis] = ['Rejected', 'The source records that the request was not granted'];
    else if (closed) [status, basis] = [closedStatus(ev), `The source marks the task ${t.status}; it counts as Done only with valid completion evidence`];
    else if (t.blocked) [status, basis] = ['Blocked', `The task states an unmet prerequisite: ${t.blockedBy ?? ''}`.trim()];
    else if (t.status === 'open') [status, basis] = ['Open', 'The source marks the task Open'];
    else [status, basis] = ['Unmarked', 'The source records no status for this row'];
    const exit = t.family === 'roadmap' ? /Exit criteria:\s*(.+)$/i.exec(t.detail)?.[1] : undefined;
    add(
      {
        id: t.id,
        kind: t.family === 'roadmap' ? 'roadmap' : 'task',
        class: t.family === 'roadmap' ? 'engineering' : 'governance',
        title: clip(t.title, 160),
        description: t.detail,
        status,
        sourceStatus: t.statusRecorded ? t.status : null,
        statusBasis: basis,
        ownerText: t.approvalNeeded ?? (t.family === 'owner-todo' ? 'Owner' : null),
        source: t.src,
        acceptance: exit ? clip(exit.trim(), 600) : null,
        dueDate: explicitDueDate(t.detail),
        completionEvidence: ev,
        relatedDecisions: uniq([...t.refs.decisions, ...t.refs.adrs.map((a) => `ADR-${a}`)]),
        flags: [...(t.blocks ? [{ code: 'blocks', text: `What it blocks, as written: ${t.blocks}` }] : []), ...(t.blocked ? [{ code: 'unmet-prerequisite', text: `The task states an unmet prerequisite, or was not granted: ${t.blockedBy ?? ''}`.trim() }] : [])],
        mode: [],
      },
      [{ text: t.detail }],
    );
  };
  m.tasks.forEach(taskItem);
  sources.push({ path: m.tasks[0]?.src.path ?? 'docs/state/TODO.md', count: m.tasks.filter((t) => t.family === 'owner-todo').length }, { path: 'docs/harness/IMPLEMENTATION-ROADMAP.md', count: m.tasks.filter((t) => t.family === 'roadmap').length });

  // ---- capstone backlog
  const backlogText = read(SOURCE_PATHS.backlog);
  if (backlogText) {
    const rows = parseBacklog(backlogText);
    sources.push({ path: SOURCE_PATHS.backlog, count: rows.length });
    for (const b of rows) {
      const pr = priorityOf(b.priority);
      const scope = b.fields.scope ?? b.fields.what ?? b.fields['what'];
      const approval = b.fields['needs your approval'];
      add(
        {
          id: b.id,
          kind: 'backlog',
          class: classOfModes(b.modes),
          title: b.title,
          description: scope?.text ?? b.title,
          priority: pr,
          priorityBasis: pr ? `Backlog ${b.priority}` : null,
          critical: b.priority === 'P0',
          criticalBasis: b.priority === 'P0' ? 'Backlog priority P0 (closes a floor risk or caps several criteria)' : null,
          status: 'Unmarked',
          sourceStatus: null,
          statusBasis: 'The backlog records no per-item status',
          ownerText: b.modes.length ? `Mode: ${b.modes.join(', ')}` : null,
          source: { path: SOURCE_PATHS.backlog, line: b.line },
          acceptance: b.fields['acceptance test']?.text ?? null,
          rubricCriteria: uniq((b.fields.criteria?.text ?? '').match(/\b[A-D][1-9]\b/g) ?? []),
          flags: approval ? [{ code: 'needs-approval', text: `Needs your approval: ${approval.text}` }] : [],
          mode: b.modes,
        },
        [{ text: b.fields.dependencies?.text ?? '', forced: ['requires'] }, { text: scope?.text ?? '' }],
      );
    }
  }

  // ---- capstone gaps
  const gapsText = read(SOURCE_PATHS.gaps);
  if (gapsText) {
    const rows = parseGaps(gapsText);
    sources.push({ path: SOURCE_PATHS.gaps, count: rows.length });
    for (const g of rows) {
      const pr = priorityOf(g.severity);
      add(
        {
          id: g.id,
          kind: 'gap',
          class: classOfModes(g.modes),
          title: g.title,
          description: g.text,
          priority: pr,
          priorityBasis: pr ? `Gap severity ${g.severity}` : null,
          critical: /^critical$/i.test(g.severity),
          criticalBasis: /^critical$/i.test(g.severity) ? 'Gap severity Critical in the gap register' : null,
          status: 'Open',
          sourceStatus: null,
          statusBasis: 'Listed in the gap register with no closure recorded',
          ownerText: g.modes.length ? `Mode: ${g.modes.join(', ')}` : null,
          source: { path: SOURCE_PATHS.gaps, line: g.line },
          rubricCriteria: g.criteria,
          evidenceRequired: g.evidence || null,
          mode: g.modes,
        },
        [{ text: g.closedBy.join(' '), forced: ['requires'] }, { text: g.evidence }],
      );
    }
  }

  // ---- rubric criteria, kept apart as evidence gaps
  const rubricText = read(SOURCE_PATHS.rubric);
  if (rubricText) {
    const rows = parseRubric(rubricText);
    sources.push({ path: SOURCE_PATHS.rubric, count: rows.length });
    for (const r of rows) {
      const pr = priorityOf(r.priority);
      const high = /^high$/i.test(r.floorExposure);
      add(
        {
          id: `RC-${r.id}`,
          kind: 'rubric',
          class: 'evidence-gap',
          title: `${r.id} ${r.title}`,
          description: `Evidence now: ${r.evidenceNow}. Main gap: ${r.mainGap}.`,
          priority: pr,
          priorityBasis: pr ? `Rubric traceability priority ${r.priority}` : null,
          critical: high,
          criticalBasis: high ? 'Floor exposure High in the rubric traceability' : null,
          status: 'Open',
          sourceStatus: `Evidence now: ${r.evidenceNow}`,
          statusBasis: 'The traceability records evidence for this criterion as less than complete; it is never marked done in the repository',
          ownerText: r.assessment.length ? `Assessment mode: ${r.assessment.join(', ')}` : null,
          source: { path: SOURCE_PATHS.rubric, line: r.line },
          rubricCriteria: [r.id],
          mode: r.assessment,
        },
        [{ text: r.backlog.join(' '), forced: ['requires'] }],
      );
    }
  }

  // ---- security findings and open items
  const secText = read(SOURCE_PATHS.security);
  if (secText) {
    const { findings, open } = parseSecurity(secText);
    sources.push({ path: SOURCE_PATHS.security, count: findings.length + open.length });
    const dir = SOURCE_PATHS.security.split('/').slice(0, -1);
    const resolve = (rel: string) => {
      const parts = [...dir];
      for (const seg of rel.split('#')[0]!.split('/')) {
        if (seg === '..') parts.pop();
        else if (seg && seg !== '.') parts.push(seg);
      }
      return parts.join('/');
    };
    for (const f of findings) {
      const pr = priorityOf(f.severity);
      const files: EvidenceLink[] = f.testedIn.map((p) => {
        const path = resolve(p);
        return { ref: path, kind: 'file' as const, src: exists(path) ? { path, line: 1 } : null, valid: exists(path), note: exists(path) ? null : 'The test file does not exist at this commit' };
      });
      const status: WorkStatus = f.fullyFixed ? closedStatus(files) : 'Open';
      add(
        {
          id: f.id,
          kind: 'security',
          class: 'engineering',
          title: clip(f.summary, 150),
          description: [f.summary, f.outcome ? `Outcome: ${f.outcome}` : '', f.changed && f.changed !== f.outcome ? `Change: ${f.changed}` : ''].filter(Boolean).join(' '),
          priority: pr,
          priorityBasis: pr ? `Security review severity ${f.severity}` : null,
          critical: f.severity === 'HIGH' && !f.fullyFixed,
          criticalBasis: f.severity === 'HIGH' && !f.fullyFixed ? 'High severity and not fully fixed in the security review' : null,
          status,
          sourceStatus: f.outcome,
          statusBasis: f.fullyFixed ? 'The review records Fixed with no remaining limit stated; Done needs the test evidence it names' : 'The review records a remaining limit or a partial fix',
          ownerText: null,
          source: { path: SOURCE_PATHS.security, line: f.line },
          completionEvidence: files,
          mode: [],
        },
        [{ text: `${f.outcome ?? ''} ${f.changed ?? ''}` }],
      );
    }
    for (const o of open) {
      add(
        {
          id: o.id,
          kind: 'security',
          class: /owner/i.test(o.owner) ? 'governance' : 'engineering',
          title: clip(o.item, 150),
          description: `${o.item}. Owner: ${o.owner}. Where: ${o.where}`,
          status: 'Open',
          sourceStatus: 'Listed under Open items in the security review',
          statusBasis: 'Listed under Open items with no closure recorded',
          ownerText: o.owner,
          source: { path: SOURCE_PATHS.security, line: o.line },
          mode: [],
        },
        [{ text: `${o.owner}. ${o.where}` }],
      );
    }
  }

  // ---- residency validation procedure
  const valText = read(SOURCE_PATHS.validation);
  if (valText) {
    const rows = parseValidation(valText);
    sources.push({ path: SOURCE_PATHS.validation, count: rows.length });
    const notRun = /NOT RUN/.test(valText);
    for (const v of rows) {
      add(
        {
          id: v.id,
          kind: 'validation',
          class: 'engineering',
          title: v.what,
          description: `${v.what}. How: ${v.how}`,
          status: 'Open',
          sourceStatus: notRun ? 'NOT RUN, as the document records' : null,
          statusBasis: notRun ? 'The validation document states results are NOT RUN' : 'No result is recorded',
          ownerText: null,
          source: { path: SOURCE_PATHS.validation, line: v.line },
          acceptance: v.pass,
          evidenceRequired: v.evidence,
          mode: [],
        },
        [{ text: `${v.how} ${v.pass}` }],
      );
    }
  }

  // ---- risks
  const riskItem = (r: Risk) => {
    const high = /^high$/i.test(r.impact);
    const open = /^open$/i.test(r.status);
    const status: WorkStatus = open ? 'Open' : /closed|mitigated|accepted/i.test(r.status) ? 'Closed, no evidence' : 'Unmarked';
    add(
      {
        id: r.id,
        kind: 'risk',
        class: 'risk',
        title: clip(r.title, 160),
        description: `${r.title}. Cause: ${r.cause}. Impact: ${r.impact}. Likelihood: ${r.likelihood}.`,
        priority: priorityOf(r.impact),
        priorityBasis: priorityOf(r.impact) ? `Risk impact ${r.impact}` : null,
        critical: high && open,
        criticalBasis: high && open ? 'Impact High and status Open (the register does not assess likelihood)' : null,
        status,
        sourceStatus: r.status,
        statusBasis: 'Risk register status; a closed risk counts as Done only with completion evidence, which the register does not record',
        ownerText: r.owner,
        source: r.src,
        acceptance: r.mitigation ? `Mitigation: ${r.mitigation}` : null,
        relatedDecisions: r.decisions,
        mode: [],
      },
      [{ text: r.mitigation }, { text: r.links }],
    );
  };
  m.risks.forEach(riskItem);
  sources.push({ path: m.risks[0]?.src.path ?? 'docs/architecture/RISK-REGISTER.md', count: m.risks.length });

  // ---- requirement gaps
  const reqGap = (r: Requirement) => {
    if (!r.openClarifications.length && !r.verifyClaims.length) return;
    const must = /^must$/i.test(r.priority);
    add(
      {
        id: `RG-${r.id}`,
        kind: 'requirement-gap',
        class: 'decision',
        title: `${r.id}: ${clip(r.title, 120)}`,
        description: `${r.title}. ${r.openClarifications.length ? `Open clarifications: ${r.openClarifications.join(', ')}. ` : ''}${r.verifyClaims.length ? `Claims to verify: ${r.verifyClaims.join(', ')}.` : ''}`.trim(),
        priority: priorityOf(r.priority),
        priorityBasis: priorityOf(r.priority) ? `Requirement priority ${r.priority}` : null,
        critical: must && r.openClarifications.length > 0,
        criticalBasis: must && r.openClarifications.length > 0 ? 'Must requirement with open clarifications' : null,
        status: 'Open',
        sourceStatus: null,
        statusBasis: 'The requirement lists open clarifications or claims that still need verification',
        ownerText: null,
        source: r.src,
        acceptance: r.acceptance || null,
        evidenceRequired: r.evidenceRequired || null,
        relatedRequirements: [r.id],
        mode: [],
      },
      [{ text: r.openClarifications.join(' '), forced: ['requires'] }, { text: r.verifyClaims.join(' ') }],
    );
  };
  m.requirements.forEach(reqGap);

  // ---- decisions
  const decisionItem = (d: NormalizedDecision) => {
    const must = d.priority?.value === 'Must';
    const unresolved = d.status === 'Proposed' || d.status === 'Pending Review' || d.status === 'Blocked' || d.status === 'Deferred';
    const status: WorkStatus = d.status === 'Approved' ? 'Done' : d.status === 'Rejected' ? 'Rejected' : d.status === 'Deferred' ? 'Deferred' : d.status === 'Superseded' ? 'Superseded' : d.status === 'Blocked' ? 'Blocked' : 'Open';
    const evidence: EvidenceLink[] =
      d.status === 'Approved'
        ? [{ ref: d.review ? (d.approvalHistory.find((e) => e.type === 'review-event')?.src.path ?? d.source.path) : d.source.path, kind: 'decision-record', src: { path: d.source.path, line: d.source.line }, valid: true, note: d.approvalBasis === 'signed' ? null : 'Approved without a signed approval record' }]
        : [];
    const flags: Flag[] = d.flags.map((f) => ({ code: f.code, text: f.text }));
    add(
      {
        id: d.id,
        kind: 'decision',
        class: 'decision',
        title: d.title,
        description: d.description ?? d.title,
        priority: priorityOf(d.priority?.value),
        priorityBasis: d.priority ? `Decision priority ${d.priority.value}: ${d.priority.basis}` : null,
        critical: must && unresolved,
        criticalBasis: must && unresolved ? 'Priority Must (highest of its traced requirements) and not yet decided' : null,
        status,
        sourceStatus: d.statusRaw,
        statusBasis: d.statusRule,
        ownerText: d.requiredApproverRole?.text ?? d.decisionOwner,
        source: { path: d.source.path, line: d.source.line },
        relatedDecisions: uniq([...d.dependsOn, ...d.dependedOnBy]),
        relatedRequirements: d.blockingRequirements.map((r) => r.id),
        relatedRisks: d.relatedRisks,
        completionEvidence: evidence,
        approval: unresolved && d.status !== 'Deferred' ? { kind: 'decision', by: d.requiredApproverRole?.text ?? 'Not stated', state: d.status } : null,
        flags,
        milestone: d.milestone,
        mode: [],
      },
      [
        // An ADR blocked by its design review waits for that review, which the review record states.
        { text: d.status === 'Blocked' ? d.relatedReviews.join(' ') : '', forced: ['requires'] },
        { text: d.dependsOn.join(' ') },
      ],
    );
  };
  m.register.records.forEach(decisionItem);
  sources.push({ path: 'docs/adr/*.md and docs/context/DECISION-REGISTER.md', count: m.register.records.length });

  // ---- design review gates
  for (const r of m.reviews) {
    const blocked = (r.computed ?? r.declared) === 'Blocked';
    const approved = (r.computed ?? r.declared) === 'Approved';
    add(
      {
        id: r.id,
        kind: 'design-gate',
        class: 'governance',
        title: `${r.design}: ${clip(r.title, 120)}`,
        description: `Declared ${r.declared}; computed by the gate ${r.computed ?? 'unknown'}${r.blockReasons !== null ? `; ${r.blockReasons} blocking reason(s)` : ''}.`,
        priority: 'Critical',
        priorityBasis: 'Design review gate',
        critical: blocked,
        criticalBasis: blocked ? 'Design review computes Blocked' : null,
        status: approved ? 'Done' : blocked ? 'Blocked' : 'Open',
        sourceStatus: `Declared ${r.declared}; computed ${r.computed ?? 'unknown'}`,
        statusBasis: 'Declared by the review record; computed by the design gate (derived snapshot)',
        ownerText: r.decider,
        source: r.src,
        completionEvidence: approved ? [{ ref: r.src.path, kind: 'decision-record', src: r.src, valid: true, note: null }] : [],
        approval: approved ? null : { kind: 'design-review', by: r.decider || 'Not named', state: r.declared },
        relatedDecisions: r.blockingDecisions,
        mode: [],
      },
      [{ text: r.blockingDecisions.join(' '), forced: ['requires'] }],
    );
  }

  // ---- build blockers (each is a fact the Studio derived from the repository)
  const gateIds = uniq(m.reviews.flatMap((r) => r.blockingDecisions));
  const blockerSrc: Record<string, Src> = {
    'BLK-1': { path: 'harness/policy/approvers.json', line: 1 },
    'BLK-2': { path: 'docs/state/STATE.md', line: 1 },
    'BLK-3': m.reviews[0]?.src ?? { path: 'docs/architecture/DESIGN-REVIEW-GATE.md', line: 1 },
    'BLK-4': { path: 'docs/architecture/DESIGN-REVIEW-GATE.md', line: 1 },
    'BLK-5': { path: 'docs/context/DECISION-REGISTER.md', line: 1 },
    'BLK-6': m.tasks.find((t) => t.id === 'T14')?.src ?? { path: 'docs/state/TODO.md', line: 1 },
  };
  const m1Open = m.register.records.filter((d) => d.kind === 'register-entry' && d.milestone === 'M1' && (d.status === 'Pending Review' || d.status === 'Proposed')).map((d) => d.id);
  const blockerLinks: Record<string, string[]> = {
    'BLK-2': ['BLK-1'],
    'BLK-3': m.reviews.filter((r) => (r.computed ?? r.declared) !== 'Approved').map((r) => r.id),
    'BLK-4': gateIds,
    'BLK-5': m1Open,
    'BLK-6': ['T14'],
  };
  for (const b of m.blockers) {
    add(
      {
        id: b.id,
        kind: 'build-blocker',
        class: 'governance',
        title: b.title,
        description: `${b.detail} Basis: ${b.basis}.`,
        priority: 'Critical',
        priorityBasis: 'Derived from a repository fact that blocks the build',
        critical: true,
        criticalBasis: 'The Studio derived it from the repository as blocking',
        status: 'Blocked',
        sourceStatus: null,
        statusBasis: `Derived: ${b.basis}`,
        ownerText: null,
        source: blockerSrc[b.id] ?? { path: 'docs/state/STATE.md', line: 1 },
        mode: [],
      },
      [{ text: (blockerLinks[b.id] ?? []).join(' '), forced: ['requires'] }],
    );
  }

  // ---- links
  const known = new Set(drafts.map((d) => d.id));
  const reqIds = new Map(m.requirements.map((r) => [r.id, r]));
  const edges: Edge[] = [];
  const unresolved: UnresolvedRef[] = [];
  const linksOf = new Map<string, Link[]>();
  for (const d of drafts) {
    const found = new Map<string, Link>();
    for (const t of raw.get(d.id) ?? []) {
      const refs = t.forced ? [...(t.text.match(new RegExp(ID_RE.source, 'g')) ?? [])].map((s) => ({ id: normId(s), type: 'requires' as const })) : extractRefs(t.text);
      for (const r of refs) {
        if (r.id === d.id) continue;
        const target = r.id;
        if (!known.has(target) && !reqIds.has(target)) {
          unresolved.push({ from: d.id, ref: target, src: d.source });
          continue;
        }
        const prior = found.get(target);
        const type = prior?.type === 'requires' || r.type === 'requires' ? 'requires' : 'references';
        found.set(target, { id: target, type, basis: type === 'requires' ? (t.forced ? 'Stated as a prerequisite in a dedicated field' : 'The wording says it is needed first') : 'Mentioned in the source text', src: d.source });
      }
    }
    linksOf.set(d.id, [...found.values()]);
    for (const l of found.values()) edges.push({ from: d.id, to: l.id, type: l.type, basis: l.basis });
  }

  const refNodes: RefNode[] = [];
  const usedReq = new Set(edges.map((e) => e.to).filter((id) => reqIds.has(id) && !known.has(id)));
  for (const id of usedReq) refNodes.push({ id, kind: 'requirement', title: reqIds.get(id)!.title, src: reqIds.get(id)!.src });

  // ---- finish items
  const items: WorkItem[] = drafts.map((d) => {
    const text = `${d.title} ${d.description ?? ''}`;
    const links = linksOf.get(d.id) ?? [];
    const base: WorkItem = {
      id: d.id,
      kind: d.kind,
      class: d.class ?? 'engineering',
      title: d.title,
      description: d.description ?? d.title,
      priority: d.priority ?? null,
      priorityBasis: d.priorityBasis ?? null,
      critical: d.critical ?? false,
      criticalBasis: d.criticalBasis ?? null,
      status: d.status ?? 'Unmarked',
      sourceStatus: d.sourceStatus ?? null,
      statusBasis: d.statusBasis ?? '',
      ownerText: d.ownerText ?? null,
      ownerRoles: rolesNamed(d.ownerText, aliases),
      assignee: null,
      source: d.source,
      relatedDecisions: d.relatedDecisions ?? uniq(links.filter((l) => /^(D-\d{3}|ADR-\d{4})$/.test(l.id)).map((l) => l.id)),
      relatedRequirements: d.relatedRequirements ?? uniq([...(text.match(/\b(?:BR|FR|SEC|DATA|AGT|NFR)-\d{3}\b/g) ?? []), ...links.filter((l) => reqIds.has(l.id)).map((l) => l.id)]),
      relatedRisks: d.relatedRisks ?? uniq(links.filter((l) => /^RK-\d{3}$/.test(l.id)).map((l) => l.id)),
      rubricCriteria: d.rubricCriteria ?? [],
      links,
      acceptance: d.acceptance ?? null,
      evidenceRequired: d.evidenceRequired ?? null,
      dueDate: d.dueDate ?? null,
      completionEvidence: d.completionEvidence ?? [],
      approval: d.approval ?? null,
      derivedBlocks: [],
      reviewNeeded: [],
      flags: d.flags ?? [],
      missing: [],
      blocksBuild: false,
      milestone: d.milestone ?? null,
      mode: d.mode ?? [],
      contentHash: '',
    };
    base.missing = (['priority', 'ownerText', 'acceptance', 'evidenceRequired'] as const).filter((k) => base[k] === null).map((k) => (k === 'ownerText' ? 'owner' : k === 'evidenceRequired' ? 'evidence required' : k));
    base.contentHash = crypto.createHash('sha256').update(canonicalJson({ ...base, contentHash: undefined })).digest('hex');
    return base;
  });

  return { items, edges, refNodes, unresolved, sources };
}

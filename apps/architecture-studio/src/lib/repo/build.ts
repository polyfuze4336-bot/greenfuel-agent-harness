import { GitRepositoryAdapter } from './git.ts';
import { adrRefs, assumptionRefs, dRefs, field, lineOf, parseAdr, parseAssumptions, parseRegister, parseRequirements, parseRisks, parseRoadmap, parseTodo, plain, tableRows } from './parse.ts';
import type { Approvals, Attention, Blocker, Decision, Doc, DesignReview, EvidenceRun, Metrics, PendingApproval, QaItem, RehearsalCriterion, Recording, RepoMeta, Slide, StudioModel, Task } from './types.ts';

const P = {
  register: 'docs/context/DECISION-REGISTER.md',
  requirements: 'docs/context/REQUIREMENTS.md',
  nfr: 'docs/context/NON-FUNCTIONAL-REQUIREMENTS.md',
  trace: 'docs/context/REQUIREMENTS-TRACEABILITY.md',
  assumptions: 'docs/context/ASSUMPTIONS.md',
  risks: 'docs/architecture/RISK-REGISTER.md',
  todo: 'docs/state/TODO.md',
  state: 'docs/state/STATE.md',
  roadmap: 'docs/harness/IMPLEMENTATION-ROADMAP.md',
  approvers: 'harness/policy/approvers.json',
  snapshot: 'docs/architecture-studio/inventory.snapshot.json',
  evidenceManifest: 'docs/evidence/MANIFEST.json',
  deck: 'docs/capstone/presentation/deck/index.html',
  qa: 'docs/capstone/presentation/QA-PANEL-50.md',
  rehearsal: 'docs/capstone/presentation/REHEARSAL-PLAN-AND-SCORECARD.md',
};

interface Snapshot {
  reviews?: { id: string; computed?: string; blockReasons?: number; blockingDecisions?: string[] }[];
  counts?: { approvals?: { validatorOutput?: string } };
}

const safeJson = <T>(s: string | undefined): T | undefined => {
  if (!s) return undefined;
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
};

const titleOf = (text: string) => plain((text.split('\n').find((l) => /^# /.test(l)) ?? '').replace(/^# /, ''));

function classify(p: string): Doc['authority'] {
  if (/^docs\/adr\/\d{4}-/.test(p) || /^docs\/architecture\/(designs|reviews)\//.test(p)) return 'authoritative';
  if (/^docs\/context\/(DECISION-REGISTER|ASSUMPTIONS|REQUIREMENTS|NON-FUNCTIONAL-REQUIREMENTS|REQUIREMENTS-TRACEABILITY)\.md$/.test(p)) return 'authoritative';
  if (/^docs\/state\/(TODO|STATE)\.md$/.test(p) || p === P.risks || p.startsWith('docs/approvals/')) return 'authoritative';
  if (p.startsWith('docs/evidence/') || p === P.snapshot || p.endsWith('QA-PANEL-50.md') || p.includes('/recordings/')) return 'derived';
  return 'reference';
}

export function buildModel(git: GitRepositoryAdapter): StudioModel {
  const warnings: string[] = [];
  const docPaths = git.list('docs/').filter((p) => !/^docs\/state\/(runs|loops)\//.test(p));
  git.preload([...docPaths, P.approvers, ...git.list('docs/state/')]);
  const read = (p: string): string => {
    const t = git.read(p);
    if (t === undefined) {
      warnings.push(`Expected source file is missing at this commit: ${p}`);
      return '';
    }
    return t;
  };

  // ---- decisions
  const register = parseRegister(read(P.register), P.register);
  const adrFiles = git.list('docs/adr/').filter((p) => /^docs\/adr\/\d{4}-.*\.md$/.test(p) && !p.startsWith('docs/adr/0000-'));
  const adrs = adrFiles.map((p) => parseAdr(read(p), p));
  const decisions: Decision[] = [...adrs, ...register];
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const registerIds = new Set(register.map((d) => d.id));
  const acceptedNumbers = new Set(adrs.filter((a) => a.status === 'accepted').map((a) => a.id.slice(4)));

  // ---- other record families
  const requirements = parseRequirements(read(P.requirements), read(P.nfr), read(P.trace), P.requirements, P.nfr, P.trace);
  const risks = parseRisks(read(P.risks), P.risks);
  const assumptions = parseAssumptions(read(P.assumptions), P.assumptions, registerIds, acceptedNumbers);
  const tasks: Task[] = [...parseTodo(read(P.todo), P.todo), ...parseRoadmap(read(P.roadmap), P.roadmap)];

  // ---- design reviews (declared from the documents; computed gate result from the derived snapshot)
  const snapshot = safeJson<Snapshot>(git.read(P.snapshot));
  if (!snapshot) warnings.push(`${P.snapshot} is missing or unreadable, so computed design-gate results are not shown.`);
  const designs = new Map<string, { title: string; adrs: string[]; src: { path: string; line: number } }>();
  for (const p of git.list('docs/architecture/designs/').filter((x) => /\/DES-.*\.md$/.test(x))) {
    const t = read(p);
    const id = field(t, 'Design ID');
    if (id) designs.set(id, { title: titleOf(t), adrs: adrRefs(field(t, 'ADRs') ?? '').map((n) => `ADR-${n}`), src: { path: p, line: lineOf(t, /Design ID/) } });
  }
  const reviews: DesignReview[] = git
    .list('docs/architecture/reviews/')
    .filter((x) => /\/RV-.*\.md$/.test(x))
    .map((p) => {
      const t = read(p);
      const id = field(t, 'Review ID') ?? p;
      const design = field(t, 'Design') ?? '';
      const snap = snapshot?.reviews?.find((r) => r.id === id);
      const d = designs.get(design);
      return {
        id,
        design,
        title: d?.title ?? titleOf(t),
        declared: field(t, 'Status') ?? 'unknown',
        decider: field(t, 'Decider') ?? 'unknown',
        adrs: d?.adrs ?? [],
        computed: snap?.computed ?? null,
        blockReasons: snap?.blockReasons ?? null,
        blockingDecisions: snap?.blockingDecisions ?? [],
        src: { path: p, line: lineOf(t, /Review ID/) },
        designSrc: d?.src ?? { path: p, line: 1 },
      };
    });

  // ---- cross links (reverse edges)
  const push = (d: Decision | undefined, k: keyof Decision['refs'], v: string) => {
    if (d && !d.refs[k].includes(v)) d.refs[k].push(v);
  };
  for (const r of requirements) for (const id of [...r.decisions, ...r.openClarifications, ...r.verifyClaims]) push(byId.get(id), 'requirements', r.id);
  for (const k of risks) for (const id of k.decisions) push(byId.get(id), 'risks', k.id);
  for (const a of assumptions) for (const id of dRefs(a.replacedBy)) push(byId.get(id), 'assumptions', a.id);
  for (const a of adrs) for (const as of assumptionRefs(a.summary)) push(a, 'assumptions', as);
  for (const rv of reviews) for (const id of rv.blockingDecisions) push(byId.get(id), 'reviews', rv.id);
  for (const t of tasks) for (const id of t.refs.decisions) push(byId.get(id), 'tasks', t.id);
  for (const t of tasks) for (const n of t.refs.adrs) push(byId.get(`ADR-${n}`), 'tasks', t.id);
  for (const d of decisions) {
    d.refs.requirements.sort();
    d.refs.decisions = d.refs.decisions.filter((x) => x !== d.id);
  }

  // ---- approvals
  const approvers = safeJson<{ approvers?: unknown[] }>(git.read(P.approvers))?.approvers ?? [];
  const approvalRecords = git.list('docs/approvals/').filter((p) => p.endsWith('.json'));
  const signedIds = new Set<string>();
  for (const p of approvalRecords) {
    const r = safeJson<{ subject?: { type?: string; id?: string } }>(git.read(p));
    if (r?.subject?.type && r.subject.id) signedIds.add(`${r.subject.type}:${r.subject.id}`);
  }
  for (const d of decisions) d.flags.signed = d.type === 'adr' && signedIds.has(`adr:${d.id.slice(4)}`);
  const phase = (read(P.state).match(/phase[^\n]{0,40}?(\d)/i) ?? [])[1] ?? null;
  const pending: PendingApproval[] = [
    ...adrs
      .filter((a) => a.status === 'proposed')
      .map<PendingApproval>((a) => ({
        id: a.id,
        kind: 'adr',
        title: a.title,
        required: 'Signed approval, architecture class (approval.mjs decision --type adr)',
        state: a.statusRaw,
        blockedBy: a.refs.decisions.filter((d) => byId.get(d)?.status === 'open'),
        href: `/decisions/${a.id}`,
        src: a.src,
      })),
    ...reviews
      .filter((r) => r.declared !== 'Approved')
      .map<PendingApproval>((r) => ({
        id: r.id,
        kind: 'design-review',
        title: r.title,
        required: 'A named decider and a signed review approval (approval.mjs decision --type review)',
        state: `Declared ${r.declared}${r.computed ? `; gate computes ${r.computed}` : ''}; decider ${r.decider}`,
        blockedBy: r.blockingDecisions,
        href: '/architecture#reviews',
        src: r.src,
      })),
  ];
  const validatorOutput = snapshot?.counts?.approvals?.validatorOutput ?? null;
  const approvals: Approvals = {
    enrolledApprovers: approvers.length,
    signedRecords: approvalRecords.length,
    phase,
    validatorOutput,
    validatorSrc: P.snapshot,
    pending,
    grandfatheredAccepted: adrs.filter((a) => a.flags.grandfathered).map((a) => a.id),
  };

  // ---- metrics
  const count = (f: (d: Decision) => boolean) => decisions.filter(f).length;
  const todo = tasks.filter((t) => t.family === 'owner-todo');
  const gateDecisions = new Set(reviews.flatMap((r) => r.blockingDecisions));
  const reviewsApproved = reviews.filter((r) => r.declared === 'Approved' && (r.computed === null || r.computed === 'Approved')).length;
  const m1Open = register.filter((d) => d.milestone === 'M1' && d.status === 'open').length;
  const metrics: Metrics = {
    decisions: {
      total: decisions.length,
      adrs: adrs.length,
      register: register.length,
      pending: count((d) => d.status === 'open' || d.status === 'proposed'),
      open: count((d) => d.status === 'open'),
      proposed: count((d) => d.status === 'proposed'),
      accepted: count((d) => d.status === 'accepted'),
      acceptedSigned: count((d) => d.status === 'accepted' && d.flags.signed),
      rejected: count((d) => d.status === 'rejected'),
      deferred: count((d) => d.status === 'deferred'),
      superseded: count((d) => d.status === 'superseded'),
    },
    tasks: {
      total: tasks.length,
      ownerTodo: todo.length,
      blocked: todo.filter((t) => t.blocked).length,
      open: todo.filter((t) => t.status === 'open').length,
      deferred: todo.filter((t) => t.status === 'deferred').length,
      ambiguous: tasks.filter((t) => t.ambiguous).length,
    },
    approvals: { outstanding: pending.length, adrs: pending.filter((p) => p.kind === 'adr').length, reviews: pending.filter((p) => p.kind === 'design-review').length, enrolledApprovers: approvers.length, signedRecords: approvalRecords.length },
    readiness: {
      label: reviews.length === 0 ? 'No design review recorded' : reviewsApproved === reviews.length && approvers.length > 0 ? 'Gate passed: ready for an approval decision' : 'Not ready for approval',
      reviewsApproved,
      reviewsTotal: reviews.length,
      reviewsBlocked: reviews.filter((r) => r.declared === 'Blocked' || r.computed === 'Blocked').length,
      gateDecisions: gateDecisions.size,
      m1Open,
      phase,
    },
    requirements: { total: requirements.length, must: requirements.filter((r) => r.priority === 'Must').length },
    risks: { total: risks.length, open: risks.filter((r) => r.status === 'Open').length },
    assumptions: { total: assumptions.length, unresolved: assumptions.filter((a) => !a.resolved).length },
  };

  // ---- repository facts
  const remoteUrl = git.remoteUrl();
  const githubUrl = remoteUrl && /github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?$/.exec(remoteUrl) ? `https://github.com/${/github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?$/.exec(remoteUrl)![1]}` : null;
  const head = git.describeCommit(git.commit);
  const upstream = git.ref === 'HEAD' ? git.upstream() : null;
  const ab = upstream ? git.aheadBehind(git.commit, upstream) : null;
  const defaultBranch = git.defaultBranch();
  const defAb = defaultBranch ? git.aheadBehind(git.commit, defaultBranch) : null;
  const name = git.userConfig('user.name');
  const email = git.userConfig('user.email');
  const repo: RepoMeta = {
    name: git.root.split(/[\\/]/).pop() ?? 'repository',
    githubUrl,
    ref: git.ref,
    commit: git.commit,
    commitShort: git.commit.slice(0, 7),
    commitDate: head?.date ?? '',
    commitSubject: head?.subject ?? '',
    branch: git.ref === 'HEAD' ? git.currentBranch() : git.ref,
    upstream,
    ahead: ab?.ahead ?? null,
    behind: ab?.behind ?? null,
    commitOnGitHub: git.remoteRefsContainingCommit().length > 0,
    remoteRefs: git.remoteRefs(),
    defaultBranch,
    defaultBranchBehind: defAb ? defAb.ahead : null,
    lastFetchAt: git.lastFetchAt(),
    uncommittedChanges: git.uncommittedCount(),
    gitUser: name || email ? { name: name ?? '', email: email ?? '' } : null,
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
  };
  // defaultBranchBehind: commits in the commit being read that the default branch does not have.

  // ---- blockers (each derived from a fact in the repository, not copied from a report)
  const t14 = tasks.find((t) => t.id === 'T14');
  const blockers: Blocker[] = [];
  if (approvers.length === 0) blockers.push({ id: 'BLK-1', title: 'No approver is enrolled', detail: 'No signed approval of any class can be valid, so every new ADR acceptance, design approval and phase raise is blocked.', basis: `${P.approvers} has no entries`, href: '/approvals' });
  if (phase === '0') blockers.push({ id: 'BLK-2', title: 'Phase 0: implementation is not unlocked', detail: 'Raising the phase needs an architecture-class and a deployment-class signature from different approvers.', basis: `${P.state}`, href: '/approvals' });
  if (metrics.readiness.reviewsBlocked > 0) blockers.push({ id: 'BLK-3', title: `${metrics.readiness.reviewsBlocked} of ${reviews.length} design reviews are Blocked`, detail: `The design gate names ${snapshot ? reviews.reduce((n, r) => n + (r.blockReasons ?? 0), 0) : 'an unknown number of'} blocking reasons.`, basis: 'docs/architecture/reviews/*.md; computed result from the derived snapshot', href: '/architecture#reviews' });
  if (gateDecisions.size > 0) blockers.push({ id: 'BLK-4', title: `${gateDecisions.size} open decisions gate the design reviews`, detail: 'A design cannot compute Approved while these stay Open.', basis: 'Blocking decisions named by the design gate (derived snapshot)', href: '/decisions?scope=gate' });
  if (m1Open > 0) blockers.push({ id: 'BLK-5', title: `${m1Open} decisions are needed by milestone M1`, detail: 'M1 is before options analysis for the reference architecture can start.', basis: `${P.register}, column "Needed by"`, href: '/decisions?milestone=M1&status=open' });
  if (t14 && !['done', 'decided', 'approved', 'agreed'].includes(t14.status)) blockers.push({ id: 'BLK-6', title: 'Branch protection is not in force', detail: 'Merge discipline is human and CI only detects. TODO T14 is still open.', basis: `${P.todo} row T14`, href: '/queue?q=T14' });

  const attention: Attention[] = blockers.map((b) => ({ id: b.id, level: 'critical' as const, title: b.title, detail: b.detail, href: b.href ?? '/' }));
  if (repo.defaultBranch && repo.defaultBranchBehind !== null && repo.defaultBranchBehind > 0) attention.push({ id: 'ATT-MAIN', level: 'warning', title: `${repo.defaultBranch} is ${repo.defaultBranchBehind} commits behind the commit being read`, detail: 'Material read here (for example ADRs 0016 to 0020) is not on the default branch.', href: '/' });
  if (!repo.commitOnGitHub) attention.push({ id: 'ATT-UNPUSHED', level: 'warning', title: 'The commit being read is not on GitHub', detail: 'Links resolve only for files whose content matches a pushed commit.', href: '/' });
  if (repo.uncommittedChanges > 0) attention.push({ id: 'ATT-DIRTY', level: 'info', title: `${repo.uncommittedChanges} uncommitted change(s) in the working tree`, detail: 'The Studio reads committed content only, so these are not shown.', href: '/' });
  const review = decisions.filter((d) => d.flags.review.length);
  if (review.length) attention.push({ id: 'ATT-REVIEW', level: 'info', title: `${review.length} decision(s) are flagged for human review`, detail: 'Delegated or partial-scope acceptances and unrecognised statuses.', href: '/decisions?scope=review' });

  // ---- documents
  const docs: Doc[] = docPaths
    .filter((p) => p.endsWith('.md') && !p.includes('/recordings/'))
    .map((p) => ({ path: p, title: titleOf(read(p)) || p.split('/').pop()!, area: p.split('/')[1] ?? 'docs', authority: classify(p) }));

  // ---- evidence
  const runs: EvidenceRun[] = git
    .list('docs/evidence/records/')
    .map((p) => ({ p, j: safeJson<{ id?: string; claim?: string; exitCode?: number | null; startedAt?: string; gitHead?: string }>(git.read(p)) }))
    .filter((x) => x.j?.id)
    .map((x) => ({ id: x.j!.id!, claim: x.j!.claim ?? '', exitCode: x.j!.exitCode ?? null, startedAt: x.j!.startedAt ?? '', gitHead: (x.j!.gitHead ?? '').slice(0, 7), src: { path: x.p, line: 1 } }));
  const manifest = safeJson<{ sealedThrough?: string; count?: number }>(git.read(P.evidenceManifest));
  const evidence = { runs, sealedThrough: manifest?.sealedThrough ?? null, sealedCount: manifest?.count ?? null, nonZero: runs.filter((r) => r.exitCode !== 0).length };

  // ---- presentation
  const slides: Slide[] = [...read(P.deck).matchAll(/<section class="slide[^"]*" id="([A-Z]\d+)"[^>]*><div class="inner"><div class="kick">([^<]*)<\/div><h1>([^<]*)<\/h1>/g)].map((m) => ({ id: m[1]!, kicker: plain(m[2]!), title: plain(m[3]!.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")) }));
  const qaText = read(P.qa);
  const qaLines = qaText.split('\n');
  const qa: QaItem[] = tableRows(qaText)
    .filter((r) => /^Q\d{2}$/.test(r.cells[0] ?? ''))
    .map(({ cells: c }) => {
      const hi = qaLines.findIndex((l) => l.startsWith(`## ${c[0]} `));
      const block = hi < 0 ? [] : qaLines.slice(hi, hi + 20);
      const unc = block.find((l) => l.startsWith('**Uncertain:**'));
      return { id: c[0]!, area: c[1] ?? '', slide: c[2] ?? '', question: plain(c[3] ?? ''), uncertain: plain((unc ?? '').replace('**Uncertain:**', '')), src: { path: P.qa, line: hi < 0 ? 1 : hi + 1 } };
    });
  const rtext = read(P.rehearsal);
  const rlines = rtext.split('\n');
  const rehearsal: RehearsalCriterion[] = [];
  rlines.forEach((l, i) => {
    const m = /^### ([BC]\d+)\.\s*(.*)$/.exec(l);
    if (!m) return;
    const status = rlines.slice(i + 1, i + 14).find((x) => x.startsWith('- **Status:**')) ?? '';
    const s = plain(status.replace('- **Status:**', '')).replace(/\s*_+.*$/, '').trim();
    rehearsal.push({ id: m[1]!, title: m[2]!.trim(), status: s || 'unknown', rehearsed: !!s && !/NOT REHEARSED/i.test(s), src: { path: P.rehearsal, line: i + 1 } });
  });
  const recordings: Recording[] = git
    .list('docs/capstone/presentation/recordings/')
    .map((p) => ({ p, j: safeJson<{ scenario?: string; title?: string; recordedAt?: string; gitHead?: string; notLive?: boolean }>(git.read(p)) }))
    .filter((x) => x.j)
    .map((x) => ({ path: x.p, scenario: x.j!.scenario ?? '', title: x.j!.title ?? '', recordedAt: x.j!.recordedAt ?? '', gitHead: (x.j!.gitHead ?? '').slice(0, 7), notLive: x.j!.notLive === true }));

  // ---- GitHub traceability
  const used = new Set<string>([...decisions.map((d) => d.src.path), ...tasks.map((t) => t.src.path), ...requirements.map((r) => r.src.path), ...risks.map((r) => r.src.path), ...assumptions.map((a) => a.src.path), ...reviews.flatMap((r) => [r.src.path, r.designSrc.path]), ...docs.map((d) => d.path), ...runs.map((r) => r.src.path), ...recordings.map((r) => r.path), P.qa, P.rehearsal, P.deck, P.trace, P.approvers, P.snapshot, P.state, P.todo, P.register, 'harness/scripts/approval.mjs']);
  const links = git.githubCommitsFor([...used].filter((p) => git.has(p)));

  return {
    repo,
    links,
    metrics,
    decisions,
    tasks,
    requirements,
    risks,
    assumptions,
    reviews,
    approvals,
    blockers,
    attention,
    docs,
    evidence,
    presentation: { slides, qa, rehearsal, recordings, recordingsSrc: 'docs/capstone/presentation/recordings/' },
    recentCommits: ((localOnly) => git.log(10).map((c) => ({ sha: c.sha, short: c.sha.slice(0, 7), date: c.date, subject: c.subject, author: c.author, localOnly: localOnly.has(c.sha) })))(git.localOnlyCommits(50)),
    warnings,
  };
}

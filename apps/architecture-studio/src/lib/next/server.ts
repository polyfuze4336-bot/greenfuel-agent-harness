// Gathers the facts the Next Best Action and the Overview need, from the caches that already exist (the read model, the work queue, the
// baseline readiness), and runs the pure rules over them. It adds no cache of its own for the ranking, which takes milliseconds; the one
// extra git call (when each ADR last changed) is kept per commit.
import fs from 'node:fs';
import path from 'node:path';
import { effectiveRoles, keyOf } from '../auth/authorize.ts';
import { authContextFor } from '../auth/config.ts';
import { classify, designatedOwners, type AccessPolicy, type SubjectKey } from '../auth/access-policy.ts';
import { getBaselineView } from '../baseline/server.ts';
import type { AreaReadiness } from '../baseline/readiness.ts';
import { reviewLane, type NormalizedDecision } from '../intel/schema.ts';
import { getQueue } from '../queue/server.ts';
import { getModel, openAdapter, repoRoot } from '../repo/index.ts';
import { runtime } from '../workflow/http.ts';
import type { Session } from '../workflow/identity.ts';
import { buildOverview, type OverviewModel } from './overview.ts';
import { rankActions, type GateBlockerFact, type ProposalFact } from './rank.ts';
import { staleEvidence, type RunFact } from './stale.ts';
import type { NextAction } from './types.ts';

export interface Me {
  login: string;
  roles: string[];
  key: SubjectKey | null;
}

export interface Freshness {
  commit: string;
  commitShort: string;
  commitDate: string;
  /** When the clone last fetched from GitHub successfully. Null when it never has, or this is not a clone. */
  lastFetchAt: string | null;
  ageSeconds: number | null;
  intervalSeconds: number;
  /** fresh: a fetch within three intervals. stale: not for longer than that, so GitHub may be unreachable. unknown: this checkout does not fetch. */
  state: 'fresh' | 'stale' | 'unknown';
  generatedAt: string;
}

const fetchHead = globalThis as unknown as { __studioFetchHead?: { root: string; file: string | null } };
/** When the clone last fetched. The location of FETCH_HEAD is found once, so this is a single file stat. */
function lastFetchedAt(): string | null {
  const root = repoRoot();
  if (fetchHead.__studioFetchHead?.root !== root) {
    const dir = openAdapter().gitCommonDir();
    fetchHead.__studioFetchHead = { root, file: dir ? path.join(dir, 'FETCH_HEAD') : null };
  }
  const file = fetchHead.__studioFetchHead.file;
  try {
    return file ? fs.statSync(file).mtime.toISOString() : null;
  } catch {
    return null;
  }
}

export async function freshness(now: number = Date.now()): Promise<Freshness> {
  const m = await getModel();
  const interval = Math.max(15, Number(process.env.STUDIO_SYNC_SECONDS) || 60);
  const last = lastFetchedAt();
  const age = last ? Math.max(0, Math.round((now - Date.parse(last)) / 1000)) : null;
  return {
    commit: m.repo.commit,
    commitShort: m.repo.commitShort,
    commitDate: m.repo.commitDate,
    lastFetchAt: last,
    ageSeconds: age,
    intervalSeconds: interval,
    state: age === null ? 'unknown' : age > interval * 3 ? 'stale' : 'fresh',
    generatedAt: new Date(now).toISOString(),
  };
}
export function meOf(session: Session | null, policy: AccessPolicy): Me | null {
  if (!session) return null;
  const ctx = authContextFor(policy);
  return { login: session.user.login, roles: effectiveRoles(session.user, ctx).roles, key: keyOf(session.user) };
}

const touched = globalThis as unknown as { __studioTouched?: { commit: string; map: Map<string, string> } };
function adrChangeDates(): (path: string) => string | null {
  const a = openAdapter();
  if (touched.__studioTouched?.commit !== a.commit) touched.__studioTouched = { commit: a.commit, map: a.lastTouched('docs/adr/') };
  const map = touched.__studioTouched.map;
  return (p) => map.get(p) ?? null;
}

// Reasons that are about a decision, and so are already actions on that decision. What is left are gates that are not decisions.
const DECISION_BLOCK_CODES = new Set(['missing', 'review', 'pending', 'rejected', 'deferred', 'superseded', 'unresolved-required-decisions', 'rejected-required', 'deferred-required']);

export interface NextView {
  commit: string;
  canonicalCommit: string | null;
  me: Me | null;
  actions: NextAction[];
  overview: OverviewModel;
  stale: ReturnType<typeof staleEvidence>;
  area: AreaReadiness | null;
  laterAreas: AreaReadiness[];
  baseline: ReturnType<typeof getBaselineView>;
  queue: Awaited<ReturnType<typeof getQueue>>;
  freshness: Freshness;
}

const memo = globalThis as unknown as { __studioNext?: { key: string; at: number; view: Promise<NextView> } };
/** A safety bound only. The key, not the clock, decides whether the answer is still right. */
const MEMO_MS = 60_000;

/**
 * The same facts give the same answer. The facts are the commit being read, who is asking, and the state of every change in flight, so a
 * visit costs a lookup until one of them moves; a webhook or a refresh also clears it. Requests that arrive while one is being computed
 * share that run. The freshness line is not part of the answer, because it changes with the clock, and is read each time.
 */
export async function getNextView(session: Session | null): Promise<NextView> {
  const m = await getModel();
  const proposals = runtime().service.deps.store.list().map((p) => `${p.id}:${p.state}:${p.updatedAt}`).join(',');
  const key = `${m.repo.commit}|${session?.user.provider ?? ''}:${session?.user.subject ?? ''}|${proposals}`;
  const hit = memo.__studioNext;
  let pending: Promise<NextView>;
  if (hit && hit.key === key && Date.now() - hit.at < MEMO_MS) pending = hit.view;
  else {
    pending = buildNextView(session);
    const entry = { key, at: Date.now(), view: pending };
    memo.__studioNext = entry;
    // A failed run must not be served again.
    pending.catch(() => memo.__studioNext === entry && (memo.__studioNext = undefined));
  }
  const view = await pending;
  return { ...view, freshness: await freshness() };
}

async function buildNextView(session: Session | null): Promise<NextView> {  const rt = runtime();
  const policy = rt.service.policy();
  const me = meOf(session, policy);
  const q = await getQueue();
  const baseline = getBaselineView();
  const m = q.model;
  const decisions = m.register.records;

  // The area for the next implementation phase is the implementation area at the policy's active stage. Others are later.
  const active = baseline.policy.activeStage;
  const areas = baseline.readiness.areas;
  const area = areas.find((a) => a.kind === 'implementation' && a.stage === active) ?? areas.find((a) => a.kind === 'implementation') ?? null;
  const laterAreas = areas.filter((a) => a !== area);

  const nextPhase = new Map<string, string[]>();
  for (const r of area?.requiredDecisions ?? []) if (!r.approved) nextPhase.set(r.id, r.requiredBy.length ? r.requiredBy : [area!.title]);
  const later = new Map<string, string[]>();
  for (const a of laterAreas) for (const r of a.requiredDecisions) if (!r.approved && !nextPhase.has(r.id)) later.set(r.id, [...(later.get(r.id) ?? []), ...(r.requiredBy.length ? r.requiredBy : [a.title])].slice(0, 3));

  const gate = baseline.gates.find((g) => g.area === area?.id);
  const gateBlockers: GateBlockerFact[] = (gate?.reasons ?? []).filter((r) => !DECISION_BLOCK_CODES.has(r.code)).map((r) => ({ code: r.code, text: r.text, refs: r.refs }));

  const approver = (d: NormalizedDecision) => {
    const rec = { id: d.id, kind: d.kind, approverText: d.requiredApproverRole?.text ?? null, natures: d.natures };
    const domain = classify(policy, rec).domain;
    const owners = domain === 'architecture' || domain === 'security' || domain === 'deployment' ? designatedOwners(policy, domain, rec) : [];
    const logins = owners.map((k) => policy.people.find((p) => p.subject === k)?.login).filter((x): x is string => !!x);
    return { label: logins.length ? [...new Set(logins)].join(' or ') : d.requiredApproverRole?.text ?? 'no approver named', isMe: reviewLane(d.natures) !== 'architecture' ? null : me?.key ? owners.includes(me.key) : null };
  };

  const proposals: ProposalFact[] = rt.service.deps.store.list().map((p) => ({ id: p.id, subjectId: p.decisionId, family: p.family === 'work' ? 'work' : 'decision', action: p.action, state: p.state, prNumber: p.prNumber, prUrl: p.prUrl, error: p.lastError?.message ?? null }));

  const runs = new Map<string, RunFact>(m.evidence.runs.map((r) => [r.id, { id: r.id, exitCode: r.exitCode, startedAt: r.startedAt }]));
  const stale = staleEvidence(decisions, runs, adrChangeDates());

  const buildChain = new Map(q.snapshot.blocking.analysis.blockers.map((b) => [b.id, { unlocks: b.unlocks, ready: b.ready }]));
  const actions = rankActions({ decisions, nextPhase, later, gateBlockers, approver, proposals, items: q.snapshot.items, buildChain, stale, me: me ? { login: me.login, roles: me.roles } : null });
  const overview = buildOverview({ commit: m.repo.commit, actions, decisions, items: q.snapshot.items, area, laterAreas });
  return { commit: m.repo.commit, canonicalCommit: q.canonicalCommit, me, actions, overview, stale, area, laterAreas, baseline, queue: q, freshness: await freshness() };
}

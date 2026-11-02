import { reviewLane, type NormalizedDecision, type OptionInfo, type Suggestion } from '../intel/schema.ts';
import { findCycles } from '../impact/analyze.ts';
import type { Assumption, DesignReview, Requirement, Risk } from '../repo/types.ts';
import type { BankQuestion } from './bank.ts';
import { buildCriticPrompt } from './prompt.ts';
import { scanText } from './safety.ts';
import { SECTION_KEYS, SECTION_TITLE, type AiChallenge, type Basis, type ExaminerDossier, type ExaminerEntry, type ExaminerSection, type InjectionSignal, type Position, type SectionKey, type Src } from './types.ts';

// The Architecture Examiner's deterministic part. It reads the same records the rest of the Studio reads and sets out, for one
// decision, what a hostile but fair panel would press on, using only what the repository says, and saying which kind of statement
// each line is. It calls no model, invents no fact, and never approves or recommends approving anything. An AI critic's challenge,
// if one has been committed, is validated elsewhere and shown beside this, never inside it.

export interface ExaminerInput {
  commit: string;
  records: NormalizedDecision[];
  requirements: Requirement[];
  risks: Risk[];
  reviews: DesignReview[];
  assumptions: Assumption[];
  suggestions: Suggestion[];
  bank: BankQuestion[];
  bankPath: string;
  ai: AiChallenge | null;
  /** Why an AI challenge file for this decision was not shown, if one exists and failed validation. */
  aiProblem?: string | null;
}

const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const E = (text: string, basis: Basis, sources: Src[] = [], note?: string): ExaminerEntry => ({ text, basis, sources, ...(note ? { note } : {}) });
const UNRESOLVED = new Set(['Proposed', 'Pending Review', 'Blocked', 'Deferred']);
const s = (x: { path: string; line: number } | null | undefined): Src[] => (x ? [{ path: x.path, line: x.line }] : []);

export interface PositionFacts {
  lane: string;
  unresolvedDeps: number;
  invalidRefs: number;
  cycles: number;
  hasChosen: boolean;
  doesNotMeet: number;
  reviewBlocked: number;
  openClarifications: number;
  evidenceGaps: number;
}

/** The Examiner's position, by a written rule. It is a statement about how defensible the record is, not a recommendation to approve. */
export function examinerPosition(f: PositionFacts): { position: Position; why: string[] } {
  if (f.lane !== 'architecture') return { position: 'Not an architecture decision', why: [f.lane === 'stakeholder' ? 'It asks for a fact only the business can supply.' : f.lane === 'verification' ? 'It asks a qualified person to verify a regulatory or certification claim.' : 'The register does not say what it asks for.'] };
  const hard: string[] = [];
  if (f.unresolvedDeps) hard.push(`it rests on ${f.unresolvedDeps} decision(s) that are not yet made`);
  if (f.invalidRefs) hard.push(`it cites ${f.invalidRefs} record(s) that do not exist`);
  if (f.cycles) hard.push('it is part of a dependency cycle');
  if (!f.hasChosen) hard.push('no option is recommended or selected in the record');
  if (f.doesNotMeet) hard.push(`the record says the chosen option does not meet ${f.doesNotMeet} criterion/criteria`);
  if (hard.length) return { position: 'Not ready to defend', why: hard };
  const soft: string[] = [];
  if (f.reviewBlocked) soft.push(`${f.reviewBlocked} design review(s) covering it are Blocked`);
  if (f.openClarifications) soft.push(`${f.openClarifications} requirement(s) still name an open clarification or verification`);
  if (f.evidenceGaps) soft.push(`${f.evidenceGaps} evidence gap(s)`);
  if (soft.length) return { position: 'Defensible with conditions', why: soft };
  return { position: 'Defensible on the record', why: ['No unresolved dependency, blocked review, open clarification or evidence gap is recorded.'] };
}

export function buildDossier(input: ExaminerInput, id: string): ExaminerDossier | null {
  const byId = new Map(input.records.map((r) => [r.id, r]));
  const d = byId.get(id);
  if (!d) return null;
  const reqs = new Map(input.requirements.map((r) => [r.id, r]));
  const reviews = new Map(input.reviews.map((r) => [r.id, r]));
  const lane = reviewLane(d.natures);
  const own: Basis = d.status === 'Approved' ? 'approved-decision' : 'proposed-interpretation';
  const chosen: OptionInfo | null = d.recommendedOption ?? d.options.find((o) => /select|chosen/i.test(o.disposition ?? '')) ?? null;
  const others = d.options.filter((o) => o !== chosen && o.key !== chosen?.key);
  const myReviews = d.relatedReviews.map((rv) => reviews.get(rv)).filter((x): x is DesignReview => !!x);
  const unresolvedDeps = d.dependsOn.map((x) => byId.get(x)).filter((x): x is NormalizedDecision => !!x && UNRESOLVED.has(x.status));
  const cycles = findCycles(input.records).filter((c) => c.includes(id));
  const blockedReviews = myReviews.filter((r) => /blocked/i.test(r.declared));
  const reqRows = d.relatedRequirements.map((x) => reqs.get(x.id)).filter((x): x is Requirement => !!x);
  const openClar = d.relatedRequirements.filter((x) => x.relation === 'blocked-until-decided');
  const evidenceGaps = d.evidence.filter((e) => !e.resolved || (e.kind === 'test-run' && e.exitCode !== 0)).length + (d.evidence.length === 0 ? 1 : 0);

  // ---- does-not-meet verdicts for the chosen option, from the comparison table the repository holds
  const doesNotMeet: { criterion: string; text: string; line: number }[] = [];
  if (d.comparison && chosen?.matrixColumn) for (const row of d.comparison.rows) { const c = row.cells[chosen.matrixColumn]; if (c?.verdict === 'does-not-meet') doesNotMeet.push({ criterion: row.criterion, text: c.text, line: row.line }); }
  const optionDoesNotMeet = (o: OptionInfo) => (d.comparison && o.matrixColumn ? d.comparison.rows.filter((r) => r.cells[o.matrixColumn!]?.verdict === 'does-not-meet').map((r) => r.criterion) : []);

  // ===== 1. the strongest argument against
  const against: ExaminerEntry[] = [];
  for (const x of doesNotMeet.slice(0, 3)) against.push(E(`The comparison table records that the chosen option ${chosen!.key} does not meet "${x.criterion}": ${clip(x.text)}`, own, d.comparison ? [{ path: d.comparison.src.path, line: x.line }] : []));
  for (const c of (chosen?.cons ?? []).slice(0, 3)) against.push(E(`The record itself lists a cost of the chosen option ${chosen!.key}: ${clip(c.text)}`, own, [c.src]));
  if (unresolvedDeps.length) against.push(E(`It rests on ${unresolvedDeps.length} decision(s) that are not yet made: ${unresolvedDeps.slice(0, 6).map((x) => `${x.id} (${x.status})`).join(', ')}${unresolvedDeps.length > 6 ? ', …' : ''}. Whatever is decided here can be undone by how those are answered.`, 'verified-fact', unresolvedDeps.slice(0, 4).flatMap((x) => s(x.source)), 'derived from the statuses in the records'));
  for (const r of blockedReviews.slice(0, 2)) against.push(E(`Design review ${r.id} covering it is declared Blocked${r.blockReasons ? ` with ${r.blockReasons} blocking reason(s)` : ''}.`, 'verified-fact', s(r.src)));
  if (openClar.length) against.push(E(`${openClar.length} requirement(s) cannot be accepted until this is decided: ${openClar.slice(0, 6).map((x) => x.id).join(', ')}.`, 'verified-fact', openClar.slice(0, 3).flatMap((x) => s(reqs.get(x.id)?.src))));
  if (d.invalidReferences.length) against.push(E(`It cites ${d.invalidReferences.length} record(s) that do not exist at this commit: ${d.invalidReferences.slice(0, 4).map((x) => x.id).join(', ')}.`, 'verified-fact', s(d.source)));
  if (lane === 'stakeholder') against.unshift(E('It is a question, not a choice: deciding now means guessing a fact only the business can supply.', 'verified-fact', s(d.source), 'from the register Kind'));
  if (lane === 'verification') against.unshift(E('It is a claim that has not been verified by a qualified person. Treating it as settled would present an assumption as a fact.', 'verified-fact', s(d.source), 'from the register Kind'));
  const none = E('No weakness is recorded in the sources for this decision. That is not evidence that there is none: ask the critic.', 'verified-fact', s(d.source));
  const counterArgument = against[0] ?? none;

  // ===== 2. viable alternatives
  const alternatives: ExaminerEntry[] = others.map((o) => {
    const bad = optionDoesNotMeet(o);
    return E(`${o.key}. ${o.name}${o.disposition ? ` (${o.disposition})` : ''}${o.summary ? `: ${clip(o.summary, 180)}` : ''}${bad.length ? ` Recorded as not meeting: ${bad.slice(0, 3).join('; ')}.` : ''}`, own, [o.src], bad.length ? 'not viable on the record' : 'no recorded verdict says it fails a criterion');
  });
  const viable = others.filter((o) => optionDoesNotMeet(o).length === 0).length;
  const aiAlts = input.suggestions.filter((x) => x.decisionId === id && x.kind === 'alternative');
  for (const a of aiAlts.slice(0, 3)) alternatives.push(E(clip(a.text, 260), 'ai-generated', [a.src], `AI suggestion ${a.id}, unreviewed`));
  if (others.length < 2) alternatives.push(E(`The record names ${others.length} alternative(s) to the chosen option. At least two viable ones are wanted. The Examiner will not invent one: the critic prompt asks for them, and a person must confirm they are real.`, 'verified-fact', s(d.source)));
  else if (viable < 2) alternatives.push(E(`Only ${viable} of the ${others.length} recorded alternatives is not recorded as failing a criterion.`, 'verified-fact', s(d.source)));

  // ===== 3. pros and cons
  const prosCons: ExaminerEntry[] = [];
  for (const o of [chosen, ...others].filter((x): x is OptionInfo => !!x)) {
    for (const p of o.pros.slice(0, 2)) prosCons.push(E(`${o.key} pro: ${clip(p.text)}`, own, [p.src]));
    for (const c of o.cons.slice(0, 2)) prosCons.push(E(`${o.key} con: ${clip(c.text)}`, own, [c.src]));
  }
  for (const a of input.suggestions.filter((x) => x.decisionId === id && (x.kind === 'pro' || x.kind === 'con')).slice(0, 4)) prosCons.push(E(`${a.optionKey ?? ''} ${a.kind}: ${clip(a.text, 220)}`.trim(), 'ai-generated', [a.src], `AI suggestion ${a.id}, unreviewed`));

  // ===== 4. hidden assumptions
  const assumptions: ExaminerEntry[] = [];
  for (const a of input.assumptions.filter((x) => `${x.text} ${x.replacedBy} ${x.basis}`.includes(id)).slice(0, 6)) assumptions.push(E(`${a.id}: ${clip(a.text, 200)}${a.riskIfWrong ? ` If wrong: ${clip(a.riskIfWrong, 140)}` : ''}${a.resolved ? ' (replaced by a decision)' : ''}`, a.resolved ? 'verified-fact' : 'unverified-assumption', s(a.src)));
  for (const x of unresolvedDeps.slice(0, 6)) assumptions.push(E(`It assumes ${x.id} (${x.status}), "${clip(x.title, 100)}", will be settled in a way that fits.`, 'unverified-assumption', s(x.source)));
  for (const q of openClar.slice(0, 4)) assumptions.push(E(`${q.id}'s traceability row lists this decision as an open clarification, so what is built on it assumes the answer.`, 'unverified-assumption', s(reqs.get(q.id)?.src)));

  // ===== 5. reliability and failure
  const reliability: ExaminerEntry[] = [];
  if (d.implications.reliability) reliability.push(E(clip(d.implications.reliability.text, 320), own, s(d.implications.reliability.src), 'stated in the record'));
  for (const rk of input.risks.filter((r) => d.relatedRisks.includes(r.id)).slice(0, 5)) reliability.push(E(`${rk.id} (${rk.status || 'status not stated'}): ${clip(rk.title, 90)}${rk.impact ? ` Impact: ${clip(rk.impact, 140)}` : ''}`, 'verified-fact', s(rk.src), 'recorded in the risk register'));

  // ===== 6. security and compliance
  const security: ExaminerEntry[] = [];
  if (d.implications.security) security.push(E(clip(d.implications.security.text, 320), own, s(d.implications.security.src), 'stated in the record'));
  if (d.implications.dataSovereignty) security.push(E(clip(d.implications.dataSovereignty.text, 320), own, s(d.implications.dataSovereignty.src), 'stated in the record'));
  if (d.natures.includes('regulatory-verification')) security.push(E('A qualified person must verify the regulatory or certification claim. An architecture approval does not authorise a filing, and no recommendation, human or AI, verifies it.', 'verified-fact', s(d.source), 'from the register Kind D'));
  for (const q of reqRows.filter((x) => /^(SEC|DATA)-/.test(x.id)).slice(0, 5)) security.push(E(`${q.id} (${q.priority || 'priority not stated'}): ${clip(q.title, 150)}`, 'verified-fact', s(q.src), 'a requirement this decision is tied to'));

  // ===== 7. cost and operations
  const cost: ExaminerEntry[] = [];
  if (d.implications.cost) {
    cost.push(E(clip(d.implications.cost.text, 360), own, s(d.implications.cost.src), 'stated in the record'));
    if (!/\d/.test(d.implications.cost.text)) cost.push(E('No amount is stated: the cost is described by its drivers, not by figures. Any number put to the panel would be unsupported.', 'unverified-assumption', s(d.implications.cost.src)));
  }
  if (d.implications.operational) cost.push(E(clip(d.implications.operational.text, 320), own, s(d.implications.operational.src), 'stated in the record'));

  // ===== 8. five difficult panel questions: from the programme's bank by explicit mention, then derived from gaps
  const questions: ExaminerEntry[] = [];
  const mention = (q: BankQuestion, ids: string[]) => ids.find((x) => new RegExp(`\\b${x.replace('-', '\\-')}\\b`).test(`${q.question} ${q.answer}`));
  const bankHits = [...input.bank.map((q) => ({ q, via: mention(q, [id]) })).filter((x) => x.via), ...input.bank.map((q) => ({ q, via: mention(q, d.dependsOn.filter((x) => x !== id)) })).filter((x) => x.via)];
  const seenQ = new Set<string>();
  for (const { q, via } of bankHits.sort((a, b) => Number(b.q.critical) - Number(a.q.critical))) {
    if (seenQ.has(q.id) || questions.length >= 3) continue;
    seenQ.add(q.id);
    questions.push(E(q.question, 'verified-fact', [{ path: input.bankPath, line: q.line }], `from the programme's question bank ${q.id}${q.critical ? ' (critical)' : ''}, because its expected answer names ${via}`));
  }
  const derived: ExaminerEntry[] = [];
  for (const x of unresolvedDeps.slice(0, 2)) derived.push(E(`You rest on ${x.id} (${x.status}), "${clip(x.title, 90)}". What happens to this decision if that is answered the other way?`, 'proposed-interpretation', s(x.source), `derived by rule from the unresolved dependency ${x.id}`));
  const missingImp = Object.entries(d.implications).filter(([, v]) => !v).map(([k]) => k);
  if (missingImp.length) derived.push(E(`Where in your sources are the ${missingImp.slice(0, 3).join(', ')} consequences stated? Show the file and the line.`, 'proposed-interpretation', s(d.source), 'derived by rule from fields no source states'));
  if (chosen?.cons[0]) derived.push(E(`Your own record lists "${clip(chosen.cons[0].text, 120)}". Why is that acceptable, and what evidence would make you withdraw this?`, 'proposed-interpretation', [chosen.cons[0].src], 'derived by rule from a recorded cost'));
  if (others.length < 2) derived.push(E('Which real alternative did you reject, and on what evidence? The record names too few to show the choice was made between real options.', 'proposed-interpretation', s(d.source), 'derived by rule: fewer than two alternatives are recorded'));
  if (evidenceGaps) derived.push(E('Which evidence record shows this works? Name its id and what it measured.', 'proposed-interpretation', s(d.source), 'derived by rule from missing or failing evidence'));
  for (const r of blockedReviews.slice(0, 1)) derived.push(E(`${r.id} is Blocked. What exactly must change for the gate to pass, and who decides?`, 'proposed-interpretation', s(r.src), 'derived by rule from a blocked design review'));
  if (d.status === 'Approved' && d.approvalBasis !== 'signed') derived.push(E('This is Approved without a signed approval record. On whose authority, and what would a signed record add?', 'proposed-interpretation', s(d.source), 'derived by rule from the approval basis'));
  if (cycles.length) derived.push(E(`${cycles[0]!.join(' → ')} is a circle. Which of these is the real starting point?`, 'proposed-interpretation', s(d.source), 'derived by rule from a dependency cycle'));
  for (const q of derived) if (questions.length < 5) questions.push(q);
  // Still short: the bank's own questions tagged ALL, which the bank says apply to every design, critical ones first.
  for (const q of input.bank.filter((x) => x.tags.includes('ALL')).sort((a, b) => Number(b.critical) - Number(a.critical))) {
    if (questions.length >= 5) break;
    if (!seenQ.has(q.id)) {
      seenQ.add(q.id);
      questions.push(E(q.question, 'verified-fact', [{ path: input.bankPath, line: q.line }], `from the programme's question bank ${q.id}${q.critical ? ' (critical)' : ''}; the bank tags it ALL, meaning it applies to every design`));
    }
  }
  const standing = ['What single finding would make you withdraw this recommendation, and have you looked for it?', 'What is the cheapest test that would show this decision is wrong?', 'Who bears the cost if this is wrong, and how soon would you know?'];
  for (const t of standing) if (questions.length < 5) questions.push(E(t, 'proposed-interpretation', s(d.source), 'a standing question, not derived from this record'));

  // ===== 9. evidence needed to defend it
  const evidence: ExaminerEntry[] = [];
  for (const e of d.evidence.slice(0, 6)) evidence.push(E(e.resolved ? `${e.id}: ${clip(e.claim ?? 'no claim stated', 160)}${e.kind === 'test-run' ? ` (${e.exitCode === 0 ? 'passed' : e.exitCode === null ? 'no result recorded' : `exit ${e.exitCode}`})` : ''}` : `${e.id} is cited but no record with that id exists at this commit.`, 'verified-fact', s(e.src)));
  if (d.evidence.length === 0) evidence.push(E('No evidence record is cited by this decision.', 'verified-fact', s(d.source)));
  const needs = reqRows.filter((q) => q.evidenceRequired).sort((a, b) => Number(/must/i.test(b.priority)) - Number(/must/i.test(a.priority))).slice(0, 6);
  for (const q of needs) evidence.push(E(`${q.id} requires: ${clip(q.evidenceRequired, 200)}`, 'verified-fact', s(q.src), 'the requirement states the evidence it needs'));
  for (const rb of d.rubric.slice(0, 3)) evidence.push(E(`Capstone rubric criterion ${rb.criterion} (${rb.title}) draws on this decision${rb.via === 'design' ? ' through its design' : ''}.`, 'verified-fact', s(rb.src)));

  // ===== 10. recommendation with limits
  const facts: PositionFacts = { lane, unresolvedDeps: unresolvedDeps.length, invalidRefs: d.invalidReferences.length, cycles: cycles.length, hasChosen: !!chosen, doesNotMeet: doesNotMeet.length, reviewBlocked: blockedReviews.length, openClarifications: openClar.length, evidenceGaps };
  const { position, why } = examinerPosition(facts);
  const reasons = why.map((w) => E(`${position}: ${w}.`.replace('..', '.'), 'proposed-interpretation', s(d.source), 'derived by a written rule from the records above'));
  const recommendation: ExaminerEntry[] = [E(`The Examiner's position is "${position}". This is a statement about how well the record can be defended, not a recommendation to approve or reject. A person decides.`, 'proposed-interpretation', s(d.source), 'derived by a written rule'), ...reasons];

  const sections: ExaminerSection[] = ([['against', against], ['alternatives', alternatives], ['pros-cons', prosCons], ['assumptions', assumptions], ['reliability', reliability], ['security-compliance', security], ['cost-operations', cost], ['questions', questions], ['evidence', evidence], ['recommendation', recommendation]] as [SectionKey, ExaminerEntry[]][]).map(([key, entries]) => ({
    key,
    title: key === 'alternatives' && lane === 'stakeholder' ? 'Possible answers (not architecture options)' : key === 'alternatives' && lane === 'verification' ? 'Ways to verify' : SECTION_TITLE[key],
    entries,
    empty: entries.length ? null : ({ against: 'No weakness is recorded in the sources for this decision. That is not evidence that there is none.', alternatives: 'The record names no alternatives.', 'pros-cons': 'No pros or cons are recorded.', assumptions: 'No assumption or unresolved dependency is recorded for this decision. That does not mean it has none.', reliability: 'No source records reliability or failure implications for this decision. That is a gap to close, not a finding of no risk.', 'security-compliance': 'No source records security or compliance implications for this decision.', 'cost-operations': 'No source records cost or operational implications for this decision.', questions: null, evidence: null, recommendation: null } as Record<SectionKey, string | null>)[key],
  }));
  void SECTION_KEYS;

  // ---- injection: text from sources and from an AI file is data. It is flagged here and never changes anything above.
  const injection: InjectionSignal[] = [];
  const scan = (where: string, text: string | null | undefined) => injection.push(...scanText(where, text));
  scan('title', d.title);
  scan('description', d.description);
  scan('business justification', d.businessJustification);
  scan('status', d.statusRaw);
  for (const o of d.options) {
    scan(`option ${o.key} name`, o.name);
    scan(`option ${o.key} summary`, o.summary);
    for (const c of [...o.pros, ...o.cons, ...o.conditional, ...o.unknown]) scan(`option ${o.key} claim`, c.text);
  }
  for (const [k, v] of Object.entries(d.implications)) scan(`${k} implication`, v?.text);
  for (const x of input.suggestions.filter((y) => y.decisionId === id)) scan(`AI suggestion ${x.id}`, `${x.text}\n${x.rationale}`);
  for (const c of input.ai?.claims ?? []) if (c.injection) injection.push({ where: 'AI challenge entry', pattern: 'instruction-like text', excerpt: clip(c.text, 110) });

  const basisCounts: Record<Basis, number> = { 'verified-fact': 0, 'approved-decision': 0, 'proposed-interpretation': 0, 'unverified-assumption': 0, 'ai-generated': 0 };
  for (const sec of sections) for (const en of sec.entries) basisCounts[en.basis]++;
  basisCounts['ai-generated'] += (input.ai?.claims ?? []).filter((c) => c.supported).length;

  const limitations = [
    'The Examiner is rule-based and uses no model. It reports what the repository records and does not judge whether it is true.',
    'It does not approve, reject or recommend approving. The position above is how defensible the record is.',
    ...(d.implications.cost && !/\d/.test(d.implications.cost.text) ? ['No cost figure is recorded, so none is estimated.'] : ['No effort, schedule or cost is estimated.']),
    ...(input.ai ? [`An AI challenge dated ${input.ai.date} exists. ${input.ai.claims.filter((c) => !c.supported).length} of its ${input.ai.claims.length} claim(s) could not be checked against their citations and are shown apart.`] : [input.aiProblem ? `An AI challenge file exists but was not shown: ${input.aiProblem}.` : 'No AI challenge is committed for this decision. The prompt below runs the architecture-critic and principal-architect agents; their output is shown here only after it is merged to the repository and its citations check out.']),
    ...(injection.length ? [`${injection.length} instruction-like passage(s) were found in the source text. They were treated as data and changed nothing here.`] : []),
  ];

  const base = { decisionId: id, title: d.title, commit: input.commit, status: d.status, lane, natures: d.natures, headline: { counterArgument, position, reasons }, sections, basisCounts, injection, ai: input.ai, limitations };
  return { ...base, prompt: buildCriticPrompt({ ...base, prompt: '' }, d) };
}

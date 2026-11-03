// The slide content. Every number and every row comes from a committed source, read through the context; nothing is typed in by hand except
// framing words. Where the repository holds no evidence, a slide carries a placeholder that says so instead of a figure.
import { clip, plain, verdictOf } from './mdtable.ts';
import type { DeckContext } from './context.ts';
import type { Chip, Claim, Item, Placeholder, Slide, SourceRef, Tone, Verdict } from './types.ts';

const usd = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : `$${Math.round(a).toLocaleString('en-US')}`;
  return n < 0 ? `-${s}` : s;
};
const usd1 = (n: number) => (Math.abs(n) >= 1e6 ? `${n < 0 ? '-' : ''}$${(Math.abs(n) / 1e6).toFixed(1)}M` : usd(n));

export const P = {
  problem: 'PROBLEMSTATEMENT.md',
  bvm: 'docs/business/BUSINESS-VALUE-MODEL.md',
  commercial: 'docs/business/COMMERCIAL-VALUE.md',
  stakeholders: 'docs/business/STAKEHOLDERS.md',
  options: 'docs/target-architecture/02-ARCHITECTURE-OPTIONS.md',
  views: 'docs/target-architecture/03-ARCHITECTURE-VIEWS.md',
  quality: 'docs/target-architecture/05-QUALITY-ATTRIBUTES.md',
  threat: 'docs/target-architecture/06-THREAT-MODEL.md',
  svc: 'docs/target-architecture/07-AZURE-SERVICE-DECISION-MATRIX.md',
  defense: 'docs/target-architecture/08-DESIGN-DEFENSE.md',
  controls: 'docs/target-architecture/10-CONTROL-MATRIX.md',
  secReview: 'docs/target-architecture/13-SECURITY-REVIEW.md',
  flows: 'docs/target-architecture/12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md',
  autonomy: 'docs/context/AGENT-AUTONOMY-MATRIX.md',
  sovereignty: 'docs/context/SOVEREIGNTY-MATRIX.md',
  refArch: 'docs/azure/AZURE-REFERENCE-ARCHITECTURE.md',
  ops: 'docs/azure/OPERATIONS-AND-DR.md',
  cost: 'docs/azure/COST-AND-CAPACITY.md',
  eval: 'docs/evaluation/agent-runs/COMPARISON.md',
  evalReport: 'docs/design/ai/AGENT-EVALUATION-REPORT.md',
  gaps: 'docs/capstone/CRITICAL-GAPS.md',
  rubric: 'docs/capstone/RUBRIC-TRACEABILITY.md',
  blocker: 'docs/phase/PHASE-1-BLOCKER-REPORT.md',
  qa: 'docs/capstone/presentation/QA-PANEL-50.md',
  demoExec: 'docs/capstone/presentation/DEMO-EXECUTIVE.md',
  coverage: 'docs/acceptance/REQUIREMENTS-COVERAGE.md',
  tests: 'docs/evidence/records/EV-0077.json',
  custody: 'harness/contracts/custody-chain-contract.mjs',
  lifecycle: 'harness/contracts/certificate-lifecycle-contract.mjs',
} as const;

type Partial2 = Partial<Slide> & Pick<Slide, 'id' | 'tier' | 'section' | 'title' | 'message' | 'visual'>;
const mk = (s: Partial2): Slide => ({ claims: [], sources: [], decisions: [], placeholders: [], notes: { say: '' }, seconds: 60, rubric: [], ...s });
const src = (path: string, chip?: Chip): SourceRef => ({ path, chip });

/** The limit each reused slide must say aloud. The speaker notes of the HTML deck do not carry one, so it is stated here, once. */
const HONESTY: Record<string, string> = {
  M01: 'Nothing is built: there is no application and no Azure resource. This is a defence of a design and its evidence.',
  M02: 'The pain points are inferred from the case study; no stakeholder has been interviewed.',
  M03: 'Every business figure is a scenario input; none came from the business.',
  M04: 'These are scenario outputs, not a forecast.',
  M05: 'ADR-0016 is Blocked: option C is a recommendation, not an approved decision.',
  M06: 'The recommended architecture is Blocked in the register (ADR-0016 to 0019) and is not built.',
  M08: 'Real code on synthetic data with test-only keys. The time saving is a scenario, not a measurement.',
  M10: 'Synthetic cases written by the author and not reviewed; no language model was run.',
  M11: 'Cost figures are scenario outputs; only Azure list prices are verified inputs.',
  M13: 'The decision is the sponsor\'s: no phase has been raised and no approver is enrolled.',
};

/** Speaker notes and evidence of the matching slide in the existing HTML deck. */
function fromLegacy(c: DeckContext, id: string): Pick<Slide, 'notes' | 'seconds' | 'rubric' | 'sources'> {
  const l = c.legacy[id];
  return {
    notes: { say: l?.say ?? '', next: l?.next, ifAsked: l?.ifAsked, honesty: HONESTY[id] },
    seconds: l?.seconds ?? 60,
    rubric: l?.rubric ?? [],
    sources: (l?.evidence ?? []).map((e) => src(e.path, e.chip as Chip)),
  };
}

const claim = (id: string, text: string, sources: string[], contains?: string[]): Claim => ({ id, text, sources, contains });
const ph = (id: string, what: string, why: string, neededFrom: string): Placeholder => ({ id, what, why, neededFrom });

const VERDICT_WORD: Record<Verdict, string> = { meets: 'Meets', conditional: 'Conditional', 'does-not-meet': 'Does not meet', unknown: 'Unknown', other: 'n/a' };

export function buildSlides(c: DeckContext): Slide[] {
  const f = c.facts;
  const e = f.eval;
  const be = Math.round(f.breakEven);
  const slides: Slide[] = [];
  const add = (s: Slide) => slides.push(s);

  const optTable = c.table(P.options, ['Criterion', 'A']);
  const sovTable = c.table(P.sovereignty, ['Data class', 'Z1']);
  const svcTable = c.table(P.svc, ['Role', 'Candidate']);
  const flowTable = c.table(P.flows, ['Flow', 'From to']);
  const autAgents = c.table(P.autonomy, ['Agent', 'Proposed ceiling']);
  const autLevels = c.table(P.autonomy, ['Level', 'Meaning']);
  const drLayers = c.table(P.ops, ['Layer', 'Baseline design']);
  const obsNeeds = c.table(P.ops, ['Need', 'Design']);
  const gapTable = c.table(P.gaps, ['ID', 'Gap']);
  const qaTable = c.table(P.qa, ['ID', 'Area']);
  const threatTable = c.table(P.threat, ['ID', 'Boundary', 'Threat']);
  const costNone = c.table(P.cost, ['Item', 'Why there is no figure']);

  // ================================================================= EXECUTIVE STORY
  add(mk({
    id: 'E01', tier: 'executive', section: 'Capstone defence', title: 'Certificates a shipowner can verify on their own',
    message: 'Fund a bounded local pilot of sovereign evidence cells. Do not fund Azure deployment yet.',
    visual: { kind: 'hero', sub: 'Green-Fuel Bunkering Certification Platform', meta: 'Phase 0: design, controls and evidence. No application and no Azure resource exists.', image: 'hero' },
    ...fromLegacy(c, 'M01'),
    claims: [claim('E01-c1', 'No Azure resource and no application exist at this commit.', [P.blocker], ['Not requested and deferred by the owner'])],
  }));

  add(mk({
    id: 'E02', tier: 'executive', section: '1 The problem', title: 'A green-fuel premium is only paid if the certificate is believed',
    message: 'Each delivery must become a certificate that survives a shipowner, an auditor and a dispute.',
    visual: { kind: 'flow', stages: (c.legacy.M02?.visual?.stages ?? []).map((l: string) => ({ label: l })), breaks: c.legacy.M02?.visual?.breaks ?? [] },
    ...fromLegacy(c, 'M02'),
    claims: [claim('E02-c1', 'The case study states the commercial problem and constraints.', [P.problem])],
  }));

  const stakeTable = c.table(P.stakeholders, ['Stakeholder', 'Basis', 'Decider for']);
  const stakeRows = stakeTable?.rows ?? [];
  const stated = stakeRows.filter((r) => /^\**stated/i.test(plain(r[1] ?? '')) || /stated/i.test(r[1] ?? '')).length;
  add(mk({
    id: 'E02B', tier: 'executive', section: '1 The stakeholders', title: `Eight stakeholders decide this: the case names ${stated}, and the rest are candidates`,
    message: 'Whoever can fund it, approve a filing, open a meter or accept the evidence is on this slide. None has been interviewed.',
    visual: { kind: 'table', head: ['Stakeholder', 'Basis', 'Decides'], widths: [4.2, 2.2, 5.6], compact: true, rows: stakeRows.map((r) => [clip(plain(r[0] ?? '').replace(/\s*\(.*$/, ''), 34), clip(plain(r[1] ?? ''), 22), clip(plain(r[2] ?? ''), 74)]), foot: 'Stated means the case study says so. Candidate means it is a hypothesis from the analysis and needs a stakeholder to confirm it.' },
    sources: [src(P.stakeholders, 'CANDIDATE'), src(P.problem, 'CASE STUDY')], seconds: 45, rubric: ['B1', 'C1'],
    notes: { say: 'These are the people and groups whose decisions shape the design. The case study names two of them directly: the quality manager, who approves every certification filing, and the shipowner, whose data must stay isolated. The others are my reading of who must agree for this to work in a port. Each one decides something different: funding, filing approval, access to meters, or what counts as acceptable evidence. I have not interviewed any of them, so every success measure on this slide is a question I still owe an answer to.', next: 'Why does reliability decide the premium?', honesty: 'Only two stakeholders are stated by the case study. The rest are hypotheses, and no stakeholder has been interviewed.' },
    claims: [claim('E02B-c1', 'The stakeholder analysis marks the quality manager and the shipowner as stated by the case study.', [P.stakeholders], ['Stated'])],
  }));

  add(mk({
    id: 'E03', tier: 'executive', section: '2 Why it matters', title: 'Reliability decides how much of the premium is kept',
    message: 'The premium pool is the prize and trusted certificates protect it. How much is unknown: the business has supplied no figure.',
    visual: { kind: 'stats', items: [
      { label: 'premium revenue pool a year, year 3, base inputs', text: usd1(f.premiumPool), chip: 'SCENARIO' },
      { label: 'of it protected by the platform, base case', text: usd1(f.premiumProtected), chip: 'SCENARIO' },
      { label: 'inputs supplied by the business so far', text: String(f.labels.userProvided), chip: 'NOT PROVIDED' },
    ], foot: 'Scenario figures are assumptions in a model, not facts. They show where value would come from.' },
    ...fromLegacy(c, 'M03'),
    claims: [claim('E03-c1', 'Every business input is a scenario assumption except Azure list prices.', [P.bvm], ['scenario'])],
    placeholders: [ph('PH-VOLUME', 'Group delivery volumes, green-fuel premiums and dispute history', 'The value model runs on scenario inputs; none came from the business.', 'Trading head and finance (decision D-032, D-026)')],
  }));

  add(mk({
    id: 'E04', tier: 'executive', section: '3 Value and cost of inaction', title: 'Base case: real value, but no three-year payback',
    message: `Placeholder inputs give a negative three-year NPV (${usd(f.npv)}) and about ${Math.round(f.payback)} months to pay back. Volume decides it.`,
    visual: { kind: 'bars', title: 'Annual benefit by source, year 3, base case', unit: 'USD', items: [
      { label: 'Certificate labour', value: f.benefit.labour, text: usd1(f.benefit.labour), chip: 'SCENARIO' },
      { label: 'Disputes', value: f.benefit.disputes, text: usd1(f.benefit.disputes), chip: 'SCENARIO' },
      { label: 'Audit preparation', value: f.benefit.audit, text: usd1(f.benefit.audit), chip: 'SCENARIO' },
      { label: 'Premium protected', value: f.benefit.premium, text: usd1(f.benefit.premium), chip: 'SCENARIO' },
      { label: 'Incremental margin', value: f.benefit.margin, text: usd1(f.benefit.margin), chip: 'SCENARIO' },
    ], foot: `Break-even needs about ${be} deliveries a year; the base case assumes ${f.deliveriesAssumed}. Doing nothing keeps the manual cost of about ${usd(f.certToday)} per certificate and forgoes about ${usd1(f.benefitY3)} a year.` },
    ...fromLegacy(c, 'M04'),
    claims: [claim('E04-c1', 'The base-case three-year NPV is negative and break-even needs more deliveries than assumed.', [P.bvm], ['NPV'])],
  }));

  const dText = (r: string[]) => plain(r[4] ?? '').replace(/^(meets|conditional|does not meet|unknown)\b[:.]?\s*/i, '');
  const dRows = (optTable?.rows ?? []).filter((r) => dText(r).length > 3);
  add(mk({
    id: 'E05', tier: 'executive', section: '4 Why today is not enough', title: 'Today\'s manual process is not known well enough, and fails where it is known',
    message: 'Records can be altered undetectably, effort grows with volume, and audit preparation is a document hunt.',
    visual: { kind: 'table', head: ['Criterion', 'Today\'s process'], widths: [4, 8], rows: dRows.map((r) => [plain(r[0] ?? '').replace(/\s*\(.*$/, ''), clip(dText(r), 90)]), foot: 'The assessment is from the options analysis. The current systems themselves are not known (D-019, D-035).' },
    sources: [src(P.options, 'DESIGN'), src(P.problem, 'CASE STUDY')], seconds: 45, rubric: ['B1', 'C1'],
    notes: { say: 'The manual process is the baseline every option is measured against. Where it can be assessed it fails the criteria that matter to a certificate: undetectable alteration, effort that grows with volume, and audit preparation done by hunting for documents. I have not seen the real current systems, so several criteria are unknown, and I say so.', next: 'What did we consider instead?', honesty: 'Current systems and baseline cost are not provided (D-019, D-035, D-034).' },
    claims: [claim('E05-c1', 'The options analysis rejects continuing today\'s process.', [P.options], ['undetectable'])],
  }));

  const cols = ['A Centralised', 'B Edge plus shore', 'C Sovereign cells', 'D Today'];
  add(mk({
    id: 'E06', tier: 'executive', section: '4 Alternatives', title: 'Four options on eleven criteria: only sovereign cells can be made to meet residency',
    message: 'The cheapest option cannot show port residency. The recommended one pays for it in operational complexity.',
    visual: { kind: 'matrix', cols, rows: (optTable?.rows ?? []).map((r) => ({ label: plain(r[0] ?? '').replace(/\s*\(.*$/, ''), cells: [1, 2, 3, 4].map((i) => ({ verdict: verdictOf(r[i] ?? ''), text: VERDICT_WORD[verdictOf(r[i] ?? '')] })) })), foot: `Verdicts are the options analysis's own. Costs over three years: A ${usd1(f.opt1.tco3)}, B ${usd1(f.opt2.tco3)} (not like-for-like), C ${usd1(f.opt3.tco3)}.` },
    ...fromLegacy(c, 'M05'),
    decisions: ['ADR-0016'],
    claims: [claim('E06-c1', 'Option A violates the data-residency hard constraint.', [P.options], ['Rejected (hard constraint)'])],
  }));

  add(mk({
    id: 'E07', tier: 'executive', section: '5 Recommendation', title: 'Recommend sovereign cells, a deterministic core and bounded agents',
    message: 'Evidence stays in its port. Software computes and signs. AI drafts and explains, and never decides.',
    visual: { kind: 'cells', foot: 'Design, not built. The group plane carries no raw or evidence-grade data.' },
    ...fromLegacy(c, 'M06'),
    decisions: ['ADR-0016', 'ADR-0017', 'ADR-0018', 'ADR-0019'],
    claims: [claim('E07-c1', 'The recommended option is recorded as ADR 0016 and is not accepted.', [P.options], ['Select option C'])],
  }));

  const reasons = [...(c.read(P.options) ?? '').matchAll(/^\d\. \*\*(.+?)\*\*(.*)$/gm)].slice(0, 5);
  add(mk({
    id: 'E08', tier: 'executive', section: '5 Why this design wins', title: 'It wins on the hard constraints and pays for it in complexity',
    message: 'Five decisive reasons, in order. Each ties to a stated requirement or constraint.',
    visual: { kind: 'table', head: ['Reason', 'What it means'], widths: [4.5, 7.5], rows: reasons.map((m) => [clip((m[1] ?? '').replace(/\.$/, ''), 56), clip((m[2] ?? '').replace(/^[\s:.]+/, ''), 88)]), foot: 'Conditions attached: if the sponsor will not pay for sovereignty, the choice is fewer ports, not a cheaper design that breaks residency.' },
    sources: [src(P.options, 'DESIGN'), src(P.defense, 'DESIGN')], seconds: 60, rubric: ['B1', 'B7'], decisions: ['ADR-0016'],
    notes: { say: 'These are the reasons in the order the options analysis gives them. The first is the decisive one: residency by construction rather than by region, because a region name is not proof that data stays in a jurisdiction. The design costs more and is harder to operate. That is a stated trade-off, and the sponsor has to accept it for the recommendation to stand.', next: 'How does the business workflow run?', honesty: 'ADR-0016 is not accepted; the review RV-0003 is unresolved.' },
    claims: [claim('E08-c1', 'The analysis lists decisive reasons for option C, in order.', [P.options], ['The decisive reasons'])],
  }));

  add(mk({
    id: 'E09', tier: 'executive', section: '6 Agentic workflow', title: 'Agents draft. Services validate and issue. A person approves',
    message: 'Five business agents work inside fixed boundaries; none can approve, file or change a method.',
    visual: { kind: 'flow', stages: [
      { label: 'Transfer completed', sub: 'signed events' },
      { label: 'Evidence bound', sub: 'chain verified' },
      { label: 'Emissions attribute', sub: 'deterministic code' },
      { label: 'Certificate drafted', sub: 'by an agent' },
      { label: 'Approved and issued', sub: 'quality manager, signed' },
      { label: 'Shipowner verifies', sub: 'public key only' },
    ], breaks: ['Agents never hold the permission to approve or file', 'Emissions come from versioned methods, never from a model', 'Every step ends in a defined, auditable state'], breaksTitle: 'The rules that hold' },
    sources: [src(P.demoExec, 'REAL RUN'), src(P.autonomy, 'DESIGN')], seconds: 60, rubric: ['B1', 'B3'],
    notes: { say: 'This is the business workflow the demo shows. A transfer completes with signed events. The evidence is bound and the chain verified. The emissions attribute is computed by deterministic code under a versioned method. An agent may draft the certificate, a validator service checks it, and a human quality manager approves it with a signed record. Only then does the issuer service issue it, and the shipowner verifies it with the public key alone.', next: 'How is the evidence kept honest and local?', honesty: 'Real code on synthetic data with test-only keys; not the platform.' },
    claims: [claim('E09-c1', 'The agent drafts; the validator validates; a human approves; the issuer issues.', [P.demoExec], ['approve'])],
  }));

  const sovRows = (sovTable?.rows ?? []).slice(0, 8);
  const zoneVerdict = (cell: string): Verdict => {
    const t = plain(cell).toLowerCase();
    return t.startsWith('yes') ? 'meets' : t.startsWith('cond') ? 'conditional' : t.startsWith('no') ? 'does-not-meet' : t.startsWith('tbd') ? 'unknown' : 'other';
  };
  add(mk({
    id: 'E10', tier: 'executive', section: '7 Evidence and sovereignty', title: 'Evidence stays in its port: everywhere else is conditional or prohibited',
    message: 'A region name is not residency proof. Placement is proposed per data class and zone, and undecided means no.',
    visual: { kind: 'matrix', cols: ['Z1 Edge', 'Z2 Port shore', 'Z3 Group hub', 'Z4 Cloud/AI', 'Z5 Customer', 'Z6 Staff abroad', 'Z7 External'], rows: sovRows.map((r) => ({ label: clip((r[0] ?? '').replace(/^DC-\d+\s*/, ''), 40), cells: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ verdict: zoneVerdict(r[i] ?? ''), text: plain(r[i] ?? '').replace(/\s*\(.*\)/, '') })) })), foot: 'Proposed rules. Yes permitted, Cond permitted only after a named decision, No prohibited, TBD undecided and treated as No.' },
    sources: [src(P.sovereignty, 'DESIGN'), src(P.flows, 'DESIGN')], seconds: 60, rubric: ['B1', 'B7'], decisions: ['ADR-0004', 'ADR-0015'],
    notes: { say: 'The first rule is that choosing a cloud region does not prove residency. People, pipelines, identity, telemetry and AI processing all move data. So placement is proposed per data class and per zone. Raw delivery measurements are permitted at the edge and in the port\'s own shore platform, and prohibited in the group hub, in cloud or AI services without a pinned location, and for staff abroad. Anything undecided is treated as no.', next: 'Show me.', honesty: 'These are proposed rules. No port is named and no region is verified.' },
    claims: [claim('E10-c1', 'A region is not a residency control.', [P.sovereignty], ['a region is not a residency control'])],
  }));

  add(mk({
    id: 'E11', tier: 'executive', section: 'Live demonstration', title: 'Watch a delivery become a certificate a shipowner can verify',
    message: 'Two minutes. Real code on synthetic data. Every step is labelled, and a recording is announced as a recording.',
    visual: { kind: 'timeline', steps: c.legacy.M08?.visual?.steps?.map((s: { t: string; label: string; sub?: string }) => ({ t: s.t, label: s.label, sub: s.sub })) ?? [], foot: `Run: node harness/demo/run.mjs exec. Backup: ${c.recordings.filter((r) => r.scenario === 'exec').length} recorded run(s), each marked "notLive".` },
    ...fromLegacy(c, 'M08'),
    claims: [claim('E11-c1', 'A recorded executive run exists and is marked not live.', ['docs/capstone/presentation/BACKUP-DEMO.md'], ['recording'])],
    placeholders: [ph('PH-TIME', 'Measured reduction in certificate processing time', 'No baseline measurement exists; the last demo step is a scenario, not a measurement.', 'A timed shadowing of the current process (D-034)')],
  }));

  add(mk({
    id: 'E12', tier: 'executive', section: '8 Measured results', title: 'Measured: the rules do the work. AI value is unproven',
    message: `On ${e.cases} synthetic cases a conventional workflow completed ${e.passed}. No language model has been run.`,
    visual: { kind: 'stats', items: [
      { label: `synthetic cases completed, no model`, text: `${e.passed} of ${e.cases}`, chip: 'MEASURED' },
      { label: 'emissions calculations correct', text: `${e.emissions.correct} of ${e.emissions.cases}`, chip: 'MEASURED' },
      { label: 'language-model arms run', text: '0', chip: 'NOT RUN' },
    ], foot: 'Synthetic, author-written, unreviewed; the holdout is not blind. No throughput, latency or availability test exists: there is no system to test.' },
    ...fromLegacy(c, 'M10'),
    claims: [claim('E12-c1', `The conventional workflow completed ${e.passed} of ${e.cases} synthetic cases.`, [P.eval], [String(e.passed), String(e.cases)])],
  }));

  add(mk({
    id: 'E13', tier: 'executive', section: '9 Cost', title: `Base case: ${usd1(f.tco)} over three years, and more per certificate than today`,
    message: 'Cost per certificate rises. The case rests on disputes and premium protection, not on labour.',
    visual: { kind: 'bars', title: 'Cost per certificate, base case', unit: 'USD', items: [
      { label: 'Today, labour only', value: f.certToday, text: usd(f.certToday), chip: 'SCENARIO' },
      { label: 'With platform, run cost', value: f.certRun, text: usd(f.certRun), chip: 'SCENARIO' },
      { label: 'With platform, fully loaded', value: f.certFull, text: usd(f.certFull), chip: 'SCENARIO' },
    ], foot: `One-time ${usd1(f.oneTime)}; annual operating ${usd1(f.opexY3)}. ${f.labels.verified} verified inputs (Azure list prices) and ${f.labels.scenario} scenario assumptions.` },
    ...fromLegacy(c, 'M11'),
    claims: [claim('E13-c1', 'The platform costs more per certificate than manual labour in the base case.', [P.bvm], ['scenario'])],
  }));

  add(mk({
    id: 'E14', tier: 'executive', section: '10 The decision', title: 'Decision: fund a bounded local pilot. Not Azure deployment yet',
    message: 'Approve Phase 1a on synthetic data, and supply four inputs that turn assumptions into numbers.',
    visual: { kind: 'table', head: ['The ask', 'What it unlocks'], widths: [8, 4], rows: (c.legacy.M13?.visual?.rows ?? []) as string[][], foot: `Revisit the whole case if confirmed volume is well below about ${be} deliveries a year.` },
    ...fromLegacy(c, 'M13'),
    claims: [claim('E14-c1', 'The phase is raised only by a human with signed approvals.', [P.blocker], ['Phase raised'])],
  }));

  // ================================================================= TECHNICAL DEFENCE
  const groups = new Map<string, { must: number; should: number; could: number; withDecision: number }>();
  for (const r of c.requirements) {
    const g = groups.get(r.group) ?? { must: 0, should: 0, could: 0, withDecision: 0 };
    if (r.priority === 'Must') g.must++;
    else if (r.priority === 'Should') g.should++;
    else g.could++;
    if (r.decisions.length) g.withDecision++;
    groups.set(r.group, g);
  }
  const mustTotal = c.requirements.filter((r) => r.priority === 'Must').length;
  add(mk({
    id: 'T01', tier: 'technical', section: 'Context and requirements', title: `${c.requirements.length} requirements, ${mustTotal} of them Must, in six families`,
    message: 'Case-study requirements are kept apart from assumptions, open questions and claims that still need verification.',
    visual: { kind: 'bars', title: 'Must requirements by family', unit: 'count', items: [...groups.entries()].map(([g, v]) => ({ label: g, value: v.must, text: `${v.must} Must, ${v.should} Should${v.could ? `, ${v.could} Could` : ''}`, chip: 'CASE STUDY' as Chip })), foot: 'Counts are read from the requirements baseline; a Must requirement without a decision is listed in the appendix.' },
    sources: [src('docs/context/REQUIREMENTS.md', 'CASE STUDY'), src('docs/context/REQUIREMENTS-TRACEABILITY.md', 'DESIGN')], seconds: 45, rubric: ['B1', 'B6'],
    notes: { say: 'The requirement baseline has a unique id for every requirement, and each one states its priority, acceptance criteria, validation method and evidence required. Requirements stated in the case study are kept apart from my assumptions, from questions that need a stakeholder, and from regulatory claims that need verification.', next: 'Which Azure services?', honesty: 'Requirements are a baseline, not an approved scope.' },
    claims: [claim('T01-c1', `${c.requirements.length} requirements are recorded.`, ['docs/context/REQUIREMENTS.md'], ['FR-001'])],
  }));

  // Role and disposition are reduced to what an audience needs; the full text, with alternatives and the per-jurisdiction checks, stays in the cited matrix.
  const ROLE: [string, string][] = [['Azure Container Apps', 'Services and agent runtime'], ['Azure Database for PostgreSQL', 'Ledger and metadata'], ['Azure Blob Storage', 'Evidence and certificates'], ['Azure Service Bus', 'Ingestion queue'], ['Azure Key Vault', 'Signing keys'], ['Azure Confidential Ledger', 'Tamper-evidence anchor'], ['Microsoft Foundry', 'Agent models'], ['Microsoft Entra', 'Identity']];
  const shortName = (s: string) => plain(s).split(/ with | to be | and |;|,/)[0]!.replace(/\s+flexible server$/i, '').trim();
  const shortDisposition = (s: string) => /^(provisional lean|candidate, undecided|candidate, deferred|deferred|not selected|existing scaffold)/i.exec(plain(s))?.[0] ?? clip(s, 30);
  const svcRows = ROLE.map(([prefix, role]) => {
    const r = (svcTable?.rows ?? []).find((x) => plain(x[1] ?? '').startsWith(prefix));
    return r ? [role, shortName(r[1] ?? ''), shortDisposition(r[5] ?? '')] : undefined;
  }).filter((r): r is string[] => !!r);  add(mk({
    id: 'T02', tier: 'technical', section: 'Azure service selection', title: 'Azure services are provisional leans, each with a residency check still to run',
    message: 'Selected by requirement, not by name. Alternatives were considered, and the open question per service is stated.',
    visual: { kind: 'table', head: ['Role', 'Candidate', 'Disposition'], widths: [4, 4, 4], rows: svcRows, foot: `${(svcTable?.rows ?? []).length} roles are assessed in the service decision matrix. None is verified in a region and none is deployed.` },
    sources: [src(P.svc, 'DESIGN'), src(P.refArch, 'DESIGN')], seconds: 60, rubric: ['B2', 'B4'], decisions: ['ADR-0019'],
    notes: { say: 'Each service answers a stated role and requirement. The leans are provisional because each has a per-jurisdiction check to run before it can be relied on: offered in region, zone redundancy, private networking, and where global parts such as identity and monitoring actually process data. Key custody and the tamper-evidence anchor are the most consequential unresolved items.', next: 'How does data move?', honesty: 'Service selection is not approved (ADR-0019) and nothing is deployed.' },
    claims: [claim('T02-c1', 'The matrix records dispositions as provisional leans or deferred.', [P.svc], ['Provisional lean'])],
  }));

  add(mk({
    id: 'T03', tier: 'technical', section: 'Edge-to-shore data flows', title: 'Thirteen flows are classified. Only some may leave the jurisdiction',
    message: 'Edge links may be intermittent: events are buffered, signed and retried idempotently. Retries are duplicates, never new evidence.',
    visual: { kind: 'edge-flow', flows: (flowTable?.rows ?? []).slice(0, 13).map((r) => ({ id: r[0] ?? '', from: (r[1] ?? '').split(/ to /)[0] ?? '', to: (r[1] ?? '').split(/ to /)[1] ?? '', data: clip(r[2] ?? '', 40), position: clip(r[3] ?? '', 60), tone: flowTone(r[3] ?? '') })), foot: 'Arrow colour: green allowed inside the jurisdiction, amber undecided, red forbidden by default. All 13 flows are in the appendix register.' },
    sources: [src(P.flows, 'DESIGN'), src(P.views, 'DESIGN')], seconds: 60, rubric: ['B2', 'B4'], decisions: ['ADR-0004'],
    notes: { say: 'Every data movement has a class and a design position. Capture is edge-first, so an outage on the link delays derived services but never loses evidence. Backups, logs and inference stay inside the jurisdiction. The one flow to the group plane is undecided and needs an approved-flow entry per item. Operator and vendor access from outside is forbidden by default, with break-glass approved inside the jurisdiction.', next: 'Who does what? The agents.', honesty: 'The flows are designed and tested on candidate contracts; the real network paths are not validated.' },
    claims: [claim('T03-c1', 'Flow F-7 to the group plane is undecided.', [P.flows], ['F-7'])],
  }));

  const levelOf = (s: string) => Number(/L(\d)/.exec(s)?.[1] ?? 0);
  add(mk({
    id: 'T04', tier: 'technical', section: 'Five production agents', title: 'Four agents may reach L4. One stays at L3. None can approve or file',
    message: 'L4 is a ceiling on autonomy inside a fixed boundary, not a permission to act commercially, regulatorily or on infrastructure.',
    visual: { kind: 'autonomy', agents: (autAgents?.rows ?? []).map((r) => ({ name: plain(r[0] ?? ''), level: levelOf(r[1] ?? ''), why: clip(r[2] ?? '', 72) })), levels: (autLevels?.rows ?? []).map((r) => ({ id: plain(r[0] ?? ''), meaning: clip(r[1] ?? '', 40) })), foot: 'Proposed ceilings. Approval, filing, method change and infrastructure change are never agent actions.' },
    sources: [src(P.autonomy, 'DESIGN'), src(P.refArch, 'DESIGN')], seconds: 60, rubric: ['B2', 'B4'], decisions: ['ADR-0017'],
    notes: { say: 'The case study gives these five agents an L4 posture. I treat L4 as a ceiling for bounded multi-step work, not as permission. The Dispute Resolution agent is capped at L3 because every outward or commercial step is human. In every case the agent cannot approve, validate or issue a certificate, cannot choose or change a method, and holds no infrastructure permission. Those limits are enforced by services and permissions, not by the prompt.', next: 'How is it secured?', honesty: 'No business agent has been run with a model; the controls are tested against a scripted attacker.' },
    claims: [claim('T04-c1', 'Dispute Resolution is capped at L3.', [P.autonomy], ['L3'])],
  }));

  const families = new Map<string, { n: number; notTestable: number }>();
  for (const r of (c.read(P.controls) ?? '').split('\n')) {
    const m = /^\| ((SV|IS|CC|CL|EM|RA|AU)-\d+) \|/.exec(r);
    if (!m) continue;
    const fam = families.get(m[2]!) ?? { n: 0, notTestable: 0 };
    fam.n++;
    if (/not testable/i.test(r)) fam.notTestable++;
    families.set(m[2]!, fam);
  }
  const FAMILY: Record<string, string> = { SV: 'Sovereignty', IS: 'Isolation', CC: 'Custody and certificates', CL: 'Certification and filing', EM: 'Emissions method', RA: 'Agent runtime', AU: 'Audit' };
  add(mk({
    id: 'T05', tier: 'technical', section: 'Security, identity and tenant isolation', title: `${f.controlRows} controls in seven families. ${f.controlsNotTestable} cannot be tested until a product exists`,
    message: 'Shipowner isolation is enforced per tenant by the cell, not by the agent. Each control names the requirement it serves.',
    visual: { kind: 'bars', title: 'Controls by family', unit: 'count', items: [...families.entries()].map(([k, v]) => ({ label: FAMILY[k] ?? k, value: v.n, text: `${v.n}${v.notTestable ? `, ${v.notTestable} not yet testable` : ''}`, chip: 'CANDIDATE' as Chip })), foot: `Security review: ${f.review.text}. Candidate oracles test the rules on synthetic data; no control is implemented in a product.` },
    sources: [src(P.controls, 'CANDIDATE'), src(P.secReview, 'CANDIDATE'), src(P.threat, 'DESIGN')], seconds: 60, rubric: ['B2', 'B4', 'B7'], decisions: ['ADR-0017'],
    notes: { say: 'The control matrix maps each control to the threat it answers and the requirement it serves. Isolation is a property of the cell and its tenancy rules, so one shipowner can never read another\'s data, whatever an agent is asked. Identity is Microsoft Entra with managed identities. Some controls cannot be tested yet because there is no product, and the matrix says which.', next: 'How is evidence kept tamper-evident?', honesty: 'Candidate oracles on synthetic data; no control is implemented in a product.' },
    claims: [claim('T05-c1', `${f.controlRows} controls are mapped.`, [P.controls], ['SV-01'])],
  }));

  const recLines = (id: string) => (c.recordings.find((r) => r.scenario === id) ? c.read(c.recordings.find((r) => r.scenario === id)!.path) : undefined);
  add(mk({
    id: 'T06', tier: 'technical', section: 'Evidence integrity and certification controls', title: 'Evidence is a signed chain; the certificate binds to its hash',
    message: 'A verifier needs only the certificate, the evidence files and a trust set it supplies. Tampering is detected, not prevented.',
    visual: { kind: 'trust-chain', steps: [
      { label: 'Device signs each event', sub: 'key held by the device' },
      { label: 'Cell verifies and receipts', sub: 'signed receipt, own clock' },
      { label: 'Events chain by hash', sub: 'each hashes the previous' },
      { label: 'Manifest binds evidence', sub: 'one hash for the transfer' },
      { label: 'Certificate binds manifest', sub: 'quality manager signs' },
      { label: 'Shipowner verifies', sub: 'public key, offline' },
    ], foot: recLines('exec') ? 'Recorded run (not live): 5 signed events, chain verified, 2,500 kg delivered, 5 receipts, tamper attempt detected.' : undefined },
    sources: [src(P.custody, 'CANDIDATE'), src(P.lifecycle, 'CANDIDATE'), src(c.recordings.find((r) => r.scenario === 'tamper')?.path ?? P.demoExec, 'REAL RUN')], seconds: 60, rubric: ['B2', 'B4'], decisions: ['ADR-0018'],
    notes: { say: 'The chain is the integrity mechanism. Each event is signed by the device and chained to the previous hash, the cell issues a signed receipt on its own clock, and the certificate binds to the evidence hash. Alteration breaks a signature, so it is detected. A shipowner needs only files and the public key to verify. Where an independent external anchor is needed, that is an open decision, ADR 0018.', next: 'Does it scale?', honesty: 'Candidate contract on synthetic data with test-only keys. The anchor and key custody are undecided.' },
    claims: [claim('T06-c1', 'The custody chain contract exists and is tested.', [P.custody], ['chain'])],
  }));

  const perfHave = (c.table(P.quality, ['Ref', 'Quantity'])?.rows ?? []).slice(0, 4).map((r) => `${plain(r[0] ?? '')}: ${clip(r[1] ?? '', 60)}`);
  add(mk({
    id: 'T07', tier: 'technical', section: 'Scalability and performance', title: 'Scalability is argued, not measured',
    message: 'The argument is structural: each cell scales independently. No throughput, latency or scale test has been run, because there is no system to test.',
    visual: { kind: 'review', need: 'Measured throughput, latency and scaling under load, per cell.', have: ['Placeholders and scenario arithmetic only; no target volume or response time exists (D-031, NFR-014, NFR-015).', ...perfHave] },
    sources: [src(P.quality, 'DESIGN'), src(P.cost, 'DESIGN')], seconds: 45, rubric: ['B7', 'C3'],
    notes: { say: 'I will not show a performance number, because I do not have one. The design argument is that each cell scales independently and capture is edge-first, so load is local. What would prove it is a load test of a running slice against a target that a stakeholder sets. Neither exists yet.', next: 'Availability and recovery.', honesty: 'Not measured. This slide carries a review placeholder until a test exists.' },
    claims: [claim('T07-c1', 'No target volume or response time exists.', [P.cost], ['No target volume or response time exists'])],
    placeholders: [ph('PH-PERF', 'Measured throughput, latency and scaling evidence', 'No application runs, so nothing can be measured; targets are not set.', 'A running Phase 1a slice and agreed targets (D-031)')],
  }));

  add(mk({
    id: 'T08', tier: 'technical', section: 'Availability, resilience and disaster recovery', title: 'Recovery stays inside each jurisdiction. Targets are unset and untested',
    message: 'Under failure the system refuses, waits or escalates. It never guesses. Regional outage and recovery are designed, not tested.',
    visual: { kind: 'table', head: ['Layer', 'Baseline design', 'Still open'], widths: [2.5, 5, 4.5], rows: (drLayers?.rows ?? []).map((r) => [clip(r[0] ?? '', 26), clip(r[1] ?? '', 46), clip(r[2] ?? '', 44)]), foot: 'Edge outage, tamper, replay and injection are tested on candidate contracts. Region outage is not.' },
    sources: [src(P.ops, 'DESIGN'), src(P.defense, 'DESIGN')], seconds: 60, rubric: ['B4', 'C3'],
    notes: { say: 'Every layer has a baseline design and an open item. The edge buffers and resends in order and ignores duplicates. Evidence stays recoverable inside the jurisdiction, never by copying to another one. Recovery targets are not set, so I cannot claim an RPO or RTO, and no regional failover has been tested.', next: 'How would we operate it?', honesty: 'Recovery targets are unset (D-031); nothing is deployed.' },
    claims: [claim('T08-c1', 'Recovery targets are not decided.', [P.ops], ['Recovery targets (D-031)'])],
    placeholders: [ph('PH-DR', 'Tested recovery against agreed RPO and RTO', 'Targets are unset and no recovery has been tested.', 'Targets from a stakeholder (D-031) and a recovery test')],
  }));

  add(mk({
    id: 'T09', tier: 'technical', section: 'Observability and operational readiness', title: 'Observability is designed per cell. Nothing is instrumented yet',
    message: 'Logs and metrics stay with the data they describe. Telemetry is classified so it cannot leak what the cell must not export.',
    visual: { kind: 'table', head: ['Need', 'Design', 'Not yet decided or verified'], widths: [3, 5, 4], rows: (obsNeeds?.rows ?? []).slice(0, 6).map((r) => [clip(r[0] ?? '', 36), clip(r[1] ?? '', 58), clip(r[2] ?? '', 46)]), foot: `${c.recordings.some((r) => r.scenario === 'observability') ? 'A recorded observability demonstration exists (not live). ' : ''}No application emits telemetry.` },
    sources: [src(P.ops, 'DESIGN'), src(c.recordings.find((r) => r.scenario === 'observability')?.path ?? P.ops, 'REAL RUN')], seconds: 45, rubric: ['B2', 'B4'],
    notes: { say: 'Operations is designed per cell: one workspace per jurisdiction, no customer or vessel names or measurements in telemetry, alerts on ingestion lag and dead-letter growth, and audit of every approval, agent action and denial. Thresholds are not agreed and no application exists to instrument.', next: 'How were the agents evaluated?', honesty: 'Designed only; no live telemetry exists.' },
    claims: [claim('T09-c1', 'Thresholds are not agreed.', [P.ops], ['no target is agreed'])],
    placeholders: [ph('PH-OBS', 'Operational traces, dashboards and alert history from a running system', 'No application emits telemetry.', 'A running slice with instrumentation')],
  }));

  add(mk({
    id: 'T10', tier: 'technical', section: 'AI evaluation and model selection', title: 'Four arms were scored. Both language-model arms are not run',
    message: 'The decision rule is fixed first: use rules by default and admit a model only where it beats the measured baseline.',
    visual: { kind: 'table', head: ['Arm', 'Result', 'State'], widths: [4, 6, 2], rows: [
      ['Conventional workflow (no model)', `${e.passed} of ${e.cases} complete; all ${e.hardGates} hard gates pass`, 'MEASURED'],
      ['Four deliberately bad arms', 'All fail the gates, as they must (scorer check)', 'MEASURED'],
      ['Single-agent language model', 'No run', 'NOT RUN'],
      ['Multi-agent language model', 'No run', 'NOT RUN'],
    ], tone: 2, foot: 'Synthetic, author-written, unreviewed cases; the holdout is not blind. Model selection is deferred (D-028).' },
    sources: [src(P.eval, 'MEASURED'), src(P.evalReport, 'MEASURED')], seconds: 60, rubric: ['B7', 'C3'],
    notes: { say: 'This is the only AI-related measurement, and it is honest about its limits. A rule-based workflow passes every hard gate. Four bad arms prove the scorer can fail things. The two language-model arms did not run, so I cannot claim AI adds value. If a model is admitted it must beat this baseline, on cases a domain reviewer controls, under rules fixed in advance.', next: 'What did we trade away?', honesty: 'Expected outcomes are the author\'s and unreviewed.' },
    claims: [claim('T10-c1', 'The language-model arms were not run.', [P.eval], ['NOT RUN'])],
  }));

  const rej = c.table(P.options, ['Option', 'Disposition'])?.rows ?? [];
  const svcRej = (svcTable?.rows ?? []).filter((r) => /not selected/i.test(r[5] ?? '')).slice(0, 2);
  add(mk({
    id: 'T11', tier: 'technical', section: 'Trade-offs and rejected alternatives', title: 'What was rejected, and the requirement that rejected it',
    message: 'Every rejection is stated in terms of a requirement or constraint, not preference.',
    visual: { kind: 'table', head: ['Alternative', 'Disposition', 'Reason'], widths: [3.5, 2.5, 6], rows: [...rej.map((r) => [clip(r[0] ?? '', 36), clip(r[1] ?? '', 28), clip(r[2] ?? '', 100)]), ...svcRej.map((r) => [clip(r[1] ?? '', 36), 'Not selected', clip(r[6] ?? '', 100)])], foot: 'What would change the recommendation is listed in the options analysis.' },
    sources: [src(P.options, 'DESIGN'), src(P.svc, 'DESIGN')], seconds: 60, rubric: ['B4', 'C3'], decisions: ['ADR-0016'],
    notes: { say: 'Centralised Azure is rejected on the hard residency constraint. Edge plus shore is not selected because it makes the edge the system of record and leaves agents no place to run. Today\'s process fails integrity and scale. At service level, Functions and App Service were not selected because Container Apps already covers the need with one operating model.', next: 'Risks and what comes next.', honesty: 'Costing of option B is not like-for-like with C.' },
    claims: [claim('T11-c1', 'Option B is not selected.', [P.options], ['Not selected'])],
  }));

  const crit = (gapTable?.rows ?? []).filter((r) => plain(r[2] ?? '') === 'Critical');
  add(mk({
    id: 'T12', tier: 'technical', section: 'Risks, limitations and roadmap', title: `${crit.length} critical gaps stand between this repository and a defensible capstone`,
    message: 'They are stated before anyone asks. Each says how it is closed and by whom.',
    visual: { kind: 'table', head: ['Gap', 'What is missing', 'Closed by'], widths: [1.2, 8, 2.8], tone: 1, rows: crit.map((r) => [plain(r[0] ?? ''), clip(r[1] ?? '', 92), plain(r[5] ?? '')]), foot: 'From the forensic audit at the commit it names; gaps closed since are not re-marked here.' },
    sources: [src(P.gaps, 'DESIGN'), src(P.rubric, 'DESIGN')], seconds: 60, rubric: ['B1', 'C3'],
    notes: { say: 'These are the critical gaps from an independent audit against the rubric. I list them because the honest position is that governance and evidence are ahead of the product, and the application does not exist. Each gap names who can close it: building, the owner, or a live session.', next: 'Roadmap.', honesty: 'The register is dated to the audit commit and has not been re-audited.' },
    claims: [claim('T12-c1', 'The audit lists critical gaps.', [P.gaps], ['Critical'])],
  }));

  const gates = [...(c.read(P.blocker) ?? '').matchAll(/^\| (G\d) \| \*\*(.+?)\*\*/gm)];
  add(mk({
    id: 'T13', tier: 'technical', section: 'Roadmap', title: 'The path to production runs through nine gates. None is passed',
    message: 'Production deployment is never automatic: each gate needs a person, and Azure deployment is deferred by the owner.',
    visual: { kind: 'timeline', steps: gates.map((m) => ({ t: m[1]!, label: clip((m[2] ?? '').replace(/\s*\(.*$/, ''), 30) })), foot: 'Gate G1 (phase raised) and G2 (approver enrolled) come first. Architecture baseline authorization is built; no baseline exists.' },
    sources: [src(P.blocker, 'DESIGN')], seconds: 45, rubric: ['B1', 'C3'],
    notes: { say: 'The Phase 1 blocker report lists nine gates. The first two are people: a human raises the phase with signed approvals, and an approver is enrolled. After that come architecture approval, sovereignty, certificate integrity, identity, the Azure deployment gate, agent execution isolation and business-case inputs.', next: 'Appendix as needed.', honesty: 'No gate is passed at this commit.' },
    claims: [claim('T13-c1', 'Nine gates are listed in the blocker report.', [P.blocker], ['G9'])],
  }));

  // ================================================================= APPENDIX
  const adrs = c.decisions.filter((d) => d.kind === 'adr' && ['ADR-0004', 'ADR-0015', 'ADR-0016', 'ADR-0017', 'ADR-0018', 'ADR-0019', 'ADR-0020'].includes(d.id));
  add(mk({
    id: 'A01', tier: 'appendix', section: 'ADR references', title: 'The target architecture is Blocked in the register, not approved',
    message: 'Status is read from the decision register at this commit, never written into the deck.',
    visual: { kind: 'table', head: ['ADR', 'Decision', 'Status', 'Approval basis'], widths: [1.4, 6, 1.8, 2.8], tone: [2, 3], rows: adrs.map((d) => [d.id, clip(d.title, 70), d.status, d.approvalBasis]), foot: `${c.readiness.global.approved} of ${c.readiness.global.decisions} register decisions are approved; ${c.readiness.global.pending} are not yet decided.` },
    sources: [src('docs/adr/0016-sovereign-evidence-cells-with-federated-coordination.md', 'DESIGN'), src('docs/adr/0020-phase-1a-local-synthetic-vertical-slice.md', 'DESIGN')], seconds: 30, rubric: ['B6'], decisions: adrs.map((d) => d.id),
    notes: { say: 'The recommended architecture is recorded as ADR 0016 to 0019. They are Blocked because the design review RV-0003 is unresolved. ADR 0020, the Phase 1a scope, is Proposed. I do not present any of them as approved.', honesty: 'Approval of these decisions is the owner\'s.' },
    claims: [claim('A01-c1', 'ADR 0016 to 0019 are not approved.', ['docs/adr/0016-sovereign-evidence-cells-with-federated-coordination.md'], ['Proposed'])],
  }));

  const fam = [...groups.entries()];
  add(mk({
    id: 'A02', tier: 'appendix', section: 'Requirement traceability', title: `${c.readiness.areas[0]?.metrics.find((m) => m.id === 'requirements-without-decisions')?.count ?? 0} Must requirements have no decision yet`,
    message: 'Each requirement traces to the decisions it depends on, with its acceptance criteria and evidence required.',
    visual: { kind: 'table', head: ['Family', 'Requirements', 'Must', 'Traced to a decision'], widths: [2, 3, 2, 3], rows: fam.map(([g, v]) => [g, String(v.must + v.should + v.could), String(v.must), String(v.withDecision)]), foot: `Must requirements without a decision: ${(c.readiness.areas[0]?.metrics.find((m) => m.id === 'requirements-without-decisions')?.members ?? []).join(', ') || 'none'}.` },
    sources: [src('docs/context/REQUIREMENTS-TRACEABILITY.md', 'DESIGN'), src(P.coverage, 'DESIGN')], seconds: 30, rubric: ['B6', 'B7'],
    notes: { say: 'The traceability table links every requirement to its decisions and validation. A passing test of a candidate contract shows only that the contract behaves as specified; it never says a requirement is satisfied.', honesty: 'Coverage is of candidates and the harness, not of a product.' },
    claims: [claim('A02-c1', 'Requirement coverage is generated and never says a requirement is satisfied.', [P.coverage], ['It never says a requirement is satisfied'])],
  }));

  add(mk({
    id: 'A03', tier: 'appendix', section: 'Detailed Azure topology', title: 'Reference topology: one Azure cell per port jurisdiction, design only',
    message: 'No Azure resource has been created. The icons are placeholders until the official icon set is supplied.',
    visual: { kind: 'topology', foot: 'Provisional leans from the service decision matrix. Region, quota and residency are unverified for every service.' },
    sources: [src(P.refArch, 'DESIGN'), src(P.svc, 'DESIGN')], seconds: 45, rubric: ['B2', 'B4'], decisions: ['ADR-0019'],
    notes: { say: 'This is the detailed topology for one cell, from the reference architecture. Stateless services and agents run on Container Apps. The ledger is PostgreSQL, evidence files are in immutable Blob storage, ingestion goes through Service Bus, keys sit in a managed HSM, and an external ledger anchors tamper evidence. Identity is Entra, monitoring is Azure Monitor in the cell\'s region, and Azure Policy enforces location.', honesty: 'Nothing here is deployed or region-verified.' },
    claims: [claim('A03-c1', 'No Azure resource has been created.', [P.blocker], ['No Azure resource'])],
  }));

  add(mk({
    id: 'A12', tier: 'appendix', section: 'Data-flow register', title: 'The 13 classified data flows, with the design position of each',
    message: 'Only some may leave the jurisdiction. Validation of each flow against a real network path is still to do.',
    visual: { kind: 'table', compact: true, head: ['Flow', 'From to', 'Design position'], widths: [0.7, 4, 7.2], tone: 2, rows: (flowTable?.rows ?? []).slice(0, 13).map((r) => [plain(r[0] ?? ''), clip(r[1] ?? '', 52), clip(r[3] ?? '', 84)]) },
    sources: [src(P.flows, 'DESIGN')], seconds: 30, rubric: ['B6'], decisions: ['ADR-0004'],
    notes: { say: 'This is the register behind the data-flow schematic: each flow has a source, a destination, the data it carries and the design position. Allowed means allowed inside the jurisdiction. Undecided means treated as no until an approved-flow entry exists.', honesty: 'Designed and tested on candidate contracts; real network paths are not validated.' },
    claims: [claim('A12-c1', 'Flow F-13 forbids real data in non-production.', [P.flows], ['F-13'])],
  }));

  add(mk({
    id: 'A04', tier: 'appendix', section: 'Performance evidence', title: 'There is no performance evidence yet',
    message: 'This slide is a placeholder by design: it is replaced when a running slice is measured.',
    visual: { kind: 'review', need: 'Throughput, latency, scale and availability measurements with method, environment, and raw results.', have: ['No application and no Azure resource exist.', 'Capacity method exists; every figure is withheld (see cost and capacity).'] },
    sources: [src(P.cost, 'DESIGN')], seconds: 15, rubric: ['B7'],
    notes: { say: 'I am not showing a benchmark, because inventing one would fail the rubric\'s evidence criterion. This slide exists so the gap is visible.', honesty: 'Placeholder.' },
    claims: [claim('A04-c1', 'The cost and capacity document withholds figures.', [P.cost], ['Why there is no figure'])],
    placeholders: [ph('PH-PERF-A', 'Performance results', 'No system to test.', 'A running slice (B-01)')],
  }));

  add(mk({
    id: 'A05', tier: 'appendix', section: 'Cost assumptions', title: 'Cost: the method exists; the Azure run cost has no figure',
    message: `${f.labels.scenario} scenario assumptions, ${f.labels.verified} verified inputs, ${f.labels.benchmark} benchmark, ${f.labels.userProvided} supplied by the business.`,
    visual: { kind: 'table', head: ['Item', 'Why there is no figure'], widths: [5, 7], rows: (costNone?.rows ?? []).map((r) => [clip(r[0] ?? '', 55), clip(r[1] ?? '', 90)]), foot: 'The business value model uses Azure list prices only as verified inputs; its totals are scenario results.' },
    sources: [src(P.cost, 'DESIGN'), src(P.bvm, 'SCENARIO')], seconds: 30, rubric: ['B7', 'C1'],
    notes: { say: 'Each missing figure has a stated reason and the decision that would supply it. The model combines Azure list prices, which are verified, with scenario assumptions, so any total that depends on a scenario input is itself a scenario result.', honesty: 'No run cost, edge cost, model cost or budget is known.' },
    claims: [claim('A05-c1', 'No monthly run cost per cell is available.', [P.cost], ['Monthly run cost per jurisdiction cell'])],
  }));

  const tmRows = threatTable?.rows.length ?? 0;
  add(mk({
    id: 'A06', tier: 'appendix', section: 'Threat model', title: `${tmRows} threats across six trust boundaries, each with a control and a stated limit`,
    message: 'The security review found three HIGH findings; none is closed by a product because none exists.',
    visual: { kind: 'stats', items: [
      { label: 'threats in the threat model', text: String(tmRows), chip: 'DESIGN' },
      { label: 'controls mapped', text: String(f.controlRows), chip: 'CANDIDATE' },
      { label: 'controls not yet testable', text: String(f.controlsNotTestable), chip: 'NOT BUILT' },
    ], foot: `Security review: ${f.review.text}. Boundaries: device to edge, edge to cell, agents to tools, shipowner to portal, group plane to cell, certificate to outside.` },
    sources: [src(P.threat, 'DESIGN'), src(P.secReview, 'CANDIDATE'), src(P.controls, 'CANDIDATE')], seconds: 45, rubric: ['B4'],
    notes: { say: 'The threat model uses STRIDE per boundary. Each row has design controls, a residual and honest limit, a validation method and the requirements it serves. The security review found three HIGH findings, eleven MEDIUM and two LOW.', honesty: 'Findings are against candidates and the harness.' },
    claims: [claim('A06-c1', 'The threat model lists boundary threats with STRIDE categories.', [P.threat], ['STRIDE'])],
  }));

  add(mk({
    id: 'A07', tier: 'appendix', section: 'Agent evaluation results', title: `${e.passed} of ${e.cases} synthetic cases complete; the one miss is a free-text relative date`,
    message: 'Hard gates passed. Language-model arms did not run.',
    visual: { kind: 'stats', items: [
      { label: 'task completion rate', text: `${(e.completion * 100).toFixed(1)}%`, chip: 'MEASURED' },
      { label: 'emissions calculations correct', text: `${e.emissions.correct} of ${e.emissions.cases}`, chip: 'MEASURED' },
      { label: 'hard gates passed', text: `${e.hardGates} of ${e.hardGates}`, chip: 'MEASURED' },
    ], foot: `Run ${e.runId}. Synthetic cases written by the author and not reviewed; the holdout is not blind.` },
    sources: [src(P.eval, 'MEASURED'), src(P.evalReport, 'MEASURED')], seconds: 30, rubric: ['B7'],
    notes: { say: `The run is ${e.runId}. Completion ${(e.completion * 100).toFixed(1)} percent, all emissions calculations right, every hard gate passed. The miss is a free-text relative date. The result says nothing about a language model.`, honesty: 'Synthetic data.' },
    claims: [claim('A07-c1', 'The evaluation run identifier is recorded.', ['docs/evaluation/agent-runs/history.json'], [String(e.runId).slice(0, 12)])],
  }));

  add(mk({
    id: 'A08', tier: 'appendix', section: 'Test coverage', title: `${f.tests.pass.toLocaleString('en-US')} of ${f.tests.tests.toLocaleString('en-US')} automated tests pass on the recorded run`,
    message: 'They test the harness and candidate contracts on synthetic data. They do not show a requirement is satisfied.',
    visual: { kind: 'stats', items: [
      { label: `tests passing, recorded run ${f.tests.id}`, text: f.tests.pass.toLocaleString('en-US'), chip: 'MEASURED' },
      { label: 'application tests', text: '0', chip: 'NOT BUILT' },
      { label: 'end-to-end tests of the platform', text: '0', chip: 'NOT BUILT' },
    ], foot: 'Requirement coverage is generated and states what a test that ran has shown.' },
    sources: [src(P.tests, 'MEASURED'), src(P.coverage, 'DESIGN')], seconds: 30, rubric: ['B7', 'C3'],
    notes: { say: 'The number is from a recorded run, not typed in. It measures the harness and the candidate contracts. There is no application and so no application test.', honesty: 'Tests prove behaviour of candidates only.' },
    claims: [claim('A08-c1', `The recorded run passed ${f.tests.pass} tests.`, [P.tests], [String(f.tests.pass)])],
  }));

  const sev = new Map<string, number>();
  for (const r of gapTable?.rows ?? []) sev.set(plain(r[2] ?? ''), (sev.get(plain(r[2] ?? '')) ?? 0) + 1);
  add(mk({
    id: 'A09', tier: 'appendix', section: 'Known gaps', title: `${gapTable?.rows.length ?? 0} gaps were recorded at the audit. ${sev.get('Critical') ?? 0} are critical`,
    message: 'The register is dated to its audit commit. A gap closed since is not marked closed here.',
    visual: { kind: 'bars', title: 'Gaps by severity at the audit', unit: 'count', items: ['Critical', 'High', 'Medium', 'Low'].map((s) => ({ label: s, value: sev.get(s) ?? 0, text: String(sev.get(s) ?? 0), chip: 'DESIGN' as Chip })), foot: 'Rubric floors: no criterion scored 1; each section at least 60 percent; artifact submitted.' },
    sources: [src(P.gaps, 'DESIGN')], seconds: 30, rubric: ['C3'],
    notes: { say: 'This is the audit\'s own register by severity. I have not re-audited, so I do not claim any gap is now closed.', honesty: 'Not re-audited.' },
    claims: [claim('A09-c1', 'The gap register lists severities.', [P.gaps], ['Severity'])],
  }));

  const areas = new Map<string, string[]>();
  for (const r of qaTable?.rows ?? []) if (!areas.has(plain(r[1] ?? ''))) areas.set(plain(r[1] ?? ''), [plain(r[0] ?? ''), plain(r[3] ?? '')]);
  add(mk({
    id: 'A10', tier: 'appendix', section: 'Architecture defence Q&A', title: 'Fifty panel questions are prepared. One per area is shown here',
    message: 'Each has a recommended answer, its evidence, what is uncertain, and when to concede.',
    visual: { kind: 'table', head: ['ID', 'Area', 'Question'], widths: [1, 2.5, 8.5], rows: [...areas.entries()].slice(0, 9).map(([a, q]) => [q[0] ?? '', a, clip(q[1] ?? '', 100)]), foot: 'Full answers: docs/capstone/presentation/QA-PANEL-50.md. Delivery under challenge is not verified until a human rehearsal.' },
    sources: [src(P.qa, 'DESIGN')], seconds: 30, rubric: ['B4', 'C2'],
    notes: { say: 'The prepared answers restate the question first, say what is real, scenario or not built, concede good points at once, and say how I would find out what I do not know.', honesty: 'Not yet rehearsed with a human.' },
    claims: [claim('A10-c1', 'The Q&A document lists the questions.', [P.qa], ['Q01'])],
  }));

  const slideIdsFor = (crit: string) => slides.filter((s) => s.rubric.includes(crit)).map((s) => s.id);
  add(mk({
    id: 'A11', tier: 'appendix', section: 'Rubric coverage', title: 'Presentation criteria: what the deck can serve and what only a live session can',
    message: 'No official score is assigned. Delivery, listening and composure are not verified until a person has rehearsed.',
    visual: { kind: 'table', head: ['Criterion', 'Evidence now', 'Slides', 'How assessed'], widths: [4, 2.5, 3.5, 2], rows: c.rubric.filter((r) => /^[BC]/.test(r.id)).map((r) => [`${r.id} ${clip(r.title, 34)}`, r.evidenceNow.split(/[(;,]/)[0]!.trim(), slideIdsFor(r.id).slice(0, 4).join(', ') || 'live only', r.mode]), foot: 'Mode: T technical evidence, L scored live, H human judgment, P publication.' },
    sources: [src(P.rubric, 'DESIGN'), src('docs/capstone/presentation/REHEARSAL-PLAN-AND-SCORECARD.md', 'DESIGN')], seconds: 30, rubric: ['B6'],
    notes: { say: 'The mapping is derived from the rubric traceability document. Criteria assessed live, such as pace and listening, cannot be evidenced by a deck.', honesty: 'The official rubric file is not in the repository; this uses the derived traceability.' },
    claims: [claim('A11-c1', 'The rubric traceability assigns no official score.', [P.rubric], ['No official score is assigned'])],
    placeholders: [ph('PH-REHEARSAL', 'Human rehearsal of the B and C criteria', 'Delivery and consultative behaviour cannot be verified by documents.', 'The presenter and a rehearsal observer')],
  }));

  return slides;
}

function flowTone(position: string): Tone {
  const p = plain(position).toLowerCase();
  if (p.startsWith('forbidden')) return 'bad';
  if (p.startsWith('undecided')) return 'warn';
  return 'good';
}

export const _internal = { VERDICT_WORD };
export type { Item };

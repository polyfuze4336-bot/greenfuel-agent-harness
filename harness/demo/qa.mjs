// 50 panel questions. Answers are written to be defensible from committed evidence; key numbers are tokens ({npv}, {payback}, ...) substituted from facts.mjs so they cannot drift.
// Every evidence path is checked for existence by tests/presentation.test.mjs. NOTHING here claims a rehearsal has happened or that delivery has been verified.
import { usd, usd1 } from './facts.mjs';

const Q = (id, area, q, a, ev, unc, con) => ({ id, area, q, a, ev, unc, con });
const TR = 'docs/target-architecture/'; const BZ = 'docs/business/'; const AI = 'docs/design/ai/'; const AZ = 'docs/azure/'; const CX = 'docs/context/'; const PH = 'docs/phase/';

export const QA = [
  // ---- discovery and problem (slide M02)
  Q('Q01', 'Discovery', 'Have you actually spoken to a bunker supplier, or is this a desk exercise?',
    'It is a desk exercise from the case study. I have not interviewed anyone. The case study names the quality manager and the shipowner as customer; every other stakeholder is inferred and marked as a candidate. The first thing the pilot funds is real discovery: volumes, dispute history, and how the quality manager works today.',
    [`${BZ}STAKEHOLDERS.md`, `${CX}ASSUMPTIONS.md`], 'Whether the inferred pain points are the real ones.', 'Concede at once. Do not imply discovery happened. Offer the discovery questions already listed for each stakeholder.'),
  Q('Q02', 'Alternatives', 'Why not use spreadsheets, an ERP module or an existing certification registry?',
    'I have not surveyed existing tools, so I cannot claim none fits. The case constraints are what make a bespoke design plausible: measurements must stay in each port jurisdiction, certificates must be tamper-evident and locally hosted, and filings need quality-manager approval. A tool that cannot show those is out. I would verify this against named products before committing to build.',
    [`${CX}REQUIREMENTS.md`, `${TR}02-ARCHITECTURE-OPTIONS.md`], 'No market scan was done. Buy-versus-build is unexamined beyond the three architecture options.', 'Concede the gap. Offer a short product scan against the hard constraints as a pilot task.'),

  // ---- why it matters (M03)
  Q('Q03', 'Commercial', 'Where does the premium revenue figure come from?',
    'It is a scenario assumption, not a fact. The model uses a placeholder premium and a placeholder volume, and shows the base year-3 pool as {premiumPool}. The only external benchmark is a published Singapore biobunker statistic used as a plausibility check on volume. No figure came from the business. I would replace these with the trading head\'s real numbers first.',
    [`${BZ}BUSINESS-VALUE-MODEL.md`, `${BZ}COMMERCIAL-VALUE.md`], 'Premium level, volume and how much a certificate failure actually costs in lost premium.', 'Concede that none is user-provided. Say which inputs you need and from whom.'),
  Q('Q04', 'Commercial', 'Does a better certificate raise the price, or only avoid losing it?',
    'The model counts premium protected, not a price rise, plus a small incremental margin line. Protecting an existing premium is the more defensible claim. The base year-3 figure is {premiumProtected}, which is the largest single benefit line and the most assumption-dependent one. I keep it visible rather than burying it.',
    [`${BZ}COMMERCIAL-VALUE.md`, `${BZ}BUSINESS-VALUE-MODEL.md`], 'How price actually responds to certification reliability; unknown.', 'Say you do not know the price response and that the pilot should ask customers and the trading head.'),
  Q('Q05', 'Commercial', 'Who captures the benefit: the supplier or the shipowner?',
    'The model counts supplier-side benefit only: labour, disputes, audit preparation, premium protected and margin. Shipowners gain verifiability but I assign them no value. Whether a supplier can recover cost through price is a commercial question I have not modelled.',
    [`${BZ}BUSINESS-VALUE-MODEL.md`, `${BZ}STAKEHOLDERS.md`], 'Benefit sharing, willingness to pay, contract terms.', 'Concede that the shipowner side is unvalued. Offer it as a discovery question.'),

  // ---- value, cost of inaction (M04)
  Q('Q06', 'Commercial', 'Your base-case NPV is negative. Why recommend anything?',
    'Because I am recommending a small, reversible step, not the full build. The base NPV is {npv} with a {payback}-month payback under placeholder inputs; the conservative case never pays back and the optimistic one pays back in months. Those are stacked extremes, not a range. The case turns on volume and premium protection, which the pilot is designed to establish before any large commitment.',
    [`${BZ}BUSINESS-VALUE-MODEL.md`, `${PH}PHASE-1-BLOCKER-REPORT.md`], 'The real inputs. If volume is low the honest answer is not to build.', 'Do not defend the full investment. Defend the bounded pilot and the decision rule to stop.'),
  Q('Q07', 'Commercial', 'What if real volume is below break-even?',
    'Then I recommend we do not build it. Break-even is about {breakEven} deliveries a year under base inputs, against {assumed} assumed. That is a deliberate stop condition, stated on the decision slide.',
    [`${BZ}BUSINESS-VALUE-MODEL.md`], 'Break-even moves with every assumption; it is a base-case figure.', 'Agree with the premise. Offer to re-run the model on real inputs live or afterwards.'),
  Q('Q08', 'Commercial', 'What is the cost of doing nothing?',
    'Within the model: the manual process continues at about {certToday} of labour per certificate, disputes and audits stay manual, and the annual year-3 benefit of about {benefitY3} is not captured. The larger exposure is qualitative: a disputed or unverifiable certificate puts the premium at risk. All of it is scenario-class.',
    [`${BZ}BUSINESS-VALUE-MODEL.md`, `${BZ}COMMERCIAL-VALUE.md`], 'The probability and size of a premium loss; unknown.', 'Say it is a scenario, not a forecast, and name the missing input (dispute and claim history).'),
  Q('Q09', 'Commercial', 'Is 600 green-fuel deliveries a year realistic?',
    'Unknown. No volume was supplied. The base assumption is a large share of a published market benchmark: about a fifth of Singapore\'s 2025 biobunker tonnage, which the model itself calls generous. That is why break-even exceeds the assumption. If real volume is lower the volume-driven benefits fall in proportion.',
    [`${BZ}BUSINESS-VALUE-MODEL.md`], 'The group\'s actual deliveries and growth.', 'Concede it may be too high. This is the single most important input to obtain.'),

  // ---- alternatives (M05)
  Q('Q10', 'Alternatives', 'Why not centralised Azure with a region in the port\'s country?',
    'Because a region name is not residency proof. Residency covers replicas, backups, logs, diagnostics, support access and AI inference location, and the legal reading of "within the jurisdiction" is an open decision for each port. Option A is cheapest at {opt1} over three years but I cannot show it meets the constraint, so it is not eligible. If a verified in-country region exists for a port, the cell can run there.',
    [`${TR}02-ARCHITECTURE-OPTIONS.md`, `${AZ}SOVEREIGNTY-DEPLOYMENT-MATRIX.md`, `${TR}12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md`], 'Which ports, and the legal reading for each (D-003, D-009, D-010). No region has been verified.', 'Concede that Option A may become acceptable for a specific port once a legal reading and region are verified.'),
  Q('Q11', 'Alternatives', 'Why build instead of buying a certification or traceability platform?',
    'I have not evaluated products, so I cannot rule them out. Build is assumed only because the architecture options were costed as designs. A purchased product would have to show port-level residency, local tamper-evident certificates, quality-manager approval and exact methodology versioning.',
    [`${TR}02-ARCHITECTURE-OPTIONS.md`, `${CX}REQUIREMENTS.md`], 'Market coverage is unexamined; no product scan was done.', 'Concede the gap and propose a product scan against the hard constraints.'),
  Q('Q12', 'Alternatives', 'Why not a blockchain or distributed ledger for tamper evidence?',
    'Because signed, hash-chained records give tamper evidence without it, and the candidate contracts show that: edits, deletions, reordering and forged events are detected. A ledger service remains one option in the mechanism decision, which is still open (D-013). I would not add the operational weight of a distributed ledger unless an auditor or scheme requires it.',
    [`docs/adr/0018-evidence-integrity-and-certificate-mechanism-options.md`, 'harness/contracts/custody-chain-contract.mjs', `${CX}DECISION-REGISTER.md`], 'Tamper-evidence mechanism, key custody and trusted time are undecided (D-013, D-021).', 'Concede it is open. Say what would change it: an auditor or scheme requirement.'),
  Q('Q13', 'Alternatives', 'Option B is cheaper. Why not B?',
    'B is {opt2} against {opt3} for C, but the costings are not like-for-like and I do not draw a conclusion from the gap. B centralises one shore platform and keeps a local store per port; whether that satisfies each port\'s residency reading, and how it handles disaster recovery, depends on decisions not yet made. If counsel says B is enough, B may be the better choice.',
    [`${TR}02-ARCHITECTURE-OPTIONS.md`, `${BZ}BUSINESS-VALUE-MODEL.md`], 'Whether B meets residency; cost comparability.', 'Concede openly. Say the recommendation changes if the legal reading allows B.'),

  // ---- recommendation (M06)
  Q('Q14', 'Architecture', 'One cell per port looks over-engineered. Defend it.',
    'It is the smallest structure that keeps each port\'s evidence local, isolates failure, and lets a cell run on a local host where Azure residency cannot be shown. It is not required if there is a single port or if a verified in-country region exists; the design then collapses to one cell. The group plane is deliberately thin so most complexity is per-port, not global.',
    [`${TR}03-ARCHITECTURE-VIEWS.md`, 'docs/architecture/designs/DES-0003-target-system-architecture.md'], 'Number of ports (unknown); operational cost per cell is a scenario figure.', 'Concede that with one port it is more than needed. Offer to start with a single cell.'),
  Q('Q15', 'AI governance', 'The brief says L4 agents. What stops an agent doing harm?',
    'Autonomy is not permission. An agent\'s level describes how much it may do without a person; what it may do is set by a tool catalogue enforced outside the model. In the candidate gateway, a scripted adversary that obeys injected instructions tried to file and read another customer\'s record and was denied and escalated every time. Agents cannot validate, approve, issue or file; those are services or humans.',
    [`${AI}AGENTIC-AUTONOMY-DESIGN-RECORD.md`, 'harness/contracts/tenant-boundary-contract.mjs', 'tests/tenant-boundary-contract.test.mjs'], 'How a real model behaves; the adversary was scripted. Requested L3 versus baseline L4 for two agents is an open decision (D-008).', 'Say the controls are model-independent, but that real-model behaviour is untested.'),
  Q('Q16', 'Architecture', 'Why not Microsoft Foundry or a managed agent runtime?',
    'I evaluated state graphs, event-driven orchestration and managed runtimes and recommended bounded event-triggered runs in a self-hosted in-cell runtime behind a tool gateway. The reason is residency and control: whether a managed runtime and a model deployment can keep processing in a given jurisdiction is unverified (D-028). Nothing was prototyped.',
    [`${AI}ORCHESTRATION-OPTIONS.md`, `${TR}07-AZURE-SERVICE-DECISION-MATRIX.md`], 'Regional availability and processing location of managed services; not verified.', 'Concede that a managed runtime may suit a port once verified; the choice is by requirement, not preference.'),
  Q('Q17', 'Architecture', 'How are methodology changes handled?',
    'As governed versions. Methods and factor sets are versioned, effective-dated, reviewed and approved by different people, signed, and immutable once approved. Every calculation record names the exact versions and can be re-run. The candidate registry refuses retroactive or overlapping versions and detects tampering.',
    ['harness/contracts/methodology-registry-contract.mjs', 'tests/methodology-registry-contract.test.mjs', `${CX}CERTIFICATION-SCHEMES.md`], 'The real scheme methods are not modelled at all; the formula is a toy. Which schemes apply is unverified.', 'State that scheme methods are inputs from a domain owner, not something I invented.'),

  // ---- what exists (M07)
  Q('Q18', 'Delivery', 'You built a harness and no product. Is this over-engineered for a capstone?',
    'Partly, and I have to own that. The harness exists to make the work governed and repeatable, but the panel rewards a working Azure application, which does not exist. The honest position is that governance and evidence are ahead of the product. My recommendation is to stop adding governance and build the bounded local slice.',
    ['docs/capstone/FORENSIC-AUDIT.md', 'docs/capstone/CRITICAL-GAPS.md', `${PH}PHASE-1-BLOCKER-REPORT.md`], 'How the panel will weigh it; not mine to say.', 'Concede. Do not defend the volume of documents as a deliverable.'),
  Q('Q19', 'Delivery', 'How much of this was written by AI, and can you defend it without the documents?',
    'A substantial share was produced with AI assistance, and I should be able to explain every control without notes. The review record notes that author and reviewer were both models and may share blind spots. A human review is an open item. Before the panel I should be able to answer on specifics, which is what the rehearsal plan tests.',
    ['docs/target-architecture/13-SECURITY-REVIEW.md', 'docs/capstone/presentation/REHEARSAL-PLAN-AND-SCORECARD.md'], 'Whether I can defend it unaided: unverified until rehearsed.', 'Say plainly that it is AI-assisted and that human understanding is what rehearsal verifies.'),
  Q('Q20', 'Delivery', '{tests} tests pass. Who verified the tests, and what do they prove?',
    'The author wrote them, with a model-run independent review that found weaknesses I then fixed. They prove that the candidate rules behave as stated on synthetic data. They do not prove a product works, that any jurisdiction accepts the design, or that a real model behaves safely. Test runs are recorded with the commit and kept even when they fail.',
    ['docs/evidence/records/EV-0077.json', 'docs/target-architecture/13-SECURITY-REVIEW.md', 'docs/acceptance/TEST-EVIDENCE-INDEX.md'], 'Independence: reviewer was a model; no human review.', 'Distinguish passing tests from demonstrated capability. Offer the failing run EV-0074 as evidence of honest recording.'),

  // ---- demo (M08)
  Q('Q21', 'Demo', 'Was that live or recorded?',
    'State which, every time. A live run is announced as live; a replay prints a banner saying it is a recording, with its capture time and commit, and refuses to play if altered. I never present a recording as live.',
    ['docs/capstone/presentation/BACKUP-DEMO.md', 'harness/demo/recording.mjs', 'tests/demo-pipeline.test.mjs'], 'None on the mechanism; delivery discipline is behavioural and unverified.', 'If it was a recording, say so before the question is asked.'),
  Q('Q22', 'Demo', 'The feedstock check was a stand-in. So what was real?',
    'The custody chain, signatures, receipts, versioned methodology and calculation, certificate lifecycle with signed human approval, and offline verification are candidate code that really ran. The feedstock verification was a fixed stand-in because no oracle exists for it, and the demo says so. The data and keys are synthetic.',
    ['harness/demo/pipeline.mjs', 'docs/target-architecture/10-CONTROL-MATRIX.md'], 'Feedstock evidence handling is unbuilt and unverified.', 'Concede that evidence for feedstock is a gap, and name it unprompted.'),
  Q('Q23', 'Demo', 'Why synthetic data? Show it with real data.',
    'Real data cannot be used: none exists, and delivery data must not leave its jurisdiction or enter non-production environments. Synthetic data with explicit labels is the permitted approach. Proof on real data is the point of a pilot cell with a real port and meters.',
    ['docs/architecture/HARD-CONSTRAINTS.md', `${CX}DATA-CLASSIFICATION.md`], 'Real meter behaviour, noise and failure modes.', 'Concede that synthetic proves rules, not field behaviour.'),

  // ---- failure, security, DR (M09)
  Q('Q24', 'Disaster recovery', 'What happens if the Azure region goes down?',
    'It is designed, not tested. The cell design keeps capture working at the edge and requires disaster-recovery locations to be inside the jurisdiction or an approved, documented loss of availability. Targets for recovery time and point are unset (D-031), nothing is deployed, and no recovery procedure has been executed.',
    [`${AZ}OPERATIONS-AND-DR.md`, `${TR}05-QUALITY-ATTRIBUTES.md`, `${TR}08-DESIGN-DEFENSE.md`], 'RTO and RPO values; DR site location; cost.', 'Concede there is no test. Say what you would measure and when.'),
  Q('Q25', 'Disaster recovery', 'What are your RTO and RPO?',
    'I have none to give. They are placeholders pending a decision (D-031), because they depend on what the business can tolerate and on cost. I will not invent a number.',
    [`${TR}05-QUALITY-ATTRIBUTES.md`, `${CX}DECISION-REGISTER.md`], 'Both values: they are unset (D-031), and no business-impact analysis has been done.', 'Concede. Offer the method: set targets from business impact, then test against them.'),
  Q('Q26', 'Security', 'What if a signing key is stolen?',
    'Key custody is an open design decision (D-013) and not modelled in the candidates. The design lists the threat. Keys have validity windows and revocation, and an independent verifier checks receipts against revocation time, but the window between theft and revocation is an acknowledged open leaf in the attack tree.',
    [`${TR}11-ATTACK-TREES.md`, `${TR}06-THREAT-MODEL.md`], 'Hardware-backed custody, rotation and recovery are all undesigned (D-013).', 'Concede the stolen-key window. Do not claim tamper prevention; the design gives tamper evidence.'),
  Q('Q27', 'Security', 'Can one shipowner leak into another through a shared model or cache?',
    'In the data API and tool gateway the candidates prevent it: foreign records look absent, lists and search are tenant-filtered, caches are namespaced, and a scripted attacker was stopped. Shared inference state, such as prefix caches, batching and provider logs, is a threat I list and cannot test until an inference path exists. The safe state until it is verified is no shared endpoint for customer work.',
    [`${TR}10-CONTROL-MATRIX.md`, `${TR}06-THREAT-MODEL.md`, 'tests/tenant-boundary-contract.test.mjs'], 'Provider behaviour; control IS-09 is untestable today.', 'Say what is tested and name the untested control unprompted.'),
  Q('Q28', 'Security', 'How do you know a real model resists prompt injection?',
    'I do not. I know the gateway denies forbidden actions whatever a model proposes, and that grounding rules reject unsupported claims. How often a real model proposes forbidden actions, or invents evidence, is not measured: the model arms did not run.',
    [`${AI}AGENT-EVALUATION-REPORT.md`, `${TR}10-CONTROL-MATRIX.md`], 'Real-model injection rate; pattern-based detectors can be evaded.', 'Say "not measured" and describe the evaluation plan and its gates.'),

  // ---- AI necessity and results (M10)
  Q('Q29', 'AI necessity', 'Why do you need AI at all?',
    'On this evidence I may not, for most of the work. A conventional workflow completed {evalPassed} of {evalCases} synthetic cases and passed every hard gate. AI is plausible only at judgement seams: free-text intake, narrative drafting with enforced grounding, and unstructured documents. I recommend rules by default and a model only where it beats the baseline.',
    [`${AI}AGENT-EVALUATION-REPORT.md`, 'docs/evaluation/agent-runs/COMPARISON.md'], 'Whether a model beats the baseline anywhere; no LLM arm has run.', 'Agree that AI is unproven. This is a strength of the recommendation, not a weakness.'),
  Q('Q30', 'AI necessity', 'Your evaluation is synthetic and written by you. Why believe it?',
    'You should not over-believe it, and the report says so. Expected outcomes are mine and unreviewed, the baseline was written knowing the dataset, and the holdout is not blind. What it does show is narrower: the scorer can fail bad behaviour, the controls prove that, and the hard gates are well defined. An independent critique found nine issues and most were fixed.',
    [`${AI}AGENT-EVALUATION-REPORT.md`, 'tests/agent-eval.test.mjs'], 'Domain correctness of expected outcomes; blind holdout missing.', 'Concede the author-bias point. Ask for a domain reviewer and a blind holdout.'),
  Q('Q31', 'AI necessity', 'Is multi-agent better than a single agent?',
    'No evidence either way, so I do not recommend multi-agent. The case for five agents is governance: separate authority, data scope and audit. Capability is a separate question, and the decision rule is that multi-agent must beat single-agent on the same tests, otherwise the simpler arm wins.',
    [`${AI}AGENT-EVALUATION-REPORT.md`, `${AI}ORCHESTRATION-OPTIONS.md`], 'Every comparison: neither LLM arm ran, so there is no evidence on either side.', 'Do not defend multi-agent on principle.'),
  Q('Q32', 'AI necessity', 'What do models cost, and how fast are they?',
    'I do not know. No model is registered, no price is recorded and no latency was measured. The runner refuses an LLM run without a verified model, a registered prompt hash and a price source. The baseline\'s sub-millisecond latency is in-process in a test harness and says nothing about production.',
    ['harness/agent-eval/registry.json', `${AI}AGENT-EVALUATION-REPORT.md`], 'All model cost and latency: no model is registered and nothing was measured.', 'Say "not measured" and explain how it will be.'),
  Q('Q33', 'AI necessity', 'What would change your mind about AI?',
    'Evidence on a reviewer-controlled blind holdout that a model completes strictly more cases than the baseline in a case class, passes all hard gates, is stable across repeats and meets cost and latency thresholds the owner sets. A model that fails a hard gate is out regardless of other scores.',
    [`${AI}AGENT-EVALUATION-REPORT.md`, 'harness/agent-eval/gates.json'], 'The soft thresholds and the required margin over the baseline are for the owner to set (D-030).', 'Offer the decision rules R1 to R5 as the pre-registered test.'),

  // ---- cost (M11)
  Q('Q34', 'Cost', 'Where does {certToday} per certificate come from?',
    'It is a scenario figure: hours per certificate times a loaded labour rate, both placeholders. Today\'s figure is labour only, while the platform figure includes operating cost, so the two are not like-for-like. I show the fully loaded figure of {certFull} for that reason.',
    [`${BZ}BUSINESS-VALUE-MODEL.md`], 'Real hours per certificate and real loaded labour rates are unknown.', 'Concede that none is measured and that the comparison is conservative against the platform.'),
  Q('Q35', 'Cost', 'Which Azure services and what do they cost?',
    'Services are candidates chosen by requirement, not available by default, and none is verified in any region. Only the Azure list prices in the model are verified inputs (retrieved from the public price API). The three-year operating cost in the base case is a scenario figure of {opex} a year.',
    [`${TR}07-AZURE-SERVICE-DECISION-MATRIX.md`, `${AZ}COST-AND-CAPACITY.md`, `${BZ}model/azure-prices.json`], 'Region and SKU availability, quota, real consumption.', 'Say prices are list prices and consumption is assumed.'),
  Q('Q36', 'Cost', 'What does sovereignty cost compared with plain cloud?',
    'In the base case about {opt3} versus {opt1} over three years, a difference of roughly {sovDiff}. That is the model\'s estimate of what residency costs: cells, edge hardware and operations. It is a scenario figure and the options are not strictly like-for-like.',
    [`${BZ}BUSINESS-VALUE-MODEL.md`, `${TR}02-ARCHITECTURE-OPTIONS.md`], 'Real hosting, edge hardware and operating costs per port are unknown.', 'Concede the premium is large relative to the benefit in the base case.'),
  Q('Q37', 'Cost', 'How would you control spend?',
    'Nothing is deployed, so there is no spend to control. The design requires approval before any billable change, budgets per environment, scoped deployment identities and a recorded what-if. The readiness gate computes NOT-READY today and production deployment is never automatic.',
    [`${PH}AZURE-DEPLOYMENT-READINESS-REVIEW.md`, `${AZ}DEPLOYMENT-STRATEGY.md`, `${AZ}COST-AND-CAPACITY.md`], 'Budget values and who owns them are not decided.', 'Say the controls are design and gate logic, not operating experience.'),
  Q('Q38', 'Cost', 'How many people does this replace?',
    'None is claimed. The model counts hours saved, about 15 manual hours per certificate today against 4 with the platform in the base case, as scenario figures. Whether that releases headcount or redeploys it is a management choice, and I assume a human quality manager stays in the loop for approval.',
    [`${BZ}BUSINESS-VALUE-MODEL.md`, `${BZ}STAKEHOLDERS.md`], 'Current staffing and the real workflow of the quality manager are unknown.', 'Do not claim headcount savings; say hours saved is a scenario figure.'),

  // ---- scale, sovereignty, operations (M12)
  Q('Q39', 'Scalability', 'What happens at ten times the volume, or twenty ports?',
    'I do not have a measured answer: no load test exists and the capacity figures are placeholders. The design scales by adding cells and keeps the group plane thin, so ports scale horizontally. Per-cell throughput, ingestion rate and storage growth are unmeasured.',
    [`${TR}05-QUALITY-ATTRIBUTES.md`, `${AZ}COST-AND-CAPACITY.md`], 'Every quantitative claim: no load test exists and capacity figures are placeholders.', 'Say "not measured". Describe the load-test specification that exists and its first run.'),
  Q('Q40', 'Sovereignty', 'Is deploying in an in-country Azure region enough?',
    'Not by itself. A region does not prove where backups, replicas, logs, diagnostics, support access or AI inference reside, and what "within the jurisdiction" covers is a legal reading per port. I would run a twelve-step validation per cell and have counsel confirm the reading; none has run.',
    [`${TR}12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md`, `${AZ}SOVEREIGNTY-DEPLOYMENT-MATRIX.md`, `${CX}SOVEREIGNTY-MATRIX.md`], 'The legal reading; real resource locations.', 'Never claim residency from a region name. Say no residency claim is made.'),
  Q('Q41', 'Compliance', 'Will certification bodies accept this?',
    'I make no claim. Candidate schemes and standards are listed as candidates to verify, and technical controls do not establish legal or certification compliance. Acceptance needs the scheme owner\'s requirements, an auditor\'s view of the evidence model, and probably a pilot with a body.',
    [`${CX}CERTIFICATION-SCHEMES.md`, 'docs/architecture/HARD-CONSTRAINTS.md'], 'Which schemes apply and what they accept.', 'State that it is unverified and name the action: engage an auditor early.'),
  Q('Q42', 'Operations', 'Who runs this, and who can access a cell?',
    'The operating model is an open decision (D-033). The design rule is no standing administrative or support access from outside the jurisdiction, with a break-glass approved inside it, and deployment through scoped identities that cannot read evidence. Nothing is operated today.',
    [`${TR}06-THREAT-MODEL.md`, `${TR}12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md`, `${AZ}OPERATIONS-AND-DR.md`], 'Staffing, on-call and vendor support terms.', 'Concede that the operating model is undecided, and say who decides it (D-033).'),

  // ---- decision (M13)
  Q('Q43', 'Decision', 'Why only a pilot? Why not ask for more?',
    'Because the evidence does not justify more. The base case does not repay in three years, volume is unconfirmed, residency is unresolved and AI value is unproven. A bounded local pilot is cheap, reversible and produces the facts that decide the larger commitment.',
    [`${PH}PHASE-1-BLOCKER-REPORT.md`, `${BZ}BUSINESS-VALUE-MODEL.md`], 'The effort and cost of the pilot have not been estimated.', 'Stay with the ask; do not escalate it under pressure.'),
  Q('Q44', 'Decision', 'What exactly do you need from me, and by when?',
    'Four things: approve Phase 1a and enrol an approver; real volumes, premiums and dispute history; the ports and a legal reading of residency; and a domain reviewer plus a decision on whether to test a model. I have not set dates; I would agree them with you.',
    [`${PH}PHASE-1-BLOCKER-REPORT.md`, 'docs/state/TODO.md'], 'Dates are not set; they depend on when the four inputs arrive.', 'Offer to propose a schedule after the meeting.'),
  Q('Q45', 'Decision', 'What would make you stop?',
    'Confirmed volume well below break-even, a legal reading that rules out every feasible hosting model, or no named owner for approvals. Any of these means we should not build, and I would say so.',
    [`${BZ}BUSINESS-VALUE-MODEL.md`, `${CX}DECISION-REGISTER.md`], 'The exact volume and legal thresholds that would trigger a stop are not yet defined.', 'State the stop conditions plainly, and say the thresholds are to be agreed.'),
  Q('Q46', 'Governance', 'Who signs approvals, and what stops you approving your own work?',
    'The approver registry is empty, so no signed approval exists and the phase gate is closed. Enrollment is the owner\'s step. Technically, approvals are signed with the approver\'s own key, bound to the exact content, single-use, and cannot come from the person who wrote or edited the work.',
    ['docs/security/APPROVER-ENROLLMENT.md', 'harness/contracts/certificate-lifecycle-contract.mjs'], 'Who the approvers are; key custody (CL-15).', 'Say the harness cannot enrol approvers; a person must.'),
  Q('Q47', 'Decision', 'The sponsor wants it on Azure next month. Can you?',
    'No, and I would not. The deployment gate is NOT-READY: no application, no approver, no port, no verified region, no what-if. Doing it anyway would create billable resources against unverified residency and unreviewed design. The fastest honest path is the pilot and the verification steps.',
    [`${PH}AZURE-DEPLOYMENT-READINESS-REVIEW.md`, 'docs/evidence/records/EV-0076.json'], 'None on the gate; timing of inputs is not mine.', 'Hold the line, offer the quickest permitted route.'),
  Q('Q48', 'Delivery', 'How long and how much effort is Phase 1a?',
    'I have not estimated it, and I will not give a number I cannot support. The scope is defined: local, synthetic, no Azure, a first vertical slice with tests. I would estimate it with you once the stack and database decisions are made.',
    ['docs/adr/0020-phase-1a-local-synthetic-vertical-slice.md', `${PH}PHASE-1-BLOCKER-REPORT.md`], 'Effort and calendar time are both unestimated.', 'Concede no estimate; offer to produce one.'),
  Q('Q49', 'Compliance', 'What about personal data and privacy law?',
    'The design minimises personal data and handles any that exists under applicable law, but I have not done a privacy assessment and have not identified which law applies per port. Data classification and a legal review are open items.',
    [`${CX}DATA-CLASSIFICATION.md`, `${CX}REQUIREMENTS.md`], 'Applicable law; personal data in scope.', 'Concede; offer to include privacy counsel in the residency review.'),
  Q('Q50', 'Challenge', 'What is the strongest argument against your recommendation?',
    'That the base case loses money, the key inputs are assumptions, AI is unproven, and I built governance before a product. All four are true. The recommendation survives only because it asks for a small, reversible step whose purpose is to test those assumptions, and because it names the stop conditions.',
    [`${BZ}BUSINESS-VALUE-MODEL.md`, 'docs/capstone/CRITICAL-GAPS.md', `${AI}AGENT-EVALUATION-REPORT.md`], 'Whether the panel finds the pilot worth funding.', 'Agree with the criticism, then restate the bounded ask. Do not argue.'),
];

const tokens = (f) => ({
  npv: usd(f.npv), payback: String(Math.round(f.payback)), breakEven: String(Math.round(f.breakEven)), assumed: String(f.deliveriesAssumed), tco: usd1(f.tco), opex: usd1(f.opexY3), certToday: usd(f.certToday), certRun: usd(f.certRun), certFull: usd(f.certFull),
  benefitY3: usd1(f.benefitY3), premiumPool: usd1(f.premiumPool), premiumProtected: usd1(f.premiumProtected), opt1: usd1(f.opt1.tco3), opt2: usd1(f.opt2.tco3), opt3: usd1(f.opt3.tco3), sovDiff: usd1(f.opt3.tco3 - f.opt1.tco3),
  tests: f.tests.pass.toLocaleString('en-US'), evalPassed: String(f.eval.passed), evalCases: String(f.eval.cases),
});
export const fill = (s, f) => { const t = tokens(f); return s.replace(/\{(\w+)\}/g, (m, k) => { if (!(k in t)) throw new Error(`unknown token ${m}`); return t[k]; }); };

export function qaMarkdown(f, slides = []) {
  const slideOf = (id) => slides.find((s) => (s.ifAsked ?? []).includes(id))?.id ?? '';
  const L = ['<!-- Generated by harness/demo/build-package.mjs from qa.mjs. Do not edit by hand. -->', '# Panel questions: 50, with recommended responses', '',
    'Each entry gives the question as a panel member would put it, a recommended response, the evidence to point to, what is uncertain, and when to concede or ask for verification. Numbers are read from the model and the evaluation runs, so they match the deck.', '',
    '**Rules for every answer.** Restate the question first (rubric C2). Say what is real, what is scenario and what is not built. Concede a good point immediately. Say "I do not know, and here is how I would find out" rather than guessing (C3). **Nothing in this pack means delivery or consultative behaviour has been verified: that needs a human rehearsal.**', '',
    '| ID | Area | Slide | Question |', '|---|---|---|---|'];
  for (const q of QA) L.push(`| ${q.id} | ${q.area} | ${slideOf(q.id)} | ${fill(q.q, f)} |`);
  L.push('');
  for (const q of QA) L.push(`## ${q.id} (${q.area})`, '', `**Question:** ${fill(q.q, f)}`, '', `**Recommended response:** ${fill(q.a, f)}`, '', `**Evidence:** ${q.ev.map((p) => `[${p}](../../../${p})`).join('; ')}`, '', `**Uncertain:** ${fill(q.unc, f)}`, '', `**Concede or verify:** ${fill(q.con, f)}`, '');
  return `${L.join('\n')}\n`;
}

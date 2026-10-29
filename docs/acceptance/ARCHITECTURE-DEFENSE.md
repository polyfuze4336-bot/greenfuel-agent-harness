# Architecture defence

Thirty examiner-style questions about the harness and about the end-to-end scenario design (DES-0002, ADR 0015). Every answer states the reasoning an examiner should hear, the ADR or requirement it rests on, the validation evidence that exists today, and what is still assumed or weak. Evidence is cited by identifier; the indexes are [TEST-EVIDENCE-INDEX](TEST-EVIDENCE-INDEX.md) and [REQUIREMENTS-COVERAGE](REQUIREMENTS-COVERAGE.md). Where no evidence exists, the answer says so.

Two limits apply to every answer. First, the design records are Proposed or Blocked: no design has been approved and no human reviewer has judged any of them. Second, the harness is a coding harness. The bunkering application, the production agents and every Azure resource do not exist, so no answer claims production behaviour.

## 1. Business justification

### Q1. Why build a coding harness before any of the bunkering application?
- **Expected reasoning:** The solution carries hard constraints (residency, shipowner isolation, tamper evidence, human filing approval, no invented measurements). An unconstrained coding agent can violate them silently. The harness makes the constraints executable before code exists, so the cost of a violation is a failed check rather than a defect in a certificate. Building it first is the reverse of the usual order on purpose.
- **Supporting ADR or requirement:** ADR 0001, ADR 0002, ADR 0003; HC-01 to HC-12; BR-006.
- **Validation evidence:** Repository validation and the full test suite pass on a fresh clone (see the acceptance report). The evaluation framework runs 12 domains and gates G1 to G7.
- **Remaining weakness:** There is no baseline or measure showing the harness improves outcomes (D-034). Its value is argued, not measured. No evaluation compares agent results with and without the harness.

### Q2. Which business requirement does the evidence ingestion subsystem serve, and what would show it worked?
- **Expected reasoning:** BR-007 (an intermittent link never prevents a delivery being evidenced), BR-002 (verifiable evidence) and BR-006 (residency). It worked if, after a disconnection, the cell holds exactly the events the edge captured, in order, with no duplicate and no silent change, and any later alteration is detectable.
- **Supporting ADR or requirement:** DES-0002 section 1, ADR 0015, BR-002, BR-006, BR-007, FR-006, NFR-005.
- **Validation evidence:** The contract tests and EVAL-PRC-DAT-007, EVAL-PRC-DAT-008 and EVAL-PRC-SOV-004 exercise this on synthetic fixtures.
- **Remaining weakness:** The measure is stated on a reference model, not on a real edge or a real disconnection. No business baseline exists (D-034) and the tolerated disconnection is undecided (D-020).

### Q3. Is the cost of one deployment per jurisdiction justified?
- **Expected reasoning:** It is a tradeoff, not a given. Per-jurisdiction placement follows from HC-01 only if residency means what the conservative reading says. If the legal reading is narrower, the case for the added cost weakens and a federated design may dominate. The design therefore parameterises placement per port and records the tradeoff.
- **Supporting ADR or requirement:** DES-0001 TD-001, RK-003, RK-001, D-009, D-011, NFR-019.
- **Validation evidence:** The tradeoff and the dependent decisions are recorded and the gate blocks approval until they are answered. No cost figure exists and none is invented (HC-12).
- **Remaining weakness:** There is no legal reading, no volume (D-032) and no budget. The justification cannot be completed without the owner's facts (TODO T31).

## 2. Architecture decisions

### Q4. Why was an edge hash-chained log with store-and-forward selected over the other options?
- **Expected reasoning:** Option A (online-only) violates HC-07 because an outage loses events. Option D (file export) has no sequence at the source and a file can be edited before upload. Option C (managed ledger) protects data only from the ledger onwards and the availability of such a service in each jurisdiction is unverified. B meets the offline and tamper-evidence needs with a data format that is independent of the store behind it.
- **Supporting ADR or requirement:** DES-0002 sections 2 and 3, ADR 0015, HC-07, HC-08.
- **Validation evidence:** RV-0002 screens all twelve constraints for B and records Option A as Violated for HC-07. The contract tests demonstrate the behaviour that distinguishes B.
- **Remaining weakness:** The selection is a proposal. B is Conditional on five owner decisions (D-013, D-018, D-019, D-020, D-021) and C may dominate once D-013 is decided.

### Q5. Where did you use native Copilot capabilities, and where did you write custom code?
- **Expected reasoning:** Native: custom agents, instruction and skill files, hooks, MCP configuration, subagent delegation and the terminal. Custom code only where deterministic enforcement or persistence was required and a native feature could not provide it: the policy hook, the evidence recorder, the validators, the task and loop engines, the memory store, the evaluation framework.
- **Supporting ADR or requirement:** ADR 0001 and the capability matrix.
- **Validation evidence:** The capability matrix lists each custom component with the gap it fills, and validators check agent files against policy. The reference assessment records what was reused, adapted and rejected.
- **Remaining weakness:** Native enforcement was observed in Copilot CLI by me and was reported, not observed, by the owner in VS Code (TODO T8, T9, T12). I did not observe the harness's own agents being invoked in this review session.

### Q6. Why is ADR 0015 still Proposed and DES-0002 Blocked?
- **Expected reasoning:** The design gate computes Blocked from the trace: several Must requirements are only Partial or Unresolved and several decisions are open. A Design ADR cannot be Accepted unless its review is Approved. Accepting it would convert a prototype into an authority the evidence does not support.
- **Supporting ADR or requirement:** ADR 0005, ADR 0015, RV-0002.
- **Validation evidence:** `design-gate.mjs` on RV-0002 computes Blocked and matches the declared status. A declared status more permissive than the computed one fails validation.
- **Remaining weakness:** The gate checks structure and consistency, not truth (RK-014). The reviewers were models and share blind spots (RK-012). No human decider is named (TODO T3).

## 3. Availability and recovery

### Q7. What happens when the shore link is down, and when it returns?
- **Expected reasoning:** Capture and local verification never wait for shore. Batches queue at the edge. On return they are forwarded in order. The cell holds a batch with a gap and reports the gap with the time it was first seen, ignores an identical redelivery, and refuses a repeat with different content.
- **Supporting ADR or requirement:** HC-07, BR-007, FR-006, NFR-004, NFR-005, NFR-006.
- **Validation evidence:** Contract tests for hold, redelivery, conflicting replay and gap reporting; EVAL-PRC-DAT-007 (red-team scenario RT-08, offline edge and delayed synchronisation, on the reference model).
- **Remaining weakness:** No edge component exists, so no real disconnection was tested. The buffer limit, the maximum disconnection and the behaviour at the limit are undecided (D-020). The threshold that raises an alert for a long-open gap is undecided.

### Q8. What if the jurisdiction cell's store is lost or corrupted?
- **Expected reasoning:** Corruption of accepted records is found by the stand-alone store check from the stored data alone. Recovery is by restoring inside the jurisdiction from the immutable store. Loss of the whole store needs an external anchor to prove nothing was rewritten, which is not designed.
- **Supporting ADR or requirement:** HC-08, SEC-008, NFR-008, D-031, RK-013.
- **Validation evidence:** The store check is tested against deleted records, edited records, an edited derived delivery state, a removed head and a misfiled record.
- **Remaining weakness:** Recovery design, recovery targets and the anchor are not designed. Whoever can write the whole store can rewrite events and recompute every commitment undetected.

### Q9. What availability and recovery targets apply?
- **Expected reasoning:** None, and the harness says so. A target requires a stakeholder source (D-031) and inventing one would break HC-12.
- **Supporting ADR or requirement:** D-031, NFR-008, HC-12, TODO T28.
- **Validation evidence:** The figures lint rejects unsourced figures in designs and ADRs. The performance and reliability evaluation tests stay Pending rather than passing against an invented number.
- **Remaining weakness:** Until a source is supplied, availability and performance cannot be evaluated at all.

## 4. Security and sovereignty

### Q10. How do you know measurement data stays in the originating jurisdiction?
- **Expected reasoning:** For the ingestion flow only: the verifier compares every jurisdiction and zone claim with its own identity and registry, never with the batch's own claims, and a source from another jurisdiction cannot be registered. For everything else the answer is that it is not yet known: no per-port flow inventory exists.
- **Supporting ADR or requirement:** HC-01, BR-006, SEC-001, NFR-009, D-003, D-009, D-011.
- **Validation evidence:** EVAL-PRC-SOV-004 and the contract tests for a foreign jurisdiction and a self-asserted claim. The Azure scaffold's static policy checks refuse unapproved locations.
- **Remaining weakness:** Metadata, telemetry, backups, diagnostics, support access and disaster recovery locations are not covered. The legal meaning of residency is undecided (D-009).

### Q11. Does deploying to an Azure region satisfy port-jurisdiction residency?
- **Expected reasoning:** No. A region is a hosting location, not a legal determination. Replication, backup, diagnostics, support access and recovery locations all matter, and some ports may have no compliant region, in which case an in-jurisdiction edge or on-premises store with a controlled shore integration is proposed.
- **Supporting ADR or requirement:** ADR 0014, docs/azure/SOVEREIGNTY-DEPLOYMENT-MATRIX, HC-01, D-009, D-010, RK-001, RK-002.
- **Validation evidence:** The readiness utility reports NOT-READY with its blockers, and the deployment gates DG-01 to DG-12 are not met. Region availability is explicitly not verified.
- **Remaining weakness:** No region or service availability has been verified for any port and there is no subscription decision (D-037).

### Q12. Integrity is shown; is authenticity?
- **Expected reasoning:** No, and the design says so. A hash chain shows that records were not altered after sealing. It does not show who produced them. A party who can reach the endpoint can append a consistent forged continuation, which also stalls the real edge. Every accepted record is therefore marked unauthenticated until signing exists.
- **Supporting ADR or requirement:** HC-06, HC-08, SEC-013, TD-003, RK-007, D-013.
- **Validation evidence:** Contract tests for the unauthenticated mark and for tampered, replaced and re-hashed batches. The forged continuation is documented, with no test, as an accepted residual.
- **Remaining weakness:** Signing, device enrolment and revocation, quarantine and key custody are undesigned. This is the largest open weakness of the ingestion design.

## 5. Performance and scale

### Q13. What volumes and response times does the design assume?
- **Expected reasoning:** None. No volume (D-032) or response target (D-031) was supplied. The contract carries working limits for batch size that are labelled as such and are not performance claims.
- **Supporting ADR or requirement:** D-031, D-032, NFR-019, HC-12, ADR 0013.
- **Validation evidence:** The performance tests in the catalogue are Pending. The contract tests cover oversized and deeply nested payloads for safety, not throughput.
- **Remaining weakness:** The design has never been run under load. A capacity assumption cannot be defended with the present evidence.

### Q14. Can a registered source exhaust the store with many small valid batches?
- **Expected reasoning:** Yes, in the reference model. Limits apply per batch only. A source rate, a store quota and an overload behaviour that never loses evidence silently are required and are recorded as not designed.
- **Supporting ADR or requirement:** DES-0002 section 9, NFR-004, D-020, D-031.
- **Validation evidence:** The reviewer found this and the design discloses it. No test exists, because there is no behaviour to test.
- **Remaining weakness:** Open. It is a design gap, not a code defect.

### Q15. Does verification scale with the length of the evidence history?
- **Expected reasoning:** The stand-alone store check reads and recomputes every stored record and re-derives delivery state, so its cost grows with history. A real store would need checkpointed verification anchored outside the cell.
- **Supporting ADR or requirement:** NFR-001, SEC-008, DES-0002 section 4.
- **Validation evidence:** None for scale. The check is tested for correctness on small fixtures only.
- **Remaining weakness:** No measurement and no incremental verification design.

## 6. Agent autonomy and governance

### Q16. What may an agent do, and does a high autonomy level grant unrestricted actions?
- **Expected reasoning:** No. Autonomy level is not a permission. Coding agents hold least-privilege tiers P0 to P4 with unknown tools and operations denied by default. The production agents are separate and read-only by design, with commercial, regulatory and infrastructure actions requiring a person.
- **Supporting ADR or requirement:** ADR 0008, the agent autonomy matrix, SEC-009, HC-09, HC-04.
- **Validation evidence:** The permission policy validator and the negative permission tests, including a deployment without approval, an Azure deletion, a cross-shipowner fixture read, a simulated secret read and a bypass through another agent.
- **Remaining weakness:** The production-agent permission tests are Pending. The identity and action model for production agents is not defined (D-027).

### Q17. Is a Markdown policy an enforcement mechanism? What actually blocks an action?
- **Expected reasoning:** No. Enforcement is a pre-tool hook that evaluates policy-as-code, validators in CI, and signed approval records for tiers that need them. The hook is a screen and not a security boundary: agents run as the user's operating system account and a regular expression can be evaded.
- **Supporting ADR or requirement:** ADR 0002, ADR 0008, docs/security/ENFORCEMENT-STATUS, TODO T14, T15, roadmap R3, R15.
- **Validation evidence:** The enforcement status document separates technically enforced from procedural controls. Policy tests deny the five required scenarios, and the denial audit log chain verifies.
- **Remaining weakness:** No sandbox exists, GitHub branch protection cannot be applied on the current plan, and the audit log is local, denial-only and not anchored outside the machine.

### Q18. Can an agent approve its own work or get round a denial by delegating?
- **Expected reasoning:** No. Agents hold no approval permission, review roles are separate from authoring roles, the delegation graph is acyclic and checked, and a denial applies to the action rather than to the agent that asked.
- **Supporting ADR or requirement:** ADR 0006, ADR 0008, ADR 0009, AGT-010.
- **Validation evidence:** Agent validation tests, the delegation-cycle check and the negative test for a blocked operation attempted through another agent.
- **Remaining weakness:** Native enforcement of subagent restrictions inside VS Code was reported by the owner, not observed (TODO T9). Self-declared human and importer memory writers can approve entries (T23, R14).

## 7. Evidence integrity

### Q19. Is the evidence tamper-proof?
- **Expected reasoning:** No: tamper-evident, with stated limits. Alteration after sealing, removal, reordering, replay and replacement are detected. A party who can rewrite the whole store and recompute every commitment is not, without signing and an external anchor.
- **Supporting ADR or requirement:** HC-08, NFR-001, SEC-008, D-013.
- **Validation evidence:** Contract tests with independently written hash vectors, so the suite is not its own oracle, plus mutation spot-checks that were caught.
- **Remaining weakness:** The whole-store rewrite is undetected today. The vectors prove a hash format, not a certificate scheme.

### Q20. How are duplicate, missing, backdated and out-of-order events handled?
- **Expected reasoning:** An identical repeat is ignored. A repeat with different content is refused and kept visible. A gap is held and reported. A missing reading is reported, never estimated. Time must not go backwards within a source, must not exceed the verifier's clock plus its own skew, and must not be older than the verifier's own maximum age. A lifecycle irregularity is kept as evidence and flagged.
- **Supporting ADR or requirement:** NFR-005, NFR-017, AGT-003, HC-06, ADR 0013.
- **Validation evidence:** The contract tests and the evaluation checks for these scenarios.
- **Remaining weakness:** The approved time source, the tolerance and the maximum age are undecided (D-021, D-020); the tests use synthetic values.

### Q21. Why should anyone trust the harness's own evidence?
- **Expected reasoning:** Because claims are recorded by a recorder that runs the command and stores the arguments, exit code, output hash, commit and runtime, and because evaluation statuses re-derive from the stored evidence. The framework reports failures and a test that did not run is never reported as passed.
- **Supporting ADR or requirement:** ADR 0012, ADR 0001, the evidence recorder.
- **Validation evidence:** The evidence index lists every record including a recorded timeout and a record where `npm` could not be started. Verification re-derives every status of the committed run, and the three genuine evaluation FAILs remain visible.
- **Remaining weakness:** The recorder trusts the machine it runs on. Records are plain files in the repository, so a person with write access could alter them and the commit history is the only protection. CI re-runs the evaluation, but that is the same author's code.

## 8. Azure cost and operations

### Q22. What drives Azure cost, and what is it?
- **Expected reasoning:** The drivers are named per component and port: an edge component and a verifier per jurisdiction, hosting per jurisdiction, storage and retention, monitoring, and model inference. No amount is stated because no price, volume or budget has been sourced.
- **Supporting ADR or requirement:** docs/azure/COST-AND-CAPACITY, NFR-019, D-032, DQ-08-01.
- **Validation evidence:** The deployment gate for cost controls is not met and is reported as such. The pricing tooling was not used because it needs sign-in that was not approved.
- **Remaining weakness:** There is no estimate, no budget and no per-port attribution.

### Q23. Why is nothing deployed, and what approvals are needed before it could be?
- **Expected reasoning:** The owner deferred actual Azure deployment. The scaffold is non-deployable by design, deployment gates DG-01 to DG-12 must be met, and creation of resources or billable changes needs signed approval from named people. No agent holds deployment rights.
- **Supporting ADR or requirement:** ADR 0014, HC-11, TODO T13, T32, T33, T36.
- **Validation evidence:** The readiness utility reports NOT-READY and exits non-zero. The Azure validator compiles the Bicep scaffold with a local compiler and checks its static policy.
- **Remaining weakness:** No tenant, subscription, identities or approvers are named, so no gate that depends on them can pass. Nothing about Azure behaviour was observed against a real subscription.

### Q24. How is the harness itself operated and kept from drifting?
- **Expected reasoning:** The repository validator runs in CI, a dedicated workflow validates the infrastructure scaffold, generated documents are regenerated and compared, and the evaluation is re-run in CI. Control-plane paths are intended to need reviewed changes.
- **Supporting ADR or requirement:** ADR 0012, ADR 0014, roadmap R4.
- **Validation evidence:** The CI runs on the pushed commits were green, and a fresh clone passed the validators and the full suite without installing any dependency.
- **Remaining weakness:** CI skips the TypeScript scenario because no toolchain is installed there (an allowed, recorded difference). Branch protection and required review are not enforceable on this plan.

## 9. Failure scenarios

### Q25. What does the repair loop do when it cannot fix a failure?
- **Expected reasoning:** It diagnoses rather than retries. It allows at most three repair attempts and two identical failures, never retries a destructive or non-idempotent operation, stops immediately on a permission violation, missing critical context or unsafe action, preserves the failure history and escalates to a person.
- **Supporting ADR or requirement:** ADR 0011, AGT-010.
- **Validation evidence:** The loop validation report covers a TypeScript build failure, a failed contract test, an incorrect emissions fixture, a sovereignty violation, a cross-shipowner access and an unrepairable repeated failure; the safe error was repaired and the hard-constraint violations stopped the loop.
- **Remaining weakness:** There is no sandbox, so code under test runs with the user's account. The emissions fixture is deliberately simple and implies nothing about a certification scheme.

### Q26. What if a feedstock certificate contains malicious instructions?
- **Expected reasoning:** Document content is data. Ingestion contains no model, identifiers match a strict pattern, payloads are typed, unknown fields are refused and nothing is echoed into a message unformatted. The production agent defence (never treating document text as an instruction) is future work and is tested only as Pending.
- **Supporting ADR or requirement:** SEC-012, HC-06, red-team scenario RT-01.
- **Validation evidence:** Contract tests for hostile identifiers and payloads. For the harness, the output hook and the memory store reject untrusted content in tests.
- **Remaining weakness:** No model-level prompt-injection test was run, and no production agent exists. Resistance of a language model to injected text is unmeasured.

### Q27. What if memory is poisoned or two memories conflict?
- **Expected reasoning:** Approved decisions are never silently overwritten. A write from an untrusted source cannot supersede an approved entry, a conflicting entry is detected and reported, sensitive fields are refused, and retrieval ranks by authority before recency.
- **Supporting ADR or requirement:** ADR 0010, docs/memory/MEMORY-GOVERNANCE.
- **Validation evidence:** The memory validation tests and the validator, using fixtures. A task session was reconstructed from stored state. VS Code was not restarted.
- **Remaining weakness:** Human and importer writers are self-declared, so an agent with file access could claim to be one (TODO T23, roadmap R14).

## 10. Alternatives and tradeoffs

### Q28. Why not use a managed ledger as the system of record?
- **Expected reasoning:** Its protection begins at the ledger, so events held at the edge are unprotected, its availability in each jurisdiction is unverified, and its content is hard to move. It is Deferred, not rejected, and is revisited once D-013 is decided.
- **Supporting ADR or requirement:** DES-0002 option C, ADR 0015, DQ-10-03.
- **Validation evidence:** The comparison table and RV-0002 section 4.
- **Remaining weakness:** No ledger capability was verified in any jurisdiction, so the deferral rests on absence of evidence. C may prove better.

### Q29. Why not a single central store for delivery measurements?
- **Expected reasoning:** It would hold measurements from several jurisdictions in one place, which violates HC-01 under the conservative reading. The costs of the local alternative (operational multiplication, poorer group visibility) are recorded as tradeoffs.
- **Supporting ADR or requirement:** DES-0001, ADR 0004, HC-01, RK-001, RK-004.
- **Validation evidence:** RV-0001 and the gate, which rejects the central option as Violated.
- **Remaining weakness:** If only one jurisdiction is in scope or the legal reading is narrower, the case dissolves. DES-0001 is Blocked and ADR 0004 is Proposed.

### Q30. What is the strongest argument against the whole approach?
- **Expected reasoning:** That language models author, review and critique the work, so their shared blind spots can pass every gate, and that gates check structure, not truth. The answer is not that this is untrue. Mitigations are separate reviewer and author roles, executable checks that do not depend on a model's opinion, genuine failing findings that stay visible, and a human decider before any approval. Those mitigations are partly built.
- **Supporting ADR or requirement:** RK-012, RK-014, ADR 0005, ADR 0012.
- **Validation evidence:** The evaluation shows genuine FAILs and a BLOCKED gate rather than a clean pass, and the two independent review rounds found real defects that were fixed and re-tested.
- **Remaining weakness:** No human has reviewed any design, no independent party has examined the harness, and the reviewer models were drawn from the same family of technology as the author. This remains the largest governance risk.

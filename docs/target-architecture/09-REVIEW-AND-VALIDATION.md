# 09 Review and validation

Status: Phase 0, 2026-10-29. This is the architecture review and business-case validation for DES-0003 and the business value model. It records what was checked, by what, what an independent model reviewer found and how each finding was handled, and what remains unvalidated. **No ADR and no design is approved.** The people who must decide are not named, no human has reviewed any of this, and every reviewer so far (author and critic) is a language model (RK-012).

## 1. Governance checks run

| Check | Command | Result | Evidence |
|---|---|---|---|
| Design-review gate on RV-0003 | `node harness/scripts/design-gate.mjs docs/architecture/reviews/RV-0003-target-system-architecture.md` | Computed **Blocked**, declared Blocked; no rejection reason, no structural error. Blocking reasons: nine hard constraints Conditional on open decisions, three perspectives not assessed (PV-04, PV-05, PV-07), fifty Must requirements Partial or Unresolved, sixteen open decisions that affect Must requirements, seven critical defence questions unanswered | EV-0068 |
| Architecture validators (hard constraints, perspectives, question bank, risks, ADR structure, review coupling, figures and compliance-claim lint) | `node harness/scripts/validate-harness.mjs` (runs the architecture validator and every other validator) | Passes (EV-0071), including the lint that rejects unsourced figures and compliance claims in DES-0003, RV-0003 and ADR 0016 to 0019. **EV-0069 is a recorded failure**: it ran before the generated evidence index had been regenerated after EV-0068, the only problem it lists; it is kept because evidence is append-only | EV-0071 (EV-0069 failed, explained) |
| Business model validation | `node harness/scripts/business-model.mjs check` | Inputs valid (every input has a class and basis, no user-provided input), price file valid, report, results and CSV current | EV-0070 |
| Full test suite | `npm test` | **890 of 890 passed, none skipped**, clean tree before and after, head unchanged; includes the business model and price tests | EV-0072 |

The gate result is a computed fact, not an assessment of quality. A design is Blocked here for the reasons the gate lists: open baseline decisions (D-003, D-009, D-010, D-011, D-013 and others), requirements a system-level design can only address partially, and defence questions that need facts nobody has yet. **The gate does not find the design wrong; it finds it undecidable until the owner supplies facts and a named human decides.**

## 2. Hard-constraint screen of the recommended option

| Constraint | Verdict | Why it is not simply "Satisfied" |
|---|---|---|
| HC-01 | Conditional | Depends on the legal meaning of residency per port, per-port hosting, and the approved flows (D-009, D-010, D-011) |
| HC-02 | Conditional | Depends on the customer entity model and on what an inference endpoint can actually isolate (D-015, D-028) |
| HC-03 | Conditional | Depends on what "locally hosted" is local to and on the custody and anchor mechanism (D-012, D-013) |
| HC-04 | Conditional | Depends on the quality-manager role and the identity model (D-007, D-027) |
| HC-05 | Conditional | Depends on methodology governance (D-022) |
| HC-06 | Conditional | Depends on measurement sources and feedstock verification (D-019, D-024) |
| HC-07 | Conditional | Depends on the disconnection period and the edge platform (D-020, D-018) |
| HC-08 | Conditional | Depends on the tamper-evidence mechanism and auditor expectations (D-013, D-025) |
| HC-09 | Conditional | Depends on the identity and permission model (D-027, D-008) |
| HC-10, HC-11, HC-12 | Satisfied | Nothing is claimed compliant, nothing is created, no figure is presented as a target |

Option A (centralised) is **Violated** on HC-01 and rejected. Nothing in the design is waived and no constraint is traded.

## 3. Independent critique and how each finding was handled

An independent, read-only model reviewer (not the author) was given the design, ADRs, architecture documents, business documents, model, scripts and the hard constraints, and told to be adversarial. It reported six findings (three high, three medium). It stated that it verified by reading and did not run the model or tests. Every finding was accepted.

| # | Severity | Finding | Handling | Residual |
|---|---|---|---|---|
| 1 | High | A group pipeline in another jurisdiction deploying into cells is an out-of-jurisdiction administration route, contradicting "administration from inside" | Changed to **publish and pull**: the group plane only publishes signed change sets; each cell's in-jurisdiction runner pulls, verifies and applies them with an identity that cannot read or export data; deployment logs and break-glass stay in the cell. Updated in views (F13, topology), ADR 0016, DES-0003, and a new threat TM-33 | The runner is a privileged component inside the cell and must itself be protected; runner design is not done |
| 2 | High | Option 2 was labelled eligible although its costing was neither compliant nor like-for-like, and its lower TCO invited a false comparison | Option 2 is now **conditional**; the report draws **no delta** from it and says its figures are a floor; only option 3 is a complete eligible costing | The cost of a compliant option 2 is not modelled |
| 3 | High | Per-shipowner isolation was undefined at the shared agent and inference boundary; "never sharing context" is not a mechanism | Added a per-shipowner **execution-context** requirement: tenant-bound inference requests, per-shipowner namespaces for caches, traces and logs, no cross-shipowner batching or session reuse, provider retention off or verified, or a dedicated deployment, or no inference. ADR 0017 item 7, views, DES-0003 SEC-005, threat TM-34 | Unverified for any real endpoint (D-028); until evidenced, the safe state is no shared endpoint for customer work |
| 4 | Medium | An offline bundle cannot show "latest valid" because it cannot learn of a later revocation | Verification now reports **validity as of a signed chain-head and revocation snapshot** with issue time and a freshness limit; ADR 0018, contract IC-09, design defence scenario 3, TM-21 | Needs a reference verifier and a stale-snapshot test; a freshness limit is a decision |
| 5 | Medium | The benefit model could count the same evidence-related loss as both a dispute concession and lost premium | Added an explicit **overlap** input that deducts the shared portion, and a report row showing the case with full overlap. Base results fell; the base net present value is now lower | The overlap is a scenario assumption until claim and credit-note history exists |
| 6 | Medium | "Fully loaded" cost per certificate divided one-time cost by three times year-3 volume, not by the certificates of years 1 to 3 | Fixed: one-time cost is divided by the certificates of years 1 to 3, with a test | None |

The critic found no statement that any design or ADR is approved.

## 4. Business-case validation

### What was validated

| Check | Method | Result |
|---|---|---|
| Every figure carries a class | Input validator rejects an input without class, basis, rationale or source; tests mutate each rule | Pass; 26 tests |
| No input claims to be user-provided without a named person and date | Validator and test | No input is user-provided |
| Verified inputs are real | Azure list prices retrieved anonymously from the public Retail Prices API on the recorded date, 14 meters across 8 Asian regions; the price file validator checks provenance and shape | Retrieved and validated; **list price only, not availability or a quote** |
| Derived results take the weakest class | Weakest-class rule and test | Every output is a scenario result |
| Arithmetic reproducible | Hand-calculated labour, dispute, audit, premium and platform-cost figures asserted against the model | Pass |
| Direction of effects is sensible | Tests for volume, premium, savings, build cost, rates, contingency, jurisdictions | Pass |
| Break-even and payback are consistent | The break-even volume is the zero of the NPV; payback agrees with the sign of the three-year net | Pass |
| The report cannot drift | The report, results and CSV are regenerated and compared; an edited input without regeneration fails | Pass |
| Plausibility | Group volume compared with a published Singapore benchmark | Base volume is a large share of Singapore's 2025 bio-blend sales, which is generous; flagged in the report |

### What the model says (in labelled scenario terms)

- The **base scenario does not pay back within three years** and its payback is around five years; the **conservative scenario does not pay back within ten**; the **stacked-optimistic scenario pays back in months**. Scenarios stack every assumption in one direction, so the spread is a measure of ignorance, not a forecast.
- **Labour savings alone do not carry the case.** The case depends on the premium and dispute lines and on volume, the least measured numbers.
- **Sovereignty has a visible price**, driven by the number of jurisdictions and operations effort rather than compute.
- The workload is small, so fixed per-cell costs dominate.

### What was not validated, and cannot be yet

- **Any figure's truth.** Every operating input is an illustrative placeholder. The only verified inputs are list prices.
- **Benefit realism.** No baseline, no claim history, no volume, no premium. No finance person has reviewed the logic.
- **Net of replaced cost.** Existing systems and costs the platform would replace are not credited.
- **Option 2 cost.** Not costed like-for-like.
- **Price by region and by agreement.** One representative region; list prices ignore agreements.
- **Availability and residency of any Azure service.** Not checked; a priced meter is not evidence of either.
- **Regulatory, scheme or legal applicability.** Nothing was verified (D-001, D-002, D-009).

**Validation conclusion.** The business model is a sound, reproducible, honestly labelled *tool*. It is **not a validated business case**, and the sponsor should not rely on any result from it until the first five discovery items in the commercial-value document are measured.

## 5. Approval status

| Item | Status | What is needed |
|---|---|---|
| DES-0003 | Proposed; review RV-0003 **Blocked** | Named human decider and reviewer (T3, T37); answers or conscious deferrals of the decisions in RV-0003 section 6; human review |
| ADR 0016 to 0019 | **Proposed** | Cannot be Accepted while RV-0003 is not Approved; a human sets Accepted and a signed approval of the architecture class is needed once an approver is enrolled (T43) |
| ADR 0004, ADR 0015, DES-0001, DES-0002 | Unchanged: Proposed, Blocked | Same |
| Phase | 0 | Raising it needs the owner's ADR and signed approvals; nothing here changes it |
| Azure deployment | Deferred by the owner (T36) | Not requested |

Nothing was marked Approved or Accepted by this work, and the validator that forbids an ADR being Accepted while its review is Blocked ran and passed.

## 6. Decisions the owner must make to unblock the review

Ordered by how much of the design they unblock. None is answered or assumed answered here.

1. **D-003, D-009, D-010, D-011:** ports, the legal meaning of residency, hosting per port, and approved flows. They fix the number and type of cells.
2. **D-013, D-012, D-006:** tamper-evidence and key custody, what "locally hosted" is local to, what a certificate is.
3. **D-027, D-007, D-033:** identity and permission model, the quality-manager role, the operating and support model.
4. **D-028, D-030:** where inference runs and how agents are evaluated; and whether customer-facing agents are wanted at all before isolation can be evidenced.
5. **D-031, D-032, D-034:** targets, volumes, value measures and cost envelope; then re-run the model on measured data.
6. **D-037 and a read-only identity (T32, T33):** so services can be verified per jurisdiction.

## 7. Limits of this review

The author and the critic are models. The gate checks structure and consistency, not truth. The design has no test against a running system because none exists. The independent review covered the documents and scripts only; it did not execute anything. A human architect and a human finance reviewer are still required, and a legal review per jurisdiction is a precondition for any residency claim.

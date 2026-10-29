# ADR 0020: Phase 1a, a local synthetic-data vertical slice inside this repository

- **Status:** Proposed
- **Type:** Governance
- **Date:** 2026-10-29
- **Deciders:** Programme owner (to decide with a signed approval once an approver is enrolled); a named design decider for DES-0003 (not yet named, T3, T48)
- **Supersedes:** none

## Context
- FACT: The phase is 0. HC-11 and BR-009 forbid application code until a human raises the phase, and the policy hook denies writes to the phase-gated paths (`src/`, `infra/` and similar) while the phase is 0. A phase raise needs a signed decision approval of the architecture class and of the deployment class from different enrolled keys, and no approver is enrolled ([PHASE-1-BLOCKER-REPORT](../phase/PHASE-1-BLOCKER-REPORT.md)).
- FACT: [DES-0003](../architecture/designs/DES-0003-target-system-architecture.md) and ADRs 0016 to 0019 are Proposed and RV-0003 is Blocked. D-003, D-006, D-007, D-009 to D-013 and D-027 are open.
- FACT (owner replies in chat, 2026-10-29, **recorded, not yet signed**): the repository structure is a folder inside this repository, not a separate repository; the Phase 1a scope proposed in the blocker report is adopted; the technology lean is TypeScript on Node for the API with React or Next.js for the web app and PostgreSQL, subject to a database-for-tests decision; the risk of hook-only protection while agents write application code is accepted and to be recorded as a decision; the owner will enroll as an approver next.
- ASSUMPTION: A slice built on synthetic data only, locally and without Azure, cannot breach residency because no real data exists, and does not need D-003, D-009, D-010 or D-011 answered.
- FACT: In Phase 1 the permission engine no longer denies tier 3 and above operations outright; they need a valid signed approval, and `azureMutationDecision` stays `deny`. This ADR does not enroll anyone or create a P3 approval, so Azure changes stay unavailable.
- FACT: A signed phase approval binds to the identifier `phase-1` only, not to this ADR's text. Scope limits therefore rely on this ADR, its review and the hook rules; the approval alone does not enforce them.

## Options considered
1. **A local, synthetic-data slice inside this repository (proposed).** Phase 1 is raised only for this scope. The application lives under `src/` (phase-gated) with its tests under `tests/product/`. Cheapest to govern: the hooks, policy, evidence recorder and CI already apply. Gives up the clean separation of a second repository.
2. **A separate repository `greenfuel-certification-platform`.** Cleaner deployment and access boundaries, but the phase flag, hooks and CI guards would have to be reproduced there, creating a remote resource that needs separate approval. The owner chose against it for now.
3. **Do nothing until every decision is answered.** No risk of pre-deciding anything, and no progress on interfaces and tests. Rejected by the owner's choice to proceed with a narrow slice.

## Decision
Proposed for the owner's signed approval. If approved, Phase 1a is bounded as follows. Anything outside these limits needs a new ADR.
1. **Data:** synthetic and clearly labelled SIMULATED. No real delivery, customer, vessel or certificate data (DATA-009).
2. **Execution:** local only. No Azure resource, sign-in, spend or deployment; Azure and deployment stay deferred (T36). `azureMutationDecision` stays `deny`.
3. **Signing:** a test-only software key, generated per test run, marked not production, so the slice decides nothing about key custody or the tamper-evidence mechanism (D-013, ADR 0018).
4. **Identity and roles:** a fixture identity provider and a minimal role model, so the slice decides nothing about the identity model or the quality-manager role (D-027, D-007).
5. **Boundaries:** no group plane and no cross-boundary flow; no real external system.
6. **Real versus simulated:** a component ledger in the application folder states, for every component, whether it uses a real service or a simulation, from the first commit.
7. **Structure:** application code under `src/`, tests under `tests/product/`, no change to the harness control plane except by the owner.
8. **Technology (lean, not a production decision):** TypeScript and Node for the API and domain, React or Next.js for the web app, PostgreSQL for persistence. The database used for tests is a separate owner decision: start Docker, approve an embedded-PostgreSQL package, or install natively. No dependency is added without review.
9. **Isolation risk:** the owner accepts that, until the dev container is built and verified, agents writing application code are protected only by hooks, which are a screen and not a boundary, and that the control-plane guard is report-only. This acceptance is the owner's to sign; it is not evidence that the risk is low.
10. **Stop condition:** work stops after the first vertical slice passes its acceptance tests. Nothing in the slice is evidence that any residency, certification or compliance requirement is met.

## Consequences
- Positive: interfaces, state machines, isolation and integrity can be tested early on a small scope; the harness governs the work.
- Negative: the slice may need rework when D-006, D-007, D-012, D-013 or D-027 are decided; a slice that looks like a product can tempt a decision by default.
- Obligations: the ledger of real versus simulated components, SIMULATED labels in every dataset and screen, and no claim beyond the scope above.
- Weakness to watch: the phase approval does not bind this scope, so the first commit of application code should carry a check that rejects Azure SDK dependencies and real-looking data identifiers.

## Revisit when
The architecture is approved or rejected; any open decision named above is answered; the dev container is built and verified; a second repository is wanted; or the slice would need data or a service outside the limits.

## Evidence
- [PHASE-1-BLOCKER-REPORT](../phase/PHASE-1-BLOCKER-REPORT.md) lists the gates and the owner's replies.
- No evidence exists that the slice has been built or that any gate has been opened by this ADR. It is Proposed and has no signed approval.

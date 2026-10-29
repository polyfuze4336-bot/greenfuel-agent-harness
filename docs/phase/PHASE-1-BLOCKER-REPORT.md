# Phase 1 blocker report: the application build has not been started

Date: 2026-10-29. Requested: begin implementing the Green-Fuel Bunkering Certification Platform in a new repository `greenfuel-certification-platform`, "using the approved architecture", and **not to proceed if critical architecture, sovereignty, security or phase-approval gates remain unresolved**.

**Result: STOPPED. No repository was created and no application code was written.** Several critical gates are closed, and the instruction itself says to report rather than proceed. This document lists each gate with its evidence, what would open it, and the decisions needed. Nothing here is an approval, and nothing was changed to make a gate look open.

## 1. A correction to the premise

The request refers to "the approved architecture". **The architecture is not approved.** [DES-0003](../architecture/designs/DES-0003-target-system-architecture.md) is Proposed, its review [RV-0003](../architecture/reviews/RV-0003-target-system-architecture.md) is **Blocked**, and ADRs 0016 to 0019 are **Proposed** (as are ADR 0004 and 0015). The owner's earlier "approve all" replies accepted process and scaffold ADRs (0001 to 0003, 0005 to 0014); they did not and could not approve these designs, because the gate forbids Accepting a Design ADR whose review is not Approved, and approval needs a named human decider that does not exist. This is stated in [09 Review and validation](../target-architecture/09-REVIEW-AND-VALIDATION.md) and in STATE.

## 2. Gate status

| # | Gate | Required to open | Current state | Evidence | Critical |
|---|---|---|---|---|---|
| G1 | **Phase raised** (HC-11, BR-009, ADR 0002) | A human raises the phase through an ADR, with signed approvals of the architecture class **and** the deployment class from different keys ([approval-gates](../../harness/approvals/approval-gates.cjs)) | **Phase 0.** The hook denies writes to application paths; `validate-approvals` reports phase 0 | `harness/policy/command-policy.json` (`"phase": 0`); EV-0071 | **Yes** |
| G2 | **Approver registry** | At least one enrolled approver of the right class, proof of possession, fingerprint confirmed by the owner | **Empty.** No approver is enrolled, so no signed approval of any class can exist. Chat text cannot satisfy a gate | `harness/policy/approvers.json`; `validate-approvals` output | **Yes** |
| G3 | **Architecture approved** | Named human decider and human reviewer; RV-0003 Approved at CP4; ADR 0016 to 0019 Accepted with a signed architecture approval | DES-0003 Proposed, RV-0003 **Blocked** (85 blocking reasons: 9 hard constraints Conditional, 50 Must requirements Partial or Unresolved, 7 critical questions unanswered, 3 perspectives not assessed, 16 open decisions on Must requirements) | EV-0068 | **Yes** |
| G4 | **Sovereignty decisions** (HC-01) | Ports and legal entities, the legal meaning of residency per port, hosting per port, approved cross-border flows | **Open:** D-003, D-009, D-010, D-011. Without them nothing can say where a cell runs or which data may leave | DECISION-REGISTER; RV-0003 | **Yes** for any real data; see section 5 for a synthetic-only slice |
| G5 | **Certificate and integrity design** (HC-03, HC-08) | What a certificate is, what "locally hosted" is local to, tamper-evidence and key-custody mechanism | **Open:** D-006, D-012, D-013. ADR 0018 fixes the required properties and does not choose a mechanism. The requested slice ends in a tamper-evident certificate record, so its design depends on these | ADR 0018 | **Yes** for production; partly for a labelled test mechanism |
| G6 | **Identity, roles and approval model** (HC-04, HC-09) | Identity provider scope, role model, the quality-manager role and deputies | **Open:** D-027, D-007, D-033. The slice requires role-based access and a quality-manager approval | RV-0003 | **Yes** |
| G7 | **Azure deployment gate** | Subscription, read-only identity, per-service verification, signed deployment approval | **Not requested and deferred by the owner (T36).** No Azure resource exists. Not a blocker for local work; a blocker for any Azure claim | TODO T36, T50 | No, by owner decision |
| G8 | **Execution isolation for agents writing application code** | Dev container built and its self-check passing; control-plane guard enforcing; signed commits | **Configured, not built or run.** Agents would write application code under the developer's own account, with the hook as the only control (a screen, not a boundary); the control-plane guard is report-only; no VS Code live validation was run | [ISOLATION](../security/ISOLATION.md), [LIVE-VALIDATION](../security/LIVE-VALIDATION.md); acceptance report CB-4 | **Yes** under the programme's own acceptance report |
| G9 | **Business-case inputs** | Measured baselines (D-034) | Scenario assumptions only; the model is a tool, not a validated case | [BUSINESS-VALUE-MODEL](../business/BUSINESS-VALUE-MODEL.md) | No for the slice; yes for funding |

The acceptance report's critical blockers CB-1 to CB-4 ([HARNESS-ACCEPTANCE-REPORT](../acceptance/HARNESS-ACCEPTANCE-REPORT.md)) are unchanged: no named decider or approver (CB-1), 37 baseline decisions open (CB-2), evaluation failures and blocked gates (CB-3), no OS isolation (CB-4).

## 3. Why I did not "start with a safe slice anyway"

- **The phase gate is a hard constraint, not a preference.** HC-11 rejects any design that requires application code before the phase is raised by a human. Writing the platform, even on synthetic data, is exactly that.
- **I cannot raise the phase for you.** A phase raise needs signed approvals bound to a document hash from enrolled keys of two classes. By design (hardening, workstream 3) text in a chat or a file cannot stand in for them, and the enrollment commands refuse to run non-interactively. If I edited the phase flag, I would be defeating the control the programme built, and the CI control-plane guard and evidence checks exist to detect that.
- **The slice would pre-decide open decisions.** A certificate record, a role model and an approval flow would force answers to D-006, D-012, D-013, D-027 and D-007 in code, and code tends to become the decision.
- **A separate repository does not move the gate.** The harness governs the programme, not one folder. Creating the repository also creates a remote resource, which needs the owner's explicit approval.

## 4. What opens the way: the shortest honest path

This is the minimum for a **narrowly scoped Phase 1a: a local, synthetic-data vertical slice with no Azure, no real data and no production claim.** Each step is yours; I will not perform any of them.

1. **Enroll yourself as an approver** on your own computer ([APPROVER-ENROLLMENT](../security/APPROVER-ENROLLMENT.md)): architecture and, for the phase raise, a deployment-class key. The registry warns that one person holding both is a weak separation of duties; a second person is better. Set up GitHub-verified signed commits and the control-plane owner list.
2. **Name a human decider and a human reviewer for DES-0003** (T3, T37, T48), and review the design, the threat model and the business model yourself. A model's review is not a substitute (RK-012).
3. **Decide the scope of Phase 1a in an ADR**, in these terms (suggested, for you to change): synthetic data only (DATA-009); local execution only; no Azure resource, sign-in or spend; ports are fictional and labelled SIMULATED; any signing uses a **test-only software key explicitly marked not production**, so the slice does not decide D-013; the slice's roles are a minimal fixture role model that does not decide D-027; the group plane and every cross-boundary flow are absent. This keeps HC-01 trivially satisfied (no real data exists) and leaves D-003, D-009, D-010, D-011, D-012 and D-013 genuinely open.
4. **Accept or reject the ADRs the slice rests on.** At least ADR 0016 (cell shape), ADR 0017 (deterministic core and bounded agents) and ADR 0018 (integrity properties) would need to be Accepted with a signed architecture approval, or the Phase 1a ADR must state that the slice builds against them as Proposed and carries the risk that they change.
5. **Raise the phase** by that ADR plus signed approvals (architecture and deployment classes, different keys), committed in a signed commit that the guard verifies.
6. **Decide isolation before agents write code (CB-4):** either build and verify the dev container (start Docker, run the self-check, see [ISOLATION](../security/ISOLATION.md)), or explicitly accept the risk of agents writing code under your account with hooks only, recorded as a decision.
7. **Approve the repository structure** (decision R in section 6).

## 5. Could a synthetic slice proceed without the sovereignty answers?

Yes in principle, and that is the reason step 3 is shaped as it is: with no real data, HC-01 has nothing to protect, and D-003, D-009 and D-010 do not need answers to write a local slice. They remain **mandatory before any real data, any Azure resource or any claim of residency**. Building the slice does not answer them, and nothing from it may be presented as evidence that a jurisdiction's rules are met.

## 6. Decisions requested

| # | Decision | Options | Why it is needed |
|---|---|---|---|
| R | Repository structure | (a) separate repository `greenfuel-certification-platform` as you asked, governed by the harness through a documented control-plane arrangement; (b) a folder in the harness repository; (c) another | A separate repository is cleaner for deployment and access, but the harness hooks, the policy phase flag and the CI guards live in the harness repository today and would need to be applied to the new one. Creating the repository is a remote action that needs your approval |
| S | Phase 1a scope | The scope in step 3, or your alternative | Without a written scope the phase cannot be raised safely |
| T | Technology lean for the slice (not a decision on production) | See section 7 | The request leaves the backend language open "according to engineering tradeoffs" |
| I | Isolation before coding | Build and verify the dev container, or accept the risk explicitly | CB-4 |
| A | Who approves | Names and keys for decider, reviewer and approvers | G2, G3 |
| D | Which open decisions to answer now versus consciously defer | D-006, D-007, D-012, D-013, D-027 for the slice; D-003, D-009, D-010, D-011 deferred as synthetic | G4 to G6 |

## 7. Engineering tradeoffs, prepared so the build can start quickly once unblocked

These are proposals for decision T, not choices. None has been implemented or verified.

| Area | Lean for a Phase 1a slice | Alternative | Tradeoff |
|---|---|---|---|
| Language and runtime | **TypeScript on Node for API, domain and workers; Next.js with React for the web app** | .NET for the API and deterministic calculation core; Python for calculation | One language and toolchain across API, contracts and UI keeps the slice small and the contracts shared (types generated from OpenAPI). .NET offers strong typing and decimal arithmetic for the calculation core and tight Azure integration; that choice matters most for the **calculation service** (HC-05) and can be made separately. Node 22 is already the harness runtime, so no new toolchain is introduced |
| Data store | PostgreSQL | Any other transactional store | Relational constraints, row-level security per shipowner, portable to a local cell (ADR 0019). **Local persistence tests need a real PostgreSQL.** Docker is not running on this machine, so the options are: start Docker; use an embedded PostgreSQL package for tests (a new dependency); or a native install. This needs your choice, and the harness's minimal-dependency principle means any package must be reviewed |
| Evidence store | Content-addressed files with immutable references (hash-named, write-once) behind an interface; a local filesystem implementation for the slice | Azure Blob Storage with immutability policies | The slice would **simulate** the blob store behind the production interface and say so |
| Messaging | An in-process queue behind an interface with idempotent consumers | Azure Service Bus | Same: simulated for the slice, with the idempotency and ordering rules tested for real |
| API contract | OpenAPI described first, versioned under a path prefix, with contract tests against it | Code-first | Contract-first suits the harness's evidence discipline |
| Auth | A fixture identity provider issuing signed test tokens with a role and a shipowner scope | Entra ID | Entra is a global service with an open residency question (D-027, D-033); the slice must not decide it |
| Browser testing | A browser test runner for one end-to-end flow | none | A new dependency that needs approval. A browser tool exists in the CLI for visual checks only |
| Frontend | Next.js only if the slice needs server rendering or routing; otherwise a plain React single-page app is smaller | Next.js | Justify against the premium-SaaS brief and the accessibility requirement; both work |
| Real versus simulated | Recorded in a file per component from the first commit | none | Required by the request |

### Proposed slice and tests (for step 3)

Delivery created, measurement received, evidence validated, certificate record generated, authorised customer views it. Tests: API contract, database persistence, cross-tenant isolation (shipowner B cannot reach A's certificate by any route), delivery state transitions (illegal transitions refused), evidence integrity (altered evidence detected), and one end-to-end browser flow. Every entity, label and dataset is marked SIMULATED. A component ledger records which components use real services and which are simulated. No Azure resource.

## 8. What was done in this turn

- Verified the gate state from the repository (phase 0, empty approver registry, ADRs Proposed, 37 open decisions).
- Wrote this report.
- **Not done, by design:** repository creation, application code, database schema, APIs, frontend, tests, any Azure action, any change to a gate.

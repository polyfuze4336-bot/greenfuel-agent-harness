# Next-phase implementation plan

This is a plan, not an authorisation. Nothing below starts until the owner raises the phase through an ADR (HC-11, TODO T36), and nothing here creates an Azure resource. Steps are ordered by dependency. No effort, duration or cost is estimated, because no basis for an estimate exists.

## Phase A: close the harness gaps (still Phase 0, no application code)

| Step | Work | Exit evidence | Needs |
|---|---|---|---|
| A1 | Name the deciders and approvers, register public keys through a reviewed change, and create the first real signed approval | The approver registry is not empty and a real approval verifies | The owner (T3, T13) |
| A2 | Answer or defer the M1 decisions that block hard constraints: D-003, D-009, D-010, D-011, D-013, D-018, D-019, D-020, D-021 | Decided decision records with Accepted ADRs; the gate output changes | The owner and counsel (T31, T34) |
| A3 | Isolate agent sessions: dev container, separate account or VM without Azure and Git credentials; move loop checks inside it | A negative test that a check in the sandbox cannot read the host credentials or change the runner | The owner (T15, R15) |
| A4 | Make branch protection possible and apply it | The protection check reports the specification applied instead of unavailable | The owner (T14) |
| A5 | Remediate the three evaluation findings: ADR 0013's effective-period and timestamp rules in the methodology and lineage contracts | EVAL-PRC-DAT-005 and EVAL-PRC-DAT-006 pass in a committed run; the DAT-006 rule is already implemented in the ingestion contract | Principal architect (R16) |
| A6 | Observe in VS Code chat: agent hooks, subagent restriction, MCP trust prompts, output hook, context profiles and the review roles | Recorded observations and live-test results | The owner (T8, T9, T12, R11, R12) |
| A7 | Authenticate human memory writers with signed approvals | Memory approvals verified against the registry | A1 (R14) |
| A8 | Decide the audit scope, retention and an external anchor | An anchored audit chain | The owner (T16) |

## Phase B: complete the design set (still no code)

Sibling designs, each through the design gate with a human decider, in this order (roadmap R13): certificate hosting and signing; edge security and platform; identity and roles; customer isolation; retention and recovery; non-production environments; then the Azure reference architecture (R17, TODO T35).

| Step | Work | Exit evidence |
|---|---|---|
| B1 | Add batch signing, device enrolment and revocation, quarantine of unauthenticated batches, an external anchor, quotas and an overload rule to the ingestion contract, once D-013 is decided | Contract tests extended; DES-0002 trace rows move from Partial |
| B2 | Per-port flow inventory F-01 to F-15 for the first port in scope | A completed inventory with configuration evidence and a negative test per flow |
| B3 | Verify Azure region and service availability per jurisdiction from authoritative sources | Dated, sourced availability table; PV-04 assessable |
| B4 | Approve or reject DES-0001 and DES-0002 through the gate with a human decider | Gate Approvable and ADR 0004 and ADR 0015 decided |
| B5 | Obtain sourced availability, recovery, latency and volume targets | Decisions D-031 and D-032 answered; the pending reliability and performance tests become runnable |

## Phase C: raise the phase and begin the build (requires an ADR from the owner)

1. Add build-lane agents, test-first practice, coding-style and observability instructions, and a bounded-iteration rule (roadmap R8).
2. Build the edge capture component and the cell ingestion service against the contract as the acceptance oracle. First evidence: the contract tests pass against the real components and a controlled disconnection test.
3. Build the deterministic calculation services with versioned methodology bundles, reproducible results and traceability to the exact version.
4. Build the five business agents under `src/` with their own identities and permissions, separate from the coding harness, with the production-agent evaluation set (red-team scenarios RT-01 to RT-11 against the real agents). Gate G5 depends on these.

## Phase D: Azure (requires explicit approval for every step)

| Step | Work | Gate |
|---|---|---|
| D1 | Create the scoped, least-privilege identities, custom role, locks and policy | DG-01 to DG-05, owner approval, named subscription (T17, T32, T33) |
| D2 | Read-only environment discovery with the approved identity | Approval of the sign-in; results recorded as evidence |
| D3 | Deploy to non-production only, from reviewed Infrastructure as Code, with a signed approval | DG-06 to DG-10 records |
| D4 | Smoke and integration tests, monitoring and recovery exercised | DG-11, DG-12 |
| D5 | Production deployment | Never automatic. A separate human approval and passing gates G6 and G7 |

## Entry criteria for Phase C

All of the following, each shown by evidence: A1, A2 (for the decisions the first component depends on), A3, A5 and B4 complete; no critical gate failure for G1 to G3; the owner's ADR raising the phase.

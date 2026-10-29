# 12. Data movement and residency validation

Status: **Phase 0, proposed, 2026-10-29.** This document does two things: it records the **designed** data movement between edge, cell and group plane, and it defines the **validation procedure** that must be run against every cell before any claim of residency. **No validation has been run. No Azure resource exists. Nothing here establishes that any port's residency requirement is met.**

A region name is not residency proof (HC-01, D-009). What "within the jurisdiction" covers is itself an open legal question for each port (D-009); this document assumes nothing about it.

## 1. Designed data movement

Each row is a flow the design intends to allow, a flow it intends to forbid, or a flow that is undecided. The class ids refer to the [data classification](../context/DATA-CLASSIFICATION.md); whether a class is bound to its jurisdiction is that document's call and the legal reading of D-009, not this one's.

| Flow | From to | Data | Design position | Needs |
|---|---|---|---|---|
| F-1 | Device to edge buffer | Signed raw events | Allowed, inside the jurisdiction, store-and-forward | Device registry, signing, local time source (D-021) |
| F-2 | Edge buffer to cell verifier | Signed raw events, in batches, idempotent | Allowed, inside the jurisdiction | Link may be intermittent (HC-07); retries are duplicates, not new events |
| F-3 | Cell verifier to cell evidence store and ledger | Events, receipts, evidence hashes | Allowed, inside the jurisdiction | Append-only, tamper-evident |
| F-4 | Cell to cell backup and replica | Evidence, ledger, certificates | Allowed **only** to a target inside the jurisdiction | Placement check (SV-01); real validation (section 3) |
| F-5 | Cell to cell log and diagnostic store | Security and operational logs | Allowed, inside the jurisdiction; export only on an approved flow | No bound content in anything that leaves (SV-02) |
| F-6 | Cell agents to the inference endpoint | Prompts that may contain delivery data | Allowed only to an endpoint in the jurisdiction whose processing location is verified | D-028; SV-05 |
| F-7 | Cell to group plane | Certificate metadata, hashes, mass-balance totals | **Undecided.** Each item needs a class and an approved-flow entry with a legal basis | D-011; SV-03 |
| F-8 | Group plane to cell | Signed methodology versions, policy bundles | Allowed; signed, verified at the cell | EM-01, TM-18 |
| F-9 | Cell to shipowner portal | The shipowner's own certificates and evidence | Allowed; per-tenant | IS-02 to IS-08 |
| F-10 | Cell to certification body | Approved filings | Allowed only after quality-manager approval, via the controlled submitter | CL-08 |
| F-11 | Any operator or vendor path into a cell from outside | Administration, support | **Forbidden by default**; break-glass approved inside the jurisdiction | SV-04 |
| F-12 | Deployment pipeline to a cell | Infrastructure and application changes | Allowed through scoped deployment identities; must not be a way to read cell data | TM-33 |
| F-13 | Real data to any non-production environment | Delivery or customer data | **Forbidden**; synthetic or approved-masked data only | DATA-009, TM-27 |

## 2. How the candidate checker relates

The [placement checker](../../harness/contracts/sovereignty-placement-contract.mjs) evaluates a **declared** manifest of resources and flows against rules PL-00 to PL-10 (see [10](10-CONTROL-MATRIX.md), section 1). It is useful for two things: stating the rules precisely, and failing a deployment plan that declares an offshore replica, an undeclared geo-pair or an unapproved flow. It cannot detect a manifest that is wrong. The fixtures in [its tests](../../tests/sovereignty-placement-contract.test.mjs) are synthetic.

## 3. Validation procedure (per cell, before any residency claim)

Run only after the owner approves a subscription and a deployment for that cell (Azure deployment is deferred on the [TODO list](../state/TODO.md); the phase gate is open item T53). Each step produces evidence recorded with the [evidence recorder](../evidence/README.md); a step without recorded output is **not done**.

| Step | What to check | How | Evidence | Pass means |
|---|---|---|---|---|
| V-1 | Every resource that can hold bound data, and where it is | Azure Resource Graph, [01-resources-by-location.kql](../../infra/discovery/01-resources-by-location.kql) | Query output, subscription id, time | Every location is on the cell's approved list |
| V-2 | Replication and redundancy settings | [02-exposure-and-replication.kql](../../infra/discovery/02-exposure-and-replication.kql) plus per-service checks of the redundancy option and the paired region | Output; for each service the setting and the pair | No geo-redundant copy leaves the jurisdiction. A resource missing from the output is **not** shown safe (the query says so) |
| V-3 | Backups | Per store: backup vault or built-in backup, its region, its redundancy | Settings export | Vault and copies inside the jurisdiction |
| V-4 | Logs and diagnostics | Diagnostic settings of every resource; the workspace region; any export rule | Settings export and workspace location | No bound content in a workspace or sink outside the jurisdiction |
| V-5 | Support and administration | Role assignments ([03-broad-role-assignments.kql](../../infra/discovery/03-broad-role-assignments.kql)), vendor support terms, break-glass design | Output and contract terms | No standing access from outside; break-glass approved and logged inside |
| V-6 | Policy | [04-policy-assignments.kql](../../infra/discovery/04-policy-assignments.kql): allowed-locations and no-public-access policies, their scope and effect | Output | Policies exist, assigned at the cell scope, effect is deny rather than audit |
| V-7 | Inference location | Provider documentation for the exact deployment type and a recorded test showing where processing occurs | Documentation reference and test record | The processing location is verified for that deployment type (D-028) |
| V-8 | Network egress | Effective routes, firewall or private-endpoint configuration, and a test of an attempted egress | Configuration export, test record | Only approved flows leave; each has an approved-flow entry |
| V-9 | Keys | Key store region, who can use or export keys | Settings export | Signing and encryption keys held under local control (SEC-011, D-013; verification without outside calls, SEC-007) |
| V-10 | Disaster recovery | DR target region or site and what is replicated there | Design and settings export | DR site is inside the jurisdiction, or the cell accepts a documented, approved loss of availability |
| V-11 | Metadata and derived data | Which derived data leaves, under which approved flow (D-011) | Flow register | Every cross-boundary item is a listed, approved class |
| V-12 | Drift | Re-run V-1 to V-6 on a schedule and after every change | Scheduled query results | No new finding; any finding opens an incident |

## 4. Result states

| State | Meaning |
|---|---|
| NOT RUN | The step has not been executed. **This is the state of every step today.** |
| PASS | Executed against live resources and the pass condition met, with recorded output |
| FAIL | Executed and a finding exists |
| INCONCLUSIVE | A resource or property could not be inspected; this is not a pass |
| BLOCKED | A prerequisite is missing (no subscription, no approval, no legal reading of D-009) |

A cell has **no residency status** until V-1 to V-11 are PASS for it, the legal reading in D-009 exists for its port, and an authorised human has accepted the result. Even then the result is a technical finding. It is not a legal opinion.

## 5. Port-by-port status

The port list and the in-jurisdiction hosting options are in the [sovereignty deployment matrix](../azure/SOVEREIGNTY-DEPLOYMENT-MATRIX.md), which is itself unverified. For every port the status here is:

| Item | Status |
|---|---|
| Legal reading of "within the jurisdiction" (D-009) | Open |
| Hosting model (D-010) | Open |
| Validation steps V-1 to V-12 | NOT RUN |
| Residency claim | **None made** |

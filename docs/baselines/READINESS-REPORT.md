# Build-readiness report

Generated from commit `721c7313d17c422ed78fef3a177797383b0cbb4f`. Policy `e6fdd8a36840`. **Review-record signatures were not checked** (the signing key is not available here); the hash chain and enrollment were.

Derived file: regenerate with `node apps/architecture-studio/scripts/baseline.ts report --write`. It states what is true at that commit and authorizes nothing.

Register: 57 decisions, 12 approved, 45 not yet decided, 0 rejected, 0 deferred, 0 superseded. Requirements: 99 (80 Must).

| Area | Stage | Ready | Blockers |
|---|---|---|---|
| application | phase-1a | **no** | 3 |
| infrastructure | production | **no** | 24 |
| deployment | production | **no** | 24 |

## Application code and its tests (`application`)

Stage: Phase 1a: local, synthetic-data vertical slice (ADR 0020). Paths: `^src/`, `^tests/product/`.

| Measure | Count | Blocks this area | Members |
|---|---|---|---|
| Required decisions | 1 | no | ADR-0020 |
| Approved | 0 | no | - |
| Not yet decided | 1 | **yes** | ADR-0020 |
| Rejected, redesign required | 0 | would | - |
| Deferred and required | 0 | would | - |
| Unresolved critical assumptions | 0 | would | - |
| Outstanding security approvals | 0 | would | - |
| Missing architecture evidence | 1 | no | ADR-0020 |
| Must requirements without a decision | 3 | no | BR-009, DATA-003, AGT-009 |
| Approved decisions without validation | 0 | no | - |
| Blocking tasks | 1 | no | T14 |

**Why this area is blocked**

1. Gate "phase-raised": The phase is 0. Implementation is not unlocked until a human raises it with signed architecture and deployment approvals. *To unblock:* A human raises the phase with signed architecture and deployment approvals (harness/scripts/approval.mjs). This capability does not do that.
2. Gate "approver-registry": No approver with an architecture-class key is enrolled, so no baseline can be authorized and no signed approval of that class can exist. *To unblock:* Enroll an architecture-class approver (docs/security/APPROVER-ENROLLMENT.md).
3. Gate "scope-adr": ADR-0020 is Proposed. ADR status line says Proposed. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.

## Infrastructure as code and Azure configuration (`infrastructure`)

Stage: Production architecture: the full set of gates. Paths: `^infra/`, `^\.azure/`, `^azure\.yaml$`, `^Dockerfile$`, `\.bicep$`, `\.bicepparam$`, `\.tf$`, `\.tfvars$`.

| Measure | Count | Blocks this area | Members |
|---|---|---|---|
| Required decisions | 41 | no | ADR-0016, ADR-0017, ADR-0018, ADR-0019, D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-008, D-009, D-010, D-011, D-… |
| Approved | 0 | no | - |
| Not yet decided | 41 | **yes** | ADR-0016, ADR-0017, ADR-0018, ADR-0019, D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-008, D-009, D-010, D-011, D-… |
| Rejected, redesign required | 0 | would | - |
| Deferred and required | 0 | would | - |
| Unresolved critical assumptions | 24 | **yes** | AS-002, AS-003, AS-004, AS-005, AS-006, AS-007, AS-008, AS-009, AS-010, AS-011, AS-012, AS-013, AS-014, AS-015, AS-016,… |
| Outstanding security approvals | 9 | **yes** | ADR-0016, ADR-0017, ADR-0018, D-008, D-013, D-021, D-027, D-030, D-036 |
| Missing architecture evidence | 37 | **yes** | D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-008, D-009, D-010, D-011, D-012, D-013, D-014, D-015, D-016, D-017, … |
| Must requirements without a decision | 3 | **yes** | BR-009, DATA-003, AGT-009 |
| Approved decisions without validation | 0 | would | - |
| Blocking tasks | 1 | **yes** | T14 |

**Why this area is blocked**

1. Gate "phase-raised": The phase is 0. Implementation is not unlocked until a human raises it with signed architecture and deployment approvals. *To unblock:* A human raises the phase with signed architecture and deployment approvals (harness/scripts/approval.mjs). This capability does not do that.
2. Gate "approver-registry": No approver with an architecture-class key is enrolled, so no baseline can be authorized and no signed approval of that class can exist. *To unblock:* Enroll an architecture-class approver (docs/security/APPROVER-ENROLLMENT.md).
3. Gate "branch-protection": Branch protection is not in force on main (TODO T14), so a CI gate can be bypassed by anyone who can push. *To unblock:* Turn on branch protection or a ruleset on main with the validate check and the architecture gate required (TODO T14).
4. Gate "architecture-approved": ADR-0016 is Blocked. ADR status line says Proposed and the design review it names is declared Blocked. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
5. Gate "architecture-approved": ADR-0017 is Blocked. ADR status line says Proposed and the design review it names is declared Blocked. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
6. Gate "architecture-approved": ADR-0018 is Blocked. ADR status line says Proposed and the design review it names is declared Blocked. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
7. Gate "architecture-approved": ADR-0019 is Blocked. ADR status line says Proposed and the design review it names is declared Blocked. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
8. Gate "architecture-approved": Design review RV-0003 is Blocked. It must be Approved with a signed architecture approval. *To unblock:* Approve the design review through its gate, with a signed architecture approval.
9. Gate "sovereignty": D-003 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
10. Gate "sovereignty": D-009 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
11. Gate "sovereignty": D-010 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
12. Gate "sovereignty": D-011 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
13. Gate "certificate-integrity": D-006 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
14. Gate "certificate-integrity": D-012 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
15. Gate "certificate-integrity": D-013 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
16. Gate "identity-roles": D-007 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
17. Gate "identity-roles": D-027 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
18. Gate "identity-roles": D-033 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
19. Not yet decided: D-001, D-002, D-004, D-005, D-008, D-014, D-015, D-016, D-017, D-018, D-019, D-020, D-021, D-022, D-023, D-024, D-025, D-026, D-028, D-029, D-030, D-031, D-032, D-034, D-035, D-036, D-037. Required and Proposed, Pending Review, Blocked, Open or missing.
20. Unresolved critical assumptions: 24 (AS-002, AS-003, AS-004, AS-005, AS-006, AS-007, AS-008, AS-009, AS-010, AS-011, AS-012, AS-013, ...). Unresolved, and cited by a required decision or listed as critical in the policy.
21. Outstanding security approvals: 9 (ADR-0016, ADR-0017, ADR-0018, D-008, D-013, D-021, D-027, D-030, D-036). Required, not approved, and either in the security approval domain or naming a security role as approver.
22. Missing architecture evidence: 37 (D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-008, D-009, D-010, D-011, D-012, ...). Required decisions that cite no evidence record, or cite one that does not exist or whose only runs failed.
23. Must requirements without a decision: 3 (BR-009, DATA-003, AGT-009). No decision appears against the requirement in the traceability, and no decision lists it as blocked by it. Not limited to the area.
24. Blocking tasks: 1 (T14). Unresolved task, roadmap, backlog, validation or security items reached by requires links from the gates, or on the build path of the Work Queue analysis.

## Deployment and release workflows (`deployment`)

Stage: Production architecture: the full set of gates. Paths: `^\.github/workflows/(deploy|release)[^/]*\.ya?ml$`.

| Measure | Count | Blocks this area | Members |
|---|---|---|---|
| Required decisions | 41 | no | ADR-0016, ADR-0017, ADR-0018, ADR-0019, D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-008, D-009, D-010, D-011, D-… |
| Approved | 0 | no | - |
| Not yet decided | 41 | **yes** | ADR-0016, ADR-0017, ADR-0018, ADR-0019, D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-008, D-009, D-010, D-011, D-… |
| Rejected, redesign required | 0 | would | - |
| Deferred and required | 0 | would | - |
| Unresolved critical assumptions | 24 | **yes** | AS-002, AS-003, AS-004, AS-005, AS-006, AS-007, AS-008, AS-009, AS-010, AS-011, AS-012, AS-013, AS-014, AS-015, AS-016,… |
| Outstanding security approvals | 9 | **yes** | ADR-0016, ADR-0017, ADR-0018, D-008, D-013, D-021, D-027, D-030, D-036 |
| Missing architecture evidence | 37 | **yes** | D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-008, D-009, D-010, D-011, D-012, D-013, D-014, D-015, D-016, D-017, … |
| Must requirements without a decision | 3 | **yes** | BR-009, DATA-003, AGT-009 |
| Approved decisions without validation | 0 | would | - |
| Blocking tasks | 1 | **yes** | T14 |

**Why this area is blocked**

1. Gate "phase-raised": The phase is 0. Implementation is not unlocked until a human raises it with signed architecture and deployment approvals. *To unblock:* A human raises the phase with signed architecture and deployment approvals (harness/scripts/approval.mjs). This capability does not do that.
2. Gate "approver-registry": No approver with an architecture-class key is enrolled, so no baseline can be authorized and no signed approval of that class can exist. *To unblock:* Enroll an architecture-class approver (docs/security/APPROVER-ENROLLMENT.md).
3. Gate "branch-protection": Branch protection is not in force on main (TODO T14), so a CI gate can be bypassed by anyone who can push. *To unblock:* Turn on branch protection or a ruleset on main with the validate check and the architecture gate required (TODO T14).
4. Gate "architecture-approved": ADR-0016 is Blocked. ADR status line says Proposed and the design review it names is declared Blocked. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
5. Gate "architecture-approved": ADR-0017 is Blocked. ADR status line says Proposed and the design review it names is declared Blocked. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
6. Gate "architecture-approved": ADR-0018 is Blocked. ADR status line says Proposed and the design review it names is declared Blocked. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
7. Gate "architecture-approved": ADR-0019 is Blocked. ADR status line says Proposed and the design review it names is declared Blocked. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
8. Gate "architecture-approved": Design review RV-0003 is Blocked. It must be Approved with a signed architecture approval. *To unblock:* Approve the design review through its gate, with a signed architecture approval.
9. Gate "sovereignty": D-003 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
10. Gate "sovereignty": D-009 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
11. Gate "sovereignty": D-010 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
12. Gate "sovereignty": D-011 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
13. Gate "certificate-integrity": D-006 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
14. Gate "certificate-integrity": D-012 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
15. Gate "certificate-integrity": D-013 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
16. Gate "identity-roles": D-007 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
17. Gate "identity-roles": D-027 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
18. Gate "identity-roles": D-033 is Pending Review. Register status is Open: an answer is awaited and no option is chosen. *To unblock:* Decide it in the Studio review workflow, or by an ADR with a signed approval.
19. Not yet decided: D-001, D-002, D-004, D-005, D-008, D-014, D-015, D-016, D-017, D-018, D-019, D-020, D-021, D-022, D-023, D-024, D-025, D-026, D-028, D-029, D-030, D-031, D-032, D-034, D-035, D-036, D-037. Required and Proposed, Pending Review, Blocked, Open or missing.
20. Unresolved critical assumptions: 24 (AS-002, AS-003, AS-004, AS-005, AS-006, AS-007, AS-008, AS-009, AS-010, AS-011, AS-012, AS-013, ...). Unresolved, and cited by a required decision or listed as critical in the policy.
21. Outstanding security approvals: 9 (ADR-0016, ADR-0017, ADR-0018, D-008, D-013, D-021, D-027, D-030, D-036). Required, not approved, and either in the security approval domain or naming a security role as approver.
22. Missing architecture evidence: 37 (D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-008, D-009, D-010, D-011, D-012, ...). Required decisions that cite no evidence record, or cite one that does not exist or whose only runs failed.
23. Must requirements without a decision: 3 (BR-009, DATA-003, AGT-009). No decision appears against the requirement in the traceability, and no decision lists it as blocked by it. Not limited to the area.
24. Blocking tasks: 1 (T14). Unresolved task, roadmap, backlog, validation or security items reached by requires links from the gates, or on the build path of the Work Queue analysis.


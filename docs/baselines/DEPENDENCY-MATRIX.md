# Dependency matrix

Commit `721c7313d17c422ed78fef3a177797383b0cbb4f`. Derived; authorizes nothing.

## Areas and the gates they need

| Gate | application | infrastructure | deployment |
|---|---|---|---|
| phase-raised | **UNMET** | **UNMET** | **UNMET** |
| approver-registry | **UNMET** | **UNMET** | **UNMET** |
| scope-adr | **UNMET** | - | - |
| branch-protection | - | **UNMET** | **UNMET** |
| architecture-approved | - | **UNMET** | **UNMET** |
| sovereignty | - | **UNMET** | **UNMET** |
| certificate-integrity | - | **UNMET** | **UNMET** |
| identity-roles | - | **UNMET** | **UNMET** |

`-` means the area does not need that gate at its stage.

## Gates and the decisions behind them

| Gate | Needs | Status |
|---|---|---|
| phase-raised | harness check | UNMET |
| approver-registry | harness check | UNMET |
| scope-adr | ADR-0020 | Proposed |
| branch-protection | harness check | UNMET |
| architecture-approved | ADR-0016 | Blocked |
| architecture-approved | ADR-0017 | Blocked |
| architecture-approved | ADR-0018 | Blocked |
| architecture-approved | ADR-0019 | Blocked |
| architecture-approved | RV-0003 (design review) | not approved |
| sovereignty | D-003 | Pending Review |
| sovereignty | D-009 | Pending Review |
| sovereignty | D-010 | Pending Review |
| sovereignty | D-011 | Pending Review |
| certificate-integrity | D-006 | Pending Review |
| certificate-integrity | D-012 | Pending Review |
| certificate-integrity | D-013 | Pending Review |
| identity-roles | D-007 | Pending Review |
| identity-roles | D-027 | Pending Review |
| identity-roles | D-033 | Pending Review |

## Required decisions: application

| Decision | Status | Approved | Required by | Domain | Requires |
|---|---|---|---|---|---|
| ADR-0020 | Proposed | no | gate scope-adr | architecture | - |

## Required decisions: infrastructure

| Decision | Status | Approved | Required by | Domain | Requires |
|---|---|---|---|---|---|
| ADR-0016 | Blocked | no | gate architecture-approved | regulatory | RV-0003 |
| ADR-0017 | Blocked | no | gate architecture-approved | regulatory | RV-0003 |
| ADR-0018 | Blocked | no | gate architecture-approved | regulatory | RV-0003 |
| ADR-0019 | Blocked | no | gate architecture-approved | architecture | RV-0003 |
| D-001 | Pending Review | no | needed by M1 | regulatory | - |
| D-002 | Pending Review | no | needed by M1 | regulatory | - |
| D-003 | Pending Review | no | gate sovereignty; needed by M1 | architecture | - |
| D-004 | Pending Review | no | needed by M1 | architecture | - |
| D-005 | Pending Review | no | needed by M1 | unclassified | - |
| D-006 | Pending Review | no | gate certificate-integrity; needed by M1 | regulatory | - |
| D-007 | Pending Review | no | gate identity-roles; needed by M1 | architecture | - |
| D-008 | Pending Review | no | needed by M1 | security | - |
| D-009 | Pending Review | no | gate sovereignty; needed by M1 | regulatory | - |
| D-010 | Pending Review | no | gate sovereignty; needed by M2 | architecture | - |
| D-011 | Pending Review | no | gate sovereignty; needed by M2 | regulatory | - |
| D-012 | Pending Review | no | gate certificate-integrity; needed by M1 | regulatory | - |
| D-013 | Pending Review | no | gate certificate-integrity; needed by M2 | security | - |
| D-014 | Pending Review | no | needed by M2 | regulatory | - |
| D-015 | Pending Review | no | needed by M1 | unclassified | - |
| D-016 | Pending Review | no | needed by M2 | regulatory | - |
| D-017 | Pending Review | no | needed by M2 | unclassified | - |
| D-018 | Pending Review | no | needed by M2 | architecture | - |
| D-019 | Pending Review | no | needed by M1 | unclassified | - |
| D-020 | Pending Review | no | needed by M1 | regulatory | - |
| D-021 | Pending Review | no | needed by M2 | security | - |
| D-022 | Pending Review | no | needed by M1 | regulatory | - |
| D-023 | Pending Review | no | needed by M1 | regulatory | - |
| D-024 | Pending Review | no | needed by M1 | regulatory | - |
| D-025 | Pending Review | no | needed by M2 | regulatory | - |
| D-026 | Pending Review | no | needed by M2 | regulatory | - |
| D-027 | Pending Review | no | gate identity-roles; needed by M2 | security | - |
| D-028 | Pending Review | no | needed by M2 | architecture | - |
| D-029 | Pending Review | no | needed by M2 | regulatory | - |
| D-030 | Pending Review | no | needed by M2 | regulatory | - |
| D-031 | Pending Review | no | needed by M2 | architecture | - |
| D-032 | Pending Review | no | needed by M2 | unclassified | - |
| D-033 | Pending Review | no | gate identity-roles; needed by M2 | architecture | - |
| D-034 | Pending Review | no | needed by M1 | architecture | - |
| D-035 | Pending Review | no | needed by M2 | architecture | - |
| D-036 | Pending Review | no | needed by M2 | security | - |
| D-037 | Pending Review | no | needed by M2 | architecture | - |

Design reviews required: RV-0003 (not approved).

## Required decisions: deployment

| Decision | Status | Approved | Required by | Domain | Requires |
|---|---|---|---|---|---|
| ADR-0016 | Blocked | no | gate architecture-approved | regulatory | RV-0003 |
| ADR-0017 | Blocked | no | gate architecture-approved | regulatory | RV-0003 |
| ADR-0018 | Blocked | no | gate architecture-approved | regulatory | RV-0003 |
| ADR-0019 | Blocked | no | gate architecture-approved | architecture | RV-0003 |
| D-001 | Pending Review | no | needed by M1 | regulatory | - |
| D-002 | Pending Review | no | needed by M1 | regulatory | - |
| D-003 | Pending Review | no | gate sovereignty; needed by M1 | architecture | - |
| D-004 | Pending Review | no | needed by M1 | architecture | - |
| D-005 | Pending Review | no | needed by M1 | unclassified | - |
| D-006 | Pending Review | no | gate certificate-integrity; needed by M1 | regulatory | - |
| D-007 | Pending Review | no | gate identity-roles; needed by M1 | architecture | - |
| D-008 | Pending Review | no | needed by M1 | security | - |
| D-009 | Pending Review | no | gate sovereignty; needed by M1 | regulatory | - |
| D-010 | Pending Review | no | gate sovereignty; needed by M2 | architecture | - |
| D-011 | Pending Review | no | gate sovereignty; needed by M2 | regulatory | - |
| D-012 | Pending Review | no | gate certificate-integrity; needed by M1 | regulatory | - |
| D-013 | Pending Review | no | gate certificate-integrity; needed by M2 | security | - |
| D-014 | Pending Review | no | needed by M2 | regulatory | - |
| D-015 | Pending Review | no | needed by M1 | unclassified | - |
| D-016 | Pending Review | no | needed by M2 | regulatory | - |
| D-017 | Pending Review | no | needed by M2 | unclassified | - |
| D-018 | Pending Review | no | needed by M2 | architecture | - |
| D-019 | Pending Review | no | needed by M1 | unclassified | - |
| D-020 | Pending Review | no | needed by M1 | regulatory | - |
| D-021 | Pending Review | no | needed by M2 | security | - |
| D-022 | Pending Review | no | needed by M1 | regulatory | - |
| D-023 | Pending Review | no | needed by M1 | regulatory | - |
| D-024 | Pending Review | no | needed by M1 | regulatory | - |
| D-025 | Pending Review | no | needed by M2 | regulatory | - |
| D-026 | Pending Review | no | needed by M2 | regulatory | - |
| D-027 | Pending Review | no | gate identity-roles; needed by M2 | security | - |
| D-028 | Pending Review | no | needed by M2 | architecture | - |
| D-029 | Pending Review | no | needed by M2 | regulatory | - |
| D-030 | Pending Review | no | needed by M2 | regulatory | - |
| D-031 | Pending Review | no | needed by M2 | architecture | - |
| D-032 | Pending Review | no | needed by M2 | unclassified | - |
| D-033 | Pending Review | no | gate identity-roles; needed by M2 | architecture | - |
| D-034 | Pending Review | no | needed by M1 | architecture | - |
| D-035 | Pending Review | no | needed by M2 | architecture | - |
| D-036 | Pending Review | no | needed by M2 | security | - |
| D-037 | Pending Review | no | needed by M2 | architecture | - |

Design reviews required: RV-0003 (not approved).


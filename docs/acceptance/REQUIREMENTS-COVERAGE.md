<!-- generated: node harness/scripts/acceptance-reports.mjs --write -->
# Requirements coverage

Generated from the requirements baseline, the design trace tables, the ADRs, the evaluation catalogue and the committed evaluation run `EVRUN-9b6110b026` (commit `587d609`). Do not edit: `validate-harness` regenerates this file and fails on any difference.

**What a class means.** It says what a test that actually ran has shown. It never says a requirement is satisfied. A passing test of a candidate contract or of the harness shows that contract or harness behaves as the test states; it does not show that a production system meets the requirement, and no production system exists. TESTED AND PASSING is therefore the strongest class that can exist today.

| Class | Meaning |
|---|---|
| TESTED AND PASSING | At least one executable evaluation test names the requirement and every one of them passed in the committed run |
| TESTED, A TEST FAILS | An executable test names it and failed. This is a finding, not a defect of the framework |
| TESTED, A TEST BLOCKED | An executable test names it and did not run because a gate was not met |
| PENDING TEST ONLY | Only a production-agent test names it, and that test cannot run because no agent or application exists |
| DESIGNED ONLY | A design trace row exists and no test names it |
| SPECIFIED ONLY | The requirement is in the baseline and nothing else refers to it |

## Summary (99 requirements, 80 Must)

| Class | All | Must |
|---|---|---|
| TESTED AND PASSING | 29 | 28 |
| TESTED, A TEST FAILS | 9 | 9 |
| TESTED, A TEST BLOCKED | 2 | 2 |
| PENDING TEST ONLY | 12 | 8 |
| DESIGNED ONLY | 12 | 9 |
| SPECIFIED ONLY | 35 | 24 |

## Requirement by requirement

| ID | Priority | Capabilities | Hard constraints | Design trace | ADRs naming it | Executable tests (latest run) | Pending tests | Class |
|---|---|---|---|---|---|---|---|---|
| BR-001 | Must | DEA,EAA,DRA,MBA,CCA | - | - | - | - | - | **SPECIFIED ONLY** |
| BR-002 | Must | XC | - | DES-0001 Partial; DES-0002 Partial | ADR-0004, ADR-0015 | - | - | **DESIGNED ONLY** |
| BR-003 | Must | DRA | - | - | - | - | - | **SPECIFIED ONLY** |
| BR-004 | Must | CCA | HC-02 | - | - | - | - | **SPECIFIED ONLY** |
| BR-005 | Must | MBA | - | - | - | - | - | **SPECIFIED ONLY** |
| BR-006 | Must | SOV | HC-01 | DES-0001 Partial; DES-0002 Partial | ADR-0004, ADR-0015 | - | - | **DESIGNED ONLY** |
| BR-007 | Must | EDG | HC-07 | DES-0001 Addressed; DES-0002 Partial | ADR-0004, ADR-0015 | - | - | **DESIGNED ONLY** |
| BR-008 | Should | XC | HC-12 | - | - | - | PRD-CST-001 | **PENDING TEST ONLY** |
| BR-009 | Must | XC | HC-11 | - | - | HRN-AZR-001 PASS; HRN-AZR-002 PASS; HRN-AZR-004 PASS; HRN-AZR-005 PASS; PRC-SEC-003 PASS; PRC-AZR-001 BLOCKED | PRD-FUN-001; PRD-SEC-003; PRD-AZR-002 | **TESTED, A TEST BLOCKED** |
| FR-001 | Must | DEA,EDG | - | DES-0001 Addressed; DES-0002 Partial | ADR-0004, ADR-0015 | - | - | **DESIGNED ONLY** |
| FR-002 | Must | DEA | - | DES-0002 Partial | ADR-0015 | - | - | **DESIGNED ONLY** |
| FR-003 | Must | DEA | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-004 | Must | DEA | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-005 | Must | DEA | HC-08 | - | - | - | - | **SPECIFIED ONLY** |
| FR-006 | Must | DEA,EDG | HC-07 | DES-0001 Addressed; DES-0002 Partial | ADR-0004, ADR-0015 | PRC-DAT-007 PASS | PRD-REL-001 | **TESTED AND PASSING** |
| FR-032 | Must | DEA | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-007 | Must | EAA | HC-10 | - | - | - | - | **SPECIFIED ONLY** |
| FR-008 | Must | EAA | HC-05 | - | - | PRC-DAT-004 PASS | PRD-FUN-002 | **TESTED AND PASSING** |
| FR-009 | Must | EAA | HC-05 | - | - | PRC-DAT-004 PASS; PRC-SEC-002 PASS | PRD-FUN-002 | **TESTED AND PASSING** |
| FR-010 | Must | EAA | HC-06 | - | - | PRC-DAT-001 PASS; PRC-SOV-002 PASS | - | **TESTED AND PASSING** |
| FR-011 | Must | EAA | HC-05 | - | - | PRC-DAT-004 PASS | - | **TESTED AND PASSING** |
| FR-012 | Must | EAA | HC-10 | - | - | PRC-DAT-005 FAIL | - | **TESTED, A TEST FAILS** |
| FR-013 | Must | DRA | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-014 | Must | DRA | HC-06 | - | - | PRC-DAT-001 PASS | - | **TESTED AND PASSING** |
| FR-015 | Must | DRA | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-016 | Should | DRA | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-033 | Should | DRA | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-017 | Must | MBA | - | - | - | - | PRD-DAT-007 | **PENDING TEST ONLY** |
| FR-018 | Must | MBA | - | - | - | - | PRD-DAT-007 | **PENDING TEST ONLY** |
| FR-019 | Must | MBA | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-020 | Should | MBA | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-021 | Must | MBA | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-022 | Must | CCA | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-023 | Must | CCA | HC-02 | - | - | - | PRD-SOV-001 | **PENDING TEST ONLY** |
| FR-024 | Must | CCA | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-025 | Must | CCA | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-026 | Must | XC,SOV | HC-03 | DES-0001 Partial | - | PRC-DAT-003 PASS; PRC-SEC-002 PASS | - | **TESTED AND PASSING** |
| FR-027 | Must | XC | HC-04 | - | - | PRC-SEC-001 PASS | PRD-SEC-002 | **TESTED AND PASSING** |
| FR-028 | Must | XC | HC-06 | - | - | - | - | **SPECIFIED ONLY** |
| FR-029 | Must | XC | HC-08 | - | - | - | PRD-OBS-001 | **PENDING TEST ONLY** |
| FR-030 | Must | XC | - | - | - | - | - | **SPECIFIED ONLY** |
| FR-031 | Should | XC | - | - | - | - | - | **SPECIFIED ONLY** |
| SEC-001 | Must | SOV | HC-01 | DES-0001 Partial; DES-0002 Partial | ADR-0004, ADR-0015 | HRN-SOV-002 PASS; HRN-AZR-004 PASS; HRN-AZR-005 PASS; PRC-ARC-001 FAIL; PRC-SOV-004 PASS; PRC-SOV-001 PASS; PRC-SOV-003 PASS; PRC-SEC-003 PASS | PRD-SOV-002 | **TESTED, A TEST FAILS** |
| SEC-002 | Must | SOV | HC-01 | DES-0001 Partial; DES-0002 Unresolved | ADR-0004, ADR-0015 | HRN-SOV-002 PASS; PRC-ARC-001 FAIL; PRC-SOV-004 PASS; PRC-SOV-001 PASS; PRC-SOV-003 PASS | PRD-SOV-002 | **TESTED, A TEST FAILS** |
| SEC-003 | Must | SOV,XC | HC-01 | DES-0001 Partial | ADR-0004 | PRC-ARC-001 FAIL | PRD-SOV-002 | **TESTED, A TEST FAILS** |
| SEC-004 | Must | SOV | HC-01 | DES-0001 Partial | ADR-0004 | PRC-ARC-001 FAIL | PRD-SOV-002 | **TESTED, A TEST FAILS** |
| SEC-005 | Must | CCA,XC | HC-02 | - | - | HRN-SOV-001 PASS | PRD-SOV-001 | **TESTED AND PASSING** |
| SEC-006 | Must | CCA,XC | HC-02 | - | - | HRN-SOV-001 PASS; HRN-SOV-004 PASS | PRD-SOV-001 | **TESTED AND PASSING** |
| SEC-007 | Must | XC | HC-03 | - | - | PRC-DAT-003 PASS | - | **TESTED AND PASSING** |
| SEC-008 | Must | XC | HC-08 | DES-0001 Partial; DES-0002 Partial | ADR-0015 | HRN-SEC-008 PASS; HRN-OBS-001 PASS; HRN-OBS-002 PASS; HRN-OBS-003 PASS | - | **TESTED AND PASSING** |
| SEC-009 | Must | XC | HC-09 | DES-0001 Partial | - | HRN-SEC-001 PASS; HRN-SEC-002 PASS; HRN-SEC-006 PASS; HRN-SEC-007 PASS; HRN-AZR-003 PASS; HRN-OPS-001 PASS; HRN-OPS-002 PASS; PRC-SEC-003 PASS | PRD-SEC-003 | **TESTED AND PASSING** |
| SEC-010 | Must | XC | HC-04 | - | - | HRN-SEC-003 PASS; PRC-SEC-001 PASS | PRD-SEC-002 | **TESTED AND PASSING** |
| SEC-011 | Must | XC | - | - | - | - | - | **SPECIFIED ONLY** |
| SEC-012 | Must | XC | - | DES-0002 Partial | ADR-0015 | HRN-SEC-004 PASS; HRN-SEC-005 PASS; HRN-SEC-011 PASS; HRN-OBS-002 PASS | PRD-SEC-001 | **TESTED AND PASSING** |
| SEC-013 | Must | EDG | - | DES-0001 Partial; DES-0002 Unresolved | ADR-0004, ADR-0015 | - | - | **DESIGNED ONLY** |
| SEC-014 | Should | XC | - | DES-0001 Partial | - | - | - | **DESIGNED ONLY** |
| SEC-015 | Should | XC | - | - | - | - | - | **SPECIFIED ONLY** |
| DATA-001 | Must | XC,SOV | - | DES-0001 Addressed; DES-0002 Partial | ADR-0015 | HRN-SOV-004 PASS | - | **TESTED AND PASSING** |
| DATA-002 | Must | DEA,EDG | - | DES-0001 Partial; DES-0002 Partial | ADR-0015 | PRC-DAT-001 PASS; PRC-DAT-006 FAIL; PRC-DAT-007 PASS; PRC-DAT-008 PASS | - | **TESTED, A TEST FAILS** |
| DATA-003 | Must | XC | HC-08 | - | - | PRC-DAT-002 PASS | PRD-OBS-001 | **TESTED AND PASSING** |
| DATA-004 | Must | XC | - | - | - | - | - | **SPECIFIED ONLY** |
| DATA-005 | Must | EAA | - | - | - | PRC-DAT-005 FAIL | - | **TESTED, A TEST FAILS** |
| DATA-006 | Must | XC,SOV | - | DES-0001 Unresolved | - | - | - | **DESIGNED ONLY** |
| DATA-007 | Must | EAA,MBA | - | - | - | - | - | **SPECIFIED ONLY** |
| DATA-008 | Should | XC | - | - | - | - | - | **SPECIFIED ONLY** |
| DATA-009 | Must | XC,SOV | - | DES-0001 Partial | - | - | - | **DESIGNED ONLY** |
| DATA-010 | Should | XC | - | - | - | - | - | **SPECIFIED ONLY** |
| AGT-001 | Must | XC | - | - | - | - | - | **SPECIFIED ONLY** |
| AGT-002 | Must | XC | HC-09 | - | - | HRN-SEC-006 PASS; HRN-SEC-009 PASS | - | **TESTED AND PASSING** |
| AGT-003 | Must | XC | HC-06 | DES-0002 Partial | ADR-0015 | HRN-SEC-005 PASS; PRC-SOV-004 PASS; PRC-SOV-002 PASS | PRD-SEC-001 | **TESTED AND PASSING** |
| AGT-004 | Must | XC | HC-06 | - | - | PRC-SOV-002 PASS | PRD-DAT-007 | **TESTED AND PASSING** |
| AGT-005 | Must | XC | HC-04 | - | - | HRN-SEC-003 PASS; PRC-SEC-001 PASS | PRD-SEC-002 | **TESTED AND PASSING** |
| AGT-006 | Must | XC | HC-09, HC-11 | - | - | HRN-SEC-001 PASS; HRN-SEC-002 PASS; HRN-SEC-007 PASS; PRC-AZR-001 BLOCKED | PRD-SEC-003 | **TESTED, A TEST BLOCKED** |
| AGT-007 | Must | XC | HC-08 | - | - | HRN-SEC-008 PASS | - | **TESTED AND PASSING** |
| AGT-008 | Must | XC | - | - | - | - | - | **SPECIFIED ONLY** |
| AGT-009 | Must | XC | - | - | - | - | - | **SPECIFIED ONLY** |
| AGT-010 | Must | XC,EDG | HC-07 | DES-0001 Addressed; DES-0002 Partial | ADR-0015 | - | - | **DESIGNED ONLY** |
| AGT-011 | Must | XC | HC-11 | - | - | HRN-SEC-009 PASS; HRN-AZR-002 PASS | PRD-FUN-001 | **TESTED AND PASSING** |
| NFR-001 | Must | XC | HC-08 | DES-0001 Partial; DES-0002 Partial | ADR-0015 | HRN-OBS-001 PASS | PRD-OBS-001 | **TESTED AND PASSING** |
| NFR-002 | Must | EAA | HC-05 | - | - | PRC-DAT-004 PASS | PRD-FUN-002 | **TESTED AND PASSING** |
| NFR-003 | Must | XC | HC-12 | - | - | - | PRD-AZR-002; PRD-REL-002 | **PENDING TEST ONLY** |
| NFR-011 | Must | XC | HC-03 | - | - | PRC-DAT-003 PASS; PRC-SEC-002 PASS | - | **TESTED AND PASSING** |
| NFR-012 | Should | XC | - | - | - | - | - | **SPECIFIED ONLY** |
| NFR-017 | Must | EDG | - | DES-0001 Unresolved; DES-0002 Partial | ADR-0015 | PRC-DAT-006 FAIL; PRC-DAT-008 PASS | - | **TESTED, A TEST FAILS** |
| NFR-004 | Must | EDG | HC-07 | DES-0001 Unresolved; DES-0002 Unresolved | ADR-0015 | PRC-DAT-007 PASS | PRD-REL-001; PRD-REL-002 | **TESTED AND PASSING** |
| NFR-005 | Must | EDG | HC-07 | DES-0001 Addressed; DES-0002 Partial | ADR-0004, ADR-0015 | HRN-REL-001 PASS; PRC-DAT-002 PASS; PRC-DAT-007 PASS | PRD-REL-001 | **TESTED AND PASSING** |
| NFR-006 | Must | EDG,DEA | HC-07 | DES-0001 Partial; DES-0002 Partial | ADR-0015 | - | PRD-REL-001 | **PENDING TEST ONLY** |
| NFR-007 | Should | XC | - | DES-0001 Unresolved | - | - | PRD-OPS-001 | **PENDING TEST ONLY** |
| NFR-008 | Must | XC | - | DES-0001 Unresolved | - | - | PRD-OPS-001 | **PENDING TEST ONLY** |
| NFR-016 | Should | XC,SOV | - | DES-0001 Addressed | ADR-0004 | - | - | **DESIGNED ONLY** |
| NFR-014 | Should | CCA,DRA | - | - | - | - | HRN-PRF-001; PRD-PRF-001 | **PENDING TEST ONLY** |
| NFR-015 | Should | XC | - | - | - | - | PRD-PRF-001 | **PENDING TEST ONLY** |
| NFR-009 | Must | SOV | HC-01 | DES-0001 Partial; DES-0002 Unresolved | ADR-0015 | PRC-ARC-001 FAIL; PRC-SOV-004 PASS; PRC-SOV-001 PASS; PRC-SOV-003 PASS | - | **TESTED, A TEST FAILS** |
| NFR-010 | Must | CCA,XC | HC-02 | - | - | - | PRD-SOV-001 | **PENDING TEST ONLY** |
| NFR-013 | Should | XC | - | DES-0001 Partial | - | - | - | **DESIGNED ONLY** |
| NFR-018 | Should | DRA,XC | - | - | - | - | - | **SPECIFIED ONLY** |
| NFR-019 | Should | XC | - | - | ADR-0004 | HRN-CST-001 PASS; HRN-CST-002 PASS | PRD-CST-001 | **TESTED AND PASSING** |
| NFR-020 | Could | CCA | - | - | - | - | - | **SPECIFIED ONLY** |
| NFR-021 | Should | EAA,MBA | - | - | - | - | - | **SPECIFIED ONLY** |

## Reading this honestly

- A requirement whose only design row is in DES-0001 or DES-0002 is at most Partial there, because both designs are Blocked by the gate; see their review records.
- Most Must requirements about agents, certificates, mass balance, the customer boundary and operations have no test at all. They belong to components that do not exist, and their pending tests say so.
- A requirement listed with a test only through a hard constraint is covered indirectly. The hard-constraint matrix in the evaluation report is the better view for those.


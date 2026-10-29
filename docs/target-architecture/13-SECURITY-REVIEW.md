# 13. Security review record (hardening stage)

Status: **Phase 0, 2026-10-29.** This records an independent security review of the **candidate oracles** built in the hardening stage, every finding, what was done about it, and what remains. It reviews code that states security properties on synthetic data. It does not review a product, because none exists, and it does not establish legal, regulatory or certification compliance.

## 1. Scope and method

| Item | Detail |
|---|---|
| Reviewed | Six candidate contracts in [harness/contracts/](../../harness/contracts) (audit chain, custody chain, certificate lifecycle, methodology registry, tenant boundary and tool gateway, sovereignty placement) and their [tests](../../tests) |
| Reviewer | The `security-review` agent, read-only, **two passes**: a first adversarial pass over code and tests, then a re-verification of every finding plus a review of documents 10, 11 and 12 for overclaims |
| What it could do | Read files and run `node --test`. It could not edit files |
| Limits | The reviewer is a model. The author of the code is also a model. They may share blind spots (TM-32, RK-012). **No human has reviewed this work** (T56). The review did not cover the Phase 0 governance code, the harness, or any Azure resource, because none of the last exists |

## 2. Findings, first pass

Line numbers refer to the files **before** remediation. Severity and confidence are the reviewer's. There were no CRITICAL findings.

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟠 HIGH | sovereignty-placement-contract.mjs | 19, 29-30, 40, 49-55 | Checker failed open: unlabelled or empty flows, duplicate resource ids, approvals not bound to destination, undeclared access and redundancy treated as safe, empty manifest passed | 9/10 |
| 2 | 🟠 HIGH | methodology-registry-contract.mjs | 88, 127 | Approval signature did not protect the record: a stored hash could be rewritten with the record and the old signature still passed | 9/10 |
| 3 | 🟠 HIGH | certificate-lifecycle-contract.mjs | 80-95, 161-171, revoke | Approvals were caller-built objects; approver identity and time were self-asserted; an object-valued approval id evaded single use | 8/10 |
| 4 | 🟡 MEDIUM | tenant-boundary-contract.mjs | 103-104 | Gateway schema check used `in`, so prototype-named argument keys passed and extra values reached handlers | 9/10 |
| 5 | 🟡 MEDIUM | tenant-boundary-contract.mjs | 114, 123-126 | Answer validation: substring number match, narrow claim pattern, any status record accepted | 9/10 |
| 6 | 🟡 MEDIUM | tenant-boundary-contract.mjs | 86-87 | Context builder trusted any source except two, and untrusted text could close its own fence | 8/10 |
| 7 | 🟡 MEDIUM | certificate-lifecycle-contract.mjs | 41-52, 96-108 | Supersession not bound by approval, not same-delivery, not re-checked at issue; two live certificates per delivery possible | 8/10 |
| 8 | 🟡 MEDIUM | certificate-lifecycle-contract.mjs | 62-79 | Validation did not bind the certificate's stated figures to the calculation record | 8/10 |
| 9 | 🟡 MEDIUM | lifecycle and methodology contracts | 80-95, 113-120 / 80-100 | Four-eyes tracked only the creator, so an editor could approve their own edit | 8/10 |
| 10 | 🟡 MEDIUM | certificate-lifecycle-contract.mjs | 161-171, revoke | Filing approval and revocation ignored `decision`, so a recorded rejection could authorise | 8/10 |
| 11 | 🟡 MEDIUM | tenant, lifecycle, custody contracts | various | Live internal objects exposed (raw store, filing, stored events), so immutability held only for well-behaved callers | 8/10 |
| 12 | 🟡 MEDIUM | methodology-registry-contract.mjs | 155-166 | Re-run did not authenticate the calculation record or check which version applied on the delivery date | 7/10 |
| 13 | 🟡 MEDIUM | certificate-lifecycle-contract.mjs | 96-108 | Time of check is not time of use: evidence and approval age were not re-checked at issue | 7/10 |
| 14 | 🟡 MEDIUM | certificate-lifecycle-contract.mjs | 194 | Filing was sent before the state changed, so a throw or re-entry could send twice | 7/10 |
| 15 | ⚪ LOW | audit-chain.mjs and callers | 10-11 and callers | Caller-chosen strings entered the log; chain fields could be overridden; denials on list, search and cache were not logged | 8/10 |
| 16 | ⚪ LOW | custody and lifecycle verifiers | various | Prototype-named keys, no `validFrom` check, no cell check, no snapshot key or age check, `complete` from any device | 7/10 |

The reviewer also listed test weaknesses: a scenario guard that counted titles only, tamper tests that never changed a record and its hash together, and no tests for the gaps above.

## 3. Remediation

Each fix has tests that fail without it. "Fixed" means the oracle now refuses the attack and a test shows it. It does not mean a product is safe.

| # | Outcome | What changed | Where tested |
|---|---|---|---|
| 1 | Fixed | Empty manifest, duplicate ids, unlabelled flows, laundered labels, destination and resource-pair binding, safe values must be declared (`false`, enum), admin and data classes must be declared | [placement tests](../../tests/sovereignty-placement-contract.test.mjs) |
| 2 | Fixed | The signed hash is recomputed from the stored fields on every use | methodology tests, ST-07 |
| 3 | Fixed in the oracle | An approval is a record signed with the approver's registered key; id format, type, role, key, meaning, decision, content binding, age and single use are checked. **Approver enrollment and key custody are not modelled (CL-15, T56)** | lifecycle tests, ST-10 |
| 4 | Fixed | Own-key schema check, null-prototype frozen arguments, narrowed handler API | tenant tests |
| 5 | **Partly fixed** | Whole-value number match, number words, exponent form, Unicode normalisation, wider claim words, negation goes to a human, status value must be mentioned. **Pattern-based; wording not covered is not caught (G-5)** | tenant tests, ST-09 |
| 6 | Fixed | Untrusted by default, per-run fence, delimiter characters escaped, zero-width characters do not hide an instruction from the flag | tenant tests, ST-09 |
| 7 | Fixed | Declared inside the approved content, same delivery, re-checked at issue, one live certificate per delivery | lifecycle tests |
| 8 | Fixed against stand-ins | Figures and quantities must equal the calculation and custody outputs. **The oracles are not wired together (G-1)** | lifecycle tests, ST-08 |
| 9 | Fixed | Every person who created or edited is an author and cannot review or approve | lifecycle and methodology tests |
| 10 | Fixed | `decision` and the filing id are part of every approval check | lifecycle tests |
| 11 | Fixed for the listed objects | Copies in and out, no raw store, narrowed API, test hooks only when a test factory asks | tenant, lifecycle, methodology tests |
| 12 | Fixed | Calculation records are signed; re-run confirms the version that applied on the date (retired versions still count) | methodology tests |
| 13 | Fixed | Evidence and approval age re-checked at issue | lifecycle tests |
| 14 | Fixed | State moves first; a failed send ends in `FILING_SEND_UNCERTAIN` and needs a human; no automatic retry | lifecycle tests, ST-10 |
| 15 | Fixed | Safe-identifier-or-hash for caller values, chain fields cannot be overridden, every denial logged | tenant, lifecycle tests |
| 16 | **Partly fixed** | Own-key lookups, `validFrom`, receipt cell, snapshot key, window and age. **`complete` still comes from any device and cross-device ordering is not checked offline (G-2)** | custody, lifecycle tests |
| Tests | Partly fixed | The scenario guard now rejects skip, todo and only, and requires an assertion in every scenario test; tamper tests change a record and its hash together | [security-scenarios.test.mjs](../../tests/security-scenarios.test.mjs) |

## 4. Findings, second pass (introduced or residual)

| # | Severity | File | Vulnerability | Outcome |
|---|----------|------|---------------|---------|
| N-1 | 🟡 MEDIUM | methodology-registry-contract.mjs | `edit()` kept the caller's nested objects, so a retained patch could be mutated after review and then approved | Fixed: copy on edit, the review records a content hash, approval requires it to match (`content-changed-since-review`); tests added |
| N-2 | ⚪ LOW | methodology and lifecycle contracts | `resolve()` returned the live entry and `_tamperStored` was always present | Fixed: copy returned; test hooks only when a test factory asks; tests added |
| N-3 | ⚪ LOW | sovereignty-placement-contract.mjs | A non-bound flow marked as requiring approval no longer needed one | Fixed; test added |
| N-4 | ⚪ LOW | sovereignty-placement-contract.mjs | Some roles holding data could declare an empty class list; approved flows are self-declared inside the manifest | Class list fixed for queue, edge-buffer and key-store; **self-declared approvals remain** (needs an external register, noted on SV-03) |

The reviewer's conclusion on the first remediation, before N-1 to N-4 were fixed: **no CRITICAL or HIGH issue remains in the reviewed code**; the highest remaining item was N-1 (MEDIUM). The fixes for N-1 to N-4 were made after that statement and have **not** had a third review pass.

## 5. Documentation overclaims found and corrected

The reviewer listed eleven statements in documents 10, 11 and 12 that claimed more than the code delivered (for example that a lifecycle gate was tested against real services, that cursors were an integrity control, that roles were enforced by the data API, and a wrong requirement citation). Each was corrected, and the limits are now listed as gaps G-1 to G-6 in [10](10-CONTROL-MATRIX.md). The reviewer found **no claim of residency, legal or certification compliance**.

## 6. What the oracles prove and what they do not

**They prove, on synthetic data:** that each stated rule is coherent and executable; that the named attacks (ST-01 to ST-10 and the review's cases) are refused by that rule; that denials and refusals are recorded in a tamper-evident log; and that a verifier needs only a bundle and a trust set it supplies.

**They do not prove:** that any future implementation follows the rule; that identity, approver enrollment, key custody, trusted time or the audit anchor are sound; that a real model resists injection or invents no evidence (RA-07, NOT RUN); that any Azure resource is where a manifest says it is (V-1 to V-12, NOT RUN); that any jurisdiction or scheme accepts the design; or that the five oracles work together (G-1).

## 7. Open items

| Item | Owner | Where |
|---|---|---|
| Human security review of the oracles and documents 10 to 13 | Owner to name a reviewer | T56 |
| Approver key enrollment and custody (CL-15) | Owner | T53, T56 |
| Integration test wiring custody, calculation and lifecycle (G-1) | Next stage, after the phase is raised | [Implementation plan](../phase/PHASE-1-BLOCKER-REPORT.md) |
| Offline completeness and cross-device ordering (G-2) | Next stage | G-2 in [10](10-CONTROL-MATRIX.md) |
| Residency validation per cell (V-1 to V-12) | Owner, after Azure deployment is approved (T36 deferred) | [12](12-DATA-MOVEMENT-AND-RESIDENCY-VALIDATION.md) |
| Evaluation of real models (RA-07) | Owner, after the model and budget decision | T55 |

## 8. Evidence

Test runs recorded with the evidence recorder are listed in the [evidence index](../evidence/README.md) and the generated [test evidence index](../acceptance/TEST-EVIDENCE-INDEX.md). Record ids for this stage are EV-0073 (the six new test files) and EV-0074 (the full suite). A passing run shows that the oracles behave as the tests state; it is not a security assessment of a product.

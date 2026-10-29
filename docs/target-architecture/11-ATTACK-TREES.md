# 11. Attack-tree analysis

Status: **Phase 0, proposed, 2026-10-29.** Six trees for the attacker goals that matter most to the case. Each tree decomposes a goal into ways to achieve it. `OR` means any one branch is enough; `AND` means every listed step is needed. Each leaf names the control that is meant to stop it ([10 control matrix](10-CONTROL-MATRIX.md)), and its status.

Leaf status vocabulary: **ORACLE** = refused by a candidate oracle with a passing test (synthetic, not a product); **DESIGN** = relies on a design control that is not testable yet; **OUT** = outside what software can control (people, law, physical); **OPEN** = a weakness or an undecided question remains.

No likelihood or impact numbers are given. There is no data to support any, and inventing them would be a fabricated figure (HC-12). Branches are ordered by the attacker's apparent ease, which is a judgement, not a measurement.

## Tree 1. Make a false or altered certificate be accepted as genuine

```
GOAL: a certificate that is not what the platform issued is accepted as valid
OR
├─ 1.1 Alter an issued certificate
│   OR
│   ├─ change content and leave the hash          → CL-07 hash check               ORACLE (ST-01)
│   ├─ change content and recompute the hash      → CL-01/CL-07 signature check    ORACLE (ST-01)
│   ├─ change content and re-sign with own key    → CL-07 trust set, key id        ORACLE (ST-01)
│   ├─ put own public key inside the bundle       → CL-07 ignores bundle keys      ORACLE (ST-01)
│   └─ backdate issue time before the key was valid → CL-07 key validity window    ORACLE (ST-01)
├─ 1.2 Present a revoked or superseded certificate as current
│   OR
│   ├─ strip or edit the snapshot                 → CL-06 signed snapshot          ORACLE (ST-01)
│   ├─ present an old copy after revocation       → CL-06 freshness: reports "valid as of" then stale
│   │                                               ORACLE; the freshness limit is a policy input (OPEN)
│   └─ verifier is offline for a long time        → cannot know of later revocation; reported, not hidden   OPEN
├─ 1.3 Get a false certificate issued by the service
│   OR
│   ├─ AND: change stored content after validation, then call issue
│   │        → CL-04 content-hash recheck at issue and approval                  ORACLE (ST-01)
│   ├─ skip validation (agent or person declares evidence validated)
│   │        → CL-02 only the validator service, gated on evidence               ORACLE (ST-08)
│   ├─ skip approval                              → CL-03 approval required before issue   ORACLE (ST-10)
│   └─ call issue as a non-issuer                 → CL-02 issuer service only (actor type and role)   ORACLE
├─ 1.4 Steal or misuse the signing key
│   OR
│   ├─ extract the key from the signing service   → CC-09 key custody                DESIGN; not modelled (D-013)
│   └─ coerce an operator to sign                 → separation of duties, audit        OUT / partly CL-03
└─ 1.5 Rewrite the audit trail to hide it
    OR
    ├─ edit, remove or reorder entries            → AU-01 hash chain                  ORACLE
    └─ truncate the tail                          → AU-01 needs an anchored head       ORACLE with an anchor; where the anchor lives is OPEN (D-013)
```

## Tree 2. Obtain another shipowner's data

```
GOAL: shipowner A (human, or an agent acting for A) reads or infers shipowner B's data
OR
├─ 2.1 Through the API
│   OR
│   ├─ request B's record id                      → IS-02 tenant check on the record, uniform not-found   ORACLE (ST-06)
│   ├─ manipulate the id (traversal, case, space, type confusion, injection)
│   │                                             → IS-03 strict identifiers          ORACLE (ST-06)
│   ├─ forge or edit a token's tenant             → IS-01 verified claims only         ORACLE (ST-06)
│   ├─ supply a tenant parameter                  → IS-01 never read                   ORACLE (ST-06)
│   ├─ page through lists or use a cursor from B  → IS-04 query filter, bound cursors  ORACLE (ST-06)
│   ├─ infer existence from counts, timing or error shape
│   │                                             → uniform responses and tenant-only counts: ORACLE for shape and counts;
│   │                                               timing is not measured                       OPEN
│   └─ search for B's identifiers                 → IS-04 literal match, own records only   ORACLE (ST-06)
├─ 2.2 Through a shared cache or store
│   OR
│   ├─ collide a cache key                        → IS-05 namespaced key               ORACLE (ST-06)
│   └─ read a shared index or log that mixes tenants → DESIGN: per-tenant stores and indexes (SEC-005)   DESIGN
├─ 2.3 Through an agent
│   OR
│   ├─ prompt the agent to fetch B's record       → IS-06/IS-07 gateway and tenant-bound handler   ORACLE (ST-06, ST-09)
│   ├─ plant instructions in a document          → RA-01/RA-02 data fencing, gateway decides      ORACLE (ST-09)
│   ├─ get a foreign fragment into the context    → IS-08 dropped and audited          ORACLE (ST-06)
│   ├─ cite B's record in an answer               → RA-03 citation must be in this run's retrieved set   ORACLE (ST-09)
│   └─ extract B's data from the model itself     → IS-09 shared inference state       DESIGN; not testable until an inference path exists   OPEN
└─ 2.4 Through people and process
    OR
    ├─ a customer administrator is impersonated   → identity provider, MFA             DESIGN (D-015, D-029)
    └─ an operator exports both customers' data   → least privilege, audit            DESIGN
```

## Tree 3. Move delivery evidence out of its port jurisdiction

```
GOAL: bound data is stored, processed, logged or administered outside the originating jurisdiction
OR
├─ 3.1 Primary placement
│   └─ deploy a store in the wrong region          → SV-01 PL-01                       ORACLE (declared manifest)
├─ 3.2 Silent copies
│   OR
│   ├─ geo-redundant storage with a paired region elsewhere → SV-01 PL-08 (undeclared pair is a violation)   ORACLE (declared)
│   ├─ backups or replicas to another jurisdiction → SV-01 PL-02                       ORACLE (declared)
│   ├─ diagnostic settings or log workspace elsewhere → SV-02 PL-03                    ORACLE (declared)
│   └─ telemetry export                            → SV-02                              ORACLE (declared); support tooling is not modelled, only declared admin paths (SV-04)
├─ 3.3 Processing
│   OR
│   ├─ send measurements to an inference endpoint outside → SV-05 PL-07                ORACLE (declared)
│   └─ endpoint claims a region but processes elsewhere  → processing location must be verified, not assumed   OPEN (D-028)
├─ 3.4 Movement
│   OR
│   ├─ a flow of a bound class across the boundary → SV-03 PL-04 needs a complete, unexpired approved flow   ORACLE
│   ├─ summary data that is really derived raw data → data-class assignment is a human decision   OPEN (D-009/D-011)
│   └─ group plane pulls raw data                  → design: group plane receives only listed classes   DESIGN
├─ 3.5 Administration
│   OR
│   ├─ admin or support access from outside        → SV-04 PL-06 break-glass inside the cell   ORACLE (declared)
│   └─ deployment pipeline as an admin path        → TM-33 deployment identities scoped to the cell   DESIGN
├─ 3.6 Lying about the above
│   └─ a manifest that does not match reality      → SV-07 live validation per cell        DESIGN; NOT RUN (see 12)   OPEN
└─ 3.7 Legal compulsion
    └─ a foreign authority compels the provider    → SV-08                               OUT
```

The checker works on a declared manifest. Branch 3.6 is the important one: every ORACLE leaf above is only as true as the declaration. That is why live validation is its own control and is listed as not run.

## Tree 4. Get a certification filing submitted without the quality manager

```
GOAL: a filing reaches a certification body without a valid quality-manager approval
OR
├─ 4.1 Submit directly
│   OR
│   ├─ an agent calls submit                      → CL-08 only the controlled filing service   ORACLE (ST-10)
│   ├─ a human other than the service calls submit → CL-08                                ORACLE (ST-10)
│   └─ a service without the filing role           → CL-08                                ORACLE (ST-10)
├─ 4.2 Counterfeit the approval
│   OR
│   ├─ write "approved by QM" into the draft       → CL-09 text is not an approval         ORACLE (ST-10)
│   ├─ approve as an agent                         → CL-08 human quality-manager only      ORACLE (ST-10)
│   ├─ approve as a non-QM human                   → CL-08                                ORACLE (ST-10)
│   ├─ approve as the preparer                     → CL-08 separation of duties           ORACLE (ST-10)
│   └─ build an approval record by hand (any fields, any approver id) → CL-03 approval must be signed with the approver's registered key   ORACLE (ST-10)
│                                                  who holds approver keys and how they are enrolled: CL-15            NOT MODELLED; approver registry is empty (T53)   OPEN
├─ 4.3 Reuse a genuine approval
│   OR
│   ├─ replay it                                   → single use                           ORACLE (ST-10)
│   ├─ use an approval given for issuing a certificate → meaning and id                    ORACLE (ST-10)
│   ├─ use an old approval                         → time limit                            ORACLE (ST-10)
│   └─ AND: obtain approval, then edit the draft   → approval bound to exact bytes; edit discards it   ORACLE (ST-10)
├─ 4.4 Change what is sent after approval
│   └─ alter the filing between approval and send  → content-hash recheck at submit        ORACLE (ST-10)
├─ 4.5 File on a revoked certificate
│   └─ revoke after approval, then submit          → recheck at submit                     ORACLE (ST-10)
└─ 4.6 Manipulate the process from outside
    └─ the body's reply tells the system to "resubmit" or "mark verified" → reply is untrusted data and changes no state   ORACLE
```

## Tree 5. Make false evidence count as real

```
GOAL: invented or altered evidence appears in a delivery's evidence package
OR
├─ 5.1 Fake sensor data
│   OR
│   ├─ a device the verifier does not know       → CC-06 registry                        ORACLE (ST-05)
│   ├─ valid-looking hashes without the key      → CC-01 signature                       ORACLE (ST-05)
│   ├─ a foreign-jurisdiction or unassigned device → CC-01/registry                      ORACLE (ST-05)
│   ├─ a genuine device with a stolen key        → CC-06 revocation, CC-09 custody       DESIGN; stolen-key window OPEN
│   └─ a compromised device that signs lies      → CC-11 physical and software attestation   OUT / DESIGN
├─ 5.2 Alter or reorder real data
│   OR
│   ├─ change, drop, insert or reorder events    → CC-02, CC-07                          ORACLE (ST-05)
│   ├─ replay or duplicate                       → CC-03                                 ORACLE (ST-02)
│   ├─ double-book one transfer                  → CC-04                                 ORACLE (ST-03)
│   └─ shift the clock                           → CC-05 verifier receipt time           ORACLE (ST-04); trusted time source OPEN (D-021)
├─ 5.3 Fake the non-sensor evidence
│   OR
│   ├─ omit feedstock evidence and say it exists → CL-02 verification status from a service   ORACLE (ST-08)
│   ├─ a document says it is verified            → RA-03 and CL-02: a document cannot supply status   ORACLE (ST-09)
│   └─ a forged feedstock certificate            → verification of the issuer is a human or registry process   OUT (D-019)
├─ 5.4 Make the AI invent it
│   OR
│   ├─ unsupported compliance claim              → RA-03                                 ORACLE (ST-09); wording evasion OPEN
│   ├─ invented number                           → RA-03 number must appear in a cited record   ORACLE (ST-09)
│   └─ real model hallucination rate             → RA-07                                 NOT TESTED
└─ 5.5 Change the numbers downstream
    └─ alter a stored calculation record         → EM-06 re-run reports a difference     ORACLE
```

## Tree 6. Change emissions results without a controlled methodology change

```
GOAL: results change, or cannot be reproduced, and nobody approved a methodology change
OR
├─ 6.1 Propose or approve as an unauthorised actor
│   OR
│   ├─ an agent proposes, reviews or approves    → EM-02                                 ORACLE (ST-07)
│   ├─ one person plays all roles                → EM-02 separation of duties            ORACLE (ST-07)
│   └─ a non-QM approves                         → EM-02                                 ORACLE (ST-07)
├─ 6.2 Alter an approved version
│   OR
│   ├─ edit after approval                       → EM-01 immutable                       ORACLE (ST-07)
│   ├─ edit stored record directly               → EM-04 integrity check, calculation refuses   ORACLE (ST-07)
│   └─ change a factor                           → EM-04                                 ORACLE (ST-07)
├─ 6.3 Apply the wrong version
│   OR
│   ├─ retroactive effective date                → EM-03                                 ORACLE (ST-07)
│   ├─ overlapping periods                       → EM-03                                 ORACLE (ST-07)
│   └─ delivery date outside any approved period → fails closed                          ORACLE
├─ 6.4 Change rounding or units quietly
│   └─ rounding, precision and unit are data in the signed version   → EM-05, EM-06     ORACLE
└─ 6.5 Make a real scheme method wrong
    └─ the formula or factor itself is wrong     → EM-08                                 NOT MODELLED; domain owner (D-001, D-002, D-022)
```

## Cross-tree observations

1. **The ORACLE leaves are only as strong as their inputs.** Tree 3 depends on a truthful manifest, Tree 2 on a real identity provider, Tree 4 on a real approver registry, Tree 1 on real key custody.
2. **The weakest areas are the ones software cannot see.** Physical tampering, a forged feedstock certificate issued by a real but dishonest party, and legal compulsion appear as OUT in several trees and need contractual, procedural and audit controls.
3. **Several leaves stay OPEN regardless of code:** the trusted time source (D-021), the location of the audit-head anchor (D-013), the real processing location of a model endpoint (D-028), the policy freshness limit for offline certificate checks, assignment of data classes to derived data (D-009, D-011), the stolen-key window, and wording evasion in the pattern-based detectors.
4. **A heuristic is not a guarantee.** The injection flag, the claim-word list and the number-word list are pattern matches. The gateway's authorisation holds whatever a model proposes; the grounding rule is necessary but not sufficient, because it is partly pattern-based and a wording it does not cover is not caught. Customer-facing compliance statements therefore still need human review at the autonomy level proposed for that agent.

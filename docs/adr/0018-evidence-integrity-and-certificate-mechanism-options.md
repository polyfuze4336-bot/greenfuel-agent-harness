# ADR 0018: Evidence integrity and certificate mechanism, required properties and option set

- **Status:** Proposed
- **Type:** Design
- **Date:** 2026-10-29
- **Deciders:** Design approver (not yet named, T3), with the quality manager, the security architect and an independent auditor representative
- **Supersedes:** none
- **Review:** RV-0003

## Context
- FACT: Certificates must be tamper-evident and locally hosted (CS-C3; HC-03), and the architecture must support evidence integrity, dispute resolution and audit reconstruction (CS-C8; HC-08). Calculations must be reproducible to the exact methodology version (CS-C5; HC-05).
- FACT: The tamper-evidence mechanism, key custody and timestamping authority are open (D-013). What "locally hosted" is local to, and how a third party verifies a certificate, are open (D-012). What a certificate is, who issues it and who receives filings are open (D-006). Retention is open (D-016).
- FACT: A hash chain gives integrity and consistency, not authenticity: anyone who can reach an endpoint can compute valid hashes. Authenticity needs signing under key custody (the candidate ingestion oracle states this and marks accepted records unauthenticated until signing exists).
- ASSUMPTION: Tamper evidence is shown by cryptographic means and independent verification; legal admissibility is not assumed (AS-015).
- FACT: A candidate contract exists as a test oracle for ingestion, not as a decision.

## Requirements addressed
- SEC-007: certificates are signed with keys under local control and verifiable without services outside the jurisdiction.
- SEC-008: evidence is append-only and tamper-evident.
- SEC-011: keys and secrets are in a managed key service under defined custody.
- FR-026: tamper-evident, locally hosted certificates that reference the evidence package and methodology version.
- FR-029: reconstruction from certificate back to raw readings, documents, methodology version, approvals and agent actions.
- FR-030: corrections create a new version with a reason and an approver.
- NFR-001: any change to or deletion of stored evidence is detectable by independent verification.
- NFR-011: long-term verifiability independent of platform version or vendor.
- NFR-012: algorithms and keys can rotate without invalidating historical certificates.
- DATA-002: raw data stored immutably with source, trusted timestamp and sequence number.

## Hard constraints
- HC-03: an independent verifier must detect alteration, and hosting, signing and verification must not depend on a location other than the one D-012 fixes. Conditional on D-012 and D-013.
- HC-08: evidence cannot be modified or deleted undetectably, and a certificate is traceable to its origins. Conditional on D-013.
- HC-05: results re-run from stored inputs and versions. Conditional on D-022.
- HC-10: no standard or scheme is stated as binding; named candidates stay unverified.

## Options considered
1. **Hash-chained append-only records, signed by keys in cell custody, with periodic signed digests published to the group plane.** Verification needs only public material; the digest is a tamper anchor held outside the cell if D-011 permits that flow. Candidate.
2. **Option 1 plus a managed or third-party ledger or timestamping service as an additional anchor.** Stronger against a privileged operator of the store; verification must not depend on the service being reachable, and its placement must satisfy HC-03 and D-012. Candidate.
3. **Signatures only, no chain or anchor.** Detects alteration of a document but not deletion or reordering of records. **Rejected (requirement):** does not meet NFR-001 or FR-029.
4. **Rely on storage-layer immutability alone.** Prevents deletion by policy but gives a third party nothing to verify. **Rejected (requirement):** does not meet HC-03, which needs independent verification.

## Decision
This ADR **does not select a mechanism**; that selection is D-013. It decides what any mechanism must provide and how it will be chosen:
1. **Required properties.** Append-only records with a hash chain per delivery and per cell; certificate signatures from keys held in the cell's custody; an offline verification bundle that needs only public material and open formats; supersession and revocation recorded in the chain; algorithm and key identifiers in every signed object so rotation does not break history; no deletion except under a retention rule with a legal-hold check, itself recorded.
2. **Authenticity is separate from integrity, and freshness is separate from validity.** Until device and batch signing exist, accepted records are marked unauthenticated and are not presented as trusted in a package or certificate. An offline bundle carries a signed chain-head and revocation snapshot with an issue time and a maximum freshness age; an offline verifier reports validity **as of the snapshot time** and treats an older snapshot as stale. It claims "latest" only when it holds a newer authenticated snapshot.
3. **Independent verifier first.** A reference verifier that uses only the bundle and public keys is built and tested before the issuing service, so verification cannot depend on the issuer's internals.
4. **Options 1 and 2 are evaluated** against the properties, against HC-03 locality and against what auditors accept (D-025), before D-013 is answered.
5. **Time.** Timestamps are judged against the receiving clock; a trusted time source and drift record are required at the edge (D-021). Whether an external timestamping authority is needed is part of D-013.

## Why this option is appropriate
Options 3 and 4 fail stated requirements. Options 1 and 2 are the plausible mechanisms, and choosing between them needs facts nobody has: what auditors accept, whether a ledger service can sit inside every jurisdiction, and which flows D-011 permits. Deciding the property set now lets the rest of the design proceed without pretending the mechanism is known.

## Consequences
- Positive: the properties are testable before a mechanism exists; the reference verifier gives the buyer and the auditor an independent check.
- Negative: the single most consequential design choice stays open; downstream designs depend on it (DES-0002 uses a candidate chain and says so).
- Obligations: key ceremony, rotation and recovery procedures per cell; a retention and legal-hold design before immutability is switched on (D-016).

## Reliability consequences
Verification of an issued certificate does not depend on the cell being up. Loss of key custody stops issuance but not verification. A broken chain is an incident, not a silent state. The anchor, if used, must not be on the capture path.

## Security consequences
Key custody is the highest-value target in each cell (RK-007). Hardware-backed custody, no key export, signing only from the certificate service after a bound approval, and split knowledge for backup are the design intent; the mechanism is not chosen. A privileged operator of a store can destroy it; only an anchor outside the store makes that detectable.

## Residency implications
Signing keys, their backups, the chain and the verification bundle stay in the jurisdiction. Any anchor outside the cell is a cross-boundary flow and needs an approved-flow entry with a legal basis; a signed digest carries no measurement data but is still derived data until D-011 says otherwise.

## Cost and operational implications
Hardware-backed custody per cell is the largest verified-price line in the model's per-cell cloud cost; operating the key ceremonies is people time. A third-party anchor adds a vendor and a recurring cost.

## Reversibility
Partly. Algorithms and keys can rotate if identifiers are in every object. Changing the chain format after certificates exist means supporting old and new verifiers for the retention period, so the format and identifiers are the hard part to change.

## Validation evidence
The candidate ingestion oracle detects alteration, deletion, reorder and replacement on synthetic fixtures. There is no signing, no certificate service and no verifier. Planned: reference verifier tests, tamper and replacement tests (RT-04 production half), key rotation tests, and an auditor review of the bundle format.

## Review gate
Reviewed in [RV-0003](../architecture/reviews/RV-0003-target-system-architecture.md): the gate computes Blocked. This ADR cannot be Accepted while that review is not Approved.

## Revisit when
D-013 is answered; auditors reject a hash-chain bundle; a ledger service proves unavailable in a jurisdiction; or D-012 fixes a locality that excludes a candidate anchor.

## Evidence
- [DES-0003](../architecture/designs/DES-0003-target-system-architecture.md), [07 Azure service decision matrix](../target-architecture/07-AZURE-SERVICE-DECISION-MATRIX.md), [06 Threat model](../target-architecture/06-THREAT-MODEL.md), the candidate ingestion contract under `harness/contracts`.
- No evidence records for production behaviour exist.

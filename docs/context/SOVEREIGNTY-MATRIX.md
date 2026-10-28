# Sovereignty Matrix

Status: baseline v0.1, 2026-10-28. Proposed rules (class B) that operationalise CS-C1 (delivery measurement data stays in its originating port jurisdiction) and CS-C2 (customer isolation) and the instruction in CS-P4 not to treat an Azure region as proof of residency. Related requirements: SEC-001 to SEC-004, NFR-009, NFR-016, DATA-001. Open decisions: D-003, D-009, D-010, D-011, D-014, D-028, D-033. Legal sources are unverified candidates (V-35, V-10).

## 1. Position: a region is not a residency control

Choosing a cloud region, even one inside the port's country, does not by itself establish that delivery measurement data stays within the jurisdiction. It addresses only where some resources are deployed. This programme does not assume otherwise. Reasons to examine each one per port and per service (generic categories; none has been verified for any specific Azure service in this baseline):

- **Existence and fit.** Whether the port's jurisdiction has a region at all, whether every service the design needs is offered there, and whether the entity that operates it is acceptable under the local rule.
- **What "within the jurisdiction" means.** Storage only, or also processing, access, backups, metadata, telemetry and AI inference. This is a legal question (D-009), not a deployment setting.
- **Replication and recovery.** Cross-region replication, geo-redundant storage and failover targets can place copies elsewhere.
- **Management plane and metadata.** Resource names, tags, configuration and diagnostic data may be handled outside the region. Sensitive values must never be placed in names or tags.
- **Global or non-regional services.** Identity, monitoring, content delivery, DNS and some security services have scopes broader than a region.
- **AI processing location.** Model deployment options differ in where prompts and outputs are processed and whether they are logged. This must be verified for each deployment type used (D-028, SEC-003).
- **People.** Operators, vendor support and engineers connecting from other countries can access data (D-033, SEC-002).
- **Pipelines.** Build systems, test environments and artefact stores can carry real data out (DATA-009).
- **Edge relays.** Anything between the edge and shore, such as brokers or sync services, is a data path (F-11).

Candidate measures to evaluate later, **none selected, none verified**: location restrictions by policy, private connectivity, customer-managed keys held in an in-jurisdiction hardware security module, controls over vendor support access, in-region redundancy rather than cross-region replication, in-jurisdiction model hosting or no AI on sovereign data, and hybrid or edge infrastructure located in the port. Each needs a design decision and evidence that it works as intended.

## 2. Zones

| Zone | Meaning |
|---|---|
| Z1 | Edge: computing located with the delivery operation inside the originating port jurisdiction (assumption AS-005) |
| Z2 | Shore platform located in the originating jurisdiction (hosting model per D-010) |
| Z3 | Group or regional hub in another jurisdiction |
| Z4 | Cloud or AI services whose processing location is not pinned to the originating jurisdiction |
| Z5 | Customer environment or customer-held copy |
| Z6 | Personnel access from outside the originating jurisdiction |
| Z7 | External recipients: certification bodies, registries, authorities, auditors, arbitrators |

## 3. Permitted placement by data class (proposed)

Legend: **Yes** proposed permitted. **No** proposed prohibited. **Cond (D-nnn)** permitted only after that decision. **TBD (D-nnn)** undecided; treat as No until decided. **–** not applicable. Data classes are defined in [DATA-CLASSIFICATION](DATA-CLASSIFICATION.md). Derived data inherits restrictions until D-011 says otherwise.

**Cross-boundary rule for every Cond cell.** For any Port-bound or Entity-bound class, a Cond cell in Z3, Z4, Z5, Z6 or Z7 is open only when **three** things hold: the legal basis is verified (D-009, with the candidate sources in V-35), the exact flow is recorded on the approved list (D-011, SEC-004), and the decision named in the cell is made. The named decision alone (for example a dispute or disclosure policy) never makes a cross-jurisdiction placement lawful. For Z6 (people outside the jurisdiction), SEC-002 applies: denied by default, break-glass inside the jurisdiction.

| Data class | Z1 | Z2 | Z3 | Z4 | Z5 | Z6 | Z7 |
|---|---|---|---|---|---|---|---|
| DC-01 Raw delivery measurement data | Yes | Yes | No | No | Cond (D-014) | No | Cond (D-025) |
| DC-02 Delivery evidence packages | Yes | Yes | No | No | Cond (D-014) | No | Cond (D-025) |
| DC-03 Blend and composition data | Yes | Yes | No | No | Cond (D-014) | No | Cond (D-025) |
| DC-04 Feedstock certificates | Yes | Yes | TBD (D-009) | No | TBD (D-024) | No | Cond (D-024) |
| DC-05 Methodology and reference data | Yes | Yes | Yes | Yes (no sensitive data) | Yes | Yes | Yes |
| DC-06 Calculation records | Yes | Yes | Cond (D-011) | No | Cond (D-029) | No | Cond (D-006) |
| DC-07 Mass-balance ledger | Yes | Yes | Cond (D-011) | No | No | No | Cond (D-023) |
| DC-08 Certificates | Yes | Yes | Cond (D-012) | No | Cond (D-012) | No | Cond (D-012) |
| DC-09 Filings and approvals | – | Yes | Cond (D-011) | No | – | No | Cond (D-006) |
| DC-10 Dispute evidence packs | – | Yes | No | No | Cond (D-014) | No | Cond (D-014) |
| DC-11 Customer compliance data | – | Yes | TBD (D-009) | No | Yes (own data only) | No | No |
| DC-12 Customer disclosure policies | – | Yes | TBD (D-009) | No | Yes (own policy only) | No | No |
| DC-13 Agent operational records | Cond (D-028) | Yes | No | No | No | No | No |
| DC-14 Telemetry and logs | Yes | Yes | Cond (D-011) | Cond (D-011) | No | Cond (D-033) | No |
| DC-15 Identity and access data | Yes | Yes | TBD (D-017) | TBD (D-017) | No | TBD (D-033) | No |
| DC-16 Keys and signing material | Cond (D-013) | Yes | No | No | No | No | No |
| DC-17 Configuration and source code | Yes | Yes | Yes | Yes | – | Yes | – |
| DC-18 Synthetic and test data | Yes | Yes | Yes | Yes | – | Yes | – |

Rows with Cond or TBD cannot be finalised without the named decision. Until then the safe reading is No.

## 4. Data-flow inventory to complete per port (SEC-001)

Residency is shown by evidence for each flow, not by a statement. For each port, each row needs an owner, the configuration evidence, and a negative test that tries to break it. Rows are categories to examine; whether a flow exists in a given design is unknown until the design exists.

| ID | Flow to examine | How it can breach | Evidence that it stays in the jurisdiction | Requirements |
|---|---|---|---|---|
| F-01 | Primary storage replication | Copies placed in another region or country | Replication configuration export; negative test | SEC-001 |
| F-02 | Backups and snapshots | Backup vault or copies outside | Vault location and policy exports; restore test in-jurisdiction | SEC-001, NFR-008 |
| F-03 | Disaster-recovery and failover target | Failover target in another jurisdiction | DR design review; failover test showing location | SEC-001, NFR-008 |
| F-04 | Telemetry, logs, metrics, traces, crash dumps | Observability data sent to a global or foreign workspace | Pipeline configuration; sample inspection | SEC-014, NFR-013 |
| F-05 | Identity directory and sign-in records | Directory data location and sign-in logs | Identity configuration review; legal opinion on the data held | SEC-009, DATA-010 |
| F-06 | Key management and signing | Keys or key operations outside | Custody evidence; signing test with outside links blocked | SEC-007, SEC-011 |
| F-07 | AI inference, embeddings, prompt and response logging, retrieval indexes | Prompts and context processed or stored outside | Deployment type and processing-location evidence per model; negative test | SEC-003, AGT-007 |
| F-08 | Management plane and metadata | Names, tags and configuration handled outside | Naming and tagging rule with a scan for sensitive values | SEC-001 |
| F-09 | Operator and support access | Remote access from other countries | Access policy; denial test; break-glass log | SEC-002 |
| F-10 | Build and deployment pipelines, artefact stores | Real data in builds or tests | Pipeline review; data scan | DATA-009 |
| F-11 | Edge-to-shore link and relays | Relay or broker outside | Network path evidence; capture of actual endpoints | SEC-001, SEC-013 |
| F-12 | Notifications and third-party services (email, chat, ticketing) | Sensitive content in messages | Content rules; review of integrations | SEC-004 |
| F-13 | Certificate verification, supersession lists, timestamping, name resolution | Verification depends on an outside service | Offline verification test | SEC-007, NFR-011 |
| F-14 | Customer channels, exports and downloads | Data leaves via customer-facing paths | Export policy review; sample test | SEC-004, FR-023 |
| F-15 | Non-production environments | Real data copied for tests | Non-production inventory; data scan | DATA-009 |

## 5. Hosting model candidates (none selected, D-010)

| Candidate | What must be verified before it can be considered |
|---|---|
| H-1 Cloud region physically in the jurisdiction | That the region exists; that every needed service is available there; the operating entity; how vendor support access works; the replication and metadata behaviour in section 1 |
| H-2 Sovereign or partner-operated cloud offering in the jurisdiction | Availability, service coverage, contract terms and operational responsibilities |
| H-3 Cloud-managed services running on infrastructure located in the port (hybrid) | What management data leaves the site; connectivity needs; supported services; operational burden |
| H-4 Group-owned or co-located infrastructure in the jurisdiction | Capacity, resilience and operational cost; security operations in-jurisdiction |
| H-5 Sovereign data held only at the edge, with shore holding only approved derived data | Durability and recovery at the edge; whether D-011 allows enough derived data to leave; audit access |

A different hosting model may be chosen per port. The design must allow that (NFR-016).

## 6. Per-port sovereignty record (to be completed before port-specific design)

For each port in scope (D-003): legal sources and their verification status; definition of "within the jurisdiction" (D-009); approved cross-border flows (D-011); hosting model and region evidence (D-010); inventory F-01 to F-15 with evidence; operator access model (D-033); break-glass owner; AI inference arrangement (D-028); sign-off by compliance counsel. A port is not ready for design sign-off until the record is complete.

## 7. Not assumed
- That an in-country region exists, or that its services meet the design.
- That any service keeps all data, metadata, logs or support access inside a region.
- That one interpretation of residency applies to every port.
- That derived data, hashes or logs are free to cross borders.
- That a certificate "locally hosted" in one place satisfies every jurisdiction.

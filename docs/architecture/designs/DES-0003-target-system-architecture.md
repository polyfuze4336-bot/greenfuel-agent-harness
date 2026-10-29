# DES-0003: Target system architecture for green-fuel bunkering certification

This is the system-level design decision for the programme. It is a real design question assessed honestly against the baseline. It is **not** an approval: the gate computes Blocked (see [RV-0003](../reviews/RV-0003-target-system-architecture.md)). No Azure resource is named as chosen or assumed available. No figure appears here: cost and volume figures live in the [business value model](../../business/BUSINESS-VALUE-MODEL.md), where each carries a class, and recovery and capacity placeholders live in [05 Quality attributes](../../target-architecture/05-QUALITY-ATTRIBUTES.md). Supporting views, contracts, threat model and defence are in [docs/target-architecture](../../target-architecture/README.md).

- **Design ID:** DES-0003
- **Review:** RV-0003
- **ADRs:** ADR-0016, ADR-0017, ADR-0018, ADR-0019
- **Tags:** DATA, EDGE, AGENT, CERT, CALC, OPS, INTEG, COST
- **Scope capabilities:** SOV, EDG, XC
- **Extra requirements in scope:** none

## 1. Decision question
What is the overall shape of the platform that delivers the five business capabilities under the eight mandatory constraints: where does evidence live, where do calculation, certificates, approvals and agents run, what is shared across ports, and how is Azure used? This serves BR-002 (verifiable evidence), BR-006 (several jurisdictions with residency) and BR-007 (intermittent connectivity). It is the decision that the storage topology (DES-0001) and ingestion (DES-0002) designs sit inside, and it must be made before the business case can be trusted, because the cost of sovereignty depends on it.

Data classes affected, from [DATA-CLASSIFICATION](../../context/DATA-CLASSIFICATION.md): all of DC-01 to DC-18, with DC-01 to DC-04, DC-08, DC-11 and DC-16 the most constrained.

## 2. Options

| Option | Name | Summary | Disposition |
|---|---|---|---|
| A | Centralised Azure cloud | One group platform in one Azure region serving every port; edge devices forward readings to it | Rejected (hard constraint) |
| B | Jurisdiction-local edge plus Azure shore platform | Raw evidence held at the edge or a port-local store; one shore platform on Azure processes derived data and runs the agents | Not selected |
| C | Hybrid sovereign evidence cells with federated coordination | One cell per port jurisdiction holds the system of record and runs the deterministic services and the agents; a thin group plane distributes signed methodology and policy and receives only approved classes; hosting per port is an Azure region or a jurisdiction-local host | Selected |
| D | Continue today's process | Manual and document-based work with existing point systems | Not selected |

Exactly one option is Selected. Option A has a Violated verdict in RV-0003.

## 3. Alternatives comparison

| Criterion | A | B | C | D |
|---|---|---|---|---|
| Data residency | Does not meet: data from several jurisdictions sits in one place and a region choice is not proof | Conditional: holds only if all processing of raw evidence stays at the edge or the local store; depends on D-009 and D-028 | Conditional: placement, backups, logs, inference and administration stay in the originating jurisdiction by construction; depends on D-009 and D-010 | Unknown: where current data sits is not known |
| Evidence integrity | Conditional: one append-only store is simple to protect but one compromise exposes every jurisdiction; mechanism open (D-013) | Conditional: the edge holds the only or a thin copy; protecting many devices is harder | Conditional: append-only store and chain per cell with anchored digests; mechanism open (D-013) | Does not meet: paper records can be altered undetectably |
| Availability | Conditional: one failure domain for all ports | Conditional: depends on small edge devices unless duplicated | Conditional: failure domains per cell; recovery must stay in the jurisdiction; targets open (D-031) | Unknown: not assessed |
| Scalability | Meets: managed services scale centrally | Conditional: edge compute limits raw-data work | Conditional: cells scale independently; a new jurisdiction adds a cell | Does not meet: effort grows with volume |
| Performance | Conditional: remote region adds latency to interactive use; capture is edge-first | Meets: capture and local reads are local | Meets: work runs near the port; no target exists (D-031) | Unknown: not assessed |
| Cost | Meets: lowest of the three in the model but ineligible, so a reference point only | Unknown: priced as a floor; local calculation and AI at every port are not priced | Conditional: highest of the eligible options because fixed costs repeat per cell; price of sovereignty shown in the model | Unknown: no baseline exists (D-034) |
| Operational complexity | Meets: one platform to run | Does not meet: many small sites to patch and secure | Does not meet: one deployment and operating arrangement per jurisdiction plus a group plane (RK-003) | Does not meet: manual effort and error |
| Security | Conditional: one large target; outside administration easiest to allow | Conditional: many exposed edge sites | Conditional: blast radius is one cell; administration from inside; per-cell keys | Does not meet: weak controls on paper |
| Certification auditability | Conditional: easy in one system, but auditors elsewhere would read data held abroad | Conditional: reconstruction spans edge stores and shore data | Meets: reconstruction is a cell query and bundles verify offline; depends on D-013 | Does not meet: audit preparation is a document hunt |
| Recovery | Conditional: one plan but recovery copies abroad breach residency for other ports | Does not meet: losing an edge device without a second copy loses evidence | Conditional: recovery inside the jurisdiction; must exist per cell (RK-013); targets open (D-031) | Unknown: not assessed |
| Vendor dependency | Conditional: deepest dependency on one cloud's regional and global services | Conditional: shore on Azure, edge on partner hardware | Conditional: portable cell contract with Azure as reference implementation; some services hard to replace | Meets: none, and none of the benefit |

## 4. Requirement trace

One row for every requirement tagged with a scope capability. This is a system-level design, so most rows are Partial: the design gives the requirement a home and a mechanism, and depends on decisions or sibling designs for the rest. The reviewer may downgrade.

| Requirement | Design element | How addressed | Status | Validation plan or evidence |
|---|---|---|---|---|
| BR-002 | Evidence store and package manifest in the cell | A complete package has a manifest of bound items and hashes and a computed completeness status; reconstruction is a cell query. Package completeness is a sibling design | Partial | Reconstruction tests with synthetic deliveries (plan); needs D-019 |
| BR-006 | Cell per jurisdiction | Raw data has one authoritative copy in its jurisdiction; proof per port is not defined | Partial | Per-port placement review and flow negative tests (plan); needs D-003, D-009, D-010 |
| BR-007 | Edge buffer and cell ingestion | Capture never depends on shore; sync is ordered and repeat-safe; buffer sizing needs the disconnection period | Partial | Edge simulator disconnection tests (plan, RT-08 pending); needs D-020 |
| BR-008 | Business value model | A scenario model with every figure labelled; no baseline exists so no result is claimed | Partial | Baselines from discovery (plan); needs D-034 |
| BR-009 | This design creates no code and no resources | The phase stays at zero; the design is documents only | Addressed | validate-harness phase gate; no application code in the repository |
| FR-001 | Capture service and ingestion gateway | Readings bound to device identity and timestamp; the meter interface is unknown | Partial | Contract tests on fixtures exist for the candidate; device tests need D-019 |
| FR-006 | Edge buffer, idempotent sync | Capture offline; reconcile later without alteration; gaps reported | Partial | Candidate ingestion oracle tests; edge simulator needed |
| FR-026 | Certificate service with hash chain and signing in cell custody | Tamper-evident certificates hosted in the cell with an offline verification bundle; mechanism open | Partial | Reference verifier tests (plan); needs D-006, D-012, D-013 |
| FR-027 | Filing service and approval service | Filings are drafts; submission needs a separate quality-manager approval bound to the content | Partial | Approval-bypass tests (plan, RT-10 production half pending); needs D-007 |
| FR-028 | Authoritative status record | Status is read from what the body or authoritative process recorded; the platform never asserts it | Partial | Status tests (plan); the authoritative source is unknown (D-006) |
| FR-029 | Lineage records and reconstruction query | Every derived value names its inputs by hash; a query rebuilds the chain from certificate to raw readings, approvals and agent actions | Partial | Reconstruction tests (plan); needs D-025 |
| FR-030 | Versioned records | Corrections are new versions with a reason and an approver; originals remain | Partial | Version and supersession tests (plan) |
| FR-031 | Chain entries for supersession and revocation | Supersession and revocation are recorded in the chain and verifiable by a third party | Partial | Verifier tests (plan) |
| SEC-001 | Cell placement rule | Stores, replicas, backups, logs and processing for a jurisdiction are in its cell | Partial | Placement and flow evidence per port (plan); needs D-009, D-010 |
| SEC-002 | Administration inside the cell; pull-based deployment | Outside administration denied by default; break-glass inside, approved and logged; the group plane publishes signed change sets and an in-cell runner without data-read rights applies them, so deployment is not an outside administration route | Partial | Access review per cell and a test that the runner cannot read evidence (plan); needs D-033 |
| SEC-003 | In-cell inference or none | Inference over delivery data only in the cell; agents optional per cell | Partial | Verification of deployment type per jurisdiction (plan); needs D-028 |
| SEC-004 | Approved-flow list at the group boundary | Cross-jurisdiction flows only for listed classes with a legal basis; the default list is empty | Partial | Allow-list negative tests (plan); needs D-009, D-011 |
| SEC-005 | Per-shipowner partitions and execution contexts | Separate storage, indexes, caches, logs, memory and credentials per shipowner, and a per-shipowner execution context with tenant-bound inference requests and no shared server-side caches, batching, traces or retention across shipowners | Partial | Isolation design and tests including cache reuse, replay, trace and retry paths (plan); needs D-015, D-028 |
| SEC-006 | Isolation tests | Tests prove a principal scoped to shipowner A cannot retrieve or be prompted into disclosing B | Partial | Production-agent isolation suite (plan, pending) |
| SEC-007 | Keys in cell custody; offline verifier | Signing keys held under local control; verification needs only public material | Partial | Custody review and verifier tests (plan); needs D-013 |
| SEC-008 | Append-only store with chain and anchor | Modification or deletion is detectable; privileged destruction needs an external anchor | Partial | Chain and anchor tests (plan); needs D-013 |
| SEC-009 | Workload and human identities | Separate identities per component and per agent; no standing broad roles; global identity scope is an open residency question | Partial | Identity and access review (plan); needs D-027, D-033 |
| SEC-010 | Approval service outside agents | Agent identities cannot hold the permission; approvals bind to a content hash; separation of duties | Partial | Approval-bypass tests (plan); needs D-007, D-027 |
| SEC-011 | Managed key service | Keys in a managed key service under defined custody; no secrets in code, prompts or logs | Partial | Secret scanning and custody review (plan); needs D-013 |
| SEC-012 | Tool gateway and output sanitiser | Untrusted documents, messages and tool output are data and cannot change policy | Partial | Injection tests (plan, RT-01 production half pending) |
| SEC-013 | Edge device security | Authenticated devices, signed software, protected storage, update control, tamper considerations | Partial | Edge security review (plan); needs D-018 |
| SEC-014 | In-cell telemetry and audit | Logs and monitoring stay in the cell with controlled export | Partial | Log content tests (plan); retention open (D-016) |
| SEC-015 | Signed builds and packages | Signed builds, dependency inventory, controlled promotion for calculation engine and agent tooling | Partial | Supply-chain checks (plan) |
| DATA-001 | Classification by cell and class | Each item inherits owner, classification, residency and isolation tags; no catalogue exists yet | Partial | Data catalogue (plan) |
| DATA-002 | Immutable raw store | Raw data stored immutably with source, trusted timestamp and sequence number; trusted time open | Partial | Store tests (plan); needs D-021 |
| DATA-003 | Lineage records | Every derived value links to its inputs by hash | Partial | Lineage tests (plan) |
| DATA-004 | Canonical identifiers | One identifier each for delivery, batch, tank, vessel, customer and methodology version | Partial | Contract tests for identifier rules exist for the candidate; others plan |
| DATA-006 | Retention and legal hold | Rules per data class and jurisdiction are not set; immutability must wait for them | Unresolved | Retention design after D-016 |
| DATA-008 | Quality status on records | Verified, unverified, disputed, corrected carried on records | Partial | Contract tests (plan) |
| DATA-009 | Environment separation | Non-production uses synthetic or approved-masked data; separate subscriptions or hosts | Partial | Data-movement negative tests (plan); needs D-036, D-037 |
| DATA-010 | Personal data minimisation | Personal data analysis is not done | Unresolved | Privacy review after D-017 |
| AGT-001 | Agent charters | Each agent has a written charter; per-agent detail is in the baseline and a sibling design | Partial | Charters per agent (plan) |
| AGT-002 | Tool gateway and role assignments | Permissions come from catalogue plus identity role plus approval; autonomy grants nothing | Partial | Gateway catalogue tests (plan); needs D-027 |
| AGT-003 | No model on the value path | Values come from authenticated sources with provenance; missing values fail closed | Partial | No-invention evaluation (plan, D-030) |
| AGT-004 | Deterministic tools for numbers | Numbers in agent output come from deterministic tools and trace to tool-call records | Partial | Tool-call trace tests (plan) |
| AGT-005 | Approval queue in the gateway | External-effect actions go to an approval service outside the agent | Partial | Approval-bypass tests (plan) |
| AGT-006 | Role design | Agents hold no infrastructure, identity, policy or methodology permission | Partial | Role review and negative tests (plan) |
| AGT-007 | Audit ledger | Inputs, retrieved evidence, tool calls, outputs, approvals, model and prompt versions logged in the cell | Partial | Audit completeness tests (plan) |
| AGT-008 | Evaluation before release | Evaluation of no-invention, isolation and refusal behaviour; thresholds undecided | Unresolved | Production-agent suite (plan, pending); needs D-030 |
| AGT-009 | Version recording | Prompt, model and tool-configuration versions recorded with each output | Partial | Version tests (plan) |
| AGT-010 | Deterministic core independent of AI | Capture, binding, calculation and verification run without AI or connectivity | Partial | Failure-injection tests (plan) |
| AGT-011 | Separate estates | Business agents live in cells; the coding harness has no access to production data, keys or tenants | Addressed | ADR 0001 and the harness permission and isolation tests; AGENT-CONNECTIVITY |
| NFR-001 | Chain, immutability, anchors | Change or deletion of stored evidence is detectable by independent verification | Partial | Verifier and tamper tests (plan); needs D-013 |
| NFR-003 | Reconstruction query | Reconstruction is one query per cell; the effort target is undefined | Partial | Reconstruction timing against a target after D-031 |
| NFR-004 | Edge autonomy | Capture and local verification continue for the disconnection design period | Partial | Edge simulator (plan); needs D-020 |
| NFR-005 | Idempotent ordered sync | Sync is idempotent, resumable, ordered and reports gaps | Partial | Candidate oracle tests exist; edge simulator needed |
| NFR-006 | Local capture path | Capture never waits on shore or on a service call and does not delay the operation | Partial | Edge tests (plan) |
| NFR-007 | Per-cell availability design | Availability is a per-cell property; targets undecided | Unresolved | Targets from D-031 |
| NFR-008 | In-jurisdiction recovery | No loss of acknowledged evidence; recovery stays in the jurisdiction; objectives undecided | Partial | Recovery exercise per cell (plan); needs D-031 |
| NFR-009 | Single placement per cell | Residency is checked against one expected placement; a cadence of configuration and flow evidence is designed but not specified | Partial | Residency evidence cadence (plan) |
| NFR-010 | Isolation tests in pipeline | Tenant isolation tests run in the release pipeline and on a schedule | Partial | Isolation suite in the pipeline (plan) |
| NFR-011 | Open formats and offline verification | Certificates and evidence verifiable for the retention period independent of platform version | Partial | Format review with auditors (plan); needs D-016 |
| NFR-012 | Algorithm and key identifiers | Identifiers in every signed object so rotation does not break history | Partial | Rotation tests (plan) |
| NFR-013 | Correlation identifiers in the cell | Logs, metrics and traces link edge events, cell processing and agent actions and stay in-jurisdiction | Partial | Observability tests (plan) |
| NFR-015 | Per-cell scaling | Each cell scales independently; volumes unknown | Partial | Load tests after D-032 |
| NFR-016 | Cell independence | Each cell continues without group or other cells; offline issuance depends on D-007 and D-020 | Partial | Failure-injection tests (plan) |
| NFR-017 | Trusted time at the edge | An approved time source and drift record; mechanism open | Partial | Time tests (plan); needs D-021 |
| NFR-018 | Open bundle formats | Certificates and packs in documented open formats a third party can verify | Partial | Reference verifier (plan) |
| NFR-019 | Cost attribution | Tags per port, capability and customer without sensitive names; model attributes cost per cell | Partial | Cost reports (plan) |

## 5. Tradeoffs

| ID | We gain | We give up | Borne by | Reversible | Links |
|---|---|---|---|---|---|
| TD-001 | Residency, isolation and recovery as testable properties of each cell | Lower cost and operational simplicity: fixed costs repeat per jurisdiction | Programme owner and operations | Partly: cells can merge if the law allows, but placed data cannot move without a legal check | RK-003, D-003, D-009 |
| TD-002 | The edge as a buffer and the cell as the record, so one lost device cannot lose evidence | A hosting decision and a recovery design for every jurisdiction, including local hosts where no region qualifies | Operations and compliance | Partly: hosting per port can change if the cell contract is kept | RK-002, RK-013, D-010 |
| TD-003 | Agents optional per cell, so no sovereign data reaches an unverified model | Uniform agent features across ports | Business owners and customers | Yes: agents can be enabled later per cell | RK-009, D-028 |
| TD-004 | A thin group plane that holds no raw data and so cannot become a breach | Group-level visibility: reporting is limited to approved classes | CEO and trading head | Yes: the approved list can widen with a legal basis | RK-004, D-011 |
| TD-005 | A deterministic core that stays correct without any model | The size of the agentic benefit: it must be proven rather than assumed | Sponsor | Yes: agents sit behind a gateway and can be added or removed | RK-012, D-030 |
| TD-006 | A portable cell contract built on containers, PostgreSQL, object storage and an AMQP-class broker | Use of some Azure-specific managed features and the savings they bring | Platform architect | Partly: the contract is a design discipline, not a guarantee | RK-002, D-010 |

## 6. Assumptions and constraints

| ID | Assumption | If wrong | Validate by |
|---|---|---|---|
| DA-001 | The group operates in more than one port jurisdiction (AS-003) | If only one jurisdiction is in scope, option A becomes eligible and may be cheaper | D-003 |
| DA-002 | The edge is inside the originating jurisdiction (AS-005) | The edge buffer is itself a cross-border copy and needs its own approved flow | D-018, D-009 |
| DA-003 | Residency covers processing and administrative access as well as storage | If it covers storage only, more can be centralised and the cell shrinks | D-009 |
| DA-004 | Meters or loggers can supply readings electronically and some can sign (AS-006) | Evidence authenticity at source is weak and the platform can only corroborate and flag | D-019 |
| DA-005 | Some in-jurisdiction hosting, Azure or local, can be established for each port | A port is excluded from scope or runs with a weaker recovery objective | D-010 |
| DA-006 | Offline periods are bounded (AS-017) and the edge can hold the data | Buffer overflow loses or delays evidence | D-020, D-032 |
| DA-007 | The workload is small, so fixed per-cell costs dominate | If much larger, capacity design and the business case change | D-032 |
| DA-008 | A quality manager exists for each port or entity with a deputy (AS-013) | Approval becomes a bottleneck or a single point of failure | D-007 |
| DA-009 | Group reporting needs only a short list of derived classes | A longer list turns the group plane into a data store that needs its own residency analysis | D-011 |

| ID | Constraint | Source |
|---|---|---|
| CN-001 | No Azure resource is created and no application code is written; deployment is human-approved and deferred | HC-11, T36 |
| CN-002 | No performance, availability or cost figure is presented as a target; placeholders are labelled | HC-12 |
| CN-003 | Every standard, scheme and regulation is a candidate until verified | HC-10 |
| CN-004 | Region selection is not residency proof | HC-01, CS-P4 |
| CN-005 | Autonomy is not permission; approvals are human and technically enforced | HC-09, HC-04 |

## 7. Risks

| Risk | Residual note |
|---|---|
| RK-001 | Residency obligations may be wider than assumed; cells already cover processing, access and telemetry, but the legal reading per port is open |
| RK-002 | A port may have no suitable in-jurisdiction hosting; local-host cells are the fallback and carry higher operations cost |
| RK-003 | Cost and effort multiply with each jurisdiction; the model shows the price and fewer jurisdictions is the main lever |
| RK-004 | Group-level visibility is poorer than the business expects; approved flows are the only mitigation and need a legal basis |
| RK-005 | Edge data may be lost or misordered in long disconnections; buffer design and the simulator reduce it |
| RK-006 | Ports may run different methodology versions; labelled results and signed distribution make it visible, not impossible |
| RK-007 | Local key custody may be mishandled; mechanism undecided |
| RK-008 | Remote support or administration may breach residency; denied by default, support model open |
| RK-009 | The design may depend on a scheme that is not applicable; every scheme stays a candidate |
| RK-010 | Cross-port mass balance may not be computable because ledgers are port-bound; depends on approved aggregate flows |
| RK-013 | A single-jurisdiction recovery design may be less resilient than a multi-country design; accepted explicitly or not allowed |

## 8. Open decisions that affect this design

- **D-003, D-009, D-010, D-011:** the ports, what residency means for each, where each cell is hosted and what may cross. These decide the number and kind of cells and whether the group plane carries anything. Blocking.
- **D-013, D-012, D-006:** key custody and tamper-evidence mechanism, what "locally hosted" is local to, and what a certificate is. They decide the certificate and integrity design (ADR 0018). Blocking.
- **D-027, D-007, D-033:** identity and permission model, the quality-manager role, and the operating and support model. They decide approval and administration.
- **D-028, D-030:** where inference runs and how agents are evaluated. They decide whether and where agents run.
- **D-018, D-019, D-020, D-021:** the edge platform, measurement sources, the disconnection period and trusted time. They decide edge design and evidence authenticity.
- **D-031, D-032, D-034:** targets, volumes, measures and cost envelope. They decide the quality attributes and the business case.
- **D-016, D-017, D-036, D-037:** retention, personal data, non-production data and the Azure tenant and subscription. They gate immutability, privacy analysis and any verification.

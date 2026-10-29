# Stakeholder analysis

Status: candidate analysis, Phase 0, 2026-10-29. **Every stakeholder below is a candidate.** The case study names only the quality manager (CS-C4) and the shipowner as customer (CS-C2, CS-CAP-5); the other roles are inferred from the capabilities or are common in bunkering, and none has been interviewed. Objectives, pain points and measures are **hypotheses (class B)**; the questions in each last row are **class C** items for stakeholder discovery. Decision authority is a proposal and does not grant any permission: autonomy is not permission (HC-09) and a role here is not a registered approver (see [APPROVER-ENROLLMENT](../security/APPROVER-ENROLLMENT.md)).

Where a measure appears here it has **no baseline**; per BR-008 a measure without a baseline is not reported as a result. The model figures that relate to these measures are scenario assumptions in [BUSINESS-VALUE-MODEL](BUSINESS-VALUE-MODEL.md).

| Stakeholder | Basis | Decider for | Related decisions |
|---|---|---|---|
| CEO / group executive sponsor | Candidate | Funding, risk appetite, whether to proceed | D-034, D-037 |
| Quality manager | **Stated** (CS-C4) | Approval of every certification filing; methodology acceptance | D-007, D-022 |
| Trading head | Candidate | Green-fuel pricing, customer commitments, which deliveries carry a premium | D-004, D-005, D-034 |
| Terminal operator | Candidate | Access to meters, tanks, networks and staff at the terminal | D-018, D-019, D-033 |
| Barge operator | Candidate | Edge equipment on the vessel, crew procedures, connectivity | D-018, D-020, D-021 |
| Shipowner (customer) | **Stated** (CS-C2) | What it accepts as evidence; its own disclosure policy | D-005, D-015, D-029 |
| Certification auditor / body | Candidate | Whether evidence and reconstruction satisfy the scheme | D-001, D-006, D-025 |
| Compliance team (including counsel, security, data protection) | Candidate | Legal reading of residency, privacy, filings; control sign-off | D-002, D-009, D-017 |

## 1. CEO / group executive sponsor

| Aspect | Content (hypothesis unless marked) |
|---|---|
| Business objectives | Protect and grow the green-fuel premium by making green claims trustworthy; enter new ports without a residency or compliance incident; show a defensible return on the investment |
| Pain points | Cannot tell how much premium revenue is exposed to claims and disputes today; reputational risk if a certificate is shown to be wrong or altered; every new jurisdiction is a legal unknown |
| Decision authority | Funds and approves the programme and its budget; accepts residual risk after the architecture is reviewed. Does **not** approve individual certificates or deployments |
| Required capabilities | One executive view of certificates issued, exceptions, disputes and approval turnaround, built only from data cleared for group reporting (D-011); evidence that controls work, not only that they exist |
| Operational constraints | Group view must not breach port residency (CS-C1); decisions are needed per jurisdiction as law differs |
| Success measures | Premium revenue lost to evidence-related claims; time from delivery to certificate; number of residency or isolation incidents (target zero); payback against the cost envelope. **No baselines exist (D-034)** |
| Unanswered discovery questions | What is the budget and timeline? Which return measure does the group use? What loss from a single disproved green claim would the group consider material? Which ports are strategic? Who owns residual risk? |

## 2. Quality manager

| Aspect | Content |
|---|---|
| Business objectives | Issue only certificates and filings that survive audit; keep calculations reproducible to the exact methodology version (CS-C5); keep the filing queue moving |
| Pain points | Assembling evidence from meters, blend sheets, feedstock certificates and transfer documents is manual and error-prone; rework when a method version changes; proving to an auditor what was known at the time |
| Decision authority | **Stated (CS-C4):** approves every certification filing, bound to the exact content submitted. Proposed: accepts methodology versions with the scheme owner's guidance (D-022). Cannot be an agent identity (SEC-010) |
| Required capabilities | A complete, hash-bound evidence package per delivery with gaps visible; a prepared draft filing; one-step reconstruction from certificate to raw readings (FR-029); re-run of any historical calculation (FR-011); approval that is cryptographically tied to what was reviewed |
| Operational constraints | Approval needs a person with a deputy (D-007); per-port or group role is unknown; must work with intermittent connectivity at the point of delivery; must not rely on out-of-jurisdiction access |
| Success measures | Approval turnaround; share of filings accepted first time; reproduction rate of re-run calculations; exceptions open and their age. No baselines |
| Unanswered discovery questions | One quality manager per port or per group? Who deputises? What is the volume per person per day? What does the scheme or body require to be attached? What happens today when a filing is rejected? Who can say a methodology version is approved? |

## 3. Trading head

| Aspect | Content |
|---|---|
| Business objectives | Sell green fuel at a premium with confidence the premium will hold; win customers who demand auditable claims; avoid concessions in disputes |
| Pain points | Customers challenge quantity, quality or emissions claims after delivery; slow certificates delay invoicing or customer reporting; cannot promise volumes of certified fuel without knowing the certified balance |
| Decision authority | Commercial terms and pricing; which customers receive which disclosure (within the policy the shipowner agrees). Cannot override evidence or approve a filing; commercial settlement stays human (HC-09) |
| Required capabilities | Reliable certified-balance visibility (mass balance, FR-017 to FR-021); faster, evidence-backed answers in disputes; customer-facing answers without staff effort |
| Operational constraints | Commercial data classes are sensitive; cross-customer views are forbidden (CS-C2); group-level balance across ports needs an approved flow (D-011) |
| Success measures | Share of premium revenue disputed or discounted; dispute cycle time; green volume sold with evidence available at invoice. No baselines |
| Unanswered discovery questions | How are premiums set and invoiced today? What do contracts say about evidence and claims? How often are credit notes issued on green deliveries? Which customers insist on audit rights? Is certified supply ever oversold today? |

## 4. Terminal operator

| Aspect | Content |
|---|---|
| Business objectives | Keep operations safe and on schedule; avoid extra work for operators; keep control of terminal systems and networks |
| Pain points | Paper and ad hoc data exchange at transfer; evidence requests from several parties for the same operation; unclear liability for measurement data |
| Decision authority | Whether equipment may be installed and data taken from its meters, tank gauges and networks; local operating procedures. May be a third party to the group |
| Required capabilities | Capture without interfering with transfer systems; read-only interfaces to meters and tank gauges where possible; clear ownership of what is captured |
| Operational constraints | Safety and hazardous-area rules; site network policy; limited connectivity; staff may not be employed by the group (D-033) |
| Success measures | No delay to transfers caused by the platform; no operator rework; data capture completeness at the terminal. No baselines |
| Unanswered discovery questions | Who owns the meters and tank gauges, and what interfaces do they expose (D-019)? Can a signing logger be installed? Which network rules apply? Who is liable for a measurement fault? Is the terminal in the same legal entity as the group? |

## 5. Barge operator

| Aspect | Content |
|---|---|
| Business objectives | Complete deliveries on time with minimal paperwork; avoid disputes about quantity; keep crew workload low |
| Pain points | Intermittent or no connectivity at anchorage; manual copying of readings and signatures; disputes over the barge's own meter |
| Decision authority | Procedures on board; whether hardware may be fitted to the vessel; crew sign-off steps |
| Required capabilities | Capture and sign readings and blend data offline with a trusted clock, queue them durably, and synchronise safely later (FR-006, NFR-004, NFR-005); simple crew workflow |
| Operational constraints | Vessel classification and electrical rules; space, power and ruggedness; crew training; the disconnection period is unknown (D-020); a trustworthy time source is needed (D-021) |
| Success measures | Share of deliveries with complete evidence at close without connectivity; no lost or duplicated events after reconnection; crew minutes per delivery. No baselines |
| Unanswered discovery questions | How long is the longest disconnection? What does the barge's meter expose and can it sign? Who maintains the device? Who can fit equipment on a chartered vessel? What is the current crew procedure? |

## 6. Shipowner (customer)

| Aspect | Content |
|---|---|
| Business objectives | Receive verifiable evidence that the fuel delivered is what was claimed so the owner can meet its own reporting; resolve disagreements quickly; keep its commercial data private |
| Pain points | Waiting for certificates; opaque evidence; cannot check claims independently; fear that its data could be seen by competitors |
| Decision authority | Accepts or contests a delivery's evidence; sets its own disclosure policy; chooses which of its staff and agents may query (D-029). Does not decide the group's methodology |
| Required capabilities | Delivery-related compliance answers from verified records only, citing the record and methodology version (FR-022); answers governed by the owner's disclosure policy before any answer is formed (FR-023); refusal or escalation instead of a guess (FR-024); offline-verifiable certificates |
| Operational constraints | Customer isolation in storage, retrieval, caches, logs and agent memory (CS-C2, SEC-005); customer entity model is open (owner, manager, charterer; D-015); customers may be in other jurisdictions (D-014) |
| Success measures | Time to a usable answer; share of enquiries answered without staff; **cross-customer disclosures, target zero**; disputes resolved at first review. No baselines |
| Unanswered discovery questions | How many customers and which types (D-005)? What do they want to see and in what format? Do they accept a third-party verifier? How do they handle charterer or manager relationships? What are their own audit obligations? |

## 7. Certification auditor / body

| Aspect | Content |
|---|---|
| Business objectives | Obtain evidence sufficient to assure the claimed attributes with minimal sampling uncertainty; trace any figure to its source |
| Pain points | Documents that cannot be tied to readings; methods applied inconsistently across sites; evidence that could have been changed after the fact |
| Decision authority | Whether a certificate or filing is accepted under the scheme. **Which schemes and bodies apply is unknown (D-001) and every named framework in [CERTIFICATION-SCHEMES](../context/CERTIFICATION-SCHEMES.md) is a candidate until verified (D-002)** |
| Required capabilities | Read access to evidence inside the jurisdiction (AS-024); reconstruction of the chain from certificate to raw data, methodology version, approvals and actions (FR-029); independent verification of a certificate without the group's services (HC-03) |
| Operational constraints | Independence: the group cannot decide what the auditor trusts; auditors may be in another jurisdiction, so access to jurisdiction-bound data is an approved flow or happens in the jurisdiction (SEC-002, D-025) |
| Success measures | Audit preparation effort; findings per audit; time to answer a sampling request. No baselines |
| Unanswered discovery questions | Which bodies and schemes? What evidence formats do they require? Will they accept a hash-based verifier? What access model do they need? How do they treat model-prepared drafts? |

## 8. Compliance team

| Aspect | Content |
|---|---|
| Business objectives | Meet residency, privacy and scheme obligations in every port; prove controls to regulators and customers; avoid unverified compliance claims |
| Pain points | Residency law differs per port and is hard to interpret; cloud region claims are not proof; processing by AI can move data; difficult to evidence that support staff did not access data |
| Decision authority | Legal interpretation of "within the jurisdiction" per port (D-009); approved cross-border flow list (D-011); privacy regime (D-017); sign-off of controls. Cannot be satisfied by a region choice (CS-P4) |
| Required capabilities | Per-port residency evidence: where each data class lives, which flows exist, who has access, where backups, logs and AI processing happen; an audit trail of access and approvals; the ability to show a negative (data did not leave) |
| Operational constraints | Controls must be demonstrable, not asserted; legal review per jurisdiction takes time; some interpretations may forbid parts of a cloud design |
| Success measures | Open residency findings; share of data classes with verified placement evidence; access reviews completed; incidents (target zero). No baselines |
| Unanswered discovery questions | Which ports and what do the local rules say? Does the rule cover storage only or also processing, access, telemetry and AI inference? Is the edge inside the jurisdiction? Which vendor support access is tolerated? What proof will regulators accept? |

## Conflicts and trade-offs between stakeholders

| Tension | Between | Design response |
|---|---|---|
| Group-wide visibility versus port residency | CEO, trading head against compliance | Group views use only data classes on the approved flow list (D-011); everything else stays in the cell. Poorer visibility is accepted and disclosed (RK-004) |
| Speed of certificate versus human approval | Trading head against quality manager | Approval is never automated (CS-C4); speed comes from preparation, not from skipping review |
| Simple edge equipment versus strong edge security | Barge and terminal operators against security | Minimal on-board footprint that signs and queues; authentication and update control are the price (SEC-013) |
| Open evidence access versus customer isolation | Auditor against shipowners | Auditor access is scoped per scope of audit and per customer, inside the jurisdiction; no cross-customer view (SEC-005) |

## What stays unknown until discovery

Every row marked "No baselines", the identity of the decision makers, and the actual ports. The architecture is designed so that the unknown answers change parameters and placement, not the structure, but the business case cannot be trusted until D-034 is answered.

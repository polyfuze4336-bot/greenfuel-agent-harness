# Business Case

Status: baseline v0.1, 2026-10-28. **This is a framing document, not a financial business case.** The case study contains no revenue, cost, volume, customer, timeline or baseline data, so no benefit is quantified and no return is claimed. Statements are labelled with the baseline classes: **A** stated in the case study, **B** hypothesis or assumption, **C** needs clarification ([DECISION-REGISTER](DECISION-REGISTER.md)), **D** needs verification ([CERTIFICATION-SCHEMES](CERTIFICATION-SCHEMES.md)).

## 1. Context (class A)
An Asian marine fuels group wants an Azure-native agentic solution for green-fuel bunkering certification. It names five capabilities (delivery evidence, emissions attributes, dispute resolution, mass balance, customer compliance) and eight mandatory constraints. See [PROBLEMSTATEMENT](../../PROBLEMSTATEMENT.md).

## 2. The business problem (class B, to be confirmed with the owner)
The case does not state the problem. The most direct reading of the capabilities and constraints is:

- A customer who buys a green-fuel delivery needs to rely on claims about what was delivered, in what quantity, with which emissions attributes, from certified feedstock. Those claims have to survive scrutiny later, including disputes (CS-CAP-3) and audits (CS-C8).
- Evidence for one delivery comes from different sources: meters, blend records, feedstock certificates, transfer documents. Binding it together reliably and keeping it tamper-evident is the core difficulty (CS-CAP-1, CS-C3).
- Claims of certified quantity have to reconcile to certified supply as fuel moves through tanks and blends (CS-CAP-4).
- Customers have different disclosure rights and must not see each other's data (CS-CAP-5, CS-C2).
- Data about a delivery may not leave the port jurisdiction (CS-C1), and the link between vessel or terminal and shore is unreliable (CS-C7).

Whether these are today's pain points, and how large, is **unknown (C)**. D-034 asks for measures and baselines.

## 3. Value hypotheses (class B, none quantified)

| Capability | Hypothesis | Beneficiary | Candidate measure (baseline unknown) |
|---|---|---|---|
| Delivery Evidence | Complete, bound evidence per delivery reduces effort and error in assembling proof | Port operations, quality manager | Share of deliveries with a complete package at delivery close; manual hours per package |
| Emissions Attribute | Deterministic, versioned calculations remove rework and make results reproducible | Quality manager, customers | Share of results reproduced identically on re-run; time to produce an attribute |
| Dispute Resolution | Sensor-backed packs shorten review of disagreements | Commercial reviewers | Time to assemble a pack; share of disputes resolved on first review |
| Mass Balance | Continuous reconciliation catches over-claims earlier | Quality manager | Number and age of unresolved exceptions per period |
| Customer Compliance | Direct, policy-bound answers reduce manual enquiries | Customer-facing teams, shipowners | Enquiry volume handled without staff; cross-customer disclosures (target zero) |

These are hypotheses to test. They are not forecasts.

## 4. Where agents add value and where they do not (class B)
CS-CAP-2 and CS-C5 require calculations to be deterministic, and CS-C6 forbids AI from inventing facts. That limits what an agent contributes. A useful working split, to be tested in options analysis:

- **Deterministic software** (not an agent): calculation, hashing, signing, ledger posting rules, approval enforcement, isolation enforcement.
- **Agents**: orchestrating the binding of evidence from varied sources, spotting gaps and inconsistencies, drafting packs and filings for humans, answering customer questions within policy, explaining results with citations.

If most value comes from the deterministic parts, the case for "agentic" rests on orchestration and natural-language access, and that should be shown, not assumed (AS-021).

## 5. Stakeholders

| Stakeholder | Basis | Interest | Open |
|---|---|---|---|
| Quality manager | Stated (CS-C4) | Approves filings; owns methodology and evidence quality | D-007 |
| Commercial reviewers | Implied by "commercial review" (CS-CAP-3) | Resolve disputes | D-007 |
| Shipowners (customers) | Stated (CS-C2, CS-CAP-5) | Delivery-related compliance answers | D-005, D-015 |
| Port operations (vessel and terminal staff) | Assumed | Generate evidence during deliveries; run the edge | D-019 |
| Port jurisdictions and their authorities | Stated by implication (CS-C1) | Residency and, possibly, bunkering rules | D-003, D-009 |
| Certification bodies, scheme owners, auditors | Assumed | Receive filings; audit | D-001, D-006, D-025 |
| Compliance counsel, security and data protection leads | Assumed | Interpret obligations; approve controls | D-002, D-009 |
| Programme owner | Assumed | Funds and decides | D-034 |

## 6. Scope

**In scope for the baseline (class A):** the five capabilities and eight constraints.
**Out of scope at this stage (class A, CS-P2):** building the business application; creating Azure resources.
**Not decided (C):** ports, fuels, schemes, existing systems, which customers go first.

## 7. Business-level options to examine in Stage 2 (none chosen)
1. Continue current manual and document-based processes.
2. Adopt tooling from a certification scheme or vendor where it exists, and add only the missing parts.
3. Build the agentic platform described in the case.
4. A phased combination: deterministic evidence and calculation core first, with agents added where they demonstrably add value.

The case specifies option 3's direction (CS-P1). Options 1, 2 and 4 are kept visible so that the choice is explicit and defensible.

## 8. Business risks (class B)

| Risk | Consequence | Mitigation direction |
|---|---|---|
| A residency or isolation breach | Contract or legal exposure, loss of customers | Prove controls by evidence (SEC-001, SEC-006, NFR-009, NFR-010) |
| A wrong or unreproducible attribute | Customers rely on incorrect claims | Deterministic versioned calculation and re-run (FR-008, FR-011) |
| An agent-invented fact | Fraud-like exposure | Zero-tolerance evaluation, source-bound outputs (AGT-003, AGT-008) |
| Unverified regulatory assumptions | Wrong design | Verification procedure before reliance (D-002) |
| Scope growth through unstated requirements | Delay and rework | Decision register and baseline change control |
| Edge conditions not understood | Evidence gaps | Early survey of meters, loggers and connectivity (D-019, D-020) |

## 9. Success measures
None are set. Candidate measures in section 3 need baselines (D-034). A measure without a baseline is not reported as a result.

## 10. What this document does not contain
Costs, savings, revenues, prices, volumes, customer counts, market sizes, timelines, regulatory penalties, and any claim about competitors. None was provided, and none is invented.

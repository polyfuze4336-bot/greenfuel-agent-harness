# ADR 0019: Azure services are selected by requirement and verified per jurisdiction

- **Status:** Proposed
- **Type:** Design
- **Date:** 2026-10-29
- **Deciders:** Design approver (not yet named, T3), with the platform architect, the compliance lead and the sponsor
- **Supersedes:** none
- **Review:** RV-0003

## Context
- FACT: The target is an Azure-native agentic solution (CS-P1), but deploying to an Azure region is not to be assumed to satisfy port-jurisdiction residency (CS-P4; HC-01). The programme brief says candidate services are candidates, selected by requirement, availability, cost, operational complexity and trade-offs, not because they exist.
- FACT: [ADR 0014](./0014-azure-readiness-scaffold-and-provisional-selection.md) is Accepted and records a provisional, non-deployable selection that is explicitly not a decision on any service. This ADR does not amend it; it sets how a provisional lean becomes a decision.
- FACT: No Azure resource exists, no service or region was verified, and no sign-in was used. The only Azure facts gathered are public list prices retrieved anonymously on a recorded date.
- FACT: Global or non-regional services (identity, monitoring, some management planes), redundancy options that replicate to a paired region, and model deployment types whose processing location differs all affect residency (SOVEREIGNTY-MATRIX).
- FACT: The deployment decision (tenant, subscription, landing zone) is open (D-037) and actual deployment is deferred by the owner (T36).

## Requirements addressed
- SEC-014: security logs and monitoring stay in the jurisdiction with controlled export.
- SEC-015: supply chain of calculation and agent tooling is protected by signed builds and controlled promotion.
- SEC-009: strong identities and least privilege for humans and workloads.
- DATA-009: only synthetic or approved-masked data outside production.
- NFR-013: observability stays in-jurisdiction.
- NFR-019: costs are attributable per port, capability and customer.

## Hard constraints
- HC-01: a service is relied on in a jurisdiction only after its placement, redundancy, management plane and data handling are verified for that jurisdiction. Conditional on D-009, D-010 and D-028.
- HC-10: no service, standard or scheme is described as compliant or applicable before it is verified.
- HC-11: selection creates nothing; deployment is human-approved.
- HC-12: no cost or availability figure without a cited source.

## Options considered
1. **Requirement-driven selection with a per-jurisdiction verification gate.** For each role, state the requirement, at least one alternative, the residency checks and the operating burden; promote a service from lean to decision only when the checks are evidenced for each jurisdiction that would use it. **Selected.**
2. **Standardise on a maximal Azure estate.** Use the managed service for every role in every cell for consistency and speed. **Rejected (hard constraint):** assumes availability and residency that are unverified, and would breach HC-01 wherever a service's control plane, redundancy or processing sits outside the jurisdiction.
3. **Cloud-neutral platform.** Build on open components only and treat Azure as one host. **Not selected:** conflicts with the stated Azure-native direction and loses managed-service operating savings in cells where Azure is verified; but the cell contract is kept portable so local cells are possible.

## Decision
1. **Selection method.** Every candidate in [07 Azure service decision matrix](../target-architecture/07-AZURE-SERVICE-DECISION-MATRIX.md) is judged on requirement fit, alternatives, per-jurisdiction residency and control checks, operating burden, cost drivers and lock-in. The matrix's dispositions are provisional leans, not decisions.
2. **Per-jurisdiction gate.** A service is promoted to a decision for a jurisdiction only when evidence shows, for that jurisdiction: the service is offered in a qualifying place; redundancy and backup stay in the jurisdiction; the management plane, telemetry and support access are understood; private networking is available as needed; and, for model deployments, where prompts and outputs are processed. Evidence comes from an approved read-only identity against the approved subscription, recorded with the evidence recorder. None exists yet.
3. **The cell contract is portable.** Interfaces are containers, PostgreSQL, object storage with immutability, an AMQP-class broker, a hardware-backed key store and OpenTelemetry-class telemetry, so a jurisdiction without a qualifying region can run a cell locally.
4. **Agents and model deployments are optional per cell** until the processing location is verified (ADR 0017).
5. **Container runtime choice is deferred.** Azure Container Apps leads for Azure cells; Kubernetes is the likely runtime for local cells. Whether to run one runtime everywhere depends on how many cells are local (D-010).
6. **Cost figures** come from the official price list at a recorded date or from the business model's labelled scenario assumptions. A list price is not availability or a quote.
7. **Deployment remains separate.** This ADR authorises no resource, no sign-in and no spend.

## Why this option is appropriate
It follows the programme brief and the sovereignty position that a region is not proof, and it prevents the most likely failure: selecting a convenient managed service whose redundancy or control plane quietly leaves the jurisdiction. Option 2 takes that failure on by design. Option 3 is kept partly through the portable contract.

## Consequences
- Positive: each service choice is justified and testable; a port can be excluded or hosted locally without redesign; selection is not driven by what is easy to click.
- Negative: slower, because verification waits for a subscription and a read-only identity; more than one runtime may be run; some managed benefits are lost in local cells.
- Obligations: a verification record per service and jurisdiction; refresh when a service changes; a decision on identity scope and support access before relying on global services (D-027, D-033).

## Reliability consequences
Provisional services introduce no failure modes until used. The gate prevents relying on redundancy that is not in the jurisdiction. Two runtimes add operational complexity and failure-mode diversity.

## Security consequences
Control planes, management agents and global identity are possible paths out of the jurisdiction; each is a check, not an assumption. Policy and role-based access control provide real guardrails but are not residency proof.

## Residency implications
This ADR is the mechanism that keeps region choice from standing in for proof. The decisions that drive it (the legal reading of residency, hosting per port, AI location, support model) are open (D-009, D-010, D-028, D-033).

## Cost and operational implications
Verification effort before any build; recurring effort to re-verify. List prices for sampled regions are in the model; the largest cloud line per cell is key custody, and operations people cost more than infrastructure in the scenarios.

## Reversibility
Yes. No service is chosen; leans can change. Portability of the cell contract limits lock-in once services are chosen.

## Validation evidence
Public list prices for fourteen meters across eight Asian regions retrieved on the recorded date (existence of a priced meter only). No availability, residency or capability verification exists.

## Review gate
Reviewed in [RV-0003](../architecture/reviews/RV-0003-target-system-architecture.md): the gate computes Blocked. This ADR cannot be Accepted while that review is not Approved.

## Revisit when
A subscription and read-only identity are granted and verification can run; a service's behaviour contradicts a lean; most cells turn out to be local; or a cheaper compliant alternative appears for a high-cost role such as key custody.

## Evidence
- [07 Azure service decision matrix](../target-architecture/07-AZURE-SERVICE-DECISION-MATRIX.md), [azure-prices.json](../business/model/azure-prices.json), [REGIONAL-AVAILABILITY](../azure/REGIONAL-AVAILABILITY.md), [SOVEREIGNTY-DEPLOYMENT-MATRIX](../azure/SOVEREIGNTY-DEPLOYMENT-MATRIX.md).
- No evidence records for Azure behaviour exist.

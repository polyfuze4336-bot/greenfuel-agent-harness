---
description: Rules for evidence schemas, storage, lineage and deterministic calculation. Pre-positioned for later phases.
applyTo: "src/data/**,src/calc/**,db/**,docs/design/data/**"
---
- Raw delivery data is append-only and records source, trusted time and sequence (DATA-002). Canonical identifiers follow DATA-004; units and rounding follow DATA-007.
- Calculations are deterministic and versioned. A result records its methodology version, factor-set version and build (FR-009) and can be re-run to match or to explain the difference (FR-011).
- A missing factor or reading fails closed. No defaults, estimates or silent substitution (HC-05, HC-06).
- Reference data (factors, methodologies) is versioned and governed (DATA-005). Do not write factor values or formulas that are not from an approved source.
- Jurisdiction-bound data, backups, telemetry and test data stay in their jurisdiction (HC-01, DATA-009). Never use real delivery data in non-production.
- Stored evidence is tamper-evident; changes are new records that reference the old one.

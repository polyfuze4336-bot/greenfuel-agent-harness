# Specifications and contracts

This folder is where specifications that the deterministic validators check will live: placement declarations, lineage bundles, methodology records and certificate chains. It is **empty on purpose**. No application exists, and no methodology, factor or certificate may be invented.

- Candidate schema ids end in `v0-candidate`. They are test oracles for open decisions (for example D-013), not decisions.
- Synthetic fixtures for tests are under `tests/fixtures/`, never here.
- An empty folder makes a validator report EMPTY ("nothing was checked"), never PASS.

See [TOOL-REGISTRY](../harness/TOOL-REGISTRY.md), section "Specialised utilities".

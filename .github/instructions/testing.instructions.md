---
description: Rules for test plans and automated tests. Pre-positioned for later phases.
applyTo: "tests/product/**,docs/design/test/**"
---
- Each test traces to a requirement ID and its validation method in the traceability file.
- A test asserts a specific outcome and must be able to fail. A missing dependency fails the test; it does not skip.
- Never weaken, skip or delete a test to make a run pass. Report the failure.
- Results are recorded with `harness/scripts/record-evidence.mjs`. Verdicts are VERIFIED, FAILED or UNVERIFIED, each citing an EV ID.
- Test data is synthetic. Never use real delivery, customer or certificate data (DATA-009).
- Azure state is never evidenced from memory. A claim needs a recorded read-only query from a named subscription.

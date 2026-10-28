---
description: Rules for observability, recovery, SLOs and runbooks. Pre-positioned for later phases.
applyTo: "ops/**,docs/runbooks/**,docs/design/operations/**"
---
- Service-level and recovery targets come from D-031. Until it is decided, write "no target exists yet"; never invent a figure.
- Telemetry, logs, backups and recovery copies stay in the jurisdiction unless an approved flow says otherwise (HC-01, D-011).
- Every failure mode has detection, degraded behaviour and recovery, including edge-to-shore disconnection (HC-07).
- Support and break-glass access follows SEC-002 and is logged.
- A runbook states who may run each step and which steps need human approval. Agents do not run drills or production operations.
- "Ready" needs drill evidence recorded by `qa-engineer` and a human sign-off.

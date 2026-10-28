---
description: Rules for backend, frontend and integration work. Pre-positioned for later phases; product source is not permitted in Phase 0.
applyTo: "src/api/**,src/web/**,src/integration/**,docs/design/application/**"
---
- Product source may be written only after a human raises the phase in `harness/policy/command-policy.json`. The code layout is provisional until open question Q8 is answered.
- Every interface has an owner, a versioned contract, authentication and defined failure behaviour. Integrations with existing systems are listed with their owners (D-035).
- Edge-facing interfaces define offline, retry and reconnect behaviour and never lose a reading when the link drops (HC-07).
- Filing or certification-status changes go only through the approval service; no endpoint, job or agent may bypass it (HC-04).
- A language model is never on a capture, calculation or status path (HC-05, HC-06).
- Customer-facing queries are scoped by tenant on the server side, never by a client-supplied filter alone (HC-02).
- No secrets, keys or connection strings in code. Use managed identity.
- Do not claim code works. Tests are written and run by `qa-engineer`; completion needs a recorded EV result.

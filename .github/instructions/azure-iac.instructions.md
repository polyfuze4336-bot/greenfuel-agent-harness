---
description: Rules for infrastructure-as-code. Pre-positioned for later phases; IaC is not permitted in Phase 0.
applyTo: "**/*.bicep,**/*.bicepparam,**/*.tf,**/*.tfvars,infra/**"
---
- IaC may be authored only after an Accepted ADR raises the phase in `harness/policy/command-policy.json` (a human edit).
- Authoring is not deploying. Agents may run `az bicep build`, `az bicep lint` and `what-if`/`validate`. Agents never run `azd up|deploy|provision`, `az deployment ... create`, `terraform apply`, or any other mutating command; humans do, per environment, after reviewing the what-if output.
- No secrets, keys, connection strings or SAS tokens in code or parameter files. Use managed identity and Azure RBAC; reference Key Vault where a secret is unavoidable.
- Pin API versions and module versions. Use Azure Verified Modules where they fit; justify custom resources.
- Every resource gets tags for owner, environment and cost centre. Production parameters live in a separate parameter file that is reviewed by a human.
- Private networking and diagnostic settings are default-on; exceptions need an ADR.

---
description: Documentation and ADR conventions for architecture work.
applyTo: "docs/**"
---
- Label substantive statements FACT (with a source link or file path), ASSUMPTION, or DECISION. Unlabelled claims are treated as assumptions by reviewers.
- Cite Microsoft Learn or other primary sources by URL and record the access date for anything that may change (SKUs, limits, pricing, region availability).
- Do not write specific Azure resource names, prices, quotas or regulatory clause numbers unless sourced. Use "TBD (see OPEN-QUESTIONS)" instead.
- Use relative Markdown links. `npm run validate` fails on broken links.
- Architecture decisions go in `docs/adr/` using the template. Do not bury decisions in prose elsewhere.

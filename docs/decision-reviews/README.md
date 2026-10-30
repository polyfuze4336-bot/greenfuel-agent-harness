# Decision review records

This folder is written only through pull requests that the Architecture Studio opens. It is empty until the first decision is
reviewed. Do not edit these files by hand: each one is hash-chained to the one before it, so an edit, a gap or a reordering is
detected and the decision is shown as inconsistent.

- One file per action: `docs/decision-reviews/<decision id>/NNNN-<action>.json`, for example `ADR-0020/0001-approve.json`.
- Files are append-only. A decision is changed by adding the next numbered file (for example `0002-reopen.json`), never by editing one.
- A decision is shown as approved, rejected or deferred only when its file is on the canonical branch (`origin/main`) and the chain verifies.
- These records are decision requests with a verified GitHub identity. They are **not** signed approvals under ADR 0008 and do not
  replace `docs/approvals/`. The ADR files are not edited by this workflow.

Design, rules and limits: [REVIEW-WORKFLOW](../architecture-studio/REVIEW-WORKFLOW.md).

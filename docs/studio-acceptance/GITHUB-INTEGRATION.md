# GitHub integration

The full design, the twelve-step write path, the App permissions, conflict handling, audit and reliability rules are in **[GITHUB-SYNC](../architecture-studio/GITHUB-SYNC.md)**. This page records only what the end-to-end acceptance run adds.

## What the acceptance run exercised

All of it against a throw-away clone, a bare git remote standing in for GitHub, and a simulated pull-request service. **No real GitHub App, installation token, webhook delivery, branch protection or GitHub Actions run was involved.**

| Behaviour | Evidence (acceptance spec) |
|---|---|
| A new ADR committed to GitHub is discovered after the working copy is advanced and the cache refreshed; it appears as Proposed with options and provenance (path, commit) | Steps 1-3 |
| Approval creates a branch `decision-review/ADR-…`, a commit and a pull request; `main` is not written | Steps 7-9 |
| The repository's own validator, run on the pull-request head, adds no failure the base did not already have and none that mention the new ADR | Step 10 |
| After a person merges (fast-forward of the remote), the Studio reports Approved only after verifying the canonical branch | Steps 11-12 |
| Related queue items and the readiness gate recompute | Steps 13-14 |
| A change landed on GitHub after the user opened a decision is refused as a stale revision and nothing is sent | Negative: conflict and stale revision |
| GitHub unreachable: the submission is shown as *awaiting GitHub update* (never as success), and the same request succeeds once GitHub returns | Negative: GitHub unreachable |
| Two files claiming one ADR number are flagged, not merged | Negative: duplicate decision |
| A hand-written review record (with a forged signature field) is rejected as an inconsistent record | Negative: forged approval |

Earlier stages also tested expired credentials, rate limits, webhook signature failure, failed CI and rejected pull requests with the simulated service ([GITHUB-SYNC](../architecture-studio/GITHUB-SYNC.md), "What has and has not been verified").

## What is not verified, and why it matters

1. **Real GitHub behaviour** (App installation, JWT exchange, secondary rate limits, merge queue, required reviews). Needs the repository owner to register the App.
2. **Branch protection.** Unavailable on this repository's plan. Until it exists, the only thing stopping a Contents-write credential from writing to `main` is the Studio's own code; there is no platform enforcement. This is the largest integration gap.
3. **GitHub Actions.** The workflows (SHA-pinned actions, `contents: read`, `pull_request` rather than `pull_request_target`) have been reviewed but have **never run on GitHub**, because nothing is pushed.
4. **Webhook delivery** through a real public endpoint.

## Settings

See the [RUNBOOK](RUNBOOK.md) for the `STUDIO_GITHUB_*` settings and where each secret must live.

# Known limitations and remaining issues

Honest list as of the final review, deployed build `2a65ef9` (the review fixes are live on Azure and local). Ordered by how much each one matters to getting the architecture to an approved build.

## Blocks the end-to-end journey (needs the owner)

| # | Limitation | Why | What unblocks it |
|---|---|---|---|
| L1 | **No real approval has ever been made through the workflow against the real repository** and none can be made on the Azure site | Azure is read-only by design. A local Studio can approve once the owner starts it with the GitHub sign-in launcher (owner decision 2026-11-05: Entra needs tenant-administrator consent the owner cannot obtain) and enrols an approver key (B1). Until the owner does both and approves, nothing is approved. This computer now has a signing key and GitHub App credentials, outside the repository | The owner's own steps in [T70](../../state/TODO.md) |
| L2 | A presentation cannot be generated **from an approved baseline** | There is no authorized baseline. Phase 0 is not raised and no approver key is enrolled (gates `phase-0` and `no-approver`). ADR-0020 is the only mandatory decision for the next phase and is Proposed | The same as L1, then authorize a baseline |
| L3 | The full path "approve → pull request → merge → webhook → readiness changes" has been proven only against a **GitHub stand-in over a real bare repository**, with the real decisions and the real policy | The real path needs L1 | L1 |

Until L1 is cleared, treat the review-to-readiness journey as **verified in a faithful test world and unverified end to end on GitHub itself**.

## Security (see [SECURITY-REVIEW](SECURITY-REVIEW.md))

| # | Limitation |
|---|---|
| L4 | **Medium.** An ADR edited after it was approved still shows *Approved* on the decision. Only an authorized baseline catches the edit. The fix changes the signed approval record, so it needs a decision |
| L5 | Segregation of duties is off by owner decision, and one approver is enrolled, so one person can propose, approve and merge. The access policy pin is optional in Entra mode, and the GitHub merge-policy check does not block when the answer is `unknown` or `partial` |
| L6 | The audit log accepts unauthenticated denial entries without a rate limit and is hash-chained, not signed or anchored |
| L7 | The infrastructure templates (`main.bicep`, `alerts.bicep`, `build-image.ps1`) are outside the repository (owner decision), so they are not version-controlled. `main.bicep` was corrected to match the live app but **not applied**. One availability alert (`alert-gfstudio-no-replica`, owner-approved 2026-11-04, emails the owner when the single replica is gone for 5 minutes) is deployed; there is no webhook, no latency or error-rate alert, and no Key Vault |

## Performance (see [PERFORMANCE-REPORT](PERFORMANCE-REPORT.md))

| # | Limitation |
|---|---|
| L8 | After a **new commit on GitHub**, the next visitor waits while the read model rebuilds (about 5 s on Azure, about 15 s on a Windows laptop, where starting git processes is slow). A webhook, an approval or a refresh now rebuilds in the background, but the 60-second fetch loop does not |
| L9 | A dirty working tree makes the laptop rebuild on every edit, because the repository fingerprint includes it. The Azure container has none. Measure on a clean tree |
| L10 | The queue response is about 635 KB of JSON (93 KB gzipped) because the whole queue is sent at once. It is not paged |
| L11 | Browser tests are not part of CI, and PowerPoint rendering cannot run on a hosted runner |
| L12 | **Lighthouse mobile misses the 90 target on Azure (79–93, five of six pages below 90)**, measured again after the fixes were deployed; desktop scores 100. The cost is JavaScript execution time under a 4× CPU slowdown. Scores on another network, device or region will differ |

## Product

| # | Limitation |
|---|---|
| L13 | Presentation building and export need Microsoft PowerPoint, so they run on a Windows computer, not on Azure. The Azure site shows the deck builder read-only |
| L14 | The presentation is a **sample**: no baseline, 7 of 7 presented decisions not approved, 0 of 41 slides approved, 7 slides with a review placeholder where the repository holds no evidence. It uses original vector artwork. **The owner approved this artwork on 2026-11-03.** A licensed photograph and the official Azure icon set are a future change (see [PRESENTATION-STUDIO](../../architecture-studio/PRESENTATION-STUDIO.md#decisions-for-the-owner)) |
| L15 | Moving a slide does not rewrite the "next" line in its speaker notes |
| L16 | The impact graph is built from explicit references only. Where the repository states no relationship, none is shown, so it can understate impact. AI-suggested relationships are labelled unverified |
| L17 | Ranking is rule-based and has no effort or cost estimates. Progress is counts of records, never a percentage. The stale-evidence rule is coarse (a run on the same day as an edit can be flagged) |
| L18 | Stakeholder and regulatory items are **not** architecture options. They need an answer or a qualified verification, and the Studio will not let them be approved as choices. They remain open (T2, T4) |

## Not done in this review, on purpose

No new features were added. The only Azure change after the review was the owner-approved availability alert (one metric alert rule and one email action group). A Key Vault would be a new billable resource and needs approval.

## Security findings: committed summary

| # | Severity | File | Lines | Vulnerability | Confidence | State |
|---|----------|------|-------|---------------|------------|-------|
| 1 | 🟡 MEDIUM | workflow/review.ts, workflow/overlay.ts | 355; 19-35 | Approval not re-bound to later ADR text edits | 8/10 | Open (L4) |
| 2 | ⚪ LOW | api/v1/register/sync/route.ts | 19 | Anonymous write to the shared baseline | 9/10 | Fixed, live on Azure (403) |
| 3 | ⚪ LOW | api/v1/sync/reconcile/route.ts; review/proposals/[pid]/sync/route.ts | 13; 12 | Missing role check on GitHub write-back | 9/10 | Fixed, live on Azure (401 anonymous) |

## For the owner to complete L1 (a real approval)

Status on 2026-11-05 (see TODO T70):

1. **Administrator consent: no longer required (owner decision 2026-11-05).** It was attempted and refused: the account available to the assistant is Global Reader (`Authorization_RequestDenied`). The owner is not the tenant administrator, so approvals use the Studio's GitHub sign-in on a local server instead (`start-studio-github-approvals.ps1`, `STUDIO_ALLOW_DEV_APPROVALS=1`). **Trade-off, stated plainly:** no Microsoft multi-factor or sign-in check, and the identity is the GitHub CLI session on this computer. The Studio cannot distinguish a person from a program using that session; the control against an AI approving is the assistant's own rule not to sign in, not a technical barrier. The recent-sign-in, designated-approver, signed-record and write-back checks still apply. The Entra route (`start-studio-approvals.ps1`) is kept for when an administrator grants consent. A stronger no-admin option (GitHub browser sign-in with GitHub's two-factor prompt) is not built.
2. **Server signing key and GitHub App credentials: prepared.** A new Ed25519 server signing key, a second Entra client secret for local use and the `localhost:3100` redirect URI were created; the GitHub App (id 5576378) was re-verified against GitHub with exactly five permissions on one repository. All secrets are in `%USERPROFILE%\.greenfuel-studio` (not in the repository or OneDrive) and are started by `start-studio-approvals.ps1`. The Studio sign-in redirect was checked; no sign-in was attempted. The Azure site stays read-only.
3. **Your approver key (`harness/policy/approvers.json`) is not enrolled, on purpose.** Enrollment needs an interactive terminal, your passphrase and retyping the fingerprint; the assistant must not do it. Until you do, the readiness gate `no-approver` stays raised.
4. **Deferred by the owner:** sign in, compare the options and approve or reject ADR-0020 yourself; then authorize the baseline and generate the deck from it.

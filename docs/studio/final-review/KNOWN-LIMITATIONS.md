# Known limitations and remaining issues

Honest list as of the final review, build `cc98446` plus the review fixes. Ordered by how much each one matters to getting the architecture to an approved build.

## Blocks the end-to-end journey (needs the owner)

| # | Limitation | Why | What unblocks it |
|---|---|---|---|
| L1 | **No real approval has ever been made through the workflow against the real repository** and none can be made today | The access policy accepts approvals only from Microsoft Entra ID (`approvalProviders: ["entra"]`). The Entra app registration still needs an administrator's consent in the tenant. This computer has no signing key and no GitHub App credentials configured, and the Azure site is read-only by design. One approver is enrolled and no approver key (B1) exists | Administrator consent (or an administrator account to sign in with), a signing key, and a GitHub App installed on the repository, all in one running Studio |
| L2 | A presentation cannot be generated **from an approved baseline** | There is no authorized baseline. Phase 0 is not raised and no approver key is enrolled (gates `phase-0` and `no-approver`). ADR-0020 is the only mandatory decision for the next phase and is Proposed | The same as L1, then authorize a baseline |
| L3 | The full path "approve → pull request → merge → webhook → readiness changes" has been proven only against a **GitHub stand-in over a real bare repository**, with the real decisions and the real policy | The real path needs L1 | L1 |

Until L1 is cleared, treat the review-to-readiness journey as **verified in a faithful test world and unverified end to end on GitHub itself**.

## Security (see [SECURITY-REVIEW](SECURITY-REVIEW.md))

| # | Limitation |
|---|---|
| L4 | **Medium.** An ADR edited after it was approved still shows *Approved* on the decision. Only an authorized baseline catches the edit. The fix changes the signed approval record, so it needs a decision |
| L5 | Segregation of duties is off by owner decision, and one approver is enrolled, so one person can propose, approve and merge. The access policy pin is optional in Entra mode, and the GitHub merge-policy check does not block when the answer is `unknown` or `partial` |
| L6 | The audit log accepts unauthenticated denial entries without a rate limit and is hash-chained, not signed or anchored |
| L7 | The infrastructure template is outside the repository (owner decision), so it is not version-controlled and its fix is not in a commit. It was corrected to match the live app but **not applied**. No alert rules exist; monitoring is logs only |

## Performance (see [PERFORMANCE-REPORT](PERFORMANCE-REPORT.md))

| # | Limitation |
|---|---|
| L8 | After a **new commit on GitHub**, the next visitor waits while the read model rebuilds (about 5 s on Azure, about 15 s on a Windows laptop, where starting git processes is slow). A webhook, an approval or a refresh now rebuilds in the background, but the 60-second fetch loop does not |
| L9 | A dirty working tree makes the laptop rebuild on every edit, because the repository fingerprint includes it. The Azure container has none. Measure on a clean tree |
| L10 | The queue response is about 635 KB of JSON (93 KB gzipped) because the whole queue is sent at once. It is not paged |
| L11 | Browser tests are not part of CI, and PowerPoint rendering cannot run on a hosted runner |
| L12 | **Lighthouse mobile misses the 90 target on Azure (80–87)**; desktop scores 100. The cost is JavaScript execution time under a 4× CPU slowdown. Scores on another network, device or region will differ |

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

No new features were added. Nothing was added to the Azure subscription. An alert rule or a Key Vault would be a new billable resource and needs approval.

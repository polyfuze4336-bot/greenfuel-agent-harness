# Final review: GreenFuel Architecture Studio

Independent final review, 2026-11-03 to 2026-11-04. Reviewer: an AI agent acting as product designer, staff engineer, performance engineer, security auditor and Azure architect. The review was read-only until a defect was proven; every change below fixes a verified usability, reliability, security or performance problem, and no feature was added.

## Verdict

**The Studio is not yet accepted for "all critical user journeys work".** Nine of the ten journeys work end to end. The tenth, deciding something for real and watching GitHub change, **cannot be completed today**, for reasons that are the owner's to resolve, not defects in the code:

* The access policy accepts approvals only from Microsoft Entra ID, the Entra app registration still needs an administrator's consent, and no running Studio has a signing key and GitHub App credentials configured. So the Azure site is read-only by design and the owner's computer cannot approve either.
* No approver key is enrolled (B1), so no baseline can be authorized, so a presentation cannot be generated "from an approved baseline".

Everything up to that human step was rehearsed on the real decision (ADR-0020), and the rest of the path (approval, pull request, merge, signed webhook, readiness change) passes 30 of 30 tests against a faithful stand-in. **I did not approve anything and no approval was fabricated.** Details: [KNOWN-LIMITATIONS](KNOWN-LIMITATIONS.md) L1 to L3.

## The ten questions

| # | Can I… | Answer | Evidence |
|---|---|---|---|
| 1 | Open the app and see what needs my attention | **Yes** | The Overview opens on one action, *Review ADR-0020*, with 45 decisions awaiting review and 14 blockers counted; the first screen has the action button. Warm first byte 0.8 s; Lighthouse 92. A cold start used to take 14–18 s on the laptop and now takes 1.3–1.6 s |
| 2 | Find any decision within seconds | **Yes** | `Ctrl K`: "tamper" 0.9 s, "residency" 0.35 s, "ADR-0016" 0.33 s, "D-009" 0.84 s, "quality manager" 0.34 s; Enter opens the decision. Weakness: for a topic word the first result can be an assumption before the decision (see below) |
| 3 | Understand its business and technical context | **Yes** | The decision panel has 22 sections (what is required, why it matters, recommended option, alternatives, implications, dependencies, blocking requirements, approvals, evidence, what is not stated). Missing fields say *Not stated*. It is long (about 1,700 words) but arranged for scanning |
| 4 | Compare alternatives without excessive reading | **Yes, after a fix** | One table, every option and criterion, each cell linked to its source line. At 1440 px the fourth option was cut off; columns are now equal width |
| 5 | Challenge the proposed architecture | **Yes** | *Challenge this decision* answers in 0.9 s with nine sections (strongest argument against, alternatives, pros and cons, hidden assumptions, failure, security, cost, five panel questions, evidence needed) and a position: "Not ready to defend". Each line is labelled as a proposed interpretation or an unreviewed AI suggestion |
| 6 | Understand the impact of approving or rejecting | **Yes** | *See the impact*: directly affected, potentially affected, blocking, follow-up work, possible rework, each from explicit references; AI suggestions are labelled unverified |
| 7 | Approve or reject with minimal effort | **Partly: verified in a test world** | One decision at a time, actions with keyboard shortcuts, reason required for reject, conditions captured. Signed out, the rail offers *Sign in*; an unauthenticated or cross-origin attempt is refused (401, 403). A real sign-in that the policy accepts does not exist yet (L1) |
| 8 | Confirm GitHub was actually updated | **Verified in a test world** | The decision turns Approved only after the pull request is merged and the repository is re-read; *Changes* shows the pull request, failures, history and freshness. Submit to pull request 6.0 s; signed merge notification to Approved 4.7 s |
| 9 | Understand what blocks the build | **Yes** | The readiness card names what stands in the way: 1 mandatory decision (ADR-0020) and 2 gates (`phase-0`, `no-approver`); optional decisions are counted apart and block nothing. `/queue/blocking` lists the chain |
| 10 | Generate an evidence-linked presentation | **Yes, as a sample** | 41 slides, every claim linked to a source at an exact commit, 0 errors and 0 warnings from PowerPoint's own layout measurement, PPTX and PDF exported. A **final** deck is refused until a baseline is authorized (L2) |

## What was found and fixed

| Area | Problem (verified) | Fix |
|---|---|---|
| Performance | JSON API responses uncompressed (queue 635 KB) | gzip in the shared route wrapper; queue 93 KB |
| Performance | Overview and Changes recomputed after a 2 s memo (1.7–1.9 s first byte) | keyed by data, shared in flight; about 0.8 s |
| Performance | First request after a start took 14–18 s on the laptop (4.9 s on Azure) | background warm-up at start and after invalidation |
| Performance | Whole read model rebuilt every minute because the fetch time was in its key | keep the model, update one field |
| Usability | Compare page cut off the fourth option at 1440 px | equal-width columns |
| Usability | Review page repeated the description, justification, dependencies, requirements and source history | the embedded record leaves out what the packet already states |
| Security | Anonymous write to the shared register baseline on the public site | refused on a read-only deployment |
| Security | Any signed-in viewer could trigger GitHub write-back | needs the permission to propose |
| Security | An unset auth mode fell back to the development sign-in | fails closed to read-only when the server answers on other hosts |
| Security | Git error text returned to readers | kept in the server log |
| Infrastructure | The Bicep template said Entra sign-in while the live app is read-only | `authMode` parameter, default matching the live app (local file; not applied) |
| Quality | An unnamed loading region failed an accessibility check (earlier in this stage) | named |

## What was found and not fixed

| Finding | Why not |
|---|---|
| **Medium:** an ADR edited after approval still shows *Approved* on the decision | The fix changes the signed approval record. Needs a decision ([SECURITY-REVIEW](SECURITY-REVIEW.md) #1) |
| The queue API takes 1.4 s warm on the laptop; client navigation 1.4–1.6 s there | A change in shape (paging or caching the serialized form), not a defect. On Azure both are fast (queue 51 ms, navigation 0.4 s) |
| **Lighthouse mobile preset scores 80–87 on Azure (target 90)** because of about 200 KB of JavaScript executing under a 4× CPU slowdown (desktop scores 100) | Reducing it means splitting or deferring client code, a change in shape. Reported as a miss |
| Global search can rank an assumption above the decision for a topic word ("residency" returns assumption AS-009 first) | Ranking tuning is a feature decision |
| *Challenge this decision* is both a button and a tab in the decision dialog | Deliberate shortcut requested earlier; harmless |
| No alert rules on Azure | A billable resource; needs approval |
| Infrastructure template outside the repository | Earlier owner decision |

## What was removed or confirmed absent

No redundant primary navigation (four destinations), no unnecessary modals (the only dialog is the decision panel, a side sheet), no decorative charts, no placeholder buttons, **0 dead links of 70 checked**, 9 production dependencies of which none is unused and none has a known vulnerability, no polling faster than five minutes. The duplicate review-page sections above were the only duplicated content found.

## Test evidence

| Suite | Result |
|---|---|
| Unit and type check (`npm run check`) | **563 of 563** |
| Journey, review to readiness, in a stand-in world (`journey.spec.ts`) | **30 of 30** |
| Final-code browser run: hardening, journey, deck builder, destinations, accessibility and responsive, states, shell, polish, impact and examiner (168 tests, 30 min) | **167 passed, 1 failed.** The failure is a build-identity test rejecting the label `f86ef67+model` that I put on my local build; the test is right, the deployed build id is the plain commit hash |
| Lighthouse (desktop, local laptop) | Performance **92–100**, Accessibility **100**, Best practices **100** on six pages |
| Lighthouse (Azure, as deployed) | desktop **100 / 100 / 100**; **mobile preset 80–87 for Performance (misses 90)**, Accessibility and Best practices 100 |
| axe on ten journeys | **0 violations**; 0 console errors; 0 horizontal overflow at 390 px |

The wider browser suite (332 tests) is long and was disturbed by the laptop sleeping overnight and by machine load. In the first full run of this review code 291 passed and 5 failed, of which two were network-socket resets, two were timing assertions and one was the read-only tour. Later, two tests failed repeatedly: `readonly.spec.ts` ("Repository re-read") and one in `work-queue.spec.ts`. **Both fail identically on the code from before this review's changes**, run side by side on the same machine at the same time, so they are environmental, not regressions. They passed earlier on a quieter machine. The first is an 8 s assertion against a refresh that took 6–48 s that day. Browser tests are not part of CI.

## Deployment

Azure: **https://ca-gfstudio.redgrass-c48c30d5.southeastasia.azurecontainerapps.io**, public and read-only, one replica. See [ARCHITECTURE-SUMMARY](ARCHITECTURE-SUMMARY.md), [PERFORMANCE-REPORT](PERFORMANCE-REPORT.md) and [SECURITY-REVIEW](SECURITY-REVIEW.md). No Azure resource was created or changed beyond rolling the container image.

## What needs the owner

1. **Clear L1** so a real approval can happen: administrator consent for the Entra app (or an administrator account), a signing key, a GitHub App installed on the repository, in one running Studio. Then approve ADR-0020, and I can complete the end-to-end journey and generate the deck from the resulting baseline.
2. Decide on the **Medium finding** (record a status-independent text hash in the approval event).
3. Approve or decline an **alert rule** for the Azure site (a small billable resource), and whether the infrastructure template should join the repository.

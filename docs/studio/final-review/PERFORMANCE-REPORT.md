# Performance report

Final review, 2026-11-04. Reproduce with `apps/architecture-studio/scripts/audit.mjs`, `scripts/lighthouse-run.mjs` and the journey test timings; the raw measurements are in [measurements](measurements/).

## Test conditions (read these before the numbers)

| | Local (laptop) | Azure |
|---|---|---|
| Machine | Windows 11, 8 logical CPUs, 32 GB, repository inside a OneDrive-synced folder | Container App, 0.5 vCPU, 1 GiB, one replica, Southeast Asia, Linux |
| Browser | Microsoft Edge 155 (Chromium), headless, 1440×900, **not throttled** | the same |
| Network | loopback | public internet from the same laptop |
| Build | `f86ef67+model` (merged `main` `cc98446` plus the review fixes); data commit `cc98446` | see the Azure section |
| Cache state | "cold" = new browser profile and cold HTTP cache; "warm" = median of 5 further loads with a warm server. A cold *server* is stated where it matters | |
| Working tree | clean. A dirty tree makes the laptop rebuild on every edit, so earlier "after" numbers taken while editing were discarded | none |
| Lighthouse | 12.8.2, desktop preset, simulated throttling as Lighthouse applies it for that preset, one run per page | |
| Not measured | Concurrent users, a long soak, a region other than Southeast Asia. Mobile Lighthouse was run on Azure only |

**The laptop is the slow case.** Starting a git process on Windows costs far more than on Linux, and the Studio starts several per rebuild, so every laptop number below overstates what Azure does. The Azure numbers are the ones that matter for the deployed site, and the laptop numbers matter for the owner who decides on their own computer. The laptop also varied by a factor of 8 for the identical request during this review (a 6 s refresh took 48 s once while OneDrive and the browser were busy), so treat single figures as ±50 %.

## Budgets and results

Budgets were set before the final run, from what a person doing the review-to-approval journey notices. **Pass** means met in these conditions.

### Pages (laptop, warm)

| Budget | Result | Verdict |
|---|---|---|
| Lighthouse Performance ≥ 90 on every page | **92, 98, 95, 94, 99, 100** (Overview, Decisions, Review, Changes, Presentation, Deck builder) | Pass |
| Lighthouse Accessibility ≥ 95 | **100** on all six | Pass |
| Lighthouse Best practices ≥ 95 | **100** on all six | Pass |
| JavaScript transferred per page ≤ 250 KB | **189–217 KB** (12–14 files) | Pass |
| Total transferred per page ≤ 400 KB | **246–357 KB** (the queue was 887 KB before gzip) | Pass |
| Largest Contentful Paint ≤ 2.5 s | **0.55–1.5 s**; the Decisions dialog (`?id=ADR-0020`) 2.35 s | Pass (one page close) |
| Cumulative Layout Shift ≤ 0.1 | **0 to 0.044** | Pass |
| Time to first byte ≤ 1.0 s | **0.41–0.82 s** (Lighthouse saw 1.06 s on the Overview once) | Pass, marginal |
| Total blocking time ≤ 200 ms | **3–49 ms** | Pass |
| Console errors | **0** on every page | Pass |
| Broken internal links | **0** of 70 checked | Pass |

### API and interactions (laptop, warm median)

| Budget | Result | Verdict |
|---|---|---|
| API responses ≤ 1.0 s | version 111 ms, freshness 268, decision detail **102**, decisions list 125, search **91**, baseline 357, overview 523, deck 577, changes 853, impact 835 | Pass |
| **Queue API ≤ 1.0 s** | **1403 ms** (it builds and serializes about 620 KB for 330 items) | **Fail** |
| Decision list and queue payload on the wire ≤ 150 KB | **58 KB** and **93 KB** (433 KB and 635 KB before compression) | Pass |
| Search narrows the register ≤ 300 ms | **163 ms** | Pass |
| Open a decision from the list ≤ 1.5 s | **1010 ms** | Pass |
| Open the "why this is here" drawer ≤ 200 ms | **74 ms** | Pass |
| **Client navigation between destinations ≤ 1.5 s** | Decisions→Changes **1622 ms**, Changes→Overview 1440 ms | **Fail (marginal)** |
| No full reload on routine navigation | none (same document) | Pass |

### The transactions

| Budget | Result | Verdict |
|---|---|---|
| First page after a start ≤ 5 s | **1.3–1.6 s** with the start-up warm-up; **14–18 s without it** on the laptop (4.9 s on Azure, measured) | Pass |
| GitHub data retrieval (`git fetch` of the branch) ≤ 5 s | **median 2.2 s** (1.2–2.4 s) | Pass |
| Re-read the repository ("Refresh") ≤ 8 s | **5.1 s** typical; **6–48 s** seen when the laptop was busy | **Fail under load** |
| Approval submitted → pull request open ≤ 15 s | **6.0 s** | Pass |
| Signed merge notification → decision shows Approved ≤ 15 s | **4.7 s** | Pass |
| Sample deck, no rendering ≤ 30 s | **20 s** | Pass |
| Sample deck with PowerPoint render, PDF and 41 previews ≤ 120 s | **32 s** on an otherwise idle machine; 170 s while the unit suite was running on the same machine | Pass (idle), **fails under load** |

The approval figures were measured against a GitHub stand-in on the same computer, so real GitHub adds network time and the check runs that must pass before a merge. They show the Studio's own work, not GitHub's.

## Azure (measured on the site as deployed: build `cc98446`, **before** this review's fixes)

Same script, browser and conditions as above, run from the laptop against the public URL (Southeast Asia, so about 20–60 ms of network). Raw data: [measurements](measurements/). Because this build has none of the fixes, it does not compress JSON and it has no start-up warm-up; the numbers are the baseline, and the fixes can only help (they are not deployed until the owner authorizes it).

| Budget | Result | Verdict |
|---|---|---|
| Lighthouse Performance ≥ 90 (desktop preset) | **100** on all six pages; Accessibility 100; Best practices 100 | Pass |
| **Lighthouse Performance ≥ 90 (mobile preset: slow 4G, 4× CPU)** | **80, 81, 82, 85, 86, 87**. Cause: script execution (total blocking time 485–755 ms under the 4× CPU slowdown) with about 200 KB of JavaScript. LCP 1.1–2.3 s | **Fail** |
| JavaScript per page ≤ 250 KB | **190–218 KB** | Pass |
| Time to first byte (warm) ≤ 1.0 s | **86–172 ms** (Lighthouse saw up to 0.9 s once on `/changes`) | Pass |
| LCP ≤ 2.5 s | **0.22–0.76 s** warm | Pass |
| CLS ≤ 0.1 | 0 to 0.019 | Pass |
| API ≤ 1.0 s | **18–97 ms** median, every endpoint including the queue (51 ms) | Pass |
| Search ≤ 300 ms / open a decision ≤ 1.5 s / client navigation ≤ 1.5 s | **166 ms** / **959 ms** / **0.36–0.43 s** | Pass |
| First request after a replica start ≤ 5 s | **4.9 s** measured after a restart of this revision (no warm-up in this build) | Pass, barely; the warm-up removes it |
| Payload on the wire | `/queue` page **865 KB**, because this build does not gzip JSON. With the fix about 350 KB | Pass (≤ 1 MB), improved by the fix |
| Console errors / broken links | **0** / **0 of 74 checked** | Pass |

**Reading the two sets together.** The deployed site is fast (desktop 100). On a phone-class device the JavaScript bundle (about 200 KB, React plus Next plus Radix) is the cost, and the budget is missed. Reducing it means splitting or deferring client code, which is a change in shape and was not made. The laptop's own slowness (process spawning on Windows) does not affect the deployed site.

## What this review changed, and the measured effect

| Problem found | Change | Effect |
|---|---|---|
| JSON API responses were **not compressed** (Next compresses pages and static files, not route-handler JSON), locally and on Azure | gzip in the shared route wrapper for JSON of 2 KB and over, when the caller accepts it | Queue 635 KB → 93 KB; register 433 KB → 58 KB; `/queue` page 887 KB → 357 KB |
| The Overview and Changes were recomputed after a **2-second** memo | keyed by the data (commit, person, proposals in flight), bounded at 60 s, shared by concurrent requests | Overview time to first byte 1.9 s → about 0.8 s; Changes 1.7 s → about 0.8 s |
| The **first** request after a start rebuilt everything (14–18 s on the laptop, 4.9 s on Azure) | build it in the background at start, and again after a webhook or approval clears it | First request 14–18 s → 1.3–1.6 s on the laptop, once the warm-up has finished |
| The read model was rebuilt every minute because the **fetch time** was in its cache key | keep the model and update the one field | The 8 s periodic stall became a 3–4.6 s bump aligned with the fetch itself |
| The queue was built twice when a page and a background rebuild arrived together | one run per key, shared | no duplicate multi-second work |

## Known performance limits

* The queue API builds and sends every item (93 KB compressed, 620 KB raw) on each request that is not cached. Paging it, or caching the serialized form, would fix the 1.4 s; not done because it is a change in shape, not a defect.
* After a **new commit on GitHub** the first request pays a rebuild (about 5 s on Azure). A webhook rebuilds ahead of time but the 60-second fetch loop does not.
* A refresh takes several seconds on the laptop because rebuilding the model starts many git processes. On Azure it is much faster (see below).
* The presentation build is dominated by PowerPoint's render: 20 s without it, 32 s with it on an idle machine, and 170 s when the machine was busy.
* Lighthouse mobile was run on Azure only (it misses the 90 target there: 80–87), and no throttled run was made on the laptop.

# GreenFuel Architecture Studio: user guide

For the person who owns the architecture and has to get it to an approved build. The Studio reads this repository on GitHub, shows what needs a decision, and records a decision only as a reviewed pull request. Nothing you do here changes GitHub until a pull request is merged.

## The four places

| Where | What it answers |
|---|---|
| **Overview** | What do I do next? One recommended action, why it ranks first, what is waiting on others, what is blocking the next phase, what was approved recently |
| **Decisions** | Every decision, searchable. Open one to read its context, compare alternatives, see its impact, challenge it, and decide |
| **Changes** | Did GitHub get my change? Pull requests waiting, sync failures, history, baseline changes, stale evidence, readiness |
| **Presentation** | Build an editable PowerPoint and PDF from the repository, slide by slide, with every claim linked to its source |

Press `Ctrl K` anywhere to search decisions, tasks and requirements. Press `g` then `o`, `d`, `c` or `p` to jump between the four places.

## Decide something

1. **Overview**: choose *Review it* on the Next best action card. The reason it ranks first is one click away (*Why this one?*). The rules are fixed and no model is involved: [NEXT-BEST-ACTION](../NEXT-BEST-ACTION.md).
2. **Read**: the left of the review page states what is being decided, why it matters, who must approve it, and what happens if it is approved or rejected. A field the repository does not state says *Not stated*; nothing is filled in.
3. **Compare**: *Compare alternatives side by side* puts every option and every criterion in one table, each cell linked to its source line.
4. **Impact**: *See the impact* lists what is affected directly, what may be affected, what is blocking, and what follow-up work an approval would create. Relationships come from references in the repository. Anything an AI suggested is labelled *unverified*.
5. **Challenge**: *Challenge this decision* shows the strongest argument against, hidden assumptions, and the questions a panel would ask. It is built from the repository and labelled by what kind of statement each line is.
6. **Decide**: on the right, *Sign in*, then choose one action: approve the recommended option, approve an alternative, approve with conditions, request revision, defer, reject (a reason is required), reopen, or comment. Keyboard shortcuts are shown on each button.
7. **Confirm**: the Studio saves your decision, pushes a branch and opens a pull request. **The decision counts only when the pull request is merged.** Until then it shows as waiting for a merge. *Changes → Pending GitHub pull requests* shows each one with its link.

## What the Studio will not let you do

* Approve for someone else, or approve without signing in. An AI agent has no session and cannot approve.
* Approve several decisions at once. Each is reviewed on its own.
* Approve a stakeholder question or a regulatory claim as if it were an architecture choice. Those need an answer or a qualified verification, and the page says so.
* Approve something that changed since you opened it. You see what changed, your choice is kept, and you reconcile before retrying.

## Build a presentation

*Presentation → Open the deck builder*. Every slide shows its sources, which claims were checked, which decisions it leans on and their status. You can retitle a slide, choose another visual, edit the speaker notes, move it, regenerate it, and approve or reject it. A slide you approved stops counting as approved when its content, its sources, or the status of a decision it cites changes, and the page tells you which. Sign in, *Build sample deck*, then export PowerPoint or PDF. A **final** deck is refused until a baseline is authorized, the decisions it presents are approved, and every slide is approved. Building needs Microsoft PowerPoint, so it runs on a Windows computer, not on the Azure site.

## If something looks wrong

| You see | It means | Do |
|---|---|---|
| *No sync for N min. GitHub may be unreachable* | The Studio has not fetched GitHub for over three sync intervals. It is showing the last copy it has | Check GitHub, then *Refresh* |
| *New commits on GitHub. Update* | GitHub is ahead of this page | Click *Update* |
| An approved decision whose text was edited later | The Studio does **not** flag this on the decision itself. It is caught only when a baseline is authorized | Open the decision's *Source link and history* and read the commits after the approval. See [KNOWN-LIMITATIONS](KNOWN-LIMITATIONS.md) |
| *Read-only deployment* | You are on the Azure site, which cannot sign anyone in | Decisions cannot be made there. They need a Studio with an accepted sign-in, a signing key and GitHub App credentials, which no deployment has yet (see [ARCHITECTURE-SUMMARY](ARCHITECTURE-SUMMARY.md)) |
| A pull request shows *conflicted* or *closed without merging* | GitHub and the Studio disagree | Open it from *Changes*, reconcile, and resubmit |

---
name: session-handoff
description: Checkpoint progress so a later session can resume without chat history. Use at the end of a session, before a long pause, and after any approval decision.
---
# Session handoff

Edit [docs/state/STATE.md](../../../docs/state/STATE.md). It is the resume point and is committed to git, so it is reviewable and shared. Native VS Code memory is local to one machine and is not a substitute.

Update these sections, replacing stale text rather than appending:
- **Current phase and objective**: one or two lines.
- **Done (with evidence)**: each item cites an evidence id (`EV-NNNN`), a commit, or a file. No evidence means it goes under "Claimed, unverified".
- **Next actions**: ordered, small enough to finish in one session.
- **Open approvals**: decisions waiting for a human.
- **Blockers and risks**.

Rules: never record secrets, tokens or personal data. Never mark something done because a plan said it would be. Keep the file under about 120 lines; move history to git, not to the file.

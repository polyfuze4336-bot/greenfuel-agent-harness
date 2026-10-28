---
name: context-loading
description: Load only the context a task needs from the requirements baseline, using the profiles in docs/context/context-manifest.json. Use at the start of any design, review or verification task about the green-fuel bunkering solution, before reading requirement documents.
---
# Context loading

Goal: read the smallest set of documents and rows that lets you do the task, and say what you read.

1. Read `AGENTS.md` (already loaded), [STATE.md](../../../docs/state/STATE.md) and [PROBLEMSTATEMENT.md](../../../PROBLEMSTATEMENT.md).
2. Open [context-manifest.json](../../../docs/context/context-manifest.json) and pick the profile whose `purpose` matches the task. For a task that spans capabilities use the union of those profiles. Use `baseline-maintenance` only when editing the baseline itself. Use `harness-engineering` only for coding-harness work.
3. Open the profile's `documents`. For REQUIREMENTS, NON-FUNCTIONAL-REQUIREMENTS and REQUIREMENTS-TRACEABILITY, do **not** read the whole table. Search for the capability tag in the Caps column (for example `DEA`) or for the profile's listed IDs, and read only those rows. Read the traceability row for each selected ID.
4. Look up only the decision IDs (`D-nnn`) and scheme IDs (`V-nn`) the profile lists. Everything under `V-` is an unverified candidate; never state it as an obligation.
5. Start your answer with one line: `Context: profile <name>; documents <list>; requirement rows <IDs or ranges>.`
6. If you need something outside the profile, name it and fetch that single item by ID. Do not load a whole extra document.
7. If documents disagree, report the conflict using the trust order in [CONTEXT-LOADING-STRATEGY](../../../docs/context/CONTEXT-LOADING-STRATEGY.md) section 7. Do not resolve it silently.

Never treat a class C item as answered or a class D item as verified. If the profile gives you no basis for a statement, say it is unknown.

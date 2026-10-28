# Review Checkpoints

Status: v0.1, 2026-10-28. A design passes through five checkpoints. Each checkpoint has entry and exit criteria, an owner, and an artefact. The review record states which checkpoint it is at. Only a human can approve at CP4; agents prepare, review and challenge.

| ID | Checkpoint | Entry | Exit | Artefacts | Who decides |
|---|---|---|---|---|---|
| CP1 | Intake | A design question exists and the requirements baseline is approved | Scope list fixed (requirement tags and extra IDs); M1 decisions that affect the question are either Decided or explicitly deferred by the owner. A design that proceeds with M1 decisions deferred is exploratory and can never be Approved | Design file with scope and decision question | Owner confirms scope |
| CP2 | Options | CP1 exit | At least three real options including do-nothing or the current approach; every option screened against all hard constraints; options that violate a constraint recorded as rejected, with the reason | Options table, alternatives comparison, hard-constraint screen | Reviewer |
| CP3 | Design and defence | One option proposed | Requirement trace complete for the scope; tradeoffs, assumptions, constraints and risks recorded; all ten perspectives assessed; every critical defence question for the design's tags has a disposition | Design file, review record, risk entries | Reviewer, with a challenger pass |
| CP4 | Approval | CP3 exit and the gate computes "Approvable" | All M1 and M2 decisions linked to in-scope Must requirements are Decided; no Must requirement is unresolved or partial unless waived by an Accepted ADR; no hard-constraint verdict is Violated, Unresolved or conditional on an open decision; every perspective assessed; every critical question answered. Then a named human approves and the ADR is Accepted | Review record with status Approved; Accepted design ADR | Named human decider |
| CP5 | Validation | CP4 passed and implementation has produced evidence | The validation plans in the design have been run and recorded; deviations raised as new findings. Not used in Phase 0, because nothing is built | Evidence records, updated review | Reviewer and human |

Rules:
- A checkpoint can be revisited. Changing a design after CP4 returns it to CP3 and clears Approved.
- A design cannot skip a checkpoint. The gate refuses an Approved status unless the record is at CP4.
- Rejection can happen at any checkpoint when a hard constraint is violated or a perspective fails.
- "Approved" means approved to proceed to implementation planning. It does not mean the design has been validated; only CP5 evidence does that.

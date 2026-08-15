---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) now specifies the
lifecycle of a goal proof, so a verdict can be re-earned, a failure cannot pass
for one, and what settles an issue is a check of what landed.

Three findings arrived together and were one problem — the lifecycle was
under-specified rather than defective in three places:

- **A verdict could never be re-earned.** A moved head correctly invalidated the
  proof, and then nothing could take another: `awaiting_merge` will not apply to
  unproved work, the other open-PR gates were satisfied, and the gate that
  dispatches a check waited for a merge nobody could now be invited to make. No
  gate was derived, nothing dispatched, and the issue could never become
  merge-ready again short of a human merging work conductor considered unproved.
- **A failed proof released the gate that demands a proof.** `satisfiedBy` read
  "a verdict exists". The phase could not complete, no gate was outstanding, and
  an applicable-but-satisfied gate also hid the entity from stall detection.
- **Nothing proved before a merge.** `runGoalCheck` was emitted only by a
  `merged` signal, so an approved, green, unmerged PR had no path to a proof.

A proof is now a **verdict, the revision it was taken against, and the ground it
stood on** — `"branch"` for *this change does what the issue asked*, `"base"` for
*what landed does what the issue asked*. The second is not implied by the first,
because a merge can squash, resolve a conflict, or land on a base that moved, and
conductor cannot see which; so it re-proves rather than assuming. `World` and the
stored issue carry `goalCheckGround` beside the verdict and its revision, and
every `IMPLEMENTATION` predicate reads `standingVerdict` — the verdict, kept only
where it describes both the code in front of us and the claim that code has to
answer for.

`awaiting_goal_check` applies to any **live** submission, open or merged, and is
released by a **passing** proof rather than by any verdict at all. It is still the
only gate that dispatches `runGoalCheck`, but its trigger is now a
`goal_check_needed` the tick derives from the stored proof on every tick — a
state, not an event — joined by a re-derived `goal_check_failed` so a failure
survives a process that died between persisting the verdict and reducing it. Both
converge: the check writes the proof that closes the gap, and an outstanding
escalation stops the derivation entirely.

`runGoalCheck`'s workspace is provisioned detached at the base only when the
submission has merged, and on the submission's own branch before that. The two
come from one decision, so a check cannot be recorded as proving something other
than what it stood on — a pre-merge check taken at the base would measure the
code *without* the change and pass, which is worse than not running.

Both invalidation mechanisms are kept and answer different questions. The
revision binding is the invariant, and catches a head that moved with no dispatch
behind it. `MUTATES_WORK` closes the window the binding cannot see — the snapshot
a tick holds was read before its own dispatch pushed — and decides which revision
a fresh verdict binds to.

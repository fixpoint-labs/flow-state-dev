---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) now binds a goal
verdict to the revision it proved.

A merge gate never opens on unproved work, and `awaiting_merge` held that by
turning on `goalCheck === "passed"` alone. That reads as *this change was
proved*, which is only ever true of the revision the check ran on — so
everything that could put a different revision under the same verdict had to be
enumerated, and the enumeration lived over conductor's own dispatch kinds. It
cannot be complete: **a head can change with no dispatch at all.** A human
pushing another commit to the implementation PR is observed and recorded as a
divergence, produces no action, and leaves the verdict standing; green CI and a
fresh approval on the new head then invited a merge of code no check had seen.

`World` and the stored issue now carry `goalCheckSha` beside the verdict, and
every `IMPLEMENTATION` predicate reads `goalCheckFor` — the verdict, kept only
where it still describes the head the work is sitting at. `awaiting_merge`,
`awaiting_goal_check` and `completedWhen` all ask the same question, so a stale
proof cannot be refused by one gate and accepted by the one below it. A push
nobody dispatched, a dispatch that rewrote the branch, and a cause nobody has
thought of yet now fail by one mechanism.

A verdict with no revision reads as **not proved**, never as
proved-at-unknown-revision — the direction a record written before the field
existed falls (BP-030), and the direction a verdict whose revision is not yet
knowable falls. Work hosted at no submission keeps a bare verdict, because
nothing can push a commit to a proof that names no pull request; that is the
assembled multi-PR shape.

`INVALIDATES_GOAL_CHECK` stays, and answers a sharper question: *can a dispatch
of this kind push?* Both consequences follow from it — a verdict from before is
cleared, and a verdict the dispatch reports is recorded unbound, because the
check ran on code the snapshot in hand predates. The next observation resolves
it. It is no longer the guarantee, so a wrong entry now costs a stale gate for
one tick rather than a false merge.

---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/patterns": minor
"@flow-state-dev/core": minor
---

A job whose worker dies now comes back on its own.

Until now, a worker that died mid-task left the task marked "someone is working
on this" forever, and no later worker would ever touch it. The only recovery was
editing storage by hand.

A running worker now keeps its own task's lease alive while it works, so a lease
that runs out means something specific: no live worker is holding this task. The
next `claim` on any host takes it back and runs it as a fresh attempt. There is
nothing to schedule and no sweeper to configure.

**Jobs that are already stranded get picked up.** A task sitting `in_progress`
with nobody on it becomes claimable as soon as you upgrade. No migration, no
backfill.

**During the upgrade itself, a task held by a worker that has not restarted yet
can be handed to a second worker while the first is still running it.** Neither
can record a result twice, so nothing is double-*recorded*, but side effects can
happen twice. This is a one-time cost of the deploy that ships renewal, not an
ongoing property: once every process is renewing, a live worker's lease does not
run out.

**The default lease is now two minutes, up from thirty seconds.** A claim that
passes no `leaseDurationMs` holds its task for two minutes, so a dead job takes
correspondingly longer to come back. If you were timing recovery against the old
number, this is why it moved. A claim that passes its own lease is unaffected.
Values under a second, over about 74 days, or non-finite are now rejected rather
than rounded.

Recovery is bounded at three re-dispatches, after which the task settles
`errored`. That allowance is separate from `maxAttempts`: a crashed machine no
longer spends the retries you configured for real failures.

Two contracts changed:

- **A dispatcher's `eligibility` predicate now narrows the substrate's
  candidates instead of replacing them.** Claimability is the substrate's call.
  Drop any `t.status === "pending"` assertion from your predicate — it now
  switches recovery off for that dispatcher rather than expressing a filter.
- **`TaskCollectionRef` gains `renewLease`.** If you implement the interface
  yourself, you owe three things, and the last two are easy to miss: the renewal
  write, a `claim()` that takes over tasks whose lease has run out, and a refusal
  of any ticketed write whose lease has already run out.

`@flow-state-dev/core` gains a per-step abort signal: `.step(block, {
  abortSignal })` runs one step under an additional signal, composed with the
request's rather than replacing it (FIX-1005).

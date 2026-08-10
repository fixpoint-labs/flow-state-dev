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
- **`TaskCollectionRef` gains `renewLease` and `now`.** If you implement the
  interface yourself, you owe three behaviours, and the last two are easy to
  miss: the renewal write, a `claim()` that takes over tasks whose lease has run
  out, and a refusal of any ticketed write whose lease has already run out.
  `now` is the clock your collection stamps and judges leases against —
  `now: () => Date.now()` unless you have a reason for another. It is exposed
  because a lease is a comparison, and everything comparing against `leaseUntil`
  has to read the same clock the claim write stamped it with.

**A worker that pauses for a human releases its task.** If your worker calls
`ctx.suspend()` — for an approval, a form, any human gate — it stops asserting
that it is alive, so the task's lease runs out normally and another worker can
recover it. Pausing is not the same as working. If you want a task held across a
long human pause instead, park the task itself for review: the lease does not
govern a task awaiting review, so it stays yours for as long as the review takes.

`@flow-state-dev/core` gains two per-step dispatch options (FIX-1005):

- `.step(block, { abortSignal })` runs one step under an additional signal,
  composed with the request's rather than replacing it.
- `.step(block, { onSettled })` runs a callback when the step's dispatch ends by
  any path, and tells it which one — `"returned"`, `"threw"` or `"suspended"`.
  `.rescue()` deliberately never fires for a suspension, so this is the only
  seam that sees one; use it to release what a preceding step started. Check the
  outcome before releasing: the hook runs before the steps that follow, so on
  the other two exits there is usually a recorder downstream that still needs
  whatever you are about to let go of. It is skipped entirely when nothing was
  dispatched — a `stepIf` that was gated off, or a step replayed from a durable
  resume — so cleanup does not re-run on every re-entry.

Both options now reach a step's whole subtree, including the background work it
dispatches. `.work()`, `.workIf()` and `.forEachBackground()` deliberately run
under the request's background signal so they outlive a disconnected client;
they now run under that signal composed with the step's, so they still stop when
the step's own signal fires.

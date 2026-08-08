---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/patterns": patch
---

A task write can now prove which task it owns. `TaskTransitionOptions.expectAttempt` is replaced by `claim`, which takes a `TaskClaimTicket` naming the collection, the task, the attempt, and the task's `createdAt`. A write presenting a ticket for a different task is refused with the new `TaskWriteDeclineReason` member `not-my-task` instead of being applied.

**Migration — `expectAttempt` is removed.** A bare attempt number names no task, and attempt numbers collide constantly across a board (two freshly claimed tasks both sit on attempt 1), so the guard was satisfied by whichever task the call happened to name. Mint a ticket from the task `claim()` returned:

```ts
// before
const task = await tasks.claim("worker-1");
await tasks.complete(task.id, output, { ifAllowed: true, expectAttempt: task.attempts });

// after
import { ticketForClaim } from "@flow-state-dev/orchestration";

const task = await tasks.claim("worker-1");
const claim = ticketForClaim(tasks.collectionId, task);
await tasks.complete(task.id, output, { ifAllowed: true, claim });
```

TypeScript rejects `expectAttempt` at compile time. An untyped caller that still passes it gets a thrown error naming the replacement rather than a silently unguarded write.

**`block`, `unblock`, `awaitReview`, and `resumeFromReview` take options and return a verdict.** All four gain the same optional `TaskTransitionOptions` the settlement methods take, and resolve to a `TaskWriteOutcome` rather than `void`. Additive at the call site; discarding the return value behaves as before. `cancel` also accepts options now — it forwards a `claim` and keeps forcing `ifAllowed` on, so it stays advisory whatever you pass.

**A model-facing tool can refuse a settlement it previously performed** — source-compatible, behaviourally new. `completeTask`, `failTask`, `blockTask`, and `cancelTask` present the calling worker's claim, so an agent running as a board worker that names a sibling's task is refused and told which task is its own. A caller with no claim, which is every coordinator, is unguarded exactly as before. `assignTask` and `updateTask` are unchanged: they travel the patch path and still write to tasks the caller does not hold.

**Decline precedence changes** from `terminal → disallowed → lost-claim` to `terminal → not-my-task → disallowed → lost-claim`. A cross-task write now reports `not-my-task` in cases that previously reported `disallowed`, which happened when the caller's view of the target task was stale enough to make an ordinary settlement look like an illegal transition.

If you implement `TaskCollectionRef` yourself, the seven lifecycle methods must accept and honour the options argument; a ref that ignores it leaves ownership unchecked and a worker's write lands on whichever task the caller named.

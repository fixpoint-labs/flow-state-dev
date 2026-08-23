---
"@flow-state-dev/orchestration": minor
---

A task board can now finish its drain while a task waits on a human (FIX-1234).

When a board parks a task for review, the request that started the drain stays
open for as long as the review takes — and eventually gives up, abandoning the
parked task with nothing reported.

The new `onReview` option on `taskBoard` changes that for boards that ask for
it. On `onReview: "exit"` a task sitting in `awaiting_review` is not the drain's
to wait on: the drain returns, and the board's `task-board-meta` completion item
carries a `terminationReason` of its own — `"parked-for-review"` — rather than
reporting the exit as a success or as a failure. The task itself is untouched.
It stays parked and durable, and a later `resumeFromReview` puts it back in the
queue for whatever drains the board next. The resume does not start a drain
itself, so something has to come along and run one — a later user turn, a
schedule, a background job.

The default is `onReview: "hold"`. A board that leaves it there holds the
drain open until someone moves the parked task out, detached boards included.
That default does change for a worker that parks the task it is holding; see
**Upgrading** below.

The mode needs three things: a collection declared with `defineTaskCollection`,
so the parked task outlives the drain that released it; the default `onIdle`;
and an explicit `id` on every entry in `initialTasks`. A board that asks for
`"exit"` without them throws when it is built, naming the requirement it missed
and the change to make.

Consumers that switch on `terminationReason` gain one value to handle. Nothing
reports it unless a board turned the mode on.

**A worker parking its own task now works, on every board.** A worker that calls
`awaitReview()` on the task it is holding leaves that task parked, whether the
worker then returns or throws. It did not before: the task was completed or
failed out from under the review a moment later.

**Upgrading:** this changes what an existing board does. A board that leaves
`onReview` on its default and whose worker parks its own task used to see that
task complete and the drain finish. It will now see the task stay parked and the
drain wait for an external actor to move it, which is what the default has
always meant for a task parked from anywhere else. If that board wants the drain
to return instead, `onReview: "exit"` is the setting for it. Boards whose tasks
are parked by something other than the worker holding them are unaffected.

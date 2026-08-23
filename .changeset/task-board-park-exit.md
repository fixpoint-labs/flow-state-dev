---
"@flow-state-dev/orchestration": minor
---

A task board can now finish its drain while a task waits on a human (FIX-1234).

When a board parks a task for review, the request that started the drain stays
open for as long as the review takes. If the answer never comes it gives up on an
internal safety cap, leaves the task parked, and reports that it was
`blocked-by-failures` — on a board where nothing failed and a person is owed an
answer.

The new `onReview` option on `taskBoard` changes that for boards that ask for
it. On `onReview: "exit"` a task sitting in `awaiting_review` is not the drain's
to wait on: the drain returns, and the board's `task-board-meta` completion item
carries a `terminationReason` of its own — `"parked-for-review"` — rather than
reporting the exit as a success or as a failure. The task itself is untouched.
It stays parked and durable, and a later `resumeFromReview` puts it back in the
queue for whatever drains the board next. The resume does not start a drain
itself, so something has to come along and run one — a later user turn, a
schedule, a background job.

The default is `onReview: "hold"`. A board that leaves it there holds the drain
open until someone moves the parked task out, or until it gives up on the safety
cap above and reports the misleading reason. Detached boards included. That
default does change for a worker that parks the task it is holding; see
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

Task collections gain a matching guard for anyone building on them directly. A
write that reports a task's result takes `refuseWhenParked`, which declines
rather than settling a task somebody has parked for review, and
`TaskWriteDeclineReason` gains `parked` to say so. That is a new member on a
union callers can switch on, and it is deliberately not `lost-claim`: nobody took
the task, so re-claiming and redoing the work — what `lost-claim` asks for — is
the wrong move. The work is done and a person is deciding what happens to it.

**Upgrading:** this changes what an existing board does. A board that leaves
`onReview` on its default and whose worker parks its own task used to see that
task complete and the drain finish. It will now see the task stay parked and the
drain hold the request open until an external actor moves it, which is what the
default has always meant for a task parked from anywhere else. That includes the
ending above: if nobody moves the task, the drain gives up on the safety cap and
reports `blocked-by-failures` with the task still parked. If that board wants the drain
to return instead, `onReview: "exit"` is the setting for it. Boards whose tasks
are parked by something other than the worker holding them are unaffected.

---
"@flow-state-dev/orchestration": minor
---

A task board can now finish its drain while a task waits on a human (FIX-1234).

When a board parked a task for review, the request that started the drain stayed
open for as long as the review took. Nobody waits that long on purpose, so what
actually happened was worse than a wait: the drain eventually gave up on an
internal safety cap and returned, leaving the parked task abandoned where it sat,
with nothing reported.

The new `onReview` option on `taskBoard` changes that for boards that ask for it.
On `onReview: "exit"` a task sitting in `awaiting_review` is not the drain's to
wait on: the drain returns, and the board's `task-board-meta` completion item
carries a `terminationReason` of its own — `"parked-for-review"` — rather than
reporting the exit as a success or as a failure. The task itself is untouched. It
stays parked and durable, and a later `resumeFromReview` puts it back in the
queue for whatever drains the board next. The resume does not start a drain
itself, so something has to come along and run one — a later user turn, a
schedule, a background job.

The default is `onReview: "hold"`, and a board that leaves it there behaves
exactly as it does today, detached boards included.

The mode needs a durable board — one built on `defineTaskCollection`, so the
parked task outlives the drain that released it — on the default `onIdle`, with
every entry in `initialTasks` carrying an explicit `id`. A board that asks for
`"exit"` without those is refused when it is built, by name, with the change to
make; each refusal says what is actually in the way rather than only that
something is.

Consumers that switch on `terminationReason` gain one value to handle. Nothing
reports it unless a board turned the mode on.

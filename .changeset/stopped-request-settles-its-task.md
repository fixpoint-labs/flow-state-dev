---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": patch
---

A stopped request settles the task it works when it ends, not when the task's lease lapses (FIX-2795).

- **orchestration:** when a person stops a task's own request (the abort route, `ctx.session.stopRequest`), the request ends `aborted` and its task is **cancelled**, with the reason "The request working the task was stopped." The cancel is an ending like any other: rows that depend on the task are cancelled too, and the filer hears it. An answer the request gave before the stop is not taken. Before, the task was meant to fail its attempt, so the work the person stopped would run again.
- **orchestration:** a person's stop of a later request admitted for a task (a steer's turn, a notice) fails nothing and cancels nothing, and its own answer is never taken. The steers it read are given back for the next turn. The task is then checked as it stands now: it waits again on what still holds it, or it owes a steer's turn.
- **orchestration:** when nothing holds the task any more (its filed work ended under the stopped turn, say), a stopped later turn can now let the task complete on the answer its own request gave earlier.
- **orchestration:** a stop from inside the process (`abortRequest(id)`, such as a host's shutdown) ends the request `interrupted`, and its attempt fails at once, so the task is free for its next claim, or fails if it has no attempts left. Before, the task stayed `in_progress` until its lease lapsed, and a durable continuation of the interrupted request could still settle it on the same attempt. Now that continuation finds its claim gone and writes nothing on the next attempt's row.
- **orchestration:** `RecorderKind` gains `"cancel"`, the recorder named on a recorder-failure report when the cancel a stopped request owes its task fails to write. A `switch` over every kind gets a new case.
- **core:** `onRequestEnded(ctx, hook, options?)` and `RequestEndSeam.add(hook, options?)` take `RequestEndHookOptions` (`{ writesOutliveAbort?: boolean }`, exported from `@flow-state-dev/core/internal`). A hook added with `writesOutliveAbort: true` keeps its resource writes when the request was stopped. Off by default.
- **engine:** the request-end registry runs a hook added with `writesOutliveAbort` with its writes not stopped by the abort. A registry built without a way to do that refuses such a hook when it is added, rather than run it as any other.

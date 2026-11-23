---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": patch
---

A stopped request settles the task it works when it ends, not when the task's lease lapses (FIX-2795).

- **orchestration:** when a person stops a task's request (the abort route, `ctx.session.stopRequest`), the request ends `aborted` and its task is now **cancelled**, with the reason "The request working the task was stopped." Before, the task was meant to fail its attempt, so the work the person stopped would run again. A stop from inside the process (`abortRequest(id)`, such as a host's shutdown) ends the request `interrupted`, and its attempt fails as before, so the task is free for its next claim at once. Before this change neither write landed: the end-of-request check's writes stopped on the abort ("This operation was aborted"), and the task stayed `in_progress` until its lease lapsed.
- **core:** `onRequestEnded(ctx, hook, options?)` and `RequestEndSeam.add(hook, options?)` take `RequestEndHookOptions` (`{ writesOutliveAbort?: boolean }`, exported from `@flow-state-dev/core/internal`). A hook added with `writesOutliveAbort: true` keeps its resource writes when the request was stopped. Off by default.
- **engine:** the request-end registry runs a hook added with `writesOutliveAbort` with its writes not stopped by the abort, as the session config's request-end hook already ran.

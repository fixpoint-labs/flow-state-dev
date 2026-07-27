---
"@flow-state-dev/orchestration": patch
---

Task tools now answer a refused status change with `{ ok: false, error: "illegal_status_transition: …" }` instead of throwing. `completeTask`, `failTask`, and `blockTask` used to throw when the task's status didn't permit the change, so a coordinator rule like "if a tool returns `ok: false`, re-plan" silently missed three of the eight tools. The message names the task's current status and the calls actually available from it, rather than only the move that was rejected. Only the tool boundary translates: driving a collection directly still throws, now as an exported `IllegalTaskTransitionError` you can catch by type. Everything that isn't a transition problem — CAS conflicts, storage failures, timeouts — still propagates. Note that a refused transition now fires `flowTools.onToolCompleted` instead of `onToolErrored`, and is no longer retried under `flowTools.defaults.retry`.

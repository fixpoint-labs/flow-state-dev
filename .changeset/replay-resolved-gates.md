---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
---

Multi-gate durable sequencers now resume correctly across a process restart.

A durable sequencer with two or more sequential `ctx.suspend()` gates could resume the *first* gate fine, but resuming a *later* gate after the process restarted would re-suspend back at an earlier (already-resolved) gate — looping forever. On replay, an earlier gate is only skipped when it has a `completed` block trace to short-circuit; for some block shapes that trace never lands (the suspending block re-runs on every replay and its trace stays `in_progress`), so the gate re-executed and, not being the continuation's pending target, re-suspended.

`buildReplayLog` now also exposes the suspensions a logical block path *already resolved* on a prior continuation (`resolvedResumes`), built by joining `suspension` items with their `suspension_resume` records. `ctx.suspend()` consults this during replay: a gate re-reached that was resolved earlier returns its recorded resolution (in original order, re-throwing a recorded rejection) instead of re-suspending. This is keyed on the durable suspension/resume log rather than a `completed` trace, so it is robust to suspend blocks that re-run on every replay, and it composes with the FIX-811 per-gate matching (the current pending gate is still resolved from `resumeContext`). The change is inert outside replay and a no-op when the older completed-trace short-circuit already covers the gate.

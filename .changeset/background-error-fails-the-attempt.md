---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
"@flow-state-dev/tools": patch
---

A dispatched task's background work that errors now fails its attempt (FIX-2088), as if its request had thrown: the task runs again while it has attempts left, otherwise it fails with an error naming the step (`Background work "<step>" failed: ...`). It counts in every request working the task, including steps `onCompleted` and `onFinished` start and a step a default `.waitForSideChain()` already drained. The request itself still reports `completed`. A cancel never fails the task this way, and a step that failed before a suspension counts only if its rerun on the resume fails too. Make a step best-effort by catching inside it.

Core adds `RequestEnding.backgroundFailures` and the `BackgroundFailure` type (`@flow-state-dev/core/types`), and `RequestSideChainPool.failures()`; the engine hands a request's background failures to its request-end hooks. In Workforce, a failed `afterAnswer` step (such as a memory capture) fails a task's attempt too, except in a task filed `resultTo: "conversation"`, where it is logged and the task keeps its answer. Conversation turns are unchanged. A step a timed-out `.waitForSideChain({ timeoutMs })` stopped waiting on is still waited for before the request ends, and its failure counts and is logged, with `failOnError` too; `drainScope` takes an `abandoned` signal for this. The MOAT bash provider's purge of stale containers now logs a failure instead of throwing it.

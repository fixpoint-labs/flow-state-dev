---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
---

A detached run's request record now names the task-board row it was started for
(FIX-982).

Listing a background job's runs (`GET /api/flows/sessions/:id/requests`) already
returned which body of work each run belonged to, under
`metadata.workstream.topic`. It did not say which row the run came from, so
matching a run back to a task board meant reading the board's own ledger beside
it. Those runs now also carry `metadata.workstream.taskId`.

The field is present only when the job came from a task board, and it is absent
on runs recorded before this release, so read it with a `== null` guard. Treat
the `workstream` bag as provenance only when the record's `source` is
`"workstream"` — an application can write any `metadata` it likes on its own
requests, while `source` is set by the framework.

Capabilities that start detached work themselves supply this through the new
`provenance` field on `startDetached`, which is for server-derived facts only
and is deliberately separate from `record` (the caller's own bookkeeping, which
stays on the child session and never reaches the request record).

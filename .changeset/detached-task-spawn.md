---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
---

Detached task-board workers now run outside the request that claimed them.

A worker declared `dispatch: { mode: "detached" }` previously validated as
detached and then ran inline, so a task's life was still capped at one request
cycle. It now starts in a Workstream — a child session dedicated to that body of
work — and the turn that filed it returns while the work keeps going.

Enumerate a session's background work with `listWorkstreams` on the client, or
`session.workstreams` from `useSession`.

Two bounds worth knowing. Work is settled by the Workstream, which must be able
to address the board it settles against, so a board whose rows a detached worker
reaches has to be scoped where the child can see it. And on a serverless host
without a queue adapter, detached work runs inside the invocation that started it
and is bounded by that function's maximum duration.

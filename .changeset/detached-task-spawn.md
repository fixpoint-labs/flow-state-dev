---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
---

Task board workers can run outside the request that claimed their task
(FIX-982).

Mark a worker `dispatch: { mode: "detached" }` and its tasks run in a
Workstream — a child session dedicated to that body of work — instead of inline.
The turn that filed the task returns while the work keeps going, and the
Workstream settles the task when it finishes.

Declaring it: a registry value may be a `{ worker, dispatch }` entry instead of a
bare block, and a bare block still means inline, so no existing board changes. A
uniform-worker board declares the same thing through a board-level `dispatch`
field, and `defaultWorker` accepts an entry.

Enumerate a session's background work with `listWorkstreams` on the client, or
`session.workstreams` from `useSession`.

Detachment comes with guards that fire at board construction, loudly and by name,
rather than at the first restart:

- an explicit `boardId` is required, because it is hashed into the child
  session's id
- the collection must be durable (`defineTaskCollection()`); request, sequencer,
  and caller-supplied factory backings are refused
- a detached worker may not declare `sessionStateSchema`, since detached workers
  share one execution flow

Two tasks continue in the same Workstream when they are addressed to the same
board, the same worker and the same topic. A task with no topic falls back to its
own id, so continuity is something a task opts into rather than something two
untitled tasks fall into together.

Two bounds worth knowing. Work is settled by the Workstream, which must be able
to address the board it settles against, so a board whose rows a detached worker
reaches has to be scoped where the child can see it. And on a serverless host
without a queue adapter, detached work runs inside the invocation that started it
and is bounded by that function's maximum duration.

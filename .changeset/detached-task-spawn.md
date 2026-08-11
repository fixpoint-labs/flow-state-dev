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
- the collection may not be `scope: "session"`. A Workstream runs in its own
  session, so a session-scoped ledger resolves empty there and the child never
  finds the row it was dispatched for — declare it `scope: "user"` or
  `scope: "org"`

Two tasks continue in the same Workstream when they are addressed to the same
board, the same worker and the same topic. A task with no topic falls back to its
own id, so continuity is something a task opts into rather than something two
untitled tasks fall into together.

A board that finishes by handing its remaining work over now says so: the final
`task-board-meta` item carries a new `terminationReason: "handed-off"` rather
than `"blocked-by-failures"`. The old value made a board that did exactly what it
was designed to do report itself as a terminal failure, permanently — nothing
re-emits that item when the child settles. `counts.in_progress` is how many rows
are still running elsewhere.

A board handed to a model as a tool (`tools: [board.drain]`) can now declare
detached workers. A generator does not carry its tools' declarations, so the
board's routing never reached the flow and the first tool call claimed a task,
failed to start it, and recorded the task as failed. Tools named in a static
array are now collected. A tool set resolved at runtime still is not — its
contents do not exist when the flow is built.

A detached worker can now run a detached board of its own. Nesting is a
documented shape, but the inner board's routing lived only on the outer board's
runner — a block the flow learns about only after collecting the outer board — so
it never reached the flow and the inner child's dispatch had nowhere to land.
Collection now closes over the runners it discovers, however deep the nesting
goes.

A dynamic schedule whose resolver returns a handler containing a detached board
is now refused at dispatch, naming the board and the flow, instead of claiming a
task it cannot start. The resolver's handler is built after the flow is, so its
board never reached the flow's routing; the refusal happens before the board
claims anything, so nothing is left half-done. The check covers the handler's
`onCompleted` and `onErrored` observers too, since those run as real blocks and
a board under one claims work exactly as a board under the handler does.

The safety check on a detached worker's payload now rejects a null-prototype
object (`Object.create(null)`). Its data survives serialization and its prototype
does not, so the worker receives an ordinary object where `hasOwnProperty` and
every other inherited member behave differently — the same identity loss the
check already rejects class instances for. Spread it into a plain object before
sending.

A board's `onError` now decides a detached worker's outcome as it does an inline
one. `onError: "fail"` was ignored for detached workers — a failing worker
recorded the row errored and its Workstream request still reported success, so
anything reading background work by run status saw a success for failed work.
`"skip"` remains the default and is unchanged.

A dispatch the host refuses outright — a flow-level `reject` concurrency policy
whose key the launching request already holds — now settles its task instead of
leaving it. The refusal happens before any background work exists, so the
request that was handing the task over still owns it and fails it; previously
the row stayed outstanding until its lease ran down.

Two bounds worth knowing. Work is settled by the Workstream, which must be able
to address the board it settles against, so a board whose rows a detached worker
reaches has to be scoped where the child can see it. And on a serverless host
without a queue adapter, detached work runs inside the invocation that started it
and is bounded by that function's maximum duration.

---
sidebar_position: 6
sidebar_label: Detached work
---

# Detached work

Some work outlives the turn that asked for it: a long research pass, a document
being drafted, an implementation running for an hour. That work runs in a
**child session**, a session of its own hanging off the conversation that
started it. It has its own state, its own resources, and its own history of
requests, and nothing it does appears in the conversation's own request list.

This page covers the child session from end to end: how a flow starts one, how
the HTTP API lists a conversation's children and reads one child's history, and
what the fields on those records mean. An app reads the same two things through
[`listChildSessions`](../client/overview.md#background-work) on the client and
[`useSession`'s `children`](../client/react.md#background-work) in React.

## Starting one

Only a flow can start a child session. There is no endpoint for it and no
client call.

A `dispatcher()` block sends an `internal` dispatch to one of the flow's
`internal` entries. With `session: { key }` the dispatch runs in a child of the
running session, derived from the key; with `session: { id }` it is delivered
into a session that already exists.

```ts
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { z } from "zod";

const summarize = handler({
  name: "summarize",
  inputSchema: z.object({ documentId: z.string() }),
  execute: async (input, ctx) => {
    // Runs in the child session, on a request of its own.
    ctx.emit.status(`Summarizing ${input.documentId}`);
  },
});

const summarizeInBackground = dispatcher({
  name: "summarize-in-background",
  type: "internal",
  target: "summarize",
  inputSchema: z.object({ documentId: z.string() }),
  session: { key: (input) => input.documentId }, // one child per document
});

export default defineFlow({
  kind: "documents",
  actions: { upload: { block: summarizeInBackground } },
  internal: { summarize: { block: summarize } },
})();
```

The dispatcher returns `{ sessionId, requestId, adopted }` once the runtime has
accepted the request, and nothing on it reports the outcome. The same key from
the same conversation lands on the same child, with `adopted: true`. Every
option, and the refusals it can throw, are on
[Flow options > Dispatching to another session](../configuration/flow.md#dispatching-to-another-session).

A task board hands a seat off by wrapping its worker in `{ block, session }`.
The drain claims a row, sends a `task` dispatch to that seat, and moves on to
the next row; the worker runs in a child session and settles the row itself.

```ts
import { defineFlow } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { defineTaskCollection } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";

const issueLedger = defineTaskCollection({
  id: "issues",
  scope: "session",
  sharedToLineage: true, // the child addresses the same rows as the conversation
  stateSchema: z.object({ issueKey: z.string() }),
});

const board = taskBoard({
  name: "issue-work",
  boardId: "issue-work", // required once any seat hands off
  collection: issueLedger,
  workers: {
    triage: triageWorker, // a bare block runs inline, in the drain
    implement: { block: implementWorker, session: "per-task" },
  },
});

export default defineFlow({
  kind: "issues",
  actions: { drain: { block: board.drain } },
  tasks: board.tasks, // one entry per handed-off seat
})();
```

`"per-task"` gives every row a child of its own, `"per-worker"` shares one child
across every row the seat runs, and `{ key: (task) => string }` groups rows by
what the function returns. A board that hands off needs a `boardId` and a
`defineTaskCollection()`, and a session-scoped collection needs
`sharedToLineage: true`; all of it is checked when the board is built. See
[Task board > Handing tasks off to child sessions](../orchestration/task-board.md#handing-tasks-off-to-child-sessions).

Where the child runs depends on the runtime. With no worker adapter it runs in
the process that started it. With a queue adapter that dispatches, it goes to
the queue and a worker process picks it up. [Work that outlives the
turn](/guides/background-work) walks through the difference.

## Listing a conversation's children

```
GET /api/flows/sessions/sess_abc/children
```

```json
{
  "children": [
    {
      "id": "dsx_9f2c1a5e7b3d4c8a0f1e2d3c4b5a6978",
      "parentSessionId": "sess_abc",
      "topic": "task|10:issue-work|8:task_7f3",
      "coordinate": "task:implement",
      "status": "active",
      "createdAt": 1770000000000,
      "updatedAt": 1770000042000
    },
    {
      "id": "dsx_1c7b40d2e9a64f5b8c3d7e1f0a2b9c4d",
      "parentSessionId": "sess_abc",
      "topic": "doc_42",
      "coordinate": "internal:summarize",
      "status": "completed",
      "createdAt": 1769999000000,
      "updatedAt": 1769999900000
    }
  ]
}
```

Each row is a session, and `id` is its session id, so every session endpoint
works on it.

`topic` and `coordinate` are labels stamped when the child was created.

- `topic` is the key the child was derived from. A `dispatcher()` with
  `session: { key }` stamps what its `key` function returned. For a task-board
  seat on `"per-task"` and `"per-worker"` the key is generated and includes the
  board id and the task id (or seat); on `{ key }` it is what your function
  returned.
- `coordinate` is the entry the work was sent to: `task:<seat>` for a board
  hand-off, `internal:<entry>` for a dispatcher.

Nothing routes or authorizes on either label, and neither is unique on its
own: two rows sharing a `topic` under different `coordinate`s are two bodies of
work. To find the child running a particular board row, read the child's
requests and match `metadata.dispatch.taskId` (below). The labels are enough
for a list, not for a join.

`topic`, `coordinate`, and `status` are all optional, so read them with `== null`
guards rather than assuming every row carries them.

### What `status` tells you

`active` means the work isn't finished. It covers a run waiting in a queue, a
run going right now, and a run paused waiting for someone to approve
something. The endpoint does not distinguish those. If you need to know which,
open the child and read its history, or read the task board the work is being
done for.

Every other value is how the child's most recent run ended:

| Value | Meaning |
|---|---|
| `completed` | The run finished. Not the same as the work succeeding |
| `failed` | The run itself ended with an error. A worker error doesn't always reach it |
| `aborted` | Cancelled |
| `incomplete` | Stopped short of finishing by a token budget |

A child doing a task board's work runs that board's worker, and a worker that
throws records the failure on its own task. What that does to the run around it
is the board's
[`onError`](../orchestration/task-board.md#concurrency-and-error-handling)
setting. On the default, `"skip"`, the run finishes and the child reads
`completed`. On `"fail"` the error propagates and the child reads `failed`.

So a board left on the default reports a run that succeeded for work that broke.
The task carries the failure under either setting, which makes the board the
thing to watch when the question is whether the work came out right, and the
child's status the thing to watch when the question is whether anything is
still running. A failed task reads `errored`, with the message in its [`error`
field](../orchestration/task-substrate.md#the-task-record).

That write goes through the worker's claim on the task, so it lands only while
the task is still the worker's to write. One cancelled in the meantime, or
completed by the worker itself earlier in the run, or handed to another worker
after the claim lapsed, keeps the status it already has and records nothing. See
[Recording a result that may no longer
apply](../orchestration/task-substrate.md#recording-a-result-that-may-no-longer-apply).

A child with no runs yet has no `status` field at all. Absence means "nothing
has run", which is different from any of the values above.

A child that failed and was retried successfully reads `completed`; the failed
attempt is still there in its own history.

`active` describes what the system recorded, not what a worker is doing right
now. If a worker's process dies mid-run the row keeps reading `active` until a
client continues the run or a retry supersedes it — the framework marks the run
recoverable, it does not restart it for you. A child whose approval request
expired without an answer reads `active` indefinitely, because nothing
discharges an approval except answering it.

### What a stopped process leaves behind

A process can stop while a child session is still running, and the work is then
cancelled without being settled. So a child can read `active` with nothing
running it, and the request records under it can read in-progress, for a while
after the process is gone. Neither is a stuck row.

The task clears itself: it is taken back once its lease has lapsed and some
worker claims it again. The request record is made *recoverable* rather than
cleared — a sweep marks it `interrupted`, the status a run can be resumed from,
running at runtime start, on a timer while a server is up, and on demand when a
client asks.

Marking it is where the framework stops. Nothing continues or re-runs the work
on your behalf: restarting a request nobody asked to restart is how the same
work runs twice. So the row keeps reading `active` — an `interrupted` run is
unfinished and still continuable — until a client resumes or retries it, or a
later run supersedes it. The sweep waits until a record's heartbeat has been
quiet longer than the staleness threshold, so a run that has simply gone quiet
for a second is never mistaken for an abandoned one.

That protection is the heartbeat, so it doesn't cover a flow that turns the
heartbeat off. With `request: { heartbeatIntervalMs: 0 }` nothing refreshes the
run's active-request registry entry, so a run lasting longer than the staleness
threshold will be marked `interrupted` while it is still going — which also
offers it for resume, so the same work can be started a second time. Keep the
heartbeat on for any flow whose requests outlive the threshold.

The process that walked away mostly doesn't settle the record on its way out:
[`dispose()`](../api/server.md#shutdown) cancels child sessions rather than
marking them finished or failed. One case doesn't follow that yet — work still
waiting behind a concurrency limit when shutdown reaches it is recorded
`aborted` without ever having started — so read a terminal status after a
shutdown as a record of what the process did, not as proof the work ran. And if
nothing ever runs against that store again, nothing sweeps it, and the row stays
as it is.

For the thresholds, see [Connection
resilience](./connection-resilience.md#configuration). For the lease and the
abandonment allowance, see [the
lease](../orchestration/task-substrate.md#the-lease) and [when a job keeps being
abandoned](../orchestration/task-substrate.md#when-a-job-keeps-being-abandoned).

## Reading one child's history

Each row's `id` addresses a session, so every session endpoint works on it:

```
GET /api/flows/sessions/dsx_9f2c1a5e7b3d4c8a0f1e2d3c4b5a6978/requests
```

That returns the child's runs, with the item log for each when you ask for it
(`?include_items=true`).

Each run's record carries the dispatch type in `source` and a `metadata.dispatch`
bag:

```json
{
  "source": "task",
  "metadata": {
    "dispatch": {
      "type": "task",
      "target": "implement",
      "from": { "block": "issue-work-hand-off-implement", "sessionId": "sess_abc" },
      "key": "task|10:issue-work|8:task_7f3",
      "taskId": "task_7f3"
    }
  }
}
```

`source` is `"task"` for a board hand-off and `"internal"` for a dispatcher. The
runtime stamps it and a request body cannot set it, so read the bag only when
`source` is one of those two: an application can put a key named `dispatch` in
`metadata` on its own requests.

- `type` and `target` are the address the dispatch was sent to, the same pair
  the listing shows as `coordinate`.
- `from` names the block that sent the dispatch and the session it was sent
  from.
- `key` is the key the child was derived from, the same value the listing shows
  as `topic`. Absent when the dispatch was delivered into an existing session by
  id.
- `taskId` is present on a `task` dispatch and names the board row the run was
  started for, taken from the claim the board held on that row. Use it to
  stitch a run to a row in a view; don't key an authorization or a settlement
  on it.

A dispatch delivered by `id` into an existing session doesn't create a child. It
lands in that session's own request list, with the same bag minus `key`.

Children can nest. A child that dispatches work of its own has children, and
`/children` on its id lists them.

## Paging

Pass `limit` (1 up to the server's ceiling; 25 when omitted) and `offset`
(0–10000). Values outside those ranges get a `400` naming the accepted range
rather than a silently clamped page. The ceiling is 100 unless the host raises
[`maxChildSessionListLimit`](../configuration/runtime.md); a value past it is a
`400` too.

Rows come back newest-created first. A child that starts a run while you are
paging will not shuffle the pages under you. A child *created* while you are
paging can be missed, or can shift a later page by one — if you need exactness
there, fetch a single page large enough to hold the whole set.

## What this endpoint won't do

**It won't apply access rules of its own.** The same rules that govern reading
the conversation named in the path govern reading its children. That is how
every session-addressed route works: session detail, state, resource content,
the debug endpoints. A conversation in another tenant answers `404`. One with no
children answers `200` with an empty list. Whether one belonging to another user
answers `403` depends on your `resolvePrincipal`. With none configured the
management endpoints stay open, so a caller holding a conversation id can read
that conversation's children. See [Without a
resolver](./authentication.md#without-a-resolver).

**It won't list children across conversations.** There is no "everything I have
running" endpoint. You reach a child through the conversation that started it.

**It won't tell you whether a worker process is alive.** See the note on
`status` above.

**It won't return the child's state, resources, or journal.** Rows carry
identity, labels, timestamps and status. Fetch the session itself if you need
more.

## Related

- [Work that outlives the turn](/guides/background-work) — how child sessions
  relate to side chains and queue-backed runs
- [Flow options > Dispatching to another session](../configuration/flow.md#dispatching-to-another-session) —
  the `dispatcher()` block
- [Task board > Handing tasks off to child sessions](../orchestration/task-board.md#handing-tasks-off-to-child-sessions) —
  `{ block, session }` seats
- [Client overview](../client/overview.md#background-work) — the same two reads
  from an app
- [React](../client/react.md#background-work) — `useSession`'s `children`
- [Claude Code SDK agent](../tools/claude-code-sdk.md#turning-it-off-for-background-work) —
  running a coding agent in a child session
- [Engine setup](./setup.md) — the full HTTP route table
- [Authentication](./authentication.md) — how addressed routes scope by owner
- [Persistence](../persistence/overview.md) — where sessions and requests are stored

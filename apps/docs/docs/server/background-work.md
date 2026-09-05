---
sidebar_position: 6
sidebar_label: Detached work
---

# Detached work

Some work outlives the turn that asked for it: a long research pass, a document
being drafted, an implementation running for an hour. That work runs in its own
*session*, the record the framework keeps for one conversation, holding its
state, its resources, and the history of every request that ran in it. A
background job's session hangs off the conversation that started it, as a child
of it.

This page covers how a flow starts a job, and the HTTP surface for
reading them afterwards. Ask a conversation for its jobs, then ask any one job
for its history.

Starting one is server-side only. There is no endpoint for it. A job begins
inside a running request, either from a `dispatcher()` block or from a task
board handing a claimed task to a child session. See [Work that outlives the
turn](/guides/background-work#workstreams-a-job-with-its-own-session) for how
the two relate to the other kinds of background work.

## Starting a job from a flow

A flow declares the work a job can run under `internal.actions`, beside
`actions`. An internal entry has the same shape as an action, but no client can
call it. The only way in is a `dispatcher()` block inside the same flow.

```ts
import { defineFlow, dispatcher, generator, handler } from "@flow-state-dev/core";
import { z } from "zod";

const summarizeDocument = generator({
  name: "summarize-document",
  model: "openai/gpt-5.4-mini",
  inputSchema: z.object({ documentId: z.string() }),
  prompt: "Summarize the document.",
});

const acknowledge = handler({
  name: "acknowledge",
  inputSchema: z.object({ reason: z.string() }),
  execute: async (input) => ({ noted: input.reason }),
});

// One job per document. The same documentId from the same conversation
// lands on the same job.
const summarizeInBackground = dispatcher({
  name: "summarize-in-background",
  type: "internal",
  target: "summarize",
  inputSchema: z.object({ documentId: z.string() }),
  session: { key: (input) => input.documentId },
});

// Deliver into a session that already exists.
const nudgeCoordinator = dispatcher({
  name: "nudge-coordinator",
  type: "internal",
  target: "acknowledge",
  inputSchema: z.object({ coordinatorSessionId: z.string(), reason: z.string() }),
  session: { id: (input) => input.coordinatorSessionId },
  payload: (input) => ({ reason: input.reason }),
});

export default defineFlow({
  kind: "documents",
  actions: {
    upload: { block: summarizeInBackground },
    nudge: { block: nudgeCoordinator },
  },
  internal: {
    actions: {
      summarize: { block: summarizeDocument },
      acknowledge: { block: acknowledge },
    },
  },
})();
```

A dispatcher is a handler. Run it, in a sequencer step, as a generator's tool,
or as an action's root block, and it sends one request to `target` and returns
as soon as the runtime has accepted it. It does not wait for the work.

```ts
// what the dispatcher returns
{ sessionId: "sess_9f2c1a", requestId: "req_c41e", adopted: false }
```

`sessionId` is the session the work runs in, `requestId` the run it became, and
`adopted` whether that session already existed. The entry validates the payload
against its own `inputSchema` on arrival; `payload` shapes it, and defaults to
the dispatcher's input as-is.

`session` decides which session that is.

| `session` | Runs in | When it does not exist |
|---|---|---|
| `{ key: (input) => string }` | a child of the running session, derived from the key | created; the next call with the same key from the same conversation adopts it |
| `{ id: (input) => string }` | the session with that id | refused. Nothing is created |

A `key` child is a job in every sense on this page: it hangs off the session
that started it, runs the same flow as the same user, keeps its own state and
history, and shows up in the parent's listing below. The key is scoped to the
conversation, so the same key from a different conversation is a different
child. An `id` target has to be a session of this flow kind that belongs to
this user.

`defineFlow` checks every dispatcher it can reach and throws at definition time
when `target` names an entry the flow does not declare. An action named
`summarize` does not stand in for `internal.actions.summarize`; each map is
looked up on its own.

A refusal at run time throws `DispatchRefusedError`, with `code:
"dispatch-refused"` and a `refused` field to branch on:

| `refused` | Meaning |
|---|---|
| `no-entry` | The flow declares no entry at that address |
| `session-not-found` | An `id` names a session that does not exist, or one that belongs to another user |
| `session-not-addressable` | An `id` names a session on another flow |
| `key-occupied` | The `key` derived a session id already held by something that is not this conversation's child |
| `no-dispatch-operation` | This process runs requests but was not set up to dispatch one |
| `dispatch-rejected` | The entry's `concurrency` policy is `reject` and its key is held |
| `external-dispatcher` | An `id` delivery on a deployment that hands work to an external queue. A `key` child is unaffected |

Every refusal is decided before anything starts, so a `.rescue()` on the
dispatcher can branch on `refused` knowing no child is running. A `key` or
`id` function that returns an empty string throws a plain `Error` naming the
block.

A task board seat can start a job the same way: a `dispatcher({ type: "task"
})` under `workers` sends each claimed task to one of the flow's `task.actions`
entries, and the child session lands in the same listing. See [Task board →
Seats that hand off](../orchestration/task-board.md#seats-that-hand-off).

## Listing a conversation's jobs

```
GET /api/flows/sessions/sess_abc/workstreams
```

`workstream` is the API's word for a background job. It names the path segment
and the response key, and means the same thing throughout this page.

```json
{
  "workstreams": [
    {
      "id": "ws_9f2c1a",
      "parentSessionId": "sess_abc",
      "topic": "market-research",
      "coordinate": "14:research-board|22:assignee|10:researcher",
      "status": "active",
      "createdAt": 1770000000000,
      "updatedAt": 1770000042000
    },
    {
      "id": "ws_1c7b40",
      "parentSessionId": "sess_abc",
      "topic": "draft-summary",
      "status": "completed",
      "createdAt": 1769999000000,
      "updatedAt": 1769999900000
    }
  ]
}
```

`topic` names the body of work and `coordinate` names where it runs. A job a
`dispatcher()` started carries the dispatcher's key as `topic` and the entry it
runs as `coordinate`: `internal:summarize` for an internal entry, `task:implement`
for a task-board seat that hands off. Work started from a detached task-board
worker gets a `coordinate` holding the board and the worker together in one
encoded string. Compare it whole. The worker's name is visible inside it, but
matching on that substring collides across boards.

Together the two identify a job, so two rows sharing a `topic` are separate jobs
whenever their `coordinate`s differ. A row with a `topic` and no `coordinate` was
addressed by topic alone, without a board. For which tasks land in the same job
rather than starting a new one, see [Which tasks share a
workstream](/guides/background-work#which-tasks-share-a-workstream).

Both labels are optional, as is `status`, so read them with `== null` guards
rather than assuming every row carries them. A row with neither label is a child
session that isn't a background job.

### What `status` tells you

`active` means the job isn't finished. It covers a job waiting in a queue, a job
running right now, and a job paused waiting for someone to approve something.
The endpoint does not distinguish those. If you need to know which,
open the job and read its history, or read the task board the job is working
from.

Every other value is how the job's last run ended:

| Value | Meaning |
|---|---|
| `completed` | The run finished. Not the same as the work succeeding |
| `failed` | The run itself ended with an error. A worker error doesn't always reach it |
| `aborted` | Cancelled |
| `incomplete` | Stopped short of finishing, usually on a budget |

A job doing a task board's work runs that board's worker, and a worker that
throws records the failure on its own task. What that does to the run around it
is the board's
[`onError`](../orchestration/task-board.md#concurrency-and-error-handling)
setting. On the default, `"skip"`, the run finishes and the job reads
`completed`. On `"fail"` the error propagates and the job reads `failed`.

So a board left on the default reports a job that succeeded for work that broke.
The task carries the failure under either setting, which makes the board the
thing to watch when the question is whether the work came out right, and the
job's status the thing to watch when the question is whether anything is still
running. A failed task reads `errored`, with the message in its [`error`
field](../orchestration/task-substrate.md#the-task-record).

That write goes through the worker's claim on the task, so it lands only while
the task is still the worker's to write. One cancelled in the meantime, or
completed by the worker itself earlier in the run, or handed to another worker
after the claim lapsed, keeps the status it already has and records nothing. See
[Recording a result that may no longer
apply](../orchestration/task-substrate.md#recording-a-result-that-may-no-longer-apply).

A job with no runs yet has no `status` field at all. Absence means "nothing has
run", which is different from any of the values above.

A job that failed and was retried successfully reads `completed`; the failed
attempt is still there in the job's own history.

`active` describes what the system recorded, not what a worker is doing right
now. If a worker's process dies mid-job the row keeps reading `active` until a
client continues the run or a retry supersedes it — the framework marks the run
recoverable, it does not restart it for you. A job
whose approval request expired without an answer reads `active` indefinitely,
because nothing discharges an approval except answering it.

### What a stopped process leaves behind

A process can stop while background work is still running, and the work is then
cancelled without being settled. So a job can read `active` with nothing running
it, and the request records under it can read in-progress, for a while after the
process is gone. Neither is a stuck row.

The task clears itself: it is taken back once its lease has lapsed and some
worker claims it again. The request record is made *recoverable* rather than
cleared — a sweep marks it `interrupted`, the status a run can be resumed from,
running at runtime start, on a timer while a server is up, and on demand when a
client asks.

Marking it is where the framework stops. Nothing continues or re-runs the work
on your behalf, deliberately: restarting a request nobody asked to restart is
how the same job runs twice. So the row keeps reading `active` — an
`interrupted` run is unfinished and still continuable — until a client resumes
or retries it, or a later run supersedes it. The sweep waits
until a record's heartbeat has been quiet longer than the staleness threshold,
so a job that has simply gone quiet for a second is never mistaken for an
abandoned one.

That protection is the heartbeat, so it doesn't cover a flow that turns the
heartbeat off. With `request: { heartbeatIntervalMs: 0 }` nothing refreshes the
run's active-request registry entry, so a run lasting longer than the staleness
threshold will be marked `interrupted` while it is still going — which also
offers it for resume, so the same work can be started a second time. Keep the
heartbeat on for any flow whose requests outlive the threshold.

The process that walked away mostly doesn't settle the record on its way out:
[`dispose()`](../api/server.md#shutdown) cancels background work rather than
marking it finished or failed. One case doesn't follow that yet — work still
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

## Reading one job's history

Each row's `id` addresses a session, so every session endpoint works on it:

```
GET /api/flows/sessions/ws_9f2c1a/requests
```

That returns the job's runs, with the item log for each when you ask for it
(`?include_items=true`).

Each run's record carries a `metadata.workstream` bag:

```json
{
  "source": "workstream",
  "metadata": {
    "workstream": {
      "topic": "market-research",
      "key": "14:research-board|22:assignee|10:researcher",
      "taskId": "task_7f3"
    }
  }
}
```

Read that bag at all only when `source` is `"workstream"`. An application can
put whatever it likes in `metadata` on its own requests, including a key named
`workstream`. `source` is different: the transport that accepted the request
stamps it, and a request body cannot.

What you can rely on differs by field.

`topic` and `key` are the address the run's session was derived from. Choosing
them and choosing which session you get is the same choice, so they cannot
disagree with the run they sit on. They are the same pair the listing returns as
the job's `topic` and `coordinate`, so `key` is opaque here for the same reason
it is there: compare it whole. `key` is absent when the job was addressed
without one.

`taskId` names the task-board row the run was started for, so you can match a
run back to a board row without keeping the board open beside it. It holds what
the code that started the job passed, and nothing checks it against a board. A
job started by a task board takes it off the claim the board holds on that row,
so on board work it points where it says. But `ctx.requestHost.startDetached`
is reachable from any block, so application code can start a job and name any
row it likes. Use `taskId` to stitch a run to a row in a view. Don't key an
authorization or a settlement on it. It appears only when the caller supplied
one, so read it with a `== null` guard.

Nothing routes, authorizes or settles on the bag. A wrong `taskId` mislabels a
run for whoever is reading it and grants nothing.

A run a `dispatcher()` started reads `source: "internal"`, or `source: "task"`
when a task-board seat handed the work off, and carries a `metadata.dispatch`
bag instead:

```json
{
  "source": "task",
  "actionName": "implement",
  "metadata": {
    "dispatch": {
      "type": "task",
      "target": "implement",
      "from": { "block": "hand-off-implement", "sessionId": "sess_abc" },
      "key": "task|10:issue-work|3:t42",
      "taskId": "t42"
    }
  }
}
```

`type` and `target` are the entry the run executes, `from` names the block that
sent it and the session it was running in, `key` is the session key the child
was derived from, and `taskId` the board row on a task hand-off. `key` is
absent when the dispatcher delivered into an existing session by `id`, and
`taskId` is absent on an internal dispatch. Read the bag only under those two
sources; the same rule as `metadata.workstream` applies.

A run with either source cannot be re-entered from outside. `retry`,
`continue`, and `resume` on its request id answer `404`, the same as for a
request that does not exist.

Jobs can nest. If a job files jobs of its own, calling `/workstreams` on its id
returns them.

## Paging

Pass `limit` (1–100, default 25) and `offset` (0–10000). Values outside those
ranges get a `400` naming the accepted range rather than a silently clamped
page.

Rows come back newest-created first. A job that starts a run while you are
paging will not shuffle the pages under you. A job *created* while you are
paging can be missed, or can shift a later page by one — if you need exactness
there, fetch a single page large enough to hold the whole set.

## What this endpoint won't do

**It won't apply access rules of its own.** The same rules that govern reading
the conversation named in the path govern reading its jobs. That is how every
session-addressed route works: session detail, state, resource content, the
debug endpoints. A conversation in another tenant answers `404`. One with no
jobs answers `200` with an empty list. Whether one belonging to another user
answers `403` depends on your `resolvePrincipal`. With none configured the
management endpoints stay open, so a caller holding a conversation id can read
that conversation's jobs. See [Without a
resolver](./authentication.md#without-a-resolver).

**It won't list background work across conversations.** There is no
"everything I have running" endpoint. You reach jobs through the conversation
that started them.

**It won't tell you whether a worker process is alive.** See the note on
`status` above.

**It won't return the job's state, resources, or journal.** Rows carry identity,
labels, timestamps and status. Fetch the session itself if you need more.

## Related

- [Work that outlives the turn](/guides/background-work) — how jobs relate to the other
  things this framework calls background work
- [Client overview](../client/overview.md#background-work) — the same two calls from an app
- [Claude Code SDK agent](../tools/claude-code-sdk.md#turning-it-off-for-background-work) — running
  a coding agent as a job, and what its workstream records
- [Engine setup](./setup.md) — the full HTTP route table
- [Authentication](./authentication.md) — how addressed routes scope by owner
- [Persistence](../persistence/overview.md) — where sessions and requests are stored

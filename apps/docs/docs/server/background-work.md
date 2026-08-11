---
sidebar_position: 6
sidebar_label: Background work
---

# Background work

Some work outlives the turn that asked for it: a long research pass, a document
being drafted, an implementation running for an hour. That work runs in its own
*session*, the record the framework keeps for one conversation, holding its
state, its resources, and the history of every request that ran in it. A
background job's session hangs off the conversation that started it, as a child
of it.

Reading a conversation's jobs takes two calls. Ask the conversation for its
jobs, then ask any one job for its history.

Starting one is not something the HTTP API does. A job's session is created from
inside a running request, through `ctx.requestHost.startDetached`. The shipped
HTTP router supplies the start operation that call needs, so a job started this
way runs on the same server that accepted the request — no extra wiring. Supply
your own `requestHost.startOperation` and yours is used instead, which is how a
deployment sends background work to a separate worker tier.

In practice that means a task board with a worker declared detached. See [Work
that outlives the turn](/guides/background-work#workstreams-a-job-with-its-own-session).

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

`topic` names the body of work and `coordinate` names where it runs. Work
started from a task board, which is the usual way, gets a `coordinate` holding
the board and the worker together in one encoded string. Compare it whole. The
worker's name is visible inside it, but matching on that substring collides
across boards.

Both labels are optional, as is `status`, so read them with `== null` guards
rather than assuming every row carries them. A row with neither label is a child
session that isn't a background job.

The pair is what identifies a job. A job is one board, one worker, one topic, so
two rows sharing a `topic` are separate jobs whenever their `coordinate`s
differ, whether that's a different board or a different worker, and tasks
matching on all three continue one job instead of starting another. A row with a
`topic` and no `coordinate` was addressed by topic alone, without a board. See
[Which tasks share a workstream](/guides/background-work#which-tasks-share-a-workstream).

### What `status` tells you

`active` means the job isn't finished. It covers a job waiting in a queue, a job
running right now, and a job paused waiting for someone to approve something.
The endpoint does not distinguish those. If you need to know which,
open the job and read its history, or read the task board the job is working
from.

Every other value is how the job's last run ended:

| Value | Meaning |
|---|---|
| `completed` | The run finished |
| `failed` | The run ended with an error |
| `aborted` | Cancelled |
| `incomplete` | Stopped short of finishing, usually on a budget |

`completed` says the run finished, not that the work came out right. A job doing
a task board's work runs that board's worker, and a worker that throws always
marks its own task `errored`. What that does to the run around it is the board's
`onError` setting. On the default, `"skip"`, the run finishes and the job reads
`completed`. On `"fail"` the error propagates and the job reads `failed`.

So a board left on the default reports a job that succeeded for work that broke.
The task carries the failure in both cases, which makes the board the thing to
watch when the question is whether the work came out right, and the job's status
the thing to watch when the question is whether anything is still running. See
[Concurrency and error
handling](../orchestration/task-board.md#concurrency-and-error-handling).

A job with no runs yet has no `status` field at all. Absence means "nothing has
run", which is different from any of the values above.

A job that failed and was retried successfully reads `completed`; the failed
attempt is still there in the job's own history.

`active` describes what the system recorded, not what a worker is doing right
now. If a worker's process dies mid-job the row keeps reading `active` until the
framework notices and either continues the run or a retry supersedes it. A job
whose approval request expired without an answer reads `active` indefinitely,
because nothing discharges an approval except answering it.

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
- [Server setup](./setup.md) — the full HTTP route table
- [Authentication](./authentication.md) — how addressed routes scope by owner
- [Persistence](../persistence/overview.md) — where sessions and requests are stored

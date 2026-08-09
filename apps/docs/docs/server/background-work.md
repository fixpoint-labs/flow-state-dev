---
sidebar_position: 6
sidebar_label: Background work
---

# Background work

An action can start work that outlives the turn that asked for it — a long
research pass, a document being drafted, an implementation running for an hour.
That work runs in its own *session*: the record the framework keeps for one
conversation, holding its state, its resources, and the history of every request
that ran in it. A background job's session is attached to the conversation that
launched it, as a child of it.

Reading them takes two calls. Ask a conversation for its jobs, then ask any one
job for its history.

## Listing a conversation's jobs

```
GET /api/flows/sessions/sess_abc/workstreams
```

```json
{
  "workstreams": [
    {
      "id": "ws_9f2c1a",
      "parentSessionId": "sess_abc",
      "topic": "market-research",
      "coordinate": "researcher",
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

`topic` names the body of work and `coordinate` names the worker handling it.
The server stamps both when the job starts, so a value written by a caller never
appears here. A row that carries neither is a child session that isn't a
background job.

Both are optional, as is `status`. Read them with `== null` guards rather than
assuming every row has them.

### What `status` tells you

`active` means one thing: the job isn't finished. It covers a job waiting in a
queue, a job running right now, and a job paused waiting for someone to approve
something. The endpoint does not distinguish those. If you need to know which,
open the job and read its history, or read the task board the job is working
from.

Anything else is how the job ended:

| Value | Meaning |
|---|---|
| `active` | Not finished |
| `completed` | Finished successfully |
| `failed` | Ended with an error |
| `aborted` | Cancelled |
| `incomplete` | Stopped short of finishing, usually on a budget |

A job with no runs yet has no `status` field at all. Absence means "nothing has
run", which is different from any of the values above.

A job that ran several times reports the outcome of its most recent run. A job
that failed and was retried successfully reads `completed`; the failed attempt
is still there in the job's own history.

One thing to be careful about: `active` describes what the system recorded, not
what a worker is doing right now. If a worker's process dies mid-job the row
keeps reading `active` until the framework notices and either continues the run
or a retry supersedes it. A job whose approval request expired without an answer
reads `active` indefinitely, because nothing discharges an approval except
answering it.

## Reading one job's history

Each row's `id` addresses a session, so every session endpoint works on it:

```
GET /api/flows/sessions/ws_9f2c1a/requests
```

That returns the job's runs, with the item log for each when you ask for it
(`?include_items=true`).

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

**It won't show a conversation's jobs to anyone but its owner.** The
conversation in the path is loaded and checked before the handler runs, so the
same rules that govern reading the conversation govern reading its jobs. A
conversation in another tenant answers `404`. One belonging to another user
answers `403`. One with no jobs answers `200` with an empty list.

**It won't list background work across conversations.** There is no
"everything I have running" endpoint. You reach jobs through the conversation
that started them.

**It won't tell you whether a worker process is alive.** See the note on
`status` above.

**It won't return the job's state, resources, or journal.** Rows carry identity,
labels, timestamps and status. Fetch the session itself if you need more.

## Related

- [Server setup](./setup.md) — the full HTTP route table
- [Authentication](./authentication.md) — how addressed routes scope by owner
- [Persistence](../persistence/overview.md) — where sessions and requests are stored

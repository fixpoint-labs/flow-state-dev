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
Both are optional, as is `status`, so read them with `== null` guards rather
than assuming every row carries them. A row with neither label is a child
session that isn't a background job.

### What `status` tells you

`active` means one thing: the job isn't finished. It covers a job waiting in a
queue, a job running right now, and a job paused waiting for someone to approve
something. The endpoint does not distinguish those. If you need to know which,
open the job and read its history, or read the task board the job is working
from.

Every other value is how the job ended:

| Value | Meaning |
|---|---|
| `completed` | Finished successfully |
| `failed` | Ended with an error |
| `aborted` | Cancelled |
| `incomplete` | Stopped short of finishing, usually on a budget |

A job with no runs yet has no `status` field at all. Absence means "nothing has
run", which is different from any of the values above.

A job that ran several times reports the outcome of its most recent run. A job
that failed and was retried successfully reads `completed`; the failed attempt
is still there in the job's own history.

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

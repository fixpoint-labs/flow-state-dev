---
"@flow-state-dev/client": patch
---

The session client can read the background work running under a conversation (FIX-1011). `listWorkstreams(parentSessionId, { limit, offset })` returns one row per body of work, and `listSessionRequests` with a row's `id` — the call that already ships, unchanged — returns what that work has done.

Each row carries the state its work reached, so a list of background work renders from one request no matter how many jobs a conversation has. `WorkstreamSummary.status` is `"active" | "completed" | "incomplete" | "failed" | "aborted"`, and is **absent** when the job has not run anything yet. `"active"` means *not finished* and nothing more — it does not separate running from queued from paused waiting for a person, and it reports the last state the server recorded rather than checking that a worker is alive. `topic` and `coordinate` are display-only labels that route and authorize nothing, and are absent on any session that is not background work; guard all three with `== null`.

There is no counterpart that starts detached work. Whether work runs in the background is declared by the flow author when the flow is wired up, never chosen by the caller, so nothing on the client can request it.

Requires a server serving `GET /api/flows/sessions/:id/workstreams` (FIX-1010).

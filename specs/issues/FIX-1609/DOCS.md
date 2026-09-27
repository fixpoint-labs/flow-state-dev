# FIX-1609 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Voice rules most at risk here: "live" is overloaded in these pages (live items, live mode), so
say what the view does; few em-dashes; no issue numbers under `apps/docs`. The client export's
name below is illustrative until it ships.

## UPDATE · `apps/docs/docs/client/react.md` · new section after "Resuming an interrupted request"

### Hearing requests you didn't send

A view hears the requests it sends. Some sessions have more than one writer: a channel where
agents answer, a board several people work, the same conversation open in two tabs. Their lines
land in the session, but nothing tells a view that didn't send them. Ask the view to stay live:

```tsx
const channel = useSession(sessionId, {
  flowKind: "channel",
  items: true,
  live: true,
});
```

The hook then opens one stream for the session. Each finished item from any request in it joins
`session.items` about a second after the server keeps it, in the order a reload would show. The
stream carries whole items, not text as it is typed, so another writer's answer appears in one
piece. Items from your own requests still arrive on their own stream, and each shows once.

The background-work list stays current too: when a run starts or finishes, the hook re-reads
`session.childSessions`. That is how you show who is busy right now:

```tsx
const working = channel.childSessions.filter((run) => run.status === "active");
```

A live view holds a connection open while it is mounted, and the server reads the session about
once a second for it. Leave `live` off for a view only one person writes to; the request stream
already carries everything there. If the server doesn't offer the stream, the view behaves as if
you hadn't asked, with no error. A dropped connection reconnects on its own and fills in what it
missed.

## UPDATE · same page · "When the list changes" · append

In a view with `live: true` the list also changes on its own, within about a second of a run
starting or finishing, from this tab or anywhere else.

## UPDATE · same page · "What a row's status tells you" · replace the second paragraph

`"active"` means *not finished* and nothing else. It does not tell you whether the job is
thinking, queued, or stopped waiting for someone to answer a question. It also reports the last
state recorded, not a check that the job is alive: work whose worker stopped unexpectedly reads as
unfinished until the system picks it back up. So in a list someone reads once, don't label it
"running" or "working". In a live view, where the row clears the moment the work ends, "working"
is a fair label for a person waiting on an answer, as long as a job paused for approval or a
stopped worker reading the same is acceptable to you. [What `status` tells
you](/docs/server/background-work#what-status-tells-you) has each value in full.

## UPDATE · `apps/docs/docs/api/react.md` · `useSession(sessionId, options?)`

Add to the options: `live?: boolean`. Default `false`. When `true`, the hook also hears requests
it didn't send and keeps `childSessions` current as runs start and finish. See [Hearing requests
you didn't send](/docs/client/react#hearing-requests-you-didnt-send).

In the `childSessions` paragraph, after "…folded into the conversation.": It is re-read on mount,
at the start of each action and on `refresh()`, and with `live: true` whenever a run starts or
finishes.

## UPDATE · `apps/docs/docs/api/client.md` · "SSE Clients", after `createSSEClient`

### `createSessionSSEClient(options)`

Opens one stream for a whole session: `GET /api/flows/sessions/:sessionId/stream`. It delivers
each finished item from any request in the session, once, with the id of the request that kept
it, and a notice when the session's background runs change. Items the session snapshot hides are
never sent. It reconnects with backoff and passes back the server time it last heard, so the
server resends what it might have missed; drop duplicates by item id. It stops, without retrying,
when the server refuses the session or has no such route. `useSession` wraps it for `live: true`.

## UPDATE · `apps/docs/docs/client/overview.md` · "Stream connection", closing paragraph

A request's stream carries one request. To follow everything that happens in a session,
including requests another tab, person or agent sent, use `createSessionSSEClient`. It sends
finished items rather than text as it streams.

## UPDATE · `apps/docs/docs/workforce/channels.md` · "Showing a channel on screen" · replace the paragraph "A line another member posts appears when the page reads the channel again…"

An agent's answer, or a post from another tab, is a request the page didn't send. Add `live: true`
and it appears within about a second, with no reload:

```tsx
const channel = useSession("engineering.standup", {
  flowKind: "channel",
  items: { itemTypes: ["component"] },
  live: true,
});
const busy = channel.childSessions.filter((run) => run.status === "active");
```

`busy` lists the agents woken by a post that haven't finished. Each row's `flowId` is the woken
seat's address, so the page can say who is working.

## UPDATE · `packages/engine/README.md` · after the `/children` paragraphs

`GET /api/flows/sessions/:sessionId/stream` follows a whole session. It is authorized as the
session snapshot is. While the connection is open, the server reads the session about once a
second from the store and sends each finished item that passes the snapshot's filter, with its
request id, plus a notice when the session's child runs change. Every server reads the same store,
so a line written on one instance reaches a view held by another. `since` (a server time the
stream sent earlier) bounds the first read; without it the stream covers the last minute.

## UPDATE · `packages/react/README.md` · `SessionView.childSessions` · replace "Current as of the reader's last interaction…"

Current as of the reader's last interaction: re-read on mount, at the start of each action, and on
`refresh()`. With `live: true` it is also re-read whenever a run starts or finishes, so a view can
show who is working without the user doing anything.

## UPDATE · `packages/client/README.md` · Public API, after `createSSEClient`

- `createSessionSSEClient(options)` — Whole-session stream: finished items from every request, and run changes

## UPDATE · `docs/architecture/server-and-client.md` · "Background work", the paragraph "The axis is interaction-scoped, not live"

Replace its first sentence and the clause about no session-level channel: The axis is
interaction-scoped by default. A view that sets `live: true` also re-reads it on the session
stream's run-changed notice, through the same guarded read, so the generation and sequence guards
below cover both. The stream carries a notice, never rows.

## UPDATE · `apps/kitchen-sink/README.md` · the **Channels** bullet, last sentence

Replace "Lines a seat posts show up the next time the channel is read" with: Lines a seat posts
appear as the channel keeps them, and each seat working on your post shows as working until it
finishes.

## Publication ownership

This issue publishes all of the above after VG passes. FIX-1610 owns the channels guide's routing
and answer sections; FIX-1611 later rewrites the kitchen-sink **Channels** bullet whole.

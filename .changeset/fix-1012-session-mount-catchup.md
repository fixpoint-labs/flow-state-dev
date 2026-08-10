---
"@flow-state-dev/react": minor
---

`useSession` can show the background work running under a conversation (FIX-1012). `session.workstreams` is a second list beside `items` — one entry per body of work, carrying what a row needs to render and the id needed to open it. Empty for any session that never started background work, and `items` is unchanged for every existing app.

Opening one needs nothing new: a body of background work is a session, so `useSession(row.id, { flowKind, autoResume: true })` reads it. A row carries no `flowKind`, so pass the flow your worker runs, or take it from that work's own request records via `listSessionRequests(row.id)`.

**The list is current as of the reader's last interaction — it does not update while they watch.** It is re-read on mount, at the start of every action (`sendAction`, `resumeLatestRequest`, `resumeSuspension`, `continueRequest`), and whenever the app calls `session.refresh()`, which now covers this list as well as the conversation. A job started somewhere else appears on the next action or refresh. That costs one background read per turn and no polling; a self-updating panel can be added later without breaking anything built on this.

**Finished background work stays in its own list.** Nothing is folded into the conversation transcript — an app that wants "here's what came back" to appear in the chat writes that itself and chooses the wording. This is a deliberate decision, not a default: apps ship against the separation, and merging results into the transcript later would rewrite what every one of them displays.

`session.workstreamsStale` is `true` when the most recent re-read failed. The rows already fetched are kept rather than cleared, so a panel can mark them as possibly out of date instead of showing nothing.

A row's `status` is absent until its work has run something, and `"active"` means only *not finished* — it does not separate working from queued from waiting on a person, and it reports the last recorded state rather than checking a worker is alive, so work whose worker stopped unexpectedly reads as unfinished until the system picks it back up. Don't label it "running" or "working", and don't switch exhaustively over the status set; new values render as-is.

Also fixes an existing defect on the `autoResume` path: a request that finished while the hook was mounting left the session on stale items until a manual refresh or remount, because nothing was left to attach to and the snapshot already applied predated the request's final items. The hook now reads the request's status before the snapshot, so a terminal status proves the snapshot that follows is current, and catches up once when it isn't — leaving `latestRequest` agreeing with the items.

Requires a server serving `GET /api/flows/sessions/:id/workstreams` (FIX-1010) and the client's `listWorkstreams` (FIX-1011).

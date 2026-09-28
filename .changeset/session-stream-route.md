---
"@flow-state-dev/engine": patch
---

Add `GET /api/flows/sessions/:sessionId/stream`, which follows a whole session: each finished item any request in it keeps (filtered as the session snapshot filters), with its request id, and a notice naming the session's unfinished runs whenever that set changes. It is authorized as the snapshot is, reads the store about once a second (only what is unfinished or recently updated), and closes after at most 15 minutes. `@flow-state-dev/engine/testing` exports `createSessionStreamConformanceTests` for store adapters (FIX-1609). Each copy of an item is sent once per connection, so a keyed item emitted again is sent again.

A request for a child session now moves that child's `updatedAt` when it is accepted, before it waits behind a concurrency key or in an external queue, so a live view of the parent names the run while it waits. That includes a run delivered into an existing child by its id, which before moved nothing.

`PATCH /api/flows/sessions/:sessionId/metadata` now writes at the version it read and advances it, as `ctx.session.setMetadata` does. An edit no longer puts back fields another write changed meanwhile; it reads the session again and retries. A session that keeps changing through every retry answers 409.

`GET /api/flows/sessions/:sessionId/state` returns `at`, the server time its read began. Hand it to the session stream as `since` to start where the snapshot's read did. The snapshot's items are sorted with `compareItemOrder`, so two requests' items that share a time and an index are ordered by request id, not by which request was updated last.

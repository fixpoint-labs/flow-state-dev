---
"@flow-state-dev/engine": patch
---

Add `GET /api/flows/sessions/:sessionId/stream`, which follows a whole session: each finished item any request in it keeps (filtered as the session snapshot filters), with its request id, and a notice naming the session's unfinished runs whenever that set changes. It is authorized as the snapshot is, reads the store about once a second (only what is unfinished or recently updated), and closes after at most 15 minutes. `@flow-state-dev/engine/testing` exports `createSessionStreamConformanceTests` for store adapters (FIX-1609).

A run delivered into an existing child session by its id now moves that child's `updatedAt`, as a run that derives its child from a key already did, so a live view of the parent sees it start.

`GET /api/flows/sessions/:sessionId/state` returns `at`, the server time its read began. Hand it to the session stream as `since` to start where the snapshot's read did. The snapshot's items are sorted with `compareItemOrder`, so two requests' items that share a time and an index are ordered by request id, not by which request was updated last.

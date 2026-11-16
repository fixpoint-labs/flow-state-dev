---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/workforce": patch
---

The request host's `sessions.list` can ask for sessions by id, and the worker sessions view always shows the default conversation (FIX-2754).

- **core, engine:** `sessions.list` takes `ids`: only those sessions, at most the first 100, with the other filters (`flowKind`, `flowId`, `fields`, `limit`, `offset`) still applied. Each passes the same rule as the rest of the list: another user's, another tenant's or organization's, a write session, one a view's admission refuses and one that doesn't exist are all left out alike, and nothing in the answer tells them apart. A view that lists by id hears what the list hears, the caller's own session changes, so a session made later under an asked-for id wakes it.
- **workforce:** `workerSessionsViewRef()` lists the default conversation first and marked however many newer sessions the user has with the worker. Before, it paged through at most 1,000 sessions looking for it, and a refresh could read ten pages; it now reads the default by id beside the first page.

Docs: the Views page's "reading your sessions" (`sessions.list` takes `ids`, under the same rule as the rest of the list); packages/workforce/README.md, where it describes the worker sessions view (the default is listed first whatever the number of newer conversations).

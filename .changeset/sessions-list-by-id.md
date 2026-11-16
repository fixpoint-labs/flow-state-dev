---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/workforce": patch
---

The request host's `sessions.list` shows each session's state as the HTTP session list does and can ask for sessions by id, and a worker sessions row carries that state, so a screen names a conversation's work project from the one live read (FIX-2754).

- **core, engine:** each session `sessions.list` answers carries in `state` the fields the HTTP session list shows the same caller: the ones its flow exposes to the client (`session.client.expose`) as well as the readonly ones. It is display data. The list's `fields` filter still takes readonly fields only, and refuses an exposed one; `sessions.read` still answers readonly state only, since a block that decides on a peer session should decide on fields the server set at birth. A list hears a change to an exposed field while a turn still runs, as soon as the write lands; writes to it, increments and pushes included, are stored the same way as before.
- **core, engine:** `sessions.list` takes `ids`: only those sessions, at most the first 100, with the other filters (`flowKind`, `flowId`, `fields`, `limit`, `offset`) still applied. Each passes the same rule as the rest of the list: another user's, another tenant's or organization's, a write session, one a view's admission refuses and one that doesn't exist are all left out alike, and nothing in the answer tells them apart. A view that lists by id hears what the list hears, the caller's own session changes, so a session made later under an asked-for id wakes it.
- **workforce:** a `workerSessionsViewRef()` row's `state` carries the exposed fields too: `workProjectId` once the user sets the conversation's work project, and the app's own `sessionFields`.
- **workforce:** `workerSessionsViewRef()` lists the default conversation first and marked however many newer sessions the user has with the worker; it reads the default by id when the first page doesn't hold it.

Docs: the Views page's "reading your sessions" (a listed session's `state` is what the HTTP list shows, exposed and readonly, for display; the `fields` filter and `sessions.read` stay readonly-only; `sessions.list` takes `ids`, under the same rule as the rest of the list); packages/workforce/README.md, where it describes the worker sessions view (a row's `state`, with the work project; the default is listed first whatever the number of newer conversations).

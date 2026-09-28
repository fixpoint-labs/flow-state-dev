---
"@flow-state-dev/client": patch
---

Add `createSessionSSEClient(options)`, a client for the whole-session stream. It reconnects with backoff, handing back the last server time it heard, and stops without retrying when the server refuses the session (401, 403, or a 409 for a session that must be migrated first) or has no such route (FIX-1609).

`createRequestStreamStore` takes an optional `keyOf`, the key each item is held under (default: its id). A store that holds more than one request's items keys by request and item id, since two requests can keep the same id.

`SessionStateSnapshotResponse` has an optional `at`, and `createSessionSSEClient`'s `since` accepts it. It also has an optional `sessionCreatedAt`, and `createSessionSSEClient` takes it as `sessionCreatedAt` and names that session on every connection: once the id holds another session, the server answers 404 and the client stops. `compareItemOrder` breaks a tie on time and index by request id, then item id, where it used to return 0.

`createSessionSSEClient` takes `onReconnecting`, called before each reconnect with how many tries there have been since the stream last delivered an event: 1 after an ordinary close, 2 or more once a try has failed.

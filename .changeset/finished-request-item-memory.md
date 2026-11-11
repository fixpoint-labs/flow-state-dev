---
"@flow-state-dev/engine": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

The SQLite and Postgres request stores no longer keep a finished request's items in memory for the life of the server (FIX-2676).

- **store-sqlite, store-postgres:** while a request runs, the store remembers what it last wrote for each item so the next write carries only what changed. That memory is now dropped once the request's run has ended, however it ended. Before, writes after the terminal status (`request.onFinished`, side-chain work, request-end hooks, the observer's own trace with trace observability on) or a failed terminal write left a serialized copy of the request's whole item log behind.
- **engine:** `RequestStore` gains an optional `releaseItemTracking(requestId)`. The runtime calls it once the last live run of a request in the process has ended. A custom store that keeps per-request item state in memory implements it to drop that state; a store that keeps none omits it.

Docs: packages/engine/README.md and apps/docs custom-store pages, if they list the `RequestStore` methods: add the optional `releaseItemTracking`.

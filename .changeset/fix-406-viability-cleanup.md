---
"@flow-state-dev/core": minor
"@flow-state-dev/server": minor
"@flow-state-dev/cli": minor
---

Viability-review cleanup pass:

- AI SDK provider errors now classify into typed framework errors — `RateLimitError`, `TimeoutError`, `ContextLengthError`, and `ProviderUnavailableError` — so retry, monitoring, and UI code can tell a 429 from a timeout from an oversized prompt.
- Filesystem store write failures surface through an `onPersistError` observable on `createFilesystemStores`, instead of only logging to the console.
- A new `tracingLevel` option on `createFlowApiRouter` (`verbose` / `normal` / `minimal`) controls how many observability state snapshots sequencers emit; durable resume checkpoints are unaffected.
- The filesystem store now warns unless constructed with `developmentOnly: true`, and `fsdev dev` defaults to SQLite — its event persistence holds real load where the filesystem store can't.
- An optional `tenantId`, read from a configurable header (default `x-tenant-id`), is exposed on request and session context for multi-tenant apps to branch on.
- Item-heavy streams are faster: the per-emit `getItems()` sort was removed from the runtime hot path.

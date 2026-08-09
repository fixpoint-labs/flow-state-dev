---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/cli": patch
---

Cancelling a request now stops it even when it is running in another process (FIX-1026). `session.abortRequest()` and `POST /abort` previously recorded the cancellation durably but nothing read it while the run was alive, so a detached request on a worker ran to completion. The process running the work now checks for a recorded cancellation on the heartbeat tick it already performs and tears the run down through the same path a same-process abort uses. Delivery is bounded by the flow's `heartbeatIntervalMs` (default 10s) and requires a request store shared across processes.

**Adapter authors: `RequestStore` gains two required members, so a custom adapter will not compile until it implements them.**

- `isAbortRequested(requestId): Promise<boolean>` — whether cancellation has been requested. Runs on every heartbeat tick, so it must be O(1) in item count; reading the whole record is not an acceptable implementation on an adapter whose `get()` carries items.
- `setFieldsIfStatus(id, fields, allowedStatuses, updatedAt)` — apply fields only while the record's status matches, atomically, returning whether the predicate held and the status found. The status it reports back must come from the same observation the predicate used: report it from a later read and the verb can name a status the record only reached afterwards, including one that is inside the predicate. Do not implement it as a version CAS either: terminal transitions persist `version` unchanged, so a version-checked write validates after a terminal commit and resurrects a dead record.

`set` must now ignore `abortRequested` in both directions — a full record can neither set the flag nor clear a stored one. This is not compiler-enforced, because the field is still readable on `RequestRecord`. `createRequestStoreConformanceTests` covers all of it.

No migration step to run. On memory, SQLite and Postgres the flag is stored where it always was and only its write path changed. The filesystem adapter is the exception: because its `get()` carries items, keeping the flag on the record would have put an O(items) read on every heartbeat tick, so it lives in an `.abort` marker file beside the record and the narrow read is a `stat`. A request cancelled before the upgrade carries the flag inline instead; that record is migrated to a marker lazily, on its first write, so the cancellation is still delivered to a run that resumes after the upgrade.

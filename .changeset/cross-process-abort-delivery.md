---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/fsdev": patch
---

Cancelling a request now stops it even when it is running in another process (FIX-1026). `session.abortRequest()` and `POST /abort` previously recorded the cancellation durably but nothing read it while the run was alive, so a detached request on a worker ran to completion. The process running the work now checks for a recorded cancellation on the heartbeat tick it already performs and tears the run down through the same path a same-process abort uses. Delivery is bounded by the flow's `heartbeatIntervalMs` (default 10s) and requires a request store shared across processes.

A cancellation accepted while a request is finishing its background work now settles that request as `aborted` rather than `completed`. A request that queued `.sideChain()` tasks waits for them before writing its terminal status, and a cancel arriving during that wait does stop them — but the request still reported `completed`, telling the caller the opposite of what happened to their work.

The completion hooks follow that status. `onCompleted` fires only on terminal success, so an action's `onCompleted` and the flow's `request.onCompleted` no longer run for a request cancelled in that window — previously they ran, and could commit business side effects or send a success notification for a request whose own `onFinished` reported `aborted`. If you relied on `onCompleted` to mean "the action body finished", move that work to `onFinished` and branch on its `status`, which fires exactly once for every outcome. Text-to-speech synthesis for such a request is now abandoned rather than run to completion and then discarded.

Work dispatched by those completion hooks is now waited for too. Because `onCompleted` runs after the background-work barrier, a hook that fans out its own `.sideChain()` tasks was queueing them into a wait that had already finished — the request returned while a notification or state write was still going, and those items could miss the final flush.

A cancellation recorded before a run starts now stops it regardless of how fast the request store answers. The check that catches a job cancelled while it was still queued happens before the action runs rather than alongside it, so an action shorter than one store read can no longer finish first and report `completed`. This costs one narrow store read on the request start path; a store failure there is logged and the request proceeds.

**Adapter authors: `RequestStore` gains two required members, so a custom adapter will not compile until it implements them.**

- `isAbortRequested(requestId): Promise<boolean>` — whether cancellation has been requested. Runs on every heartbeat tick, so it must be O(1) in item count; reading the whole record is not an acceptable implementation on an adapter whose `get()` carries items.
- `setFieldsIfStatus(id, fields, allowedStatuses, updatedAt)` — apply fields only while the record's status matches, atomically, returning whether the predicate held and the status found. The status it reports back must come from the same observation the predicate used: report it from a later read and the verb can name a status the record only reached afterwards, including one that is inside the predicate. Do not implement it as a version CAS either: terminal transitions persist `version` unchanged, so a version-checked write validates after a terminal commit and resurrects a dead record.

`set` must now ignore `abortRequested` in both directions — a full record can neither set the flag nor clear a stored one. This is not compiler-enforced, because the field is still readable on `RequestRecord`. `createRequestStoreConformanceTests` covers all of it.

A filesystem store operation that fails now reports its error to the caller and nothing else. Every write on that adapter is serialized per record, and the promise used to order that queue carried the failure a second time with no one to receive it — an unhandled rejection, which on Node's default settings takes the process down. A disk that filled up or a permission error could therefore end the host instead of failing one write. The queue also no longer passes one operation's failure to whichever write is next in line.

No migration step to run. On memory, SQLite and Postgres the flag is stored where it always was and only its write path changed. The filesystem adapter is the exception: because its `get()` carries items, keeping the flag on the record would have put an O(items) read on every heartbeat tick, so it lives in an `.abort` marker file beside the record and the narrow read is a `stat`. A request cancelled before the upgrade carries the flag inline instead; that record is migrated to a marker lazily, on its first write, so the cancellation is still delivered to a run that resumes after the upgrade.

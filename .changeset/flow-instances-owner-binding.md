---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": patch
"@flow-state-dev/fsdev": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
"@flow-state-dev/bullmq": patch
"@flow-state-dev/scheduled": patch
"@flow-state-dev/chat-sdk": patch
"@flow-state-dev/mcp": patch
---

A flow definition now declares how many instances it can register, and every saved session and request stays bound to the instance that created it (FIX-1321, FIX-1322).

**Declaring instances.** `defineFlow({ cardinality })` takes `"singleton"` (the default: one instance whose id is its `kind`, so `myFlow()` is the instance and `myFlow({ id: "default" })` now throws) or `"collection"` (several configured copies, each created with a required explicit `id`). `FlowType` and `FlowInstance` carry `cardinality`. The registry indexes by exact global id: `registry.get(id)` finds a singleton by its kind and a collection member by its own id, a collection's bare kind resolves to nothing, and there is no first-registered fallback anywhere. A duplicate id, a singleton under a custom id, a collection instance without one, or a kind mixing the two cardinalities throws `FlowIdentityConflictError` at `register`. `GET /api/flows` entries carry `cardinality`.

**Instance addresses.** The first segment of the action, stream, resume, retry and continue routes, `fsdev run <flowId>` and `fsdev chat`, an MCP/chat/webhook/schedule dispatch, a BullMQ job's `flowKind`, and a `dispatcher()`'s `flowKind` selector all carry the instance id (a singleton's kind, or a collection member's id) under the existing field name.

**Owner binding.** Sessions, requests and active-request entries record `flowId`, the owning instance, beside `flowKind`, the definition. A record addressed through another instance is refused before any effect: `FlowInstanceBindingMismatchError` from the host, `runAction` and `createExecutionContext`; `409 { error: "wrong-instance-session" | "wrong-instance-request" }` on the action route; `UnrecoverableError` on a BullMQ worker. Record-only routes resolve the governing flow from the record's owner (`anonymousFlowIds` replaces `anonymousFlowKinds`; `detectInterruptedRequests` takes an `ownedBy` predicate). Retry, continue, resume and recovery re-enter the recorded owner; the React `resumeLatestRequest` uses the record's `flowId`. Session and request listings accept an exact `flowId` filter (also on the client's `listSessions`) and project `flowId` on every row, including `ChildSessionSummary`, `ExecuteActionResponse.request` and retry results. `resolveRecordOwner` and `ownsRecord` are exported from `@flow-state-dev/engine`.

**Existing data.** SQLite and Postgres add a nullable, indexed `flow_id` column on open with no backfill. A row with no owner recorded belongs to the singleton of its kind; a collection kind with such history answers `409 migration-required` until an operator attributes it offline (quiesce, inventory, backfill, read back; see the persistence guide). Before turning an existing flow into a collection, drain queued jobs enqueued under its bare kind.

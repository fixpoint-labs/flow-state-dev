---
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/engine": minor
---

SQLite resource content and resource state are now durable. Previously the SQLite adapter persisted scope records, items, and events but kept resource content (artifacts, collection bodies, client data) and resource state in process memory, so a "persistent" SQLite registry silently lost them on restart. Both now live in dedicated `resource_content` and `resource_state` tables — a file-backed registry survives restart at full parity with Postgres. Existing databases pick up the tables automatically; no migration step.

SQLite live-tail also scales with concurrent subscribers: instead of one poll loop per SSE subscriber, each request now shares a single poll loop fanned out to all of its subscribers and woken in-process by the write path. The `subscribeToEvents` contract is unchanged.

The `@flow-state-dev/engine/testing` entry point gains `createContentStoreConformanceTests` and `createResourceStateStoreConformanceTests` so any store adapter can verify its keyed resource stores against the shared contract.

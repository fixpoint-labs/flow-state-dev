---
"@flow-state-dev/engine": minor
"@flow-state-dev/core": minor
"@flow-state-dev/client": minor
"@flow-state-dev/fsdev": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
---

A flow can check every new session's initial state with `session.createCheck`, refuse caller-seeded fields with `session.serverOwned`, and fix a field for a session's life by declaring it `.readonly()` in its session `stateSchema`; `listSessions({ state })` and the list route's `state.<field>` filter select sessions by a readonly field. A session's initial state that fails its `stateSchema` is now refused, on every path that creates one, rather than stored raw. A dispatcher's `session: { key, state }` and a task dispatcher's `state` create the child session with that state. `ensureSessionRecord` now takes the create request beside the record it builds (FIX-1788).

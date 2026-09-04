---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
---

Session records can name a parent session, and listing them filters on it. `SessionRecord.parentSessionId` holds the id of the session a session belongs to, and `SessionListOptions.parentage` selects what a listing returns: `"top-level"` for sessions with no parent, `"all"` for every session, or `{ parentOf: sessionId }` for one session's children.

**Omitting `parentage` returns top-level sessions only.** A caller that passes no parentage filter gets sessions with no parent rather than everything, so session pickers and listings never show a caller's internal sub-sessions beside the ones a person started. Pass `parentage: "all"` for the unrestricted result set — admin, debug and recovery callers that want every session need to say so explicitly. Note that this is the reverse of `tenantId` in the same options object, where omitting the key applies no filter.

Every backend applies the same three modes. The SQLite and Postgres adapters add a nullable `parent_session_id` column through an idempotent migration applied on open, with no backfill step. A custom `StoreRegistry` implementation must honor `parentage` itself — the field is optional, so a store that ignores it keeps returning child sessions.

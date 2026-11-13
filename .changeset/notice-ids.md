---
"@flow-state-dev/contracts": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/client": minor
"@flow-state-dev/orchestration": minor
---

A change notice names what changed, so a screen can re-read only those rows (FIX-2625).

- **contracts / client:** `WireNotice` gains `ids?: string[]`: the ids of what changed, never its data. Absent means read everything. A `board` notice names the tasks whose rows changed, a collection entry's `resource` notice names the entry's storage key (only when its path may be named: never an owner-private row or a user-scope entry), a `run` notice on a parent session's topic names the child session (on a user's own topic it names nothing, since that topic spans the user's orgs), and a `request` notice names the request. `items`, `state` and `resync` name nothing. `client.live` and `client.subscribe` pass them through; notices of one topic and kind waiting on a read union their ids, up to 100, past which a notice names none.
- **engine:** `createFlowState({ noticeIds: { org: false } })` (also on `createFlowApiRouter`) turns ids off for a topic scope, for an app where even the timing of an org's changes is sensitive. No notice of that scope reaches a browser with ids, and a resource notice reaches a scope-wide subscription with no path, so every resource watcher in that scope reads everything on any resource change. On by default. A key other than `session`, `user` or `org`, or a non-boolean value, is refused at startup.
- **store-postgres:** the Postgres bus carries ids across processes; a notice too large for `NOTIFY` drops its ids before it is widened to its scope.
- **orchestration:** a task board's change notice names the task.

A client from before this change ignores `ids` and reads everything, as before.

Docs: apps/docs/guides/realtime.md (ids on a notice; turning them off per scope with `noticeIds`), apps/docs/docs/api/client.md (`WireNotice.ids`), apps/docs/docs/persistence/overview.md (what the Postgres bus carries), packages/client/README.md (`WireNotice.ids`), packages/engine/README.md (`noticeIds`), packages/core/README.md (notice ids)

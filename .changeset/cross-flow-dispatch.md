---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
---

`dispatcher()` can address another flow: `flowKind` on an `internal` or `task` dispatcher resolves `action` on that flow's matching entry map and starts the work there, fire-and-forget. `defineFlow` holds one flow's entry maps and skips the check, so the miss is a named runtime refusal — `flow-not-found` for an unregistered flow, `no-entry` for a registered one that declares no such entry — never a retry, a queue, or a fall-through to the sender's own map. A cross-flow `{ key }` child belongs to the addressed flow (its `flowKind`, its state defaults) and roots its own lineage; a reply is the same `{ from: true }` dispatcher pointed back at the sender's `flowKind`. Omit `type` — ordinary dispatchers send `internal`, and a task-board seat is a dispatcher whose `session` is `"per-task"`, `"per-worker"`, or `{ key }` (FIX-1297, FIX-1171 family). The entry-name field is `action`.

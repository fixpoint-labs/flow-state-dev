---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
---

`dispatcher()` can address another flow: `flowKind` on an `internal` dispatcher resolves `target` on that flow's `internal.actions` and starts the work there, fire-and-forget. `defineFlow` holds one flow's entry maps and skips the check, so the miss is a named runtime refusal — `flow-not-found` for an unregistered flow, `no-entry` for a registered one that declares no such entry — never a retry, a queue, or a fall-through to the sender's own map. A cross-flow `{ key }` child belongs to the addressed flow (its `flowKind`, its state defaults) and roots its own lineage; a reply is the same `{ from: true }` dispatcher pointed back at the sender's `flowKind`. A `task` dispatcher takes no `flowKind` and throws if given one (D-8, FIX-1171 family).

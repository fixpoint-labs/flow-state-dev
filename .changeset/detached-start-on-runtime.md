---
"@flow-state-dev/engine": patch
"@flow-state-dev/cli": patch
---

Let a router-less runtime start detached work, and stop shutdown from cutting it
off — so `fsdev run` and `fsdev chat` can exercise a flow that hands work to a
Workstream (FIX-1077).

`createFlowRouteHandlers` was the only shipped assignment of
`RequestHost.startOperation`, so a process that resolves its runtime through
`getRuntime()` and never builds an HTTP router had none, and `startDetached`
refused `no-start-operation` on every dispatch. `createFlowState` now wires an
in-process start operation onto the shared `runtimeConfig.requestHost` when it
resolves a runtime that has not been asked for a router, using the same
dispatcher the router would.

Two things go with it:

- **`dispose()` waits for detached work that runs in this process.** Detachment
  means the launching *request* does not wait; in a one-shot process it cannot
  mean the *process* does not wait, because there is nothing left to outlive.
  Without this a CLI run closed pooled stores while a child was still writing,
  and the child's task row was stranded `in_progress`. Work handed to a queue is
  deliberately **not** waited for: it is durable, outliving the process is the
  point of enqueuing it, and a queue with no worker consuming it would otherwise
  block shutdown indefinitely. The notice printed while waiting goes through the
  configured runtime logger, so `fsdev run --quiet` suppresses it.
- **Detached work inherits the launching request's runtime config**, not the
  host's construction-time one — so a caller that derives a config (as
  `fsdev run --model` does) has it apply to background work instead of silently
  resolving the app's default model.

Unchanged: a deployment that supplied its own start operation keeps it, a
router-first init still gets the router's, and a `worker-only` runtime — which
has no inbound transport and whose start operation is a queue-backed enqueue
owned by the queue's adapter — still refuses `no-start-operation` by name.
`fsdev run` without an `fsdev.config.*` (directory discovery) builds no
`FlowState` and is unaffected; that gap is tracked as FIX-1087.

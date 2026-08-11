---
"@flow-state-dev/engine": patch
---

Let a router-less runtime start detached work, so `fsdev run` and `fsdev chat`
can exercise a flow that hands work to a Workstream (FIX-1077).

`createFlowRouteHandlers` was the only shipped assignment of
`RequestHost.startOperation`, so a process that resolves its runtime through
`getRuntime()` and never builds an HTTP router had none — and `startDetached`
refused `no-start-operation` on every dispatch. `createFlowState` now wires an
in-process start operation onto the shared `runtimeConfig.requestHost` when it
resolves a runtime that has not been asked for a router, using the same
dispatcher the router would.

Unchanged: a deployment that supplied its own start operation keeps it, a
router-first init still gets the router's, and a `worker-only` runtime — which
has no inbound transport and whose start operation is a queue-backed enqueue
owned by the queue's adapter — still refuses `no-start-operation` by name.

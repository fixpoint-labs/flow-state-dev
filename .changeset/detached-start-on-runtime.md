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

- **`dispose()` waits for detached work that runs in this process**, up to
  `detachedDrainTimeoutMs` (default 30s). Detachment means the launching
  *request* does not wait; in a one-shot process it cannot mean the *process*
  does not wait, because there is nothing left to outlive. Without this a CLI run
  closed pooled stores while a child was still writing, and the child's task row
  was stranded `in_progress`. The wait is bounded because unbounded is not
  patience — one child that never settles would hang shutdown outright. When the
  budget expires, shutdown proceeds and reports the request and session ids it
  did not wait out, so abandoned work is named rather than dropped silently.
  Work handed to a queue is **not** waited for at all: the enqueue is confirmed
  before the launching call returns, and waiting for the job to run would block
  on a process this one does not control. The progress notice goes through the
  configured runtime logger, so `fsdev run --quiet` suppresses it; the
  did-not-wait-out report deliberately does not, because it reports work that may
  not have completed and nothing else surfaces that.
- **Detached work inherits the launching request's runtime config**, not the
  host's construction-time one — so a caller that derives a config (as
  `fsdev run --model` does) has it apply to background work instead of silently
  resolving the app's default model.

Unchanged: a deployment that supplied its own start operation keeps it, and a
router-first init still gets the router's.

Also unchanged, and worth distinguishing because the two failures have different
shapes: a `worker-only` runtime — which has no inbound transport and whose start
operation is a queue-backed enqueue owned by the queue's adapter — **returns**
`{ ok: false, refused: "no-start-operation" }`, a value a caller branches on.
`fsdev run` without an `fsdev.config.*` (directory discovery) builds no
`FlowState` at all, so there is no runtime host on the context and
`requireRequestHost` **throws** `NoRequestHostError` (`code: "no-request-host"`)
before any refusal is reachable; that gap is tracked as FIX-1087.

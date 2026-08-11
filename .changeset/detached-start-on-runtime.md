---
"@flow-state-dev/engine": patch
"@flow-state-dev/cli": patch
---

A runtime can now start background work without an HTTP router in front of it, so `fsdev run`, `fsdev chat`, and a `worker-only` process can each launch a workstream instead of only a server being able to (FIX-1077).

A host that started background work in its own process stays open until that work finishes, bounded by the new `detachedDrainTimeoutMs` option on `createFlowState` (default 30s). Past the budget it cancels what is still running and names the requests and sessions it gave up on. Those records are settled by the framework's ordinary recovery — a lapsed task lease, an interrupted-request sweep — rather than being marked terminal at shutdown.

A CLI `--model` override covers the generators that run in the command's own process. Background work dispatched to a queue runs under the worker's own model configuration, and the CLI now says so on stderr at each dispatch that loses the override.

---
"@flow-state-dev/engine": patch
---

The largest `limit` the workstream listing route accepts is now a server option, `maxWorkstreamListLimit` (FIX-1012). It defaults to 100, which is what the route enforced before, so nothing changes for a deployment that does not set it.

Raise it when conversations run more background work than that. The list a client reads is all-time history — finished work stays listed — so it grows with everything a conversation has ever started, and any fixed ceiling eventually truncates the oldest finished work with no way to reach past it.

The ceiling is raised rather than removed, and it is an operator's setting rather than a caller's, because the cost is per row and per read: each row resolves its status from the request store, and clients re-read this list on every interaction. A larger ceiling buys completeness with read amplification on every turn.

Lowering it below the route's own default page size is also honoured — a request that omits `limit` returns at most the configured maximum rather than exceeding it.

Settable on both host entry points (`createFlowState` and `createFlowApiRouter`), and validated when either is constructed: a value that is not a positive safe integer throws rather than being accepted, because `Infinity` and `NaN` make the bound vacuous and would leave the read uncapped while looking configured.

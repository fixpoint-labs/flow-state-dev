---
"@flow-state-dev/engine": minor
---

**Breaking:** engine's names that another package also exports for something else are renamed or no longer exported, so one name means one thing (FIX-2449). No deprecated aliases: an old import fails to compile with "has no exported member".

- `DispatchHandle`, what an inbound transport host's `dispatch` returns, is renamed `InboundDispatchHandle`. Core's dispatcher-block result keeps the name `DispatchHandle`.
- The bridge frame `StreamEvent` is renamed `StreamBridgeEvent`. The stream item from contracts and core keeps the name `StreamEvent`.
- The policy-aware retry predicate (`isRetryableError(error, policy)`) is no longer exported. Core's one-argument helper of that name is unchanged.
- `ChildSessionStatus` and `ChildSessionSummary` are no longer exported from engine; import them from `@flow-state-dev/client`.
- `enginePackageMarker` is removed.

Docs: packages/engine/README.md (the bridge list names `StreamBridgeEvent`, not `StreamEvent`)

---
"@flow-state-dev/core": minor
"@flow-state-dev/orchestration": minor
---

Detached worker bindings now bubble up to the flow, and a detached board's task
assignees are fixed at admission.

A task board can declare that a worker runs outside the request that claimed its
task. When that work is woken later — after the originating request returned, or
after a restart — the only thing available to route with is the task row. This
adds the flow-level map that makes that routing possible, and freezes the field
the routing derives from.

- `@flow-state-dev/core`: blocks carry an optional `workstreamBindings` map that
  accumulates the way `declaredResources` already does. A board stamps its
  bindings on its drain sequencer, enclosing sequencers and routers merge their
  children's up, and `defineFlow` reads the union off each action root into
  `flow.workstreamBindings`. Nothing is authored to get one, and the map lives
  outside `flow.actions`, so a detached worker is not reachable from an HTTP or
  MCP caller. Two different worker blocks at one `(boardId, coordinate)` is
  refused at flow definition — a coordinate that resolves to two blocks is a
  routing question with no answer, and picking one silently runs the wrong
  worker. New helpers: `declareWorkstreamBindings`, `mergeWorkstreamBindings`,
  `workstreamBindingKey`.

- `@flow-state-dev/orchestration`: `taskBoard` derives each worker's routing
  coordinate — a tagged `assignee` / `uniform` / `floor` value rather than a bare
  string, so a board that legally names an assignee `uniform` does not merge it
  with the uniform slot. New exports `coordinateKey`, `coordinateLabel`,
  `workstreamRoutingSeed` and the `WorkerCoordinate` type. `workstreamRoutingSeed`
  folds the board id into the seed's key, because the runtime derives a detached
  child session from `(tenant, principal, parent session, topic, key)` and has no
  board dimension of its own — two boards sharing a topic and an assignee name
  would otherwise land in one session.

- `@flow-state-dev/orchestration`: on a board with any detached worker,
  `setAssignee` now declines with the new `immutable-assignee` reason, whatever
  the task's status. Reassigning after admission does not redirect anything: work
  already dispatched keeps running under the old coordinate and the new one
  addresses a session nothing will wake, so the write succeeds and the task
  simply never runs. The refusal is reported through the existing
  `TaskWriteOutcome`, so callers that ignore the return value are unaffected.

No execution changes. Boards that declare no detached workers behave exactly as
before: no bindings, no coordinate, and `setAssignee` unrestricted.

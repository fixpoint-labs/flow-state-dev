# Design: Trace Channel Separation + Debug Item Durability (FIX-506)

> A single SSE wire carrying two kinds of items — production (10 types, what users see) and trace (4 types, what the devtool sees) — with durable trace persistence past `RequestRecord` GC.

## 1. Problem

Today the SSE stream at `/api/flows/:flowKind/requests/:requestId/stream` carries 15 item types. Production clients see 11 of them (`createClientEventFilter` strips the other 4). The devtool subscribes with `?unfiltered=true` to get all 15.

Three problems:

1. The public `OutputItem` union and `BlockValue` type include four item types and one union case (`ref`) no production consumer ever sees. The public surface is bigger than the actual contract.
2. `block_debug` payloads (resolved generator prompts, tool definitions, model selection) live only in the request's events log — they vanish along with the `RequestRecord` when retention GC runs. The devtool can't replay traces from a completed request once the request has been GC'd.
3. One of the eleven public production types (`step_error`, added recently for failed `.work()` background tasks) is observability data, not user-facing. It surfaces a yellow warning in the UI for failures the user has no action to take on.

## 2. Approach: single SSE wire, server-side filter, durable trace store, public/internal type split

Keep the existing single SSE endpoint. Rename `?unfiltered=true` to `?include=trace` for honesty. Introduce a `TraceStore` on `StoreRegistry` that persists trace events independently of `RequestRecord` GC, mirroring how `CheckpointStore` already works for `state_snapshot`. Refactor the four auto-emission sites through a new `ctx.emit.trace.*` namespace and stamp `agentType: "trace"` consistently. Shrink the public `OutputItem` union from 15 to 10 — the four trace types leave the union but stay exported as named types; `step_error` is deleted outright.

### Why this shape

- **Server-side filter on a single endpoint already provides the same guarantee a wire-level split would.** The first draft proposed two SSE endpoints. On review, two endpoints doubles the configurations to keep correct without strengthening any boundary. A misconfigured trace endpoint leaks the same way a missing filter leaks.
- **Bounded-N retention beats time-windowed retention for in-process devtool buffers.** Redux DevTools' `maxAge: 50` is the canonical pattern. Bound by request count plus a per-request soft byte cap.
- **Closed kind-set argues for kind-as-method.** OTel's generic `addEvent(kind, payload)` is justified by an open-ended event-kind set. We have four trace types; type-narrowed methods (`ctx.emit.trace.blockOutput`, `routerDecision`, `stateSnapshot`, `blockDebug`) are easier to call correctly.
- **Public/internal split via subpath beats `@internal` JSDoc + `stripInternal`.** TypeScript's docs flag `stripInternal` as "use at your own risk." A separate subpath (`@flow-state-dev/core/items/internal`) is enforced by `package.json#exports`.
- **First-party named-type exports stay public.** `BlockTraceItem`, `RouterDecisionItem`, `StateSnapshotItem`, `BlockDebugItem` leave the `OutputItem` union but remain exported types — `@flow-state-dev/react` and `apps/kitchen-sink` already import them by name.

## 3. Design

### 3.1 Public type surface

Public `OutputItem` shrinks to 10 types:

```ts
export type OutputItem =
  | MessageItem
  | ReasoningItem
  | ToolOutputItem
  | ComponentItem
  | ContainerItem
  | SourceItem
  | StatusItem
  | ErrorItem
  | StateChangeItem
  | ResourceChangeItem;
```

Two distinct removals:

- The four trace types leave the union but their type names stay exported from `@flow-state-dev/core/items` as standalone types — first-party files keep compiling.
- `StepErrorItem` is deleted entirely. Type definition gone, named export gone, emit site gone, every renderer dispatch gone.

`BlockValue<T>` becomes `inline | structure` on the public surface:

```ts
export type BlockValue<T> =
  | { kind: "inline"; value: T }
  | { kind: "structure"; shape: StructureShape };
```

The `ref` case moves to `BlockValueInternal` in `@flow-state-dev/core/items/internal`.

### 3.2 `ctx.emit` namespace

```ts
ctx.emit = {
  message: (textOrContent, options?) => MessageItem,
  component: (component, data, options?) => ComponentItem,
  status: (message, options?) => StatusItem,
  trace: {
    blockOutput: (item) => void,
    routerDecision: (item) => void,
    stateSnapshot: (item) => void,
    blockDebug: (payload) => void,
  },
};
```

The flat methods (`ctx.emitMessage`, `ctx.emitComponent`, `ctx.emitStatus`) become `@deprecated` aliases. Removed at next major. A debounced once-per-process `console.warn` fires on first alias use.

### 3.3 SSE wire

Unchanged shape. `?unfiltered=true` is renamed to `?include=trace`. The route handler keeps two paths:

- **Live-tail**: subscribes to the emitter; applies `createClientEventFilter` unless `?include=trace`.
- **Completed-request replay**: reads from `RequestRecord.events`. With `?include=trace`, additionally reads from `stores.traces.getEvents(requestId)`. If `RequestRecord` is GC'd but `TraceStore` retains the request, `?include=trace` returns trace-only data.

### 3.4 `TraceStore`

```ts
export interface TraceStore {
  appendEvent(requestId: string, event: TraceEvent): Promise<void>;
  flush(requestId: string): Promise<void>;
  getEvents(requestId: string, fromSequence?: number): Promise<TraceEvent[]>;
  listRequestIds(): Promise<string[]>;
}

export type TraceEvent = {
  requestId: string;
  sequenceNumber: number;
  ts: number;
  type: "trace.item.added" | "trace.item.done";
  item: BlockTraceItem | RouterDecisionItem | StateSnapshotItem | BlockDebugItem;
};
```

In-memory default: `maxRequests: 50`, `maxBytesPerRequest: 5 MB`. FIFO eviction by `Map` insertion order. SQLite implementation lives in `@flow-state-dev/store-sqlite`. Retention is enforced by the trace store itself; `applyRetentionPolicy` does not touch it (same pattern as `CheckpointStore`).

### 3.5 Auto-emission

Four current auto-emission sites refactor to call through `ctx.emit.trace.*`:

| Site | Before | After |
|---|---|---|
| `executeBlock.ts:113` (`emitBlockTraceItem`) | `response.emitItemAdded/Done` directly | `ctx.emit.trace.blockOutput(item)` |
| `createExecutionContext.ts:2672` (`onRouteSelected`) | direct emit | `ctx.emit.trace.routerDecision(item)` |
| `sequencer.ts:272` (`emitStateSnapshot`) | direct emit | `ctx.emit.trace.stateSnapshot(item)` |
| `debug-items.ts:87` | `emitItemOneShot` | `ctx.emit.trace.blockDebug(payload)` |

Each `ctx.emit.trace.*` call:

1. Stamps `agentType: "trace"` if not set.
2. Calls `response.emitItemAdded` / `emitItemDone` (or `emitItemOneShot` for `block_debug`).
3. Reads the assigned sequence number via `response.getSequenceNumber()`.
4. Fire-and-forget `stores.traces.appendEvent(...)` (errors → `onPersistError`).

`runAction`'s `finally` adds `stores.traces.flush(requestId)` alongside the existing checkpoint flush.

### 3.6 `step_error` deletion

`step_error` carried `message`, `code`, `blockName`, and a derived `recovered: true` flag. All recoverable from existing channels:

| `step_error` field | Lives where after deletion |
|---|---|
| `message` | failed `block_trace` |
| `code` | failed `block_trace` |
| `blockName` | `block_output.provenance.blockName` |
| `recovered: true` | derivable from "failed `block_trace` AND no terminal `error`" |
| `console.error` log | unchanged at `sequencer.ts:751` |

`emitWorkStepError` is deleted; the `console.error` stays. `executeBlock` continues to emit a failed `block_trace` for any block that throws — that's now the only signal for `.work()` failures, and it rides the trace channel.

### 3.7 Visibility model

`STRUCTURAL_TYPE_DEFAULTS` shrinks from 12 to 7 (the four trace entries leave; the `step_error` entry leaves with the type). The `agentType === "trace"` short-circuit in `resolveItemVisibility` becomes the only path returning `client: false`. `createClientEventFilter` is unchanged in shape.

`TRACE_ITEM_TYPES` in `state-routes.ts` stays as a legacy-compat safety net (TODO-tagged) for pre-migration `RequestRecord.items` records that lack the `agentType` stamp. Primary check is `resolveItemVisibility(item).client === false`.

## 4. Trade-offs

- **Why not delete trace type names from public exports too?** First-party files import them by name. Keep them exported, just out of the union.
- **Why not keep `step_error` and merge with `error` via a `severity` field?** Commit `8e0bd62b` deliberately moved away from a merged shape (a `recovered` flag on a single `error` type) toward separate types because TypeScript exhaustiveness on `item.type` is a UI safety property. Re-merging undoes that. Better to delete one of the two types.
- **Why not move `step_error` to the trace channel instead of deleting it?** The failed `block_trace` already carries the same information. Two trace items for the same signal is duplication.
- **Why public `ctx.emit.trace.*` instead of hidden `ctx._trace`?** Consistent with `ctx.cap.*`. `@internal` JSDoc on the namespace conveys intent without breaking the shape.

## 5. Sequencing

Step 0: this design doc (small PR).
Step 1: public type split.
Step 1b: `step_error` deletion (after Step 1).
Step 2: `ctx.emit` namespace + alias migration.
Step 3: `TraceStore` interface + in-memory + SQLite implementations.
Step 4: auto-emission refactor (depends on 1b, 2, 3).
Step 5: filter cleanup + `?include=trace` rename + replay path (depends on 4).
Step 6: documentation, in same PR as 5.

## References

- Linear FIX-506 implementation spec (revision 3).
- Reverted commit: `8e0bd62b` ("feat(core, ui): emit step_error for background work failures and render as warning").

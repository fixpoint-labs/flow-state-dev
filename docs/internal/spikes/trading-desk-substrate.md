# Trading Desk substrate verification spike (FIX-559, Step 0)

Date: 2026-05-07
Status: complete
Linear: [FIX-559](https://linear.app/fixpoint-labs/issue/FIX-559)

The Phase 1 spec calls for a verification spike before scaffolding the Trading
Desk example. The spec's primary concern is whether the React substrate
delivers state and resource updates to the client mid-stream, which is required
for the live `pending → writing → published` memo transitions in the navigator.
This document records what the spike found by reading the substrate code paths
end-to-end. The findings are conclusive enough that no flow-level reproduction
was needed — the gap is structural and visible in `useSession.ts`.

## Findings

### 1. Container-start events reach the client

`packages/server/src/context/createExecutionContext.ts` emits a container item
when a sub-sequencer with `container.component` enters. The item carries the
sub-sequencer's `name` and `label`. `useSession.onItemAdded` admits non-trace
items so the transcript pane can render the phase divider directly off these.

Status: **OK**, no workaround needed.

### 2. `state_change` items reach the client mid-stream — but `useClientData` does not update

`patchState` against any scope emits a transient `state_change` item with a
`delta` payload (see `createExecutionContext.ts:1486-1502` for session-level
patches). These items flow through `onItemAdded` as they arrive.

However, `useClientData` reads from `session.snapshot.clientData`, and the
snapshot is only refreshed via `applySnapshot` — which `useSession` calls only
on `onRequestStatus({ status: "completed" | ... })` (`useSession.ts:864-891`).
Mid-stream `state_change` items do not refresh the snapshot.

Net effect: `useClientData` shows stale `clientData` for the entire request,
and only flips to the final state after the request terminates.

Status: **GAP**. Plan A in the spec ("mirror memo status into
`session.clientData.memoStatus`") does **not** work against current substrate.

### 3. `state_change` deltas carry values for non-transient session keys

`emitStateChangeItem` includes the literal patch values in `delta` for
session/user/org-scope patches (`createExecutionContext.ts:1486-1502`). Block-
instance-scope patches against a single key omit values. This means a renderer
that scans `session.items` for `state_change` items affecting
`session.<field>` can reconstruct the live value without a separate channel.

Status: **OK**, usable for the workaround.

### 4. `resource_change` items reach the client mid-stream — but `useResourceCollection` does not update

Confirmed at `useSession.ts:735-737, 884-890`: `onItemAdded` sets
`resourceChangedDuringStreamRef.current = true` when a `resource_change` item
arrives, and `refreshSnapshot()` is only called on terminal `onRequestStatus`
events. The collection itself is not patched in place.

Status: **GAP**, same shape as #2. Affects the memo body content (sidebar
needs the published memo's `body` and `metrics` for rendering) — but only
matters at the `published` transition, not during the live `pending → writing`
flicker.

### 5. There is no public `ctx.emit.custom(...)` for arbitrary item types

`ctx.emit` exposes `message`, `component`, `status`, and a `trace` namespace
reserved for framework auto-emitters (`packages/core/src/types/block.ts:243`).
There is no user-facing API for arbitrary custom item types. A custom
`memo-status` item type would require a framework change.

Status: **GAP** for "Plan B" as written in the spec. Use `ctx.emitComponent`
instead, which already supports arbitrary `component` names with `props` —
functionally equivalent to a custom item type for client-side dispatch.

## Workaround chosen for Phase 1

**Read live state from `session.items`, not from `session.snapshot.clientData`
or `useResourceCollection`.**

Two viable variants; we'll use whichever is cleanest at implementation time:

1. **`state_change`-driven**: build a small `useLiveSessionState` hook that
   reduces `state_change` items in `session.items` into a live session-state
   map. Consumers read live `memoStatus` from this map. Memo bodies still come
   from `useResourceCollection` after request completion (acceptable —
   `published` transitions land in a single batch at end-of-request, and the
   visual gap between the last `writing` and the first `published` is small).

2. **Component-event-driven**: each analyst's `markWriting` / `commitMemo` /
   `markError` tap calls `ctx.emitComponent({ component: "memo-status", props:
   { memoKey, status } })`. Renderers scan `session.items` for these
   components. Heavier on the items log; lighter on hook plumbing.

Variant 1 is preferred because it doesn't introduce a new component type that
exists only to work around a framework gap.

## Follow-ons to file under the project

Both gaps below are framework-level and should be addressed before later
phases come to depend on them. They are tracked separately from FIX-559 so the
example can ship on the workaround.

- **Mid-stream `clientData` updates**: refresh the session snapshot's
  `clientData` projection in `useSession` when `state_change` items arrive,
  not only on request termination. Probable shape: incremental snapshot patch
  driven by item delta + version monotonicity.
- **Mid-stream `useResourceCollection` updates**: refresh the resource
  collection's snapshot when `resource_change(updated)` items arrive, not
  only on request termination. Probable shape: targeted refetch keyed on the
  changed resource path, with optional `state` payload included in the
  `resource_change` item so a network round-trip is avoided.

## What this spike did not exercise

- A live flow run against a real LLM. The findings above are structural; no
  flow run would change them.
- `useResourceContent` refetch behavior. The Phase 1 spec keeps the memo body
  in resource state (not lazy content), so this path is unused in Phase 1.
- DevTool observability of resource transitions. Out of scope for the spike;
  exercised manually in Step 10's smoke test.

---
sidebar_position: 6
---

# State Operations

Every scope (`request`, `session`, `user`, `org`, and the optional `sequencer`) exposes the same set of atomic state operations. This page is the full reference: every helper, the no-op short-circuit, CAS semantics, and the errors you can see.

For the conceptual overview of scopes and schema bubbling, see [State & Scopes](/docs/fundamentals/state-and-scopes). For the dispatch internals (lock vs CAS path, mutation timeouts), see [State Mutation Model](/docs/state/mutation-model).

## The seven operations

All scope handles implement the same `ScopeStateOps` interface. Every operation returns `Promise<boolean>` — `true` when the write produced a real state change, `false` when the proposed update was structurally equal to the current state and was skipped.

### `patchState(updates)`

Merge fields into existing state. Other fields are left untouched.

```ts
await ctx.session.patchState({ mode: "agent", lastActiveAt: Date.now() });
```

There's also a one-key updater form for read-modify-write on a single field:

```ts
await ctx.session.patchState("counters", (current) => ({
  ...current,
  views: current.views + 1,
}));
```

### `setState(next)`

Replace the entire state. Any field not in `next` is dropped (or, if your schema has a default, restored to its default on the next read).

```ts
await ctx.session.setState({ mode: "chat", messageCount: 0 });
```

Use sparingly — `patchState` is almost always what you want. Reach for `setState` when resetting a session, initializing on first run, or genuinely overwriting everything.

### `incState(increments)`

Atomically add to numeric fields:

```ts
await ctx.session.incState({ messageCount: 1, errorCount: 0 });
```

Each entry is added to the current value. Negative numbers decrement. Fields that don't exist start from `0`.

### `pushState(field, value)`

Append to an array field:

```ts
await ctx.session.pushState("history", { role: "user", text: "Hello" });
```

The field must be declared as an array in your schema. If the field is missing, the operation initializes it to `[value]`.

### `setStateRecord(field, key, value)` and `deleteStateRecord(field, key)`

Work with a record-typed field — a map keyed by ID — without you having to spread the whole map yourself:

```ts
await ctx.session.setStateRecord("byId", "doc-1", {
  title: "Design Doc",
  updatedAt: Date.now(),
});

await ctx.session.deleteStateRecord("byId", "doc-1");
```

These are common enough in real applications (chat threads, saved items, anything indexed by ID) that they get dedicated helpers.

### `atomicState(mutator)`

Read-modify-write in a single atomic step. The mutator receives the current state and returns a partial update:

```ts
await ctx.session.atomicState((state) => ({
  retryCount: state.retryCount + 1,
  lastAttemptAt: Date.now(),
}));
```

`atomicState` is the right primitive when an update depends on the current value — and you need to be sure no other writer landed between your read and your write. The mutator may run more than once if a concurrent writer races you (see [CAS semantics](#cas-semantics) below).

The mutator must be a *pure function* of the current state. Don't perform side effects inside it — they may run twice on retry.

## The no-op short-circuit

Every operation returns `Promise<boolean>`:

- `true` — the write changed state. Persisted, version bumped, `state_change` SSE event emitted.
- `false` — the proposed update was structurally equal to the current state. No persist call, no version bump, no SSE event. The operation is a free no-op.

This means idempotent writes don't need manual identity checks:

```ts
// Safe to call repeatedly. If `mode` is already "agent", nothing happens.
await ctx.session.patchState({ mode: "agent" });
```

The comparison uses `Object.is` for primitives (NaN-equal-NaN, `+0 != -0`) and recursive structural equality for plain objects and arrays.

## Reading state

State is read through `ctx.<scope>.state`, which is fully typed from your Zod schema:

```ts
execute: async (input, ctx) => {
  const mode = ctx.session.state.mode;          // typed
  const prefs = ctx.user.state.preferences;     // typed
  const orgConfig = ctx.org?.state.config;  // typed; ctx.org may be undefined
}
```

`ctx.session.state` reflects writes from earlier in the same request. After `await ctx.session.patchState({ mode: "agent" })`, the next read of `ctx.session.state.mode` returns `"agent"`.

## Identity

Every scope handle exposes its identity:

```ts
ctx.session.identity  // { type: "session", id, userId, orgId? }
ctx.user.identity     // { type: "user", id }
ctx.org?.identity     // { type: "org", id, ... }
ctx.request.identity  // { type: "request", id }
```

`ScopeIdentity` is:

```ts
type ScopeIdentity = {
  type: "request" | "session" | "user" | "org";
  id: string;
  userId?: string;
  orgId?: string;
};
```

`userId` is required on every action execution. `orgId` is optional — when omitted, `ctx.org` is `undefined`. `sessionId` is optional — when omitted, the framework auto-creates an ephemeral session.

## CAS semantics

Scope writes use **Compare-and-Swap (CAS)**: the helper reads the current state and version, computes the next state, and persists with `expectedVersion`. If another writer has bumped the version in between, the persist call reports a conflict, the container refreshes from the store, and the operation retries with the new current state.

```
read state + version
       │
       ▼
mutate locally
       │
       ▼
persist(next, expectedVersion)
       │
   ┌───┴───┐
   ok    conflict ──► refresh from store, retry
```

Default retry budget: **3 retries** with exponential backoff (10ms, 20ms, 40ms). The retry budget is per call, not per process.

When retries exhaust, the helper throws `ConcurrentModificationError`:

```ts
import { ConcurrentModificationError } from "@flow-state-dev/engine";

try {
  await ctx.session.patchState({ mode: "agent" });
} catch (err) {
  if (err instanceof ConcurrentModificationError) {
    // err.attempts — how many tries we made
    // err.code — "CONCURRENT_MODIFICATION"
  }
}
```

In practice, this is rare for typical conversational flows. It surfaces under sustained concurrency on the same scope — usually a sign that the contended writes belong on a different scope, or that the work should be batched.

### Two dispatch paths

Not every scope uses the CAS retry loop. Scopes wired through a `persist` callback to a durable store (`request`, `session`, `user`, `org` on filesystem / sqlite / postgres) use CAS because a remote authority — another connection, another process — can advance the stored version under a stale read. Scopes that don't bridge through `persist` (`sequencer` state, target containers) use a per-container FIFO lock. The lock path serializes mutators in submission order with no version checks, no retries, and never throws `ConcurrentModificationError`.

Note: sequencer state going through the lock path doesn't mean it's lost on restart. The runtime still checkpoints sequencer state asynchronously at step boundaries (FIX-401), so a Phase 2 resume can rehydrate it. See [Sequencer State](/docs/advanced/sequencer-state).

The dispatch is internal to `applyMutation`. Callers see the same `ScopeStateOps` API regardless of which path runs. For the full breakdown — when you'd see `ConcurrentModificationError` vs `ScopeMutationTimeoutError`, and how to bound the lock path's worst case — see [State Mutation Model](/docs/state/mutation-model).

## State size warnings

The CAS path enforces a soft size limit (default: 10 KB per scope). When state crosses the threshold, the framework calls a warning hook — the write still succeeds, but you'll see a log line at startup configuration time.

This is a guardrail, not a hard limit. State is meant for flat, structured fields and small records. Large content — documents, transcripts, embeddings — belongs in a [Resource](/docs/resources/overview), where it lives outside the hot CAS loop.

## Where to next

- **[State & Scopes](/docs/fundamentals/state-and-scopes)** — conceptual overview, schema bubbling, the four scopes.
- **[State Mutation Model](/docs/state/mutation-model)** — dispatch internals, lock vs CAS, mutation timeout.
- **[State Targets and Parents](/docs/advanced/state-targets-and-parents)** — typed access to ancestor block state.
- **[Sequencer State](/docs/advanced/sequencer-state)** — state scoped to one execution of one sequencer instance, checkpointed for resume.

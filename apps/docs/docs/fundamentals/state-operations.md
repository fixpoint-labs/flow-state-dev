---
sidebar_position: 6
---

# State Operations

Every scope (`request`, `session`, `user`, `org`, and the optional `sequencer`) exposes the same set of atomic state operations. This page is the full reference: every helper, the no-op short-circuit, CAS semantics, and the errors you can see.

For the conceptual overview of scopes and schema bubbling, see [State & Scopes](/docs/fundamentals/state-and-scopes). For the dispatch internals (lock vs CAS path, mutation timeouts), see [State Mutation Model](/docs/state/mutation-model).

## The seven operations

All scope handles implement the same `ScopeStateOps` interface. Every operation returns `Promise<boolean>` — `true` when the write changed stored state, `false` when nothing was written. More than one thing produces `false`, and none of them promise the store already holds your value; see [the no-op short-circuit](#the-no-op-short-circuit).

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

`setState` writes the object you passed, and it keeps writing that object if it has to retry against a concurrent writer. It replaces their fields rather than merging with them. That is the right behaviour for "make the state exactly this" and the wrong one for "apply my change".

### `incState(increments)`

Atomically add to numeric fields:

```ts
await ctx.session.incState({ messageCount: 1, errorCount: 0 });
```

Each entry is added to the current value. Negative numbers decrement. Fields that don't exist start from `0`.

An increment on a **single** field is sent to the store as the increment itself, so two concurrent runs bumping the same counter both land and neither has to retry. Increment more than one field in a call and the operation writes a computed record instead, under the version check described in [CAS semantics](#cas-semantics). The increments still compose: a retry recomputes them against the value that won.

### `pushState(field, value)`

Append to an array field:

```ts
await ctx.session.pushState("history", { role: "user", text: "Hello" });
```

The field must be declared as an array in your schema. If the field is missing, the operation initializes it to `[value]`.

Like a single-field increment, an append is sent to the store as the append itself. Two runs appending to one array both land, and the array holds both entries.

### `setStateRecord(field, key, value)` and `deleteStateRecord(field, key)`

Work with a record-typed field — a map keyed by ID — without you having to spread the whole map yourself:

```ts
await ctx.session.setStateRecord("byId", "doc-1", {
  title: "Design Doc",
  updatedAt: Date.now(),
});

await ctx.session.deleteStateRecord("byId", "doc-1");
```

These are common enough in real applications (chat threads, saved items, anything indexed by ID) that they get dedicated helpers. Both touch one key and leave the rest of the map alone, so two runs writing different keys don't contend. Two runs writing the *same* key do: neither write carries a version, so the second one replaces the first, both calls return `true`, and neither is told.

`deleteStateRecord` has one place where that doesn't hold. Not every store offers a field-delete operation: none of them do on request state, and the filesystem store doesn't on any scope. Those cases write the whole record at the version this run last read, in one attempt. If another writer moved the record first, the call returns `false` and the key is still there. That `false` is a lost race against a record that still exists, not a report that the key was already gone.

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
- `false` — nothing was written. No version bump, no SSE event. The store may still have been called.

The usual cause of `false` is a redundant write. When the update you propose is structurally equal to the state this context last read, it's skipped before the store is called, so idempotent writes don't need manual identity checks:

```ts
// Safe to call repeatedly. If `mode` is already "agent", nothing happens.
await ctx.session.patchState({ mode: "agent" });
```

The comparison uses `Object.is` for primitives (NaN-equal-NaN, `+0 != -0`) and recursive structural equality for plain objects and arrays.

### What `false` doesn't promise

That comparison runs against the state **this context last read**, before anything reaches the store. It is not a check that the store agrees. If another context has changed the field since your last read, and your write happens to match your own stale copy, the write is skipped and the other context's value stays stored.

Two more things return `false`, and neither of them means "already correct":

- **The scope's record no longer exists.** Stores refuse a missing record before they look at any version, and the write isn't turned into a create. An `incState` or `pushState` against a deleted session returns `false` and creates nothing.
- **An unchecked write fell back to a full-record write and lost.** When the store doesn't offer the matching operation, the runtime writes the whole record at the version this run last read, in one attempt with no retry. Lose that race and the call returns `false` against a record that still exists — a lost delete looks exactly like a delete that had nothing to do.

So read `false` as "nothing was written", never as "the state already matched". When you need to know what is stored, read it back.

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

A scope write that depends on what state currently holds uses **Compare-and-Swap (CAS)**: the helper reads the current state and version, computes the next state, and persists with `expectedVersion`. If another writer has bumped the version in between, the persist call reports a conflict, the container refreshes from the store, and the operation retries with the new current state.

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

Which calls take that path, and which don't:

| Version-checked | Unchecked |
|---|---|
| `setState` | `pushState(field, value)` |
| `atomicState` | `setStateRecord(field, key, value)` |
| `patchState("field", updater)` | `deleteStateRecord(field, key)` |
| `patchState` with two or more fields | `patchState({ field: value })` — one field, plain value |
| `incState` across two or more fields | `incState({ field: n })` — one field |

The right-hand column doesn't read state to compute its result, so it doesn't need a version to be current. The store applies the increment, the append, or the single-key write to the record as it stands. Those calls never conflict and never raise `ConcurrentModificationError`.

Not conflicting is not the same as not losing data, and the difference splits that column in two:

| Unchecked call | Two concurrent writers, same field |
|---|---|
| `incState({ field: n })` — one field | Both land. The field ends up with both deltas |
| `pushState(field, value)` | Both land. Position is not promised |
| `patchState({ field: value })` — one field, plain value | Last write wins. The other value is gone |
| `setStateRecord(field, key, value)` | Last write wins on that key. Other keys are untouched |
| `deleteStateRecord(field, key)` | The key is removed. Other keys are untouched |

Increments and appends combine. A single-field `patchState`, or a `setStateRecord` on one key, does not: the store has nothing to compare, so it stores the value it was handed and the earlier one is gone. Both calls return `true`, and neither writer is told it overwrote anything. When the new value depends on the old one, reach for `patchState("field", updater)` or `atomicState` — those re-run your function against the value that won.

The left-hand column isn't automatically a merge either, and a retry means something different per call. `atomicState`, the updater form of `patchState`, and a multi-field `incState` re-run your computation against the refreshed state, so the two updates combine. A multi-field `patchState` re-applies the fixed values you passed, so fields you didn't name survive and the ones you did are overwritten. `setState` re-sends the whole object you passed, unchanged, so it replaces whatever the other writer landed. Use it to set state to a known value, not to apply a change to it.

Unchecked calls are still refused if the scope's record has been deleted. See [when `false` doesn't mean "already correct"](/docs/state/mutation-model#when-false-doesnt-mean-already-correct).

A store also has to offer the matching operation for a write to go the right-hand way. Field deletion is the gap in the built-in adapters, so `deleteStateRecord` falls back to a version-checked full-record write on request state and on the filesystem store. The [mutation model](/docs/state/mutation-model#the-store-has-to-offer-the-operation) has the detail.

Default retry budget for a version-checked write: **3 retries** with exponential backoff (10ms, 20ms, 40ms). The retry budget is per call, not per process.

When retries exhaust, the helper throws `ConcurrentModificationError`:

```ts
import { ConcurrentModificationError } from "@flow-state-dev/engine";

try {
  await ctx.session.atomicState((state) => ({
    retryCount: state.retryCount + 1,
  }));
} catch (err) {
  if (err instanceof ConcurrentModificationError) {
    // err.attempts — how many tries we made
    // err.code — "CONCURRENT_MODIFICATION"
  }
}
```

In practice, this is rare for typical conversational flows. It surfaces under sustained concurrency on the same scope — usually a sign that the contended writes belong on a different scope, or that the work should be batched.

### Three dispatch paths

Version-checked writes don't all run the same loop. On `session`, `user`, and `org` they run the CAS retry loop directly, because a remote authority — another connection, another process — can advance the stored version under a stale read.

`request` state is written to a store too. Its writes serialize through a per-container FIFO queue and persist under it, so a fan-out of concurrent writers inside one run commits every write, in submission order. The version check stays underneath the queue, because the queue orders one run's writers and nothing else.

Scopes that don't bridge through `persist` at all (`sequencer` state, target containers) take the same queue with no store write behind it. Nothing there can conflict, so your mutator runs exactly once and `ConcurrentModificationError` never surfaces.

Request scope is the one to read carefully. Its queue removes the conflicts between writers in the same run, but the version check underneath can still lose to a writer the queue cannot order, such as a recovery continuation re-entering the same request. The operation then refreshes from the store and calls your mutator again, and `ConcurrentModificationError` surfaces if the retries run out. So treat a request-scope mutator the way you treat one on session, user, or org: a pure function of the state it receives, with no side effects. See [Writing an updater that may run twice](/docs/state/mutation-model#writing-an-updater-that-may-run-twice).

Note: sequencer state going through the lock path doesn't mean it's lost on restart. The runtime still checkpoints sequencer state asynchronously at step boundaries, so a Phase 2 resume can rehydrate it. See [Sequencer State](/docs/advanced/sequencer-state).

The dispatch is internal to `applyMutation`. Callers see the same `ScopeStateOps` API regardless of which path runs. For the full breakdown — when you'd see `ConcurrentModificationError` vs `ScopeMutationTimeoutError`, and how to bound the lock path's worst case — see [State Mutation Model](/docs/state/mutation-model).

## How much to keep in state

Nothing caps the size of a scope's state. It is meant for flat, structured fields and small records: modes, counters, ids, short maps. Large content, like documents, transcripts or embeddings, belongs in a [Resource](/docs/resources/overview), which is stored and versioned per key.

## Where to next

- **[State & Scopes](/docs/fundamentals/state-and-scopes)** — conceptual overview, schema bubbling, the four scopes.
- **[State Mutation Model](/docs/state/mutation-model)** — dispatch internals, lock vs CAS, mutation timeout.
- **[State Targets and Parents](/docs/advanced/state-targets-and-parents)** — typed access to ancestor block state.
- **[Sequencer State](/docs/advanced/sequencer-state)** — state scoped to one execution of one sequencer instance, checkpointed for resume.
- **[Block State](/docs/advanced/block-state)** — the same seven operations, scoped to any block's own request-scoped state via `ctx.self`.

---
sidebar_position: 6
---

# State Operations

Every scope (`request`, `session`, `user`, `org`, and the optional `sequencer`) exposes the same set of state operations. This page is the reference for them: what each one does, what its return value tells you, and what two concurrent writers end up with.

For the conceptual overview of scopes and schema bubbling, see [State & Scopes](/docs/fundamentals/state-and-scopes). For the dispatch internals behind these operations, see [State Mutation Model](/docs/state/mutation-model).

## The seven operations

All scope handles implement the same `ScopeStateOps` interface. Every operation returns `Promise<boolean>`: `true` when a write was accepted, `false` when nothing was written. Neither answer describes the stored value — see [What a write tells you](#what-a-write-tells-you).

They differ in how they behave when two writers touch the same field, and that difference decides which one you want. [Concurrent writes](#cas-semantics) has the rule per call.

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

Use sparingly — `patchState` is almost always what you want. Reach for `setState` when resetting a session, initializing on first run, or genuinely overwriting everything. It replaces a concurrent writer's fields rather than merging with them, which is right for "make the state exactly this" and wrong for "apply my change".

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

These are common enough in real applications (chat threads, saved items, anything indexed by ID) that they get dedicated helpers. Both touch one key and leave the rest of the map alone.

### `atomicState(mutator)`

Read-modify-write in a single atomic step. The mutator receives the current state and returns a partial update:

```ts
await ctx.session.atomicState((state) => ({
  retryCount: state.retryCount + 1,
  lastAttemptAt: Date.now(),
}));
```

Reach for `atomicState` when an update depends on the current value and you need to be sure no other writer landed between your read and your write.

The mutator must be a *pure function* of the current state. Don't perform side effects inside it, and don't write to anything declared outside it — it may run more than once. [Writing an updater that may run twice](/docs/state/mutation-model#writing-an-updater-that-may-run-twice) covers what that means in practice.

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

It is a cache of what this execution context last read, which matters when you are checking whether a write landed. A fresh execution context loads the record from the store on the way in; so does a direct read through the store.

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

## What a write tells you {#what-a-write-tells-you}

Every operation returns `Promise<boolean>`:

- `true` — the write was accepted. Persisted, version bumped, `state_change` SSE event emitted.
- `false` — nothing was written. No version bump, no SSE event. The store may still have been called.

Both answers are reports about the write, not about the stored value.

### `true` doesn't mean the value changed {#the-no-op-short-circuit}

A write issued from a context whose cache predates a concurrent writer is still applied. A duplicate `deleteStateRecord` for a key another context already removed, or a `patchState` setting a field to the value another context already stored, is accepted, bumps the version, and returns `true` with the stored value structurally unchanged.

### `false` doesn't mean the store already holds your value {#when-false-doesnt-mean-already-correct}

The usual cause of `false` is a redundant write. When the update you propose is structurally equal to the state this context last read, it's skipped before the store is called, so idempotent writes don't need manual identity checks:

```ts
// Safe to call repeatedly. If `mode` is already "agent", nothing happens.
await ctx.session.patchState({ mode: "agent" });
```

The comparison uses `Object.is` for primitives (NaN-equal-NaN, `+0 != -0`) and recursive structural equality for plain objects and arrays.

That comparison runs against the state **this context last read**, before anything reaches the store. It is not a check that the store agrees. If another context has changed the field since your last read, and your write happens to match your own stale copy, the write is skipped and the other context's value stays stored:

```ts
// this context last read mode: "chat". Another context has since stored "agent".
const changed = await ctx.session.atomicState(() => ({ mode: "chat" }));
// false. Stored mode is still "agent" — the write was never sent.
```

A write is also refused, and returns `false`, in these cases:

- **The scope's record no longer exists.** Every store checks that the record exists before it looks at any version, and the write isn't turned into a create:

  ```ts
  await ctx.session.incState({ messageCount: 1 });
  // false if the session record has been deleted. Nothing is created.
  ```

- **A write with no version fell back to a full-record write and lost.** When the store doesn't offer the matching operation, the runtime writes the whole record at the version this run last read, in one attempt with no retry. Lose that race and the call returns `false` against a record that still exists — a lost delete looks exactly like a delete that had nothing to do. See [the store has to offer the operation](#the-store-has-to-offer-the-operation).

So read `false` as "nothing was written", never as "the state already matched". When you need to know what is stored, read it back from something other than this context's cache. Neither the stale-cache no-op nor the lost fallback write refreshes `ctx.<scope>.state`, so reading it back there hands you the same copy the call was decided against.

## Concurrent writes {#cas-semantics}

A write that depends on what state currently holds uses **compare-and-swap (CAS)**: the helper reads the current state and version, computes the next state, and persists with `expectedVersion`. If another writer has bumped the version in between, the persist call reports a conflict, the container refreshes from the store, and the operation retries with the new current state.

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

Other calls describe an operation instead — "add 1 to `messageCount`", "set `byId.doc-1` to this value" — and the runtime hands that operation to the store, which applies it to the record as it stands. Those writes carry no version, so nothing is compared, nothing can conflict, and they never raise `ConcurrentModificationError`. A call only goes that way if [the store offers the matching operation](#the-store-has-to-offer-the-operation).

| Version-checked | No version |
|---|---|
| `setState` | `pushState(field, value)` |
| `atomicState` | `setStateRecord(field, key, value)` |
| `patchState("field", updater)` | `deleteStateRecord(field, key)` |
| `patchState` with two or more fields | `patchState({ field: value })` — one field, plain value |
| `incState` across two or more fields | `incState({ field: n })` — one field |

That is the mechanism. What you actually need is what two concurrent writers on the same field end up with:

| Call | Two writers, same field |
|---|---|
| `incState({ field: n })` — one field | Both land. The field ends up with both deltas |
| `pushState(field, value)` | Both land. Position is not promised |
| `patchState({ field: value })` — one field, plain value | **Last write wins.** The other value is gone |
| `setStateRecord(field, key, value)` | **Last write wins** on that key. Other keys are untouched |
| `deleteStateRecord(field, key)` | The key is removed. Other keys are untouched |
| `setState(next)` | **The object you passed is written as-is.** The other writer's fields are replaced |
| `patchState({ a, b })` — two or more fields | Your fields overwrite theirs. Fields you didn't name survive |
| `incState({ a, b })` — two or more fields | Both sets of increments land |
| `patchState("field", updater)` | Your updater runs again against the value that won |
| `atomicState(mutator)` | Your mutator runs again against the value that won |

### Both writers land

Two contexts incrementing the same counter both land, and neither spends a retry:

```ts
// two concurrent execution contexts, unchanged flow code, messageCount at 0
await ctx.session.incState({ messageCount: 1 });
await ctx.session.incState({ messageCount: 1 });
// stored messageCount is 2
```

Appends land the same way, and nothing is dropped. What isn't promised is position. Two concurrent `pushState` calls on one array both survive, in whichever order they reached the store:

```ts
// two concurrent execution contexts appending to session state
await ctx.session.pushState("history", { role: "user", text: "first" });
await ctx.session.pushState("history", { role: "user", text: "second" });
// both entries are in history. Which one sits at index 0 depends on
// which write the store applied first.
```

So if you read that array back as an ordered history, order it on a field you set yourself, a timestamp or a sequence number. Array position won't carry that for you.

### Last write wins on the same field

A write with no version holds up against writers touching other parts of the record. Two writers on different fields, or on different keys of one map, don't clobber each other, because each write is applied to the record as the store holds it at that moment.

Two writers on the same field, or the same key of one map, are the case that bites. A single-field `patchState`, or a `setStateRecord` on one key, carries no version, so the store has nothing to compare and stores the value it was handed. The write that reaches the store second wins, and the first one is gone:

```ts
// two concurrent execution contexts, both writing session state
await ctx.session.patchState({ owner: "worker-a" });
await ctx.session.patchState({ owner: "worker-b" });
// stored owner is whichever write landed second. The other value is
// overwritten. Both calls resolved true, neither raised, neither retried.
```

Nothing in the return value tells you this happened. Both calls resolve `true`, because each writer's own value did reach the store.

When the write depends on what is already stored, use the updater form of `patchState` or `atomicState` instead. Both read current state, and a lost race re-runs your updater against the value that won rather than discarding it:

```ts
// claim the session only if nobody holds it
const claimed = await ctx.session.patchState("owner", (current) => current ?? "worker-b");
// true if this context claimed it. false if "worker-a" won the race —
// the updater re-ran against "worker-a" and left it alone.
```

### A version check is not a merge

Carrying a version is not the same as merging, and `setState` is the call that catches people out. When a version-checked write loses the race, the runtime refreshes from the store and runs the write again — but "again" means three different things.

- `atomicState`, the updater form of `patchState`, and a multi-field `incState` re-run *your computation* against the value that won, so the two updates combine.
- A multi-field `patchState` re-applies the fixed values you passed onto the refreshed state, so fields you didn't name survive and the ones you did are overwritten.
- `setState` re-sends *the whole object you already passed*, unchanged, so whatever the other writer landed is replaced.

Reach for `setState` when you mean "make the state exactly this", not when you mean "apply my change to it".

### The store has to offer the operation {#the-store-has-to-offer-the-operation}

A write only skips the version check if the store behind the scope offers the matching operation. The field write, the increment, the append and the field delete are each optional on a store adapter. When one is missing, the runtime writes the whole record instead, at the version this run last read, in a single attempt with no retry.

Field deletion is the gap in the built-in adapters. The in-memory, SQLite and Postgres stores offer it on session, user and org state, where `deleteStateRecord` removes the key in place and there is no version to lose. No store offers it on request state, and the filesystem store offers it on no scope at all. `deleteStateRecord` there writes the full record:

```ts
await ctx.session.deleteStateRecord("byId", "doc-1");
// on the filesystem store, resolves false when another writer moved the
// session record first. "doc-1" is still stored.
```

That `false` is a lost race against a session record that is still very much there, not a report that the key was already gone.

Retrying the same call in the same execution context will not clear the key. The refused write leaves this context's cached state and version untouched, so every repeat sends the version that already lost and gets `false` back. Reading the map first changes nothing, because that read comes from the same cache.

Use a version-checked write instead. `atomicState` refreshes from the store on a conflict and runs your mutator again against the record that won:

```ts
await ctx.session.atomicState((state) => ({
  byId: Object.fromEntries(
    Object.entries(state.byId).filter(([key]) => key !== "doc-1")
  ),
}));
// "doc-1" is gone from the record the store holds. Raises
// ConcurrentModificationError if the retry budget exhausts.
```

A fresh execution context clears it too, since it loads the record from the store on the way in.

### When retries run out

Default retry budget for a version-checked write: **3 retries** with exponential backoff (10ms, 20ms, 40ms). The budget is per call, not per process.

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

In practice, this is rare for typical conversational flows. It surfaces under sustained concurrency on the same scope — usually a sign that the contended writes belong on a different scope, or that the work should be batched. The [mutation model](/docs/state/mutation-model#faq) lists the ways out.

## Which path a write takes

Version-checked writes don't all run the same loop, and which one you get depends on the scope:

| Scope | How writes are ordered | Can raise |
|---|---|---|
| `session`, `user`, `org` | CAS retry loop. A remote authority — another connection, another process — can advance the stored version under a stale read | `ConcurrentModificationError` |
| `request` | A per-container FIFO queue, persisting under it, with the version check still underneath | `ConcurrentModificationError` |
| `sequencer`, target containers | The same queue, with no store write behind it | Nothing — your mutator runs exactly once |

Request scope is the one to read carefully. Its queue removes the conflicts between writers in the same run, so a fan-out commits every write in submission order. But the version check underneath can still lose to a writer the queue cannot order, such as a recovery continuation re-entering the same request. The operation then refreshes from the store and calls your mutator again. So treat a request-scope mutator the way you treat one on session, user, or org: a pure function of the state it receives, with no side effects.

Sequencer state going through the queue doesn't mean it's lost on restart. The runtime still checkpoints sequencer state asynchronously at step boundaries, so a Phase 2 resume can rehydrate it. See [Sequencer State](/docs/advanced/sequencer-state).

The dispatch is internal. Callers see the same `ScopeStateOps` API regardless of which path runs. [State Mutation Model](/docs/state/mutation-model) has the full breakdown, including the mutation timeout that bounds the queue path.

## How much to keep in state

Nothing caps the size of a scope's state. It is meant for flat, structured fields and small records: modes, counters, ids, short maps. Large content, like documents, transcripts or embeddings, belongs in a [Resource](/docs/resources/overview), which is stored and versioned per key.

## Where to next

- **[State & Scopes](/docs/fundamentals/state-and-scopes)** — conceptual overview, schema bubbling, the four scopes.
- **[State Mutation Model](/docs/state/mutation-model)** — dispatch internals, resource state versioning, mutation timeout.
- **[State Targets and Parents](/docs/advanced/state-targets-and-parents)** — typed access to ancestor block state.
- **[Sequencer State](/docs/advanced/sequencer-state)** — state scoped to one execution of one sequencer instance, checkpointed for resume.
- **[Block State](/docs/advanced/block-state)** — the same seven operations, scoped to any block's own request-scoped state via `ctx.self`.

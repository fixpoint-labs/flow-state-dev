---
sidebar_position: 1
---

# State mutation model

Every scope's state mutators (`patchState`, `pushState`, `incState`, `setStateRecord`, `deleteStateRecord`, `atomicState`) route through one of two paths inside the runtime. The right primitive depends on whether anything outside this Node.js process can advance the version underneath you.

Read-only instance config is also available on the context as `ctx.settings` — see [Server Setup → Settings](/docs/server/setup#settings).

## Two-tier dispatch

```
                     applyMutation(container, options, mutator)
                                  │
                    ┌─────────────┴──────────────┐
                    │  options.persist defined?  │
                    └─────────────┬──────────────┘
                                  │
              ┌──── no ───────────┴────── yes ────┐
              ▼                                   ▼
    withScopeLock — FIFO queue            runWithCAS — retry loop
    per StateContainer,                   with exponential backoff,
    no version checks,                    version-checked persist,
    no retries,                           may throw
    may throw ScopeMutationTimeoutError   ConcurrentModificationError
```

The dispatch is internal to `applyMutation`. Callers see the same `ScopeStateOps` API regardless of which path runs.

### In-memory scopes use a FIFO queue

A *target* state container, a *sequencer* state container, [block state](/docs/advanced/block-state) generally, or any scope you build that doesn't bridge through a `persist` callback gets the lock path. Each container has a tail promise; new mutators chain off it, run one at a time in submission order, and the tail advances.

In a single-process Node.js runtime, the only race vector for these mutators is `await`-point interleaving inside this process. Optimistic concurrency control with a fixed retry budget is the wrong primitive here — concurrent task-board workers create predictable, sustained contention, and the retry budget exhausts long before all writers can land. Serializing at the source costs nothing and is correct by construction.

The lock branch never throws `ConcurrentModificationError`. There is no version conflict to retry, because there is no remote authority that could advance the version.

### External-store scopes still use CAS

`request`, `session`, `user`, and `org` scopes that bridge through a `persist` callback (filesystem, sqlite, postgres adapters) keep the optimistic CAS path. The remote authority — another connection pool, another process, the durable file lock — can advance the stored version while we hold a stale read. CAS is exactly the primitive for that: read the version, mutate locally, persist with `expectedVersion`, retry on conflict.

`ConcurrentModificationError` continues to surface from these paths when retries exhaust. That's the contract: if you write through `persist` and the remote authority moves faster than your retry budget, you need to either widen the budget or restructure to avoid the contention.

### The resource state store is versioned too

The four scopes above hold one state record each. **Resource state** — the state behind `ctx.sessionResources.something`, and behind every instance of a collection — lives in a separate store, keyed per resource.

That store used to be plain last-write-wins, which is the right model for a document body nothing merges against a prior read, and the wrong one for structured state concurrent workers read-modify-write. The store is now versioned: every stored resource carries a version that increases by one on each committed write and is never reused, and a write **can** state the version it expected to find. A write that names a version lands only if nobody moved the key since; otherwise it is refused, and the refusal reports the version that is actually current.

Read that as a property of the store, not yet as a property of your flow. The refusal is available to whoever holds the `ResourceStateStore` — a store adapter, a test harness, code reaching for `runtime.stores.resourceState` — because those callers choose what version to name. The runtime's own resource persister does not name one yet: when a flow mutates `ctx.sessionResources.something` or a collection instance, that write still goes to the store unconditionally. **Resource mutations from flow code are therefore still last-write-wins.** Threading the observed version through that path is the next piece of this work; until it lands, two contexts patching the same resource can still lose one of the writes, exactly as before.

Nothing changes in flow code either way — you never write a version yourself.

Deleting a resource leaves a small marker behind rather than removing the row, and that marker keeps the version. It is what makes delete-then-recreate safe: a worker holding a version from before the delete can never match the resource that replaced it, because versions are never reused. Markers are kept indefinitely — nothing sweeps them — which costs one row per deleted key.

One limit stated plainly: on the filesystem store the comparison is held per key within a single process. That covers two contexts in one Node process. It does not coordinate two operating-system processes pointed at the same directory. The in-memory, SQLite and Postgres stores compare and swap inside the store itself.

## Writing an updater that may run twice

The callback you hand to `updateState` (or `atomicState`) is an **updater**: it receives the current state and returns the next one. On the CAS path above, that callback is not guaranteed to run once. When the persist step loses a version check, the loop refreshes from the store and **calls your updater again** with the freshest state. Only the last attempt's output is written.

That matters the moment your updater has something to tell its caller. The natural way to report an outcome is to reach outside the callback:

```ts
// Don't. `found` outlives the callback.
let found = false
await ref.updateState((s) => {
  const idx = s.entries.findIndex((e) => e.id === id)
  if (idx < 0) return s          // a replay lands here; `found` is still true
  found = true
  return { ...s, entries: withoutIndex(s.entries, idx) }
})
return found
```

If the first attempt removed the entry and a conflicting write removed it first, the second attempt takes the `idx < 0` branch and commits nothing — but `found` still holds `true` from the attempt that lost. The function reports work that was never saved. An accumulating array is worse: it keeps every attempt's entries, duplicates included.

The rule is: **an updater treats everything declared outside it as read-only.** Reading an outer value is fine. Writing one — assigning it, pushing through it, assigning one of its properties — is not.

Return the outcome instead. `updateStateWith` passes it back out of the write, taking the answer from whichever invocation committed:

```ts
import { updateStateWith } from "@flow-state-dev/core/helpers"

return (await updateStateWith(ref, (s) => {
  const idx = s.entries.findIndex((e) => e.id === id)
  if (idx < 0) return { state: s, result: false }
  return { state: { ...s, entries: withoutIndex(s.entries, idx) }, result: true }
})) ?? false
```

The updater returns `{ state, result }`: the state to commit, and what this invocation did. `updateStateWith` returns the `result` belonging to the invocation whose state was committed, or `undefined` if the updater never completed one — which is why the example falls back to `false`.

The same applies to values you *derive* from state before the write. Reading `ref.state.currentTurn`, stamping it onto a record, and committing that record inside the callback has the same defect one step removed: the record carries the turn from before the conflict. Build the record from the state the callback receives.

`withOutcome` is the same helper for a runner that isn't a resource — anything that applies a mutator, including a wrapper of your own. Pass the runner as a closure, so the call keeps its receiver:

```ts
await withOutcome((mutator) => ref.updateState(mutator), updater)
```

That is what `updateStateWith(ref, updater)` does for you.

A repo-wide check (`scripts/validate-updater-purity.mjs`, run by `pnpm typecheck`) fails the build on the common outward-write forms — assigning an outer binding, pushing through one, assigning one of its properties — including where the target is wrapped in a type assertion. It is a backstop, not a proof: a custom mutating method, a write through a helper that receives the binding, or an alias will pass it. The helper above is the actual fix; the check is there to catch the shapes people reach for out of habit.

## Mutation timeout

The lock path can deadlock if a mutator never finishes — say it awaits something that never resolves. To bound the worst case, every in-memory mutation has a budget:

```ts
defineFlow({
  kind: "chat",
  request: { mutationTimeoutMs: 60_000 },  // default: 30_000
  actions: { /* ... */ }
});
```

When a mutator's queue wait + execution exceeds the budget, the call rejects with `ScopeMutationTimeoutError` instead of hanging. The timer counts queue wait, not just execution — head-of-line blocking from earlier enqueuers eats into the budget.

The timeout is a bounded-error safety net, not a cancellation primitive. The in-flight mutator keeps running after the caller's promise rejects; if it eventually returns, the lock still commits its result and bumps the version. So a caller that retries on `ScopeMutationTimeoutError` may end up applying the mutation twice. If you need at-most-once semantics, write idempotent mutators (e.g. set/replace, not increment) or guard the retry on top.

Set to `Infinity` to disable. The CAS path ignores the option; `runWithCAS` uses its own retry/timeout semantics at the durable boundary.

## Lock semantics

The lock is **non-reentrant**. A mutator that calls `atomicState` again on the same container would await its own completion forever:

```ts
// DON'T — nested same-scope mutation deadlocks.
await ctx.session.atomicState(async (state) => {
  await ctx.session.atomicState(...);  // never returns
});

// DO — compose state in a single mutator.
await ctx.session.atomicState((state) => ({
  count: state.count + 1,
  lastSeen: Date.now(),
}));
```

Cross-scope mutator chains are fine — different containers have independent queues:

```ts
await ctx.session.atomicState((state) => {
  // OK — request and session are different containers.
  void ctx.request.patchState({ stamp: Date.now() });
  return { count: state.count + 1 };
});
```

## FAQ

**Why does my flow still throw `ConcurrentModificationError`?**

You're writing through a `persist` callback to an external store (filesystem, sqlite, postgres). The CAS retry budget exhausted because contention exceeded what optimistic concurrency can absorb at that boundary. Options:

- Widen the retry budget on the persist call site.
- Move the contended writes to an in-memory scope (sequencer state on a parent block) so they go through the lock instead.
- Restructure the contention pattern — fewer concurrent writers, batched updates, or finer-grained scopes.

**Why doesn't the lock path retry on conflict?**

There's no conflict to retry. The lock serializes mutators inside this process; each one reads the current state at the moment its turn arrives. Two mutators racing to increment `count` both see the post-commit value of the previous one, so both increments land — no retries needed.

**Can I add my own retry budget to in-memory mutators?**

You don't need one. The lock guarantees in-order, conflict-free serialization. If your mutator throws for some other reason, that error surfaces as-is to the caller; it's not a "transient" failure that retrying would fix.

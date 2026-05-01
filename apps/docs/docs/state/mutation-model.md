---
sidebar_position: 1
---

# State mutation model

Every scope's state mutators (`patchState`, `pushState`, `incState`, `setStateRecord`, `deleteStateRecord`, `atomicState`) route through one of two paths inside the runtime. The right primitive depends on whether anything outside this Node.js process can advance the version underneath you.

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

A *target* state container, a *sequencer* state container, or any scope you build that doesn't bridge through a `persist` callback gets the lock path. Each container has a tail promise; new mutators chain off it, run one at a time in submission order, and the tail advances.

In a single-process Node.js runtime, the only race vector for these mutators is `await`-point interleaving inside this process. Optimistic concurrency control with a fixed retry budget is the wrong primitive here — concurrent task-board workers create predictable, sustained contention, and the retry budget exhausts long before all writers can land. Serializing at the source costs nothing and is correct by construction.

The lock branch never throws `ConcurrentModificationError`. There is no version conflict to retry, because there is no remote authority that could advance the version.

### External-store scopes still use CAS

`request`, `session`, `user`, and `org` scopes that bridge through a `persist` callback (filesystem, sqlite, postgres adapters) keep the optimistic CAS path. The remote authority — another connection pool, another process, the durable file lock — can advance the stored version while we hold a stale read. CAS is exactly the primitive for that: read the version, mutate locally, persist with `expectedVersion`, retry on conflict.

`ConcurrentModificationError` continues to surface from these paths when retries exhaust. That's the contract: if you write through `persist` and the remote authority moves faster than your retry budget, you need to either widen the budget or restructure to avoid the contention.

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

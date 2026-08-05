---
"@flow-state-dev/engine": minor
"@flow-state-dev/orchestration": patch
"@flow-state-dev/patterns": patch
---

Resource mutations written from flow code are now compare-and-swap.

The previous change made `ResourceStateStore` versioned, but only callers holding
the store directly could use it — the runtime persisted flow-authored resource
mutations unconditionally, so two execution contexts patching one resource were
still last-write-wins. That is now closed. Two concurrent contexts patching
different fields of the same resource both land:

```ts
// two concurrent execution contexts, unchanged flow code
await ctx.sessionResources.task.patchState({ claimedBy: "worker-a" });
await ctx.sessionResources.task.patchState({ note: "in progress" });
// before: one field silently gone. after: both present
```

Nothing changes in flow code — you never write a version yourself. Every resource
write now runs through a retry driver at the registry's read/mutate seam, carrying
the version its context observed. On conflict the write op's own mutator re-runs
against the value that won, so the retry merges rather than overwriting.

Two behaviours are new, and both are cases where the old code silently did the
wrong thing:

```ts
await ctx.sessionResources.task.patchState({ note: "x" });
// rejects if another context deleted it — it is not resurrected from a stale read
await ctx.sessionResources.tasks.create("t1");
// rejects if a live "t1" exists, whether pre-existing or the winner of a race
```

Both refusals are final rather than retried, because a retry could only re-apply
what the loser read before it lost. They surface as `ResourceDeletedError` and
`ResourceAlreadyExistsError`; sustained contention still raises
`ConcurrentModificationError`. Deleting a collection instance, and evicting one
under `maxInstances`, now carry the version the context observed too, so a delete
chosen from a stale snapshot conflicts instead of tombstoning the generation that
replaced it.

Writing a value a resource already holds still skips the write and emits no
change event — but only after re-reading the key and confirming the version is
current. Previously that check ran against an unverified in-context cache, which
meant a deliberate write of a value equal to a stale cache was reported as a
no-op while another writer's value stood: a lost update on the one path that
never compared a version.

Resource state deliberately does not reuse `runWithCAS`, the driver the session /
request / user / org scopes use. Its conflict policy retries cases that must be
terminal here, it suppresses a no-op before checking any version, it routes
single-field literal patches down a commutative path that writes without a
version check at all, and it has no cancellation. Resource writes honour
`ctx.signal`, so an aborted action stops instead of persisting after
cancellation.

Task boards backed by a durable resource collection inherit this: a claim written
against a stale read is refused and re-applied rather than overwriting the worker
that won. The filesystem store remains the exception — it compares within a
single process, so a board fanned across replicas wants SQLite or Postgres.

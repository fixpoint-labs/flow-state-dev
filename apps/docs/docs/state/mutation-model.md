---
sidebar_position: 1
---

# State mutation model

Every scope's state mutators (`patchState`, `setState`, `pushState`, `incState`, `setStateRecord`, `deleteStateRecord`, `atomicState`) route through one of three paths inside the runtime. Which path you get depends on whether the scope writes to a store at all, and on whether anything outside this Node.js process can advance the version underneath you.

The shape of the write decides a second question: whether it carries a version at all. [Which writes carry a version](#which-writes-carry-a-version) is the table, and it is the part worth reading before you pick a mutator.

Read-only instance config is also available on the context as `ctx.settings` — see [Engine setup → Settings](/docs/server/setup#settings).

## Three write paths

```
       applyMutation(container, options, mutator)
                           │
  ┌────────────────────────┼────────────────────────┐
  ▼                        ▼                        ▼
  no persist               request scope            session / user / org
  │                        │                        │
  withScopeLock — a FIFO   withScopeLock, then the  runWithCAS — a retry loop
  queue per container.     same version-checked     with exponential backoff
  No version check, no     persist under the lock.  and a version-checked
  retries.                 Serialized writers do    persist. Retries on
                           not conflict with one    conflict.
                           another; the retries
                           stay underneath.
```

The dispatch is internal to `applyMutation`. Callers see the same `ScopeStateOps` API regardless of which path runs. What each path can raise:

| Path | Raises |
|---|---|
| No persist | `ScopeMutationTimeoutError` when queue wait + execution outruns `mutationTimeoutMs` |
| Request scope | `ConcurrentModificationError` when the retry budget exhausts |
| Session / user / org | `ConcurrentModificationError` when the retry budget exhausts |

Those two rows are about version-checked writes. An unchecked write carries no version, so it has nothing to conflict with and cannot raise `ConcurrentModificationError`.

### Scopes with no store use a FIFO queue

A *target* state container, a *sequencer* state container, [block state](/docs/advanced/block-state) generally, or any scope you build that doesn't bridge through a `persist` callback gets the lock path. Each container has a tail promise; new mutators chain off it, run one at a time in submission order, and the tail advances.

In a single-process Node.js runtime, the only race vector for these mutators is `await`-point interleaving inside this process. Optimistic concurrency control with a fixed retry budget is the wrong primitive here — concurrent task-board workers create predictable, sustained contention, and the retry budget exhausts long before all writers can land. Serializing at the source costs nothing and is correct by construction.

The lock branch never throws `ConcurrentModificationError`. There is no version conflict to retry, because there is no remote authority that could advance the version.

### Request scope serializes, then persists

Request state is written to the store on every mutation, so a paused request can restore it on `/continue`. Most of the contention on that record comes from inside a single run — a block that fans out, a few side chains patching request state at once. Those writers all share one container, so a queue can order them exactly.

So request scope takes the queue and the store write both: mutators serialize through the same per-container lock the store-less scopes use, and each one persists while it still holds the lock. Writers land in submission order, one version bump each. Because each reads a current version, they never conflict with one another, and a fan-out wider than any retry budget still commits every write.

The version check and its retries sit underneath the queue rather than being replaced by it. A queue can only order writers that share a container, and a request record can briefly have one that doesn't: recovery re-enters an interrupted request under its own id, and the run it starts writes through a container of its own. A conflict there resolves the way it does on session scope — re-read, re-apply, persist — and `ConcurrentModificationError` surfaces only if the budget exhausts.

### Session, user, and org scopes use CAS

These scopes write to a store — whichever adapter you configured, including the default in-memory one — and take the optimistic CAS path for any write that depends on what state currently holds. A remote authority — another connection pool, another process, the durable file lock — can advance the stored version while we hold a stale read. CAS is the primitive for that: read the version, mutate locally, persist with `expectedVersion`, retry on conflict.

`ConcurrentModificationError` surfaces from these paths when retries exhaust. That's the contract: if the remote authority moves faster than your retry budget, you need to either widen the budget with `cas` on the scope or restructure to avoid the contention.

### Which writes carry a version

Some calls compute the next state from what they read, so the runtime writes a whole record and asks the store to accept it only if the version this context read is still current. Others describe an operation instead — "add 1 to `messageCount`", "set `byId.doc-1` to this value" — and the runtime hands that operation to the store, which applies it to the record as it stands. Those are **unchecked** writes. Nothing is compared, so nothing can conflict, and an unchecked write never raises `ConcurrentModificationError`.

That is the mechanism. What you actually need is the second column: what two concurrent writers on the same field end up with.

| Call | Carries a version | Two writers, same field |
|---|---|---|
| `incState({ field: n })` — one field | No | Both land. The field ends up with both deltas |
| `pushState(field, value)` | No | Both land. Position is not promised |
| `patchState({ field: value })` — one field, plain value | No | **Last write wins.** The other value is gone |
| `setStateRecord(field, key, value)` | No | **Last write wins** on that key. Other keys are untouched |
| `deleteStateRecord(field, key)` | No | The key is removed. Other keys are untouched |
| `setState(next)` | Yes | **The object you passed is written as-is.** The other writer's fields are replaced |
| `patchState({ a, b })` — two or more fields | Yes | Your fields overwrite theirs. Fields you didn't name survive |
| `incState({ a, b })` — two or more fields | Yes | Both sets of increments land |
| `patchState("field", updater)` | Yes | Your updater runs again against the value that won |
| `atomicState(mutator)` | Yes | Your mutator runs again against the value that won |

Carrying a version is not the same as merging, and `setState` is the call that catches people out. When a version-checked write loses the race, the runtime refreshes from the store and runs the write again — but "again" means three different things. `atomicState`, the updater form of `patchState`, and a multi-field `incState` re-run *your computation* against the value that won, so the two updates combine. A multi-field `patchState` re-applies the fixed values you passed onto the refreshed state, so fields you didn't name survive and the ones you did are overwritten. `setState` re-sends *the whole object you already passed*, unchanged, so whatever the other writer landed is replaced. Reach for `setState` when you mean "make the state exactly this", not when you mean "apply my change to it".

#### Both writers land

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

#### Last write wins on the same field

An unchecked write holds up against writers touching other parts of the record. Two writers on different fields, or on different keys of one map, don't clobber each other, because each write is applied to the record as the store holds it at that moment.

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

#### The store has to offer the operation

A write only skips the check if the store behind the scope offers the matching operation. When it doesn't, the runtime writes the whole record instead, at the version this run last read, in a single attempt with no retry.

Field deletion is the one gap in the built-in adapters. No built-in store offers it on request state, and the filesystem store offers it on no scope at all. `deleteStateRecord` there writes the full record:

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

On session, user and org state backed by the in-memory store, SQLite or Postgres, `deleteStateRecord` is unchecked like the rest. The store removes the key in place, so there is no version to lose.

#### When `false` doesn't mean "already correct" {#when-false-doesnt-mean-already-correct}

An unchecked write is refused when the record is gone. Every store checks that the record exists before it looks at any version, so a write to a scope whose record was deleted underneath you doesn't recreate it:

```ts
await ctx.session.incState({ messageCount: 1 });
// false if the session record has been deleted. Nothing is created.
```

`false` is also what you get when the write was skipped as a no-op, and that no-op is decided against the state **this context last read**, before any store round-trip. If another context changed the field since your last read, and your write happens to match your own stale copy, the write is skipped and the other context's value stays stored:

```ts
// this context last read mode: "chat". Another context has since stored "agent".
const changed = await ctx.session.atomicState(() => ({ mode: "chat" }));
// false. Stored mode is still "agent" — the write was never sent.
```

So `false` means "nothing was written". It does not mean "the store already holds your value". Three different things produce it: a no-op against this context's cached read, a refusal because the record is gone, and a lost version check on a full-record fallback write. The return value alone won't tell them apart. When you need to know what is stored, read it back from something other than this context's cache. `ctx.<scope>.state` is that cache, and a lost version check leaves it untouched, so reading it back there hands you the copy that just lost. A version-checked write refreshes it on conflict, and a fresh execution context loads the record on the way in.

### The resource state store is versioned too

The four scopes above hold one state record each. **Resource state** — the state behind `ctx.resources.something`, and behind every instance of a collection — lives in a separate store, keyed per resource.

Resource state is versioned: every stored resource carries a version that increases by one on each committed write and is never reused. A write lands only if the version this context read is still current; otherwise it is refused and the mutator re-runs. The refusal reports the version that is actually current.

The resource **state** mutators take that check: `patchState`, `setState`, `updateState`, and the same three on a collection instance. The unchecked writes above belong to scope state.

`writeContent` does not take it. A content write carries no version, so the store overwrites whatever body the key holds:

```ts
await ctx.resources.plan.writeContent("# Plan\n\nDraft one");
// replaces the stored body. No version is compared, so a concurrent
// writer's body is replaced without a refusal and without a retry.
```

Keep anything two contexts might need to merge in resource state rather than in content, and write it with `updateState`. Its updater runs again against the value that won, so both changes land. `patchState` merges too when the two contexts name disjoint fields: the fields you pass are applied to the refreshed state, so fields you didn't name survive and fields you did are overwritten. `setState` never merges. It re-sends the object you passed, replacing whatever the other context stored. Treat content as a body you replace whole.

**The version guarantee reaches flow code.** When you mutate `ctx.resources.something` or a collection instance, the runtime writes at the version this execution context read. If another context moved the key in between, your write is refused, your mutator re-runs against the value that actually won, and the retry writes whatever that re-run produced. Two contexts patching different fields of one resource both land:

```ts
// two concurrent execution contexts, unchanged flow code
await ctx.resources.task.patchState({ claimedBy: "worker-a" });
await ctx.resources.task.patchState({ note: "in progress" });
// both fields present — neither context's write is silently dropped
```

You never write a version yourself.

Two behaviours are worth expecting:

```ts
await ctx.resources.task.patchState({ note: "x" });
// rejects if another context deleted it. It is not resurrected from a stale read.
await ctx.resources.tasks.create("t1");
// rejects if a live "t1" exists, whether it was already there or won a race.
```

Both refusals are final rather than retried. A retry could only re-apply what you read before you lost, which for a deleted resource means bringing it back and for a lost `create` means overwriting whoever won.

`getOrCreate` and `upsert` never surface the second one. Their contract is to hand you the instance either way, so a create that loses the race becomes a read of the winner (`getOrCreate`) or applies its update as a patch (`upsert`).

One thing that is deliberately *not* an error: touching a resource that has never been stored. A resource you declared but never wrote exists so far only as its schema default, and a write to it that changes nothing is a no-op, not a report that something was deleted.

Those two cases are why resource state has its own retry driver rather than sharing the one the four scopes use. The scope driver treats every conflict as retryable, which is correct when the only thing a conflict can mean is "somebody else moved this value." Resource state has two conflicts that mean something else — the key is gone, and the key is already taken — and retrying either produces exactly the write the version check was there to stop. Resource writes also pair a queue with a version check, the way request scope does: a per-key queue orders one context's writes to a resource so they never contend with each other, and the compare-and-swap underneath handles the contexts the queue cannot see.

Writing a value the resource already holds still skips the write and emits no change event — but only once the runtime has re-read the key and confirmed your version is current. If the version moved, that is a conflict, not a no-op: the value you are writing happens to equal a stale cache, and suppressing it there would be the silent lost update this whole model exists to prevent.

A resource write can exhaust its retry budget under sustained contention and raise `ConcurrentModificationError`, the same as the external-store scopes above. The per-key write queue in front of it makes that rare, because writes from one context never contend with each other.

Deleting a resource leaves a small marker behind rather than removing the row, and that marker keeps the version. It is what makes delete-then-recreate safe: a worker holding a version from before the delete can never match the resource that replaced it, because versions are never reused. Markers are kept indefinitely — nothing sweeps them — which costs one row per deleted key.

One limit stated plainly: on the filesystem store the comparison is held per key on the store instance. That covers every write through that instance, two contexts sharing it included. It does not coordinate two stores pointed at the same directory, whether they sit in one Node process or two. The in-memory, SQLite and Postgres stores compare and swap inside the store itself.

## Schema-invalid resource writes

After `patchState`, `setState`, or `updateState` returns on a `ResourceRef`, the stored state is a JSON object that satisfies that resource's `stateSchema`. Collection-instance refs from `get` or `create` expose the same three methods and the same contract.

```ts
import { defineResource, handler, FlowError } from "@flow-state-dev/core";
import { z } from "zod";

const taskResource = defineResource({
  scope: "session",
  stateSchema: z.object({
    note: z.string().default(""),
    retries: z.number().int().nonnegative().default(0),
  }),
  writable: true,
});

const bumpRetries = handler({
  name: "bump-retries",
  resources: { task: taskResource },
  execute: async (_input, ctx) => {
    const task = ctx.resources.task;

    await task.patchState({ note: "in progress" });
    // task.state.note === "in progress"

    try {
      await task.updateState((state) => ({ ...state, retries: -1 }));
    } catch (err) {
      if (FlowError.isInstance(err) && err.code === "validation_error") {
        err.retryable; // false
        err.message;
        // Resource "task" write failed stateSchema validation at "retries": <issue>
      }
    }
    // task.state.retries === 0. The refused write did not land.
  },
});
```

A result that fails `stateSchema`, or that parses to a non-null non-object, throws `ValidationError`. Stored state is the value from before the call. No `resource_change` is emitted.

`setState(null)` on a `.nullable()` resource is not a schema failure. The store holds JSON objects, so that write persists as `{}` — the same cleared form an unwritten nullable single already surfaces as.

The message is:

```
Resource "<storage-key>" write failed stateSchema validation[ at "<path>"]: <issue>
```

`<storage-key>` is the persist key: `task` for a single resource, `items/doc1` for a collection instance. The ` at "<path>"` segment is present when Zod reports a field path.

Collection `create` and `upsert` refuse an invalid initial or merged state. The instance is not created or patched.

A read of a persisted single-resource value that does not validate resolves to a schema-valid default. The read does not throw. A collection-instance read returns the stored object as-is.

The refusal applies to `ResourceRef`. Scope bags (`ctx.session.patchState` and the rest) are a different surface.

## Writing an updater that may run twice

The callback you hand to `updateState` (or `atomicState`) is an **updater**: it receives the current state and returns the next one. On any path above with a version check under it — request, session, user, org, and resource state — that callback is not guaranteed to run once. When the persist step loses a version check, the loop refreshes from the store and **calls your updater again** with the freshest state. Only the last attempt's output is written.

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

The lock path can deadlock if a mutator never finishes — say it awaits something that never resolves. To bound the worst case, every mutation on a scope with no store has a budget:

```ts
defineFlow({
  kind: "chat",
  request: { mutationTimeoutMs: 60_000 },  // default: 30_000
  actions: { /* ... */ }
});
```

When a mutator's queue wait + execution exceeds the budget, the call rejects with `ScopeMutationTimeoutError` instead of hanging. The timer counts queue wait, not just execution — head-of-line blocking from earlier enqueuers eats into the budget.

The timeout is a bounded-error safety net, not a cancellation primitive. The in-flight mutator keeps running after the caller's promise rejects; if it eventually returns, the lock still commits its result and bumps the version. So a caller that retries on `ScopeMutationTimeoutError` may end up applying the mutation twice. If you need at-most-once semantics, write idempotent mutators (e.g. set/replace, not increment) or guard the retry on top.

That is also why the budget stops at scopes with no store. It is not applied to request, session, user, or org — anything that writes to a store. A write the caller has given up on is still able to reach the store, and by the time it gets there the runtime may have finished the request and written its final status. Letting the abandoned write land on top of that would replace a finished record with a stale one. An error you can catch is worth having when the cost of the timeout is a rejected call; it isn't when the cost is the stored record.

Set to `Infinity` to disable.

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

A version-checked write to a store scope exhausted its CAS retry budget, because contention exceeded what optimistic concurrency can absorb at that boundary. Options:

- Widen the retry budget on the persist call site.
- Rewrite the contended write as a single-field increment or an append if the update allows it. Where the store offers the matching operation, a counter bumped with `incState({ n: 1 })` never conflicts; the same counter bumped with `atomicState` does. Where it doesn't ([the store has to offer the operation](#the-store-has-to-offer-the-operation)), the increment still never raises, but it becomes one version-checked attempt that can lose the race and resolve `false`.
- Move the contended writes to a scope with no store (sequencer state on a parent block) so they go through the lock instead.
- Restructure the contention pattern — fewer concurrent writers, batched updates, or finer-grained scopes.

**Why don't scopes with no store retry on conflict?**

There's no conflict to retry. The lock serializes mutators inside this process; each one reads the current state at the moment its turn arrives. Two mutators racing to increment `count` both see the post-commit value of the previous one, so both increments land — no retries needed.

Request scope holds the same lock, so that answer looks like it should carry over. It doesn't: the version check stays underneath the lock, a writer the queue cannot order can still conflict, and the retry re-runs your updater. See [Request scope serializes, then persists](#request-scope-serializes-then-persists).

**Can I add my own retry budget to in-memory mutators?**

You don't need one. The lock guarantees in-order, conflict-free serialization. If your mutator throws for some other reason, that error surfaces as-is to the caller; it's not a "transient" failure that retrying would fix.

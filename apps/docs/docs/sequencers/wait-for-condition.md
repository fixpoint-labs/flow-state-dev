---
sidebar_position: 4
sidebar_label: waitForCondition
---

# waitForCondition

Suspend a sequencer until something happens in the request's item stream — a resource gets written, a task changes status, a sibling pattern emits a particular event. Cheaper than polling and event-driven by construction.

## What it does

`.waitForCondition(predicate, { timeoutMs })` pauses the sequencer between steps. The predicate is a synchronous function over the request's items array. The runtime evaluates it once on entry and again every time an item is added, updated, or completed, until the predicate returns true or the timeout fires.

When it settles, the step yields `{ timedOut: boolean }`. It does not throw on timeout — the next step decides what to do.

The block subscribes to the request emitter while it waits and unsubscribes on exit (satisfaction, timeout, or parent abort). No timers run when the predicate is already true on entry.

## Signature

```ts
sequencer.waitForCondition(
  predicate: (items: readonly OutputItem[]) => boolean,
  options: { timeoutMs: number }
): SequencerDefinition<TInput, { timedOut: boolean }>
```

## Examples

### Wait for a resource write

```ts
import { whenResourceChanged } from "@flow-state-dev/core/items";

pipeline
  .work(writerBlock)
  .waitForCondition(
    whenResourceChanged({ scope: "session", path: "artifacts/spec.md" }),
    { timeoutMs: 30_000 }
  )
  .then(readerBlock);
```

The reader runs after the writer has flushed its artifact, without the reader having to know how the writer got scheduled.

### Wait for any task-change item

```ts
import { whenAnyItem } from "@flow-state-dev/core/items";

pipeline.waitForCondition(
  whenAnyItem(
    (item) => item.type === "component" && item.componentType === "task-change"
  ),
  { timeoutMs: 5_000 }
);
```

Useful when you only need a wake signal, not a specific predicate over collection state.

### Glob over resource paths

```ts
import { whenResourceMatching } from "@flow-state-dev/core/items";

pipeline.waitForCondition(
  whenResourceMatching({ scope: "session", pattern: "artifacts/*" }),
  { timeoutMs: 10_000 }
);
```

`*` matches a single path segment, `**` matches any number. No other metacharacters.

### Branch on timeout

```ts
pipeline
  .waitForCondition(predicate, { timeoutMs: 1_000 })
  .thenIf(
    ({ timedOut }) => timedOut,
    () => undefined,
    timeoutFallback
  );
```

Timeout is a normal output, not an exception. Either branch.

## Helpers

Three helpers ship in `@flow-state-dev/core/items`. They're total, allocation-free on the hot path, and don't throw on malformed items.

- `whenResourceChanged({ scope, path, changeType? })` — exact path match against `resource_change` items. Optional `changeType` further narrows by `"created" | "updated" | "deleted"`.
- `whenResourceMatching({ scope, pattern })` — same as above but the path is a tiny glob (`*`, `**`).
- `whenAnyItem(predicate)` — generic escape hatch. Returns true if any item satisfies your closure.

## Custom predicates

If the helpers don't fit, write your own. Constraints:

- Synchronous. No `async` and no awaits.
- Pure over `readonly OutputItem[]`. Do not mutate items.
- Cheap. The predicate runs on entry and on every item event for the lifetime of the wait — if the request emits a thousand items, your predicate runs a thousand times.
- Truthy means "wake up", not "exit successfully". The step still yields `{ timedOut: false }` and the next step decides what to do.

A common pattern is closing over an external read source — say, a collection ref — and consulting that source from inside the predicate. The items array is the wake signal; the source of truth lives elsewhere.

```ts
function whenCollectionDrained(collection: CollectionRef) {
  return () => collection.count() === 0;
}

pipeline.waitForCondition(whenCollectionDrained(myCollection), {
  timeoutMs: 60_000,
});
```

If the predicate throws, the wait aborts and the error propagates out of the step. Don't throw on bad items — return false.

## Lifecycle

- **Subscribe** happens only if the entry-time check returns false. Already-satisfied predicates skip the wait entirely.
- **Re-evaluation** runs on every `item.added`, `item.updated`, and `item.done` fan-out.
- **Unsubscribe** is automatic on satisfy, timeout, or parent abort.
- **Parent abort** (request cancellation, outer sequencer aborting) cancels the wait and propagates the abort.

## Limitations

- Predicates are synchronous. Use a regular `.then(handler)` step if you need async checks.
- No backpressure. Every item event re-evaluates the predicate; a chatty request multiplies the work. Keep predicates cheap.
- The wait is request-scoped. Cross-request coordination needs a different primitive (a resource collection, a polling handler).
- Items are append-only for the lifetime of the request, so a predicate that returned true on entry will keep returning true — that's fine for the initial check, but watch out if your predicate depends on something outside the items array (it may flip back and forth on subsequent reads).

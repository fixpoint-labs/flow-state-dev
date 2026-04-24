---
sidebar_position: 9
---

# Drain Pool

The Drain Pool pattern is concurrent streaming dispatch over a dynamic queue. N workers continuously pull items from a shared queue, process them, and loop until the queue is empty and all workers are idle. Workers can enqueue follow-up items mid-drain. The parent sequencer waits for the full drain before moving on.

Use it when:

- You have a dynamic work queue that handlers add to as they run.
- You want bounded concurrency — exactly N workers, not `N^depth`.
- The queue needs to survive request interruption (durable via session resources).
- The parent must wait for the drain to complete.

If the work is a static array and you don't need mid-run enqueue, use `.forEach({ maxConcurrency })` directly on a sequencer. If you need serial dispatch with mid-run enqueue in ephemeral state, use [Event Queue](./utility-blocks). If you want fire-and-forget fan-out that doesn't wait, use `.forEachBackground()`.

## How it compares

| Pattern | Input | Concurrency | Mid-run enqueue | Parent waits? | Storage |
| --- | --- | --- | --- | --- | --- |
| `.forEach()` | static array | `maxConcurrency` | no | yes | n/a |
| `.forEachBackground()` | static array | `concurrency` | no | **no** (fire-and-forget) | n/a |
| `eventQueue` | dynamic queue | 1 (serial) | yes | yes | sequencer state (ephemeral) |
| `drainPool` | **dynamic queue** | **N workers** | **yes** | **yes** | **session resource (durable)** |

## Block composition

```
initialItems
  → seedPool (write to collection, init pool state)
  → .forEach(N workers, maxConcurrency: N)
      worker loop:
        → leaseNext (CAS-flip oldest pending → leased on pool state)
        → thenIf(leased) {
            → user block (may .tap(enqueue(...)))
            → markDone (on success or rescue-on-error)
          }
        → checkPool (read pool projection → shouldContinue)
        → loopBack while shouldContinue
```

The pool sequencer's state is the authoritative lifecycle record: a per-item map arbitrated through `atomicState`, which is CAS-protected at the store layer. The session-resource collection mirrors the state for durability and client-side observability.

## Basic usage

```ts
import { drainPool } from "@flow-state-dev/patterns/drain-pool";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";

const jobSchema = z.object({ id: z.string(), payload: z.string() });

const jobRunner = handler({
  name: "run-job",
  inputSchema: jobSchema,
  outputSchema: z.any(),
  execute: async (job) => {
    await doWork(job);
    return null;
  },
});

const pool = drainPool<z.infer<typeof jobSchema>>({
  name: "jobs",
  item: jobSchema,
  concurrency: 8,
  initialItems: [
    { id: "a", payload: "first" },
    { id: "b", payload: "second" },
  ],
  block: jobRunner,
});

const flow = defineFlow({
  kind: "worker-flow",
  actions: {
    run: {
      inputSchema: z.any(),
      block: pool.block,
    },
  },
  // The queue collection is auto-installed via block-level sessionResources,
  // but you can register explicitly for flow-level visibility.
  session: {
    resources: { [pool.queueKey]: pool.queue },
  },
});
```

## Mid-drain enqueue

Workers can append follow-up items by tapping the `enqueue` helper into the body. Use the factory form of `block` so the helper is available before the pool handle exists:

```ts
import { drainPool } from "@flow-state-dev/patterns/drain-pool";
import { sequencer, handler } from "@flow-state-dev/core";

const pool = drainPool({
  name: "crawl",
  item: linkSchema,
  concurrency: 4,
  initialItems: [seedLink],
  block: ({ enqueue }) =>
    sequencer({ name: "crawl-body" })
      .then(fetchPage)
      .tap(
        enqueue((page, ctx) =>
          extractLinks(page).filter(isNew),
        ),
      ),
});
```

The `enqueue` helper is **only safe inside a worker body** — calling it from a sibling tap that runs concurrently with workers risks silent item loss. If an enqueue commits after all workers have seen `shouldContinue: false`, the new items sit pending forever and the drainPool exits.

Enqueue-from-worker-body is safe because the worker's own `inFlight` count keeps the termination invariant from firing until after the enqueue and `markDone` both commit.

## Termination invariant

A worker exits only when both `queuePending === 0` and `inFlight === 0` — i.e. no work is waiting and no sibling is holding a lease whose `markDone` could still enqueue a follow-up.

A worker that fails to lease on the current iteration (e.g. queue is temporarily empty) will loop back to `leaseNext` rather than exit, as long as sibling workers are in-flight. This keeps a drain alive through transient empty windows.

## Error handling

`onError: "skip"` (default) isolates failures. A worker that throws records the error on the item and moves on; siblings continue. If `maxAttempts > 1`, the failed item transitions back to `pending` and is eligible for any worker's next lease. On exhaustion, the item lands with `status: "failed"` and `lastError` populated.

`onError: "fail"` propagates: the worker's Promise rejects, `.forEach`'s `Promise.all` rejects, and the pool fails the parent sequencer. In-flight sibling workers complete normally (JS has no cancellation); their writes may land after the parent has already failed, which is acceptable given the durability model.

## At-least-once semantics

Drain Pool is **at-least-once**. A worker can:

1. Lease item X.
2. Execute side effects (external API call, email send, DB write).
3. Crash before `markDone` commits.
4. After `leaseDurationMs`, another worker reclaims the lease and re-runs the item.

Side effects run more than once. Non-idempotent side effects must be deduped by the caller. Use `item.id` (a uuid v4 by default) as the idempotency key:

```ts
const body = handler({
  inputSchema: jobSchema,
  outputSchema: z.any(),
  sessionResources: { idempotency: idempotencyCollection },
  execute: async (job, ctx) => {
    const seen = ctx.session.resources.idempotency.getOptional(job.id);
    if (seen !== undefined) return seen.state.result;

    const result = await doSideEffectfulWork(job);
    await ctx.session.resources.idempotency.create(job.id, { result });
    return result;
  },
});
```

Exactly-once is explicitly out of scope. That's a different abstraction (two-phase commit or transactional outbox) and would require framework-level primitives that don't exist yet.

## Durability

The queue is a session resource collection. Durability follows the session store adapter:

- **In-memory store** — ephemeral. Queue lost on process restart. Fine for local dev and test.
- **Filesystem store** — survives restart. On retry via FIX-294's request heartbeat, the new execution re-enters the drainPool, sees the populated collection, and resumes. Items that were `leased` under the previous (dead) request are reset to `pending` on re-entry; their new workers pick them up.
- **Postgres / other durable stores** — single-process durable. Multi-process concurrent workers are out of scope for Phase 1 (requires an adapter-level atomic primitive like `SELECT FOR UPDATE SKIP LOCKED`).

Mid-block checkpoint resume is FIX-141 territory; drainPool composes with it cleanly when it lands but does not depend on it.

## Config reference

```ts
drainPool<TItem>({
  /** Unique pool name per session. Used as sequencer name, collection key,
   *  and prefix on internal block names. */
  name: string;

  /** Zod schema for queue item payloads. */
  item: ZodType<TItem>;

  /** Number of parallel workers. Default: 4. */
  concurrency?: number;

  /** Payloads seeded into the queue at start. Default: []. */
  initialItems?: readonly TItem[];

  /** Worker block, or factory receiving `{ enqueue }`. */
  block:
    | BlockDefinition
    | ((helpers: { enqueue: EnqueueFactory }) => BlockDefinition);

  /** Failure policy. Default: "skip". */
  onError?: "skip" | "fail";

  /** Max attempts per item. Default: 1. */
  maxAttempts?: number;

  /** Lease duration in ms. Default: 30_000. Tune up for long-running bodies:
   *  rule of thumb is >= 6× p99 processing time. */
  leaseDurationMs?: number;

  /** Per-worker loopBack cap. Default: 10_000. */
  maxIterations?: number;

  /** Devtool container hint. Default: `{ component: "drain-pool" }`. */
  container?: ContainerConfig;
}): {
  block: SequencerDefinition;          // plug into a parent sequencer or flow
  queue: DefinedResourceCollection;    // register on defineFlow (optional — auto-installed)
  queueKey: string;                    // resource key
  enqueue: (items) => BlockDefinition; // factory for mid-drain enqueue
};
```

## See also

- [Event Queue](./utility-blocks) — serial dispatch with mid-run enqueue, ephemeral state.
- [Reactive Blackboard](./reactive-blackboard) — stigmergic fan-out; refactored on top of drainPool for bounded aggregate concurrency.
- `.forEachBackground()` — fire-and-forget fan-out; no result coordination, no re-enqueue.

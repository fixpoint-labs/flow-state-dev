---
sidebar_label: "Durable Execution"
---

# Durable execution

Long-running flows have two failure modes worth planning for. The first is crashes: a server restart, a serverless timeout, or an unexpected exception kills the process mid-run. Without recovery, the user gets nothing back. The second is deliberate pauses: a step waits for a human decision that takes minutes or hours, not milliseconds.

Durable execution is the machinery underneath both. The runtime checkpoints sequencer state at every step boundary and stores a suspension record when a block pauses for external input. A resume re-invokes the original action, restores state from the checkpoint, skips already-completed steps, and runs the remaining work — for a crash, continuing where the process died; for a pause, returning the human's decision into the step that waited.

This page covers the durability side: configuring a provider, how resume restores state, the stores, and retention. The human-pause side — `ctx.suspend()`, approval gates, and gating an agent's tool calls — is covered in [Human-in-the-loop](../human-in-the-loop/overview.md), which builds on everything here.

The tradeoff: durability requires a store capable of persistence (not just in-memory), and a `DurabilityProvider` wired into the runtime. Neither is free, and for short-lived flows without pauses the overhead isn't worth it. Opt out with `durable: false` on a sequencer when you don't need it.

## Enabling durability

Sequencers default to `durable: true`. Checkpoints write automatically at every step boundary as long as a `DurabilityProvider` is configured on the runtime. Without a provider, checkpoint writes are skipped silently and `ctx.suspend()` is unavailable.

Wire a provider at startup:

```ts
import { createFlowState, inMemoryStores, createCheckpointDurabilityProvider } from "@flow-state-dev/server";

const stores = inMemoryStores();

export const flowstate = createFlowState({
  flows: { contentReview },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: stores } },
  durabilityProvider: createCheckpointDurabilityProvider(stores),
});
```

`createCheckpointDurabilityProvider` is the standard factory. It delegates to the same store adapters the rest of the runtime uses (`checkpoints`, `suspensions`, `leases`). If you're using filesystem, SQLite, or Postgres stores, the suspension and lease tables are created alongside the other tables.

To opt a specific sequencer out of checkpointing:

```ts
sequencer({ name: "fanout", durable: false })
  .step(fetchA)
  .step(fetchB)
```

Ephemeral sequencers that run inside patterns like `parallelTasks` are good candidates for `durable: false`. The outer sequencer that coordinates them can still be durable.

## Pausing for a human

Durable execution is what lets a flow pause for a human and resume cleanly. A block calls `ctx.suspend()`, the request goes to `"suspended"` status, the SSE stream closes, and a resume endpoint continues the run once a decision arrives. Agents get the same thing at the granularity of individual tool calls through tool approval.

That whole surface — `ctx.suspend()`, `SuspendOptions`, the resume endpoint, the error model, and the DevTool Suspensions tab — lives in [Human-in-the-loop](../human-in-the-loop/overview.md). Gating an agent's tool calls is in [Tool approval](../human-in-the-loop/tool-approval.md). Both require the `DurabilityProvider` configured above.

## Skip-and-inject: how resume works under the hood

Whether a run resumes after a crash or after a human responds, the mechanism is the same. The resume dispatch creates a new request with a `resumeOf` reference pointing at the original. When `runAction` initializes, it loads the suspension record (for a pause) or the latest checkpoint (for a crash) and restores the sequencer state from it. Steps before the resume point are skipped using their cached outputs. Execution continues from there — for a pause, the suspended step re-runs and `ctx.suspend()` returns the resume data instead of throwing; for an agent, the model call that produced the gated tool calls is never replayed.

The new request has its own `requestId` and generates its own SSE stream. Because completed steps are injected from their cached outputs rather than re-executed, resume does not re-run side effects that already happened — pair this with [`ctx.runOnce`](./idempotency.md) for the step that was mid-flight when a crash hit.

## DurabilityProvider interface

`DurabilityProvider` is the coordination layer between the checkpoint infrastructure and the resume runtime. The interface has eight methods:

```ts
interface DurabilityProvider {
  saveCheckpoint(checkpoint: SequencerCheckpoint): Promise<void>;
  loadCheckpoint(requestId: string, blockInstanceId: string): Promise<SequencerCheckpoint | null>;

  suspend(record: SuspensionRecord): Promise<void>;
  loadSuspension(requestId: string, suspensionId: string): Promise<SuspensionRecord | null>;
  listSuspended(filter?: SuspensionFilter): Promise<SuspensionRecord[]>;

  acquireLease(requestId: string, options: LeaseOptions): Promise<Lease | null>;
  releaseLease(requestId: string, leaseId: string): Promise<void>;

  cleanup(requestId: string): Promise<void>;
}
```

`createCheckpointDurabilityProvider` is the standard implementation. It wires these methods to the `checkpoints`, `suspensions`, and `leases` stores from your `StoreRegistry`. The business logic — when to checkpoint, when to suspend, when to skip — lives in the sequencer and `runAction`, not in the provider.

If you need to intercept or extend durability behavior (say, to fan out suspension notifications to an external queue), implement your own `DurabilityProvider` and delegate to a `createCheckpointDurabilityProvider` instance for the store writes.

`listSuspended` accepts an optional filter with `flowKind`, `userId`, `sessionId`, `status`, and `limit` fields. It's useful for building approval queue UIs.

## Store adapters

The standard store adapters all implement the durability tables:

| Adapter | Package | Notes |
|---|---|---|
| In-memory | `@flow-state-dev/server` (`inMemoryStores()`) | Default. State is lost on process restart — suitable for development and testing |
| Filesystem | `@flow-state-dev/server` (`filesystemStores({ rootDir })`) | Persists to JSON files. Survives restarts, not suitable for multi-instance deployments |
| SQLite | `@flow-state-dev/store-sqlite` | Single-file database. Good for single-server deployments |
| Postgres | `@flow-state-dev/store-postgres` | Full persistence with concurrent read/write support |

For production use with crash recovery as a goal, you want SQLite at minimum and Postgres when running multiple instances or on a platform that doesn't guarantee local disk persistence.

## Retention and cleanup

Durability writes three kinds of records: checkpoints (sequencer state at step boundaries), suspension records (one per `ctx.suspend()` call), and leases (held briefly during a resume). On a host that runs for weeks, these accumulate. A completed run's checkpoints are dead weight, a resolved approval is only worth keeping for a while, and a process that crashes before it finishes leaves records that nothing comes back to clean up.

Retention is opt-in. Pass a `durabilityRetention` config alongside your provider and the runtime starts a sweeper: a periodic in-process job that runs on a fixed interval and reclaims records that are provably safe to drop.

```ts
export const flowstate = createFlowState({
  flows: { contentReview },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: stores } },
  durabilityProvider: createCheckpointDurabilityProvider(stores),
  durabilityRetention: {
    sweepIntervalMs: 600_000,                 // sweep every 10 minutes
    checkpointMaxAgeMs: 86_400_000,           // backstop: drop terminal-run checkpoints after 24h
    suspensionTerminalMaxAgeMs: 604_800_000,  // keep resolved suspensions 7 days, then prune
    orphanCheckpointThresholdMs: 86_400_000,  // an interrupted run is "abandoned" after 24h
    batchLimit: 1000,                         // max records deleted per store per tick
  },
});
```

Every field has a default, so `durabilityRetention: {}` is enough to turn the sweeper on with the values above. Omitting `durabilityRetention` entirely leaves records in place — nothing is deleted without you asking for it.

What each tick does:

- **Enforces suspension expiry.** A `pending` suspension whose `expiresAt` has passed is flipped to `expired`, so the resume endpoint rejects a stale approval gate instead of letting it hang forever.
- **Prunes resolved suspensions** older than `suspensionTerminalMaxAgeMs` (measured from when they were resolved). The window exists so you can still inspect recent approval decisions; after it, they're removed.
- **Prunes expired leases.**
- **Prunes orphaned checkpoints.** Checkpoints of completed, failed, or aborted runs are dropped once they pass `checkpointMaxAgeMs`. An interrupted run keeps its checkpoints until `orphanCheckpointThresholdMs` passes, since you might still resume it.

The one invariant worth internalizing: **checkpoints of an in-progress or suspended run are never pruned by age.** Those are exactly the state a crashed or paused run needs to continue, so the sweeper leaves them alone no matter how old they get. A flow parked on a slow human-approval gate for a week is safe.

When you run multiple hosts against a shared store, the sweeper takes a single lease each tick so only one host sweeps at a time. Deletes are idempotent regardless, so the lease is an efficiency measure, not a correctness one.

## See also

- [Human-in-the-loop](../human-in-the-loop/overview.md) — `ctx.suspend()`, approval gates, and the resume endpoint that build on this machinery
- [Tool approval](../human-in-the-loop/tool-approval.md) — gating an agent's tool calls
- [Idempotency and `runOnce`](./idempotency.md) — for making handlers safe to re-run on retry, which complements crash recovery
- [Error handling](./error-handling.md) — for rescue handlers and structured error flow

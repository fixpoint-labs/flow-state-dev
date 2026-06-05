---
sidebar_label: "Durable Execution"
---

# Durable execution

Long-running flows have two failure modes worth planning for. The first is crashes: a server restart, a serverless timeout, or an unexpected exception kills the process mid-run. Without recovery, the user gets nothing back. The second is approval gates: a step needs a human decision before continuing, but a human can't respond in milliseconds. Without a way to pause and resume, you end up polling, blocking a thread, or bolting on a side-channel notification system.

Durable execution addresses both. The runtime checkpoints sequencer state at every step boundary and stores suspension records when a block explicitly pauses for external input. A resume endpoint re-invokes the original action, restores state from the checkpoint, skips already-completed steps, and runs the suspended step again — this time returning the resume data instead of suspending.

The tradeoff: durability requires a store capable of persistence (not just in-memory), and it requires a `DurabilityProvider` wired into the runtime. Neither is free, and for short-lived flows without approval gates the overhead isn't worth it. Opt out with `durable: false` on a sequencer when you don't need it.

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

## Human-in-the-loop with ctx.suspend()

`ctx.suspend()` pauses execution at the current step and waits for an external actor to resolve the suspension. It's how you implement approval gates, human review steps, and anything else that requires an out-of-band decision.

```ts
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const reviewStep = handler({
  name: "reviewStep",
  inputSchema: z.object({ content: z.string() }),
  outputSchema: z.object({ approved: z.boolean(), feedback: z.nullable(z.string()) }),
  execute: async (input, ctx) => {
    const decision = await ctx.suspend!({
      reason: "human_approval",
      message: `Review content: "${input.content.slice(0, 50)}..."`,
      resumeSchema: {
        type: "object",
        properties: {
          approved: { type: "boolean" },
          feedback: { type: "string" }
        },
        required: ["approved"]
      }
    });
    return decision as { approved: boolean; feedback: string | null };
  }
});

const publishStep = handler({
  name: "publishStep",
  inputSchema: z.object({ approved: z.boolean(), feedback: z.nullable(z.string()) }),
  outputSchema: z.string(),
  execute: async (input) => {
    if (!input.approved) return "Publication rejected";
    return "Content published successfully";
  }
});

const flow = defineFlow({
  kind: "content-review",
  actions: {
    submit: {
      block: sequencer({ name: "reviewPipeline", durable: true })
        .step(reviewStep)
        .step(publishStep),
      inputSchema: z.object({ content: z.string() })
    }
  }
});
```

### What happens when a step suspends

When `ctx.suspend()` is called, the sequencer catches the resulting `SuspensionError` at the step boundary, persists a `SuspensionRecord` to the durability store, and transitions the request to `"suspended"` status. A `SuspensionItem` is emitted to the SSE stream before it closes. Clients receive the suspension metadata — `suspensionId`, `reason`, `message`, and optionally a `render` hint for building a UI — and can use it to display an approval interface.

The original SSE connection closes cleanly. Nothing blocks a thread.

### SuspendOptions

| Field | Type | Description |
|---|---|---|
| `reason` | `"human_approval" \| "human_input" \| "external_event" \| string` | Machine-readable category for the suspension |
| `message` | `string` | Human-readable description, emitted in the `SuspensionItem` |
| `data` | `Record<string, unknown>` | Arbitrary metadata attached to the suspension record |
| `resumeSchema` | `Record<string, unknown>` | JSON Schema describing the expected resume payload shape |
| `timeoutMs` | `number` | Optional expiry. After this duration the suspension transitions to `timed_out`. |
| `render` | `{ component: string; props?: Record<string, unknown> }` | Hint for client-side rendering of the approval UI |

## Resuming a suspended request

The resume endpoint accepts a decision on a suspended request and re-dispatches the original action:

```
POST /:flowKind/requests/:requestId/resume
```

Request body:

```json
{
  "suspensionId": "susp_abc123",
  "action": "approve",
  "data": { "approved": true, "feedback": null },
  "resumedBy": "user_xyz"
}
```

`action` must be `"approve"` or `"reject"`. `data` carries the payload that `ctx.suspend()` will return on the resumed step. `resumedBy` is optional — it's stored on the suspension record for audit purposes.

The endpoint acquires an exclusive lease before re-dispatching, so concurrent resume attempts on the same request get a `409` rather than a double execution.

On success the endpoint returns `202` with the new `requestId`. If the caller includes `Accept: text/event-stream`, the response streams the resumed execution directly.

### Skip-and-inject: how resume works under the hood

The resume dispatch creates a new request with a `resumeOf` reference pointing at the original. When `runAction` initializes, it loads the suspension record and the checkpoint saved at the suspension point. The sequencer state is restored from that checkpoint. Steps before the suspension step are skipped using their cached outputs. The suspension step re-runs — but this time `ctx.suspend()` sees a `ResumeContext` and returns `resumeData` instead of throwing.

Execution continues normally from there. The new request has its own `requestId` and generates its own SSE stream.

## Error handling

Three errors are relevant to durable execution:

**`SuspensionError`** — Thrown by `ctx.suspend()` as a control-flow signal. The sequencer catches it; rescue handlers do not. You cannot catch this yourself. It is not a block failure.

**`SuspensionRejectedError`** — Thrown when the suspension is resolved with `action: "reject"`. This one is catchable in a rescue handler:

```ts
import { SuspensionRejectedError } from "@flow-state-dev/core";

const reviewSequencer = sequencer({ name: "review", durable: true })
  .step(reviewStep)
  .step(publishStep)
  .rescue([
    {
      when: [SuspensionRejectedError],
      block: notifyRejected
    }
  ]);
```

**`SuspensionTimeoutError`** — Thrown when a suspension with `timeoutMs` expires before it is resolved. Also catchable in rescue.

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

## See also

- [Idempotency and `runOnce`](./idempotency.md) — for making handlers safe to re-run on retry, which complements crash recovery
- [Error handling](./error-handling.md) — for rescue handlers and structured error flow

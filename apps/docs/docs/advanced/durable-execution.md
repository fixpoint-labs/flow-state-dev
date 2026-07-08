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
import { createFlowState, inMemoryStores, createCheckpointDurabilityProvider } from "@flow-state-dev/engine";

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

On the React side, `useSuspensions(session)` derives pending and resolved suspensions from the item stream and exposes `approve` and `reject` callbacks that stream the resumed continuation back into `session.items` — so the resolution renders live, no refresh. `<ApprovalRenderer>` is the built-in inline card. For a full server-to-UI walkthrough, see the [Human-in-the-Loop guide](/guides/human-in-the-loop); for the hook and renderer reference, see [Suspensions and approvals](/docs/client/react#suspensions-and-approvals).

### SuspendOptions

| Field | Type | Description |
|---|---|---|
| `reason` | `"human_approval" \| "human_input" \| "external_event" \| string` | Machine-readable category for the suspension |
| `message` | `string` | Human-readable description, emitted in the `SuspensionItem` |
| `data` | `Record<string, unknown>` | Arbitrary metadata attached to the suspension record |
| `resumeSchema` | `Record<string, unknown>` | JSON Schema describing the expected resume payload shape |
| `timeoutMs` | `number` | Optional expiry. After this duration the suspension transitions to `timed_out`. |
| `render` | `{ component: string; props?: Record<string, unknown> }` | Hint for client-side rendering of the approval UI |
| `allow` | `ResumeAction[]` | Which resolution actions this suspension permits. Omit to take the reason-based default: `human_input` → `["submit"]`; everything else (including `human_approval`) → `["approve", "reject"]`. Add `"skip"` to make the step optional. The resume route returns `409` for an action outside this set. |

## Resuming a suspended request

The resume endpoint accepts a decision on a suspended request and continues it:

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

`action` is one of `"approve" | "reject" | "submit" | "skip"`, and must be in the suspension's `allow` set (a `409` otherwise). `submit` carries a typed payload in `data` (a question answer, a form, a selection); `skip` declines an optional step and carries no payload; `approve` / `reject` are the binary outcomes. `data` is the payload that `ctx.suspend()` returns on the resumed step. `resumedBy` is optional — it's stored on the suspension record for audit purposes.

When the inbound action is `submit` (or `approve` with a schema present), the server validates `data` against the suspension's stored `resumeSchema` before any state transition. An invalid payload returns `400` with path-keyed `validationErrors` and the suspension stays pending.

Resume continues the **same** request id. There is no new linked request. The record's status walks `suspended → in_progress → terminal` as the continuation runs (and `interrupted → in_progress → terminal` on crash recovery). A `GET` on the request returns the whole pause-and-continue history on one record, not two records joined by a reference.

The endpoint acquires an exclusive lease before re-dispatching, so concurrent resume attempts on the same request get a `409` rather than a double execution.

On success the endpoint returns `202` with the same `requestId`. If the caller includes `Accept: text/event-stream`, the response streams the continued execution directly.

A deliberate "start over from scratch" is a separate operation. RETRY mode runs the action again under a new request id. Resume is for picking up where a pause left off; retry is for discarding the prior attempt.

### Skip-and-inject: how resume works under the hood

The resume dispatch re-invokes the action on the original request. `runAction` loads the suspension record, the checkpoint saved at the suspension point, and the request's item log. Sequencer state is restored from the checkpoint. Blocks that already finished are skipped — the runtime injects each one's recorded output from the item log instead of re-executing. The suspending block re-runs, and this time `ctx.suspend()` returns `resumeData` instead of throwing.

Execution continues from there on the same request id and the same SSE stream. See [Continuous item log across resume](#continuous-item-log-across-resume) for what the log looks like across the cycle, and [Block memoization on resume](#block-memoization-on-resume) for the rules on side effects.

## Continuous item log across resume

The item log is not reset on resume. It is appended across the pause. One full cycle leaves a single ordered log on one request:

1. Items produced before the suspension.
2. The `suspension` item emitted when the block paused.
3. A `suspension_resume` item recording the continuation (an audit row — who resolved it, how, and the resume payload).
4. Items produced after the block resumed.

Sequence numbers stay monotonic across the whole thing. An item-log sequence for one approve cycle:

```jsonc
{ "seq": 1, "type": "message",           "text": "Drafted the summary." }
{ "seq": 2, "type": "suspension",        "suspensionId": "susp_abc123", "reason": "human_approval" }
// --- request pauses here, SSE stream closes, status = "suspended" ---
// --- resume endpoint called; status walks suspended → in_progress ---
{ "seq": 3, "type": "suspension_resume", "suspensionId": "susp_abc123", "resolution": "approved", "resolvedBy": "user_xyz" }
{ "seq": 4, "type": "message",           "text": "Published." }
```

Because the log continues by sequence number, the SSE stream continues by cursor too. A client that was at sequence N when the request suspended reconnects with `Last-Event-ID: N` (or `?starting_after=N`) once the request is back `in_progress` and receives sequence N+1 onward. No replay of the pre-suspension items is needed.

## Block memoization on resume

Skipping completed blocks is *memoization*: the runtime injects each finished block's recorded output from the item log rather than running it again. The suspending block itself re-runs.

The consequence to plan for: a side effect that isn't captured in a block's output fires again when that block re-executes. The suspending block is the one that re-executes on resume, so its side effects are the ones to guard. Wrap them in `ctx.runOnce(key, fn)`, and for exactly-once across process crashes pair that with provider-key idempotency.

See [Block memoization and replay](./block-memoization-and-replay.md) for the full side-effect rules, the `runOnce` guarantees and their limits, and control-flow determinism.

## Multiple suspend/resume cycles

A request can suspend and resume more than once. Each cycle appends to the same log: another `suspension` item, another `suspension_resume` item, and the post-resume items, all under the same request id with continuous sequence numbers. The audit of every pause lives on the item log as the `suspension` / `suspension_resume` pairs, in order, so the full decision trail for a multi-gate flow reads top to bottom on one record.

This holds across a process restart, not just an in-process pause. A continuation replays the request from the top of the action, so resuming a *later* gate re-reaches the earlier ones. Those earlier gates were already resolved on the durable log, so they replay their recorded resolutions in order instead of pausing again, and the request runs through to completion. A flow with two sequential `ctx.suspend()` gates resumed at the second gate after the server restarted completes the same as it would in one process.

## What `ctx.suspend()` returns

On resume, `ctx.suspend()` returns the resolver's payload (`data`) for `approve` and `submit`. The two non-payload outcomes are different:

- `reject` throws `SuspensionRejectedError` (see below), aborting the step unless a rescue handler catches it.
- `skip` returns the `SUSPENSION_SKIPPED` sentinel, importable from `@flow-state-dev/core`. A skip is normal control flow, so the author branches on it rather than catching an error:

```ts
import { SUSPENSION_SKIPPED } from "@flow-state-dev/core";

const answer = await ctx.suspend!({
  reason: "human_input",
  message: "Add a reviewer note? (optional)",
  resumeSchema: z.object({ note: z.string() }),
  allow: ["submit", "skip"],
});

if (answer === SUSPENSION_SKIPPED) {
  // proceed with a default
}
```

The sentinel never crosses the wire — only the string `resolution: "skipped"` is persisted, and the symbol is reconstructed on both the live continuation and the replay path.

### Resolution statuses

A suspension's resolved status is one of `approved`, `rejected`, `submitted`, `skipped`, `timed_out`, or `expired` (`pending` is the sole non-resolved state). The resume action maps to the status one-to-one: `submit` → `submitted`, `skip` → `skipped`. The matching `suspension_resume` audit item carries the status in its `resolution` field.

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
| In-memory | `@flow-state-dev/engine` (`inMemoryStores()`) | Default. State is lost on process restart — suitable for development and testing |
| Filesystem | `@flow-state-dev/engine` (`filesystemStores({ rootDir })`) | Persists to JSON files. Survives restarts, not suitable for multi-instance deployments |
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

## Managing suspensions in the DevTool

When a flow suspends for human input, an operator needs to see what's waiting without querying the store by hand. The DevTool has a **Suspensions** tab for this. It lists suspensions for the current session — pending ones at the top, recently resolved and expired ones below — and a detail pane shows each suspension's message, the request it belongs to, and its `resumeSchema` (the shape of the input the flow is waiting for).

From the detail pane you can **approve** or **reject** a pending suspension and supply the resume data. That posts to the same resume endpoint a production client would call, so resolving from the DevTool drives the real flow forward.

The tab reads through the gated debug endpoints, which are disabled by default and loopback-only. It requires a configured `durabilityProvider`; without one, the suspension store is empty and the tab shows nothing to act on.

The same request panel also lists interrupted runs, not just suspensions — a request that stopped abruptly (a crash, a restart, a mid-execution deploy) but is still resumable. See [DevTool — Interrupted runs and crash recovery](/docs/devtool/overview#interrupted-runs-and-crash-recovery) for spotting one and continuing it.

## See also

- [Human-in-the-Loop guide](/guides/human-in-the-loop) — building an approval gate end to end, from `ctx.suspend()` to the React card that resolves it
- [Idempotency and `runOnce`](./idempotency.md) — for making handlers safe to re-run on retry, which complements crash recovery
- [Error handling](./error-handling.md) — for rescue handlers and structured error flow

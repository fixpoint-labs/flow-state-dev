---
sidebar_label: "Durable Execution"
---

# Durable execution

Long-running flows have two failure modes worth planning for. The first is crashes: a server restart, a serverless timeout, or an unexpected exception kills the process mid-run. Without recovery, the user gets nothing back. The second is approval gates: a step needs a human decision before continuing, but a human can't respond in milliseconds. Without a way to pause and resume, you end up polling, blocking a thread, or bolting on a side-channel notification system.

Durable execution addresses both. The runtime checkpoints sequencer state at every step boundary and stores suspension records when a block explicitly pauses for external input. A resume endpoint re-invokes the original action, restores state from the checkpoint, skips already-completed steps, and runs the suspended step again — this time returning the resume data instead of suspending.

Durable execution is on by default wherever your stores persist: filesystem, SQLite and Postgres. It isn't free: every sequencer writes a checkpoint at each step, and a sweeper reads the store on a schedule even when nothing waits. For short-lived sequencers without approval gates, opt out per sequencer with `durable: false`, or for the whole app with `durable: false` on `createFlowState`.

## Enabling durability

There's nothing to enable on stores that persist. An app on SQLite, Postgres or the filesystem store is durable without any setting:

```ts
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";

export const flowstate = createFlowState({
  flows: { contentReview },
  models: { default: "openai/gpt-6-luna" },
  stores: { default: { primary: sqliteStores({ filename: "data/app.db" }) } },
});
```

`createFlowState` builds the checkpoint provider from the active profile's stores (`checkpoints`, `suspensions`, `leases`), so sequencers checkpoint and a request paused by `ctx.suspend()` is held until someone answers it, across a restart. `fsdev dev` and `fsdev run` with no config get the same default over their local SQLite file. See [the CLI reference](/docs/api/cli#when-a-run-waits-for-a-person).

The `durable` option on `createFlowState` is the host setting:

| `durable` | Persisting stores | In-memory stores |
| --- | --- | --- |
| not set | on | off |
| `false` | off | off |
| `true` | on | on |

In-memory stores are off by default because a suspension held there is lost, without a word, when the process ends. Tests that want suspensions held in memory set `durable: true`.

`durable` on a sequencer decides whether that sequencer checkpoints, and has no effect on a host without durable execution. An action doesn't need `durable: true` to suspend: on a durable host, any block can call `ctx.suspend()`.

On a host without durable execution, `ctx.suspend()` throws an error that names the setting to change, and the request fails. Nothing is held.

### Which hosts sweep

The sweeper (see [Retention and cleanup](#retention-and-cleanup)) runs in a process that serves the routes: `fsdev dev`, `fsdev serve`, a self-hosted server, `createFlowApiRouter`. That is what fires a suspension's deadline. A one-shot command such as `fsdev run` sweeps nothing. It leaves the paused request in the store, exits, and leaves the deadline to whichever server runs on the same store next.

### A router you build yourself

The low-level `createFlowApiRouter` and `runAction` are durable only when you give them a provider, through `runtimeConfig.durabilityProvider`. `resolveDurabilityProvider({ stores, durable })` applies the same rule `createFlowState` does:

```ts
import { createFlowApiRouter, resolveDurabilityProvider } from "@flow-state-dev/engine";

const router = createFlowApiRouter({
  registry,
  stores,
  runtimeConfig: { durabilityProvider: resolveDurabilityProvider({ stores }) },
});
```

Given `runtimeConfig`, the router takes its runtime options (the model resolver, tracing level and the rest) from it alone, so put them there too. `createCheckpointDurabilityProvider(stores)` builds the provider directly, whatever the stores.

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
| `title` | `string` | Optional short heading for the suspension, a few words. A UI that lists or heads pending suspensions can show this and put `message` underneath as the body. Leave it out when `message` is already one short line |
| `message` | `string` | Human-readable description, emitted in the `SuspensionItem`. With a `title`, it's the body and may be markdown |
| `data` | `Record<string, unknown>` | Arbitrary metadata attached to the suspension record |
| `resumeSchema` | `Record<string, unknown>` | JSON Schema describing the expected resume payload shape |
| `timeoutMs` | `number` | Optional expiry. Once this duration passes unanswered, the sweeper marks the suspension `expired`. If the suspension allows `reject` (an approval), the request then carries on as if it had been rejected: see [Retention and cleanup](#retention-and-cleanup). |
| `render` | `{ component: string; props?: Record<string, unknown> }` | Hint for client-side rendering of the approval UI |
| `allow` | `ResumeAction[]` | Which resolution actions this suspension permits. Omit to take the reason-based default: `human_input` → `["submit"]`; everything else (including `human_approval`) → `["approve", "reject"]`. Add `"skip"` to make the step optional. The resume route returns `409` for an action outside this set. |

## Resuming a suspended request

The resume endpoint accepts a decision on a suspended request and continues it:

```
POST /api/flows/:flowId/requests/:requestId/resume
```

Request body:

```json
{
  "suspensionId": "susp_abc123",
  "action": "approve",
  "data": { "approved": true, "feedback": null }
}
```

`action` is one of `"approve" | "reject" | "submit" | "skip"`, and must be in the suspension's `allow` set (a `409` otherwise). `submit` carries a typed payload in `data` (a question answer, a form, a selection); `skip` declines an optional step and carries no payload; `approve` / `reject` are the binary outcomes. `data` is the payload that `ctx.suspend()` returns on the resumed step. The suspension record names who resumed it: the signed-in caller, or the request's owner when the app doesn't authenticate. A `resumedBy` in the body is ignored.

When the inbound action is `submit` (or `approve` with a schema present), the server validates `data` against the suspension's stored `resumeSchema` before any state transition. An invalid payload returns `400` with path-keyed `validationErrors` and the suspension stays pending.

Resume continues the **same** request id. There is no new linked request. The record's status walks `suspended → in_progress → terminal` as the continuation runs (and `interrupted → in_progress → terminal` on crash recovery). A `GET` on the request returns the whole pause-and-continue history on one record, not two records joined by a reference.

The endpoint acquires an exclusive lease before re-dispatching, so concurrent resume attempts on the same request get a `409` rather than a double execution.

A resume, a retry or a crash continuation never moves a request to another instance. `:flowId` in the path has to be the id of the instance recorded as the request's owner, whatever the server currently has registered and in whatever order. A path naming another copy of the same definition is refused, and the two surfaces answer differently. Resume returns `404`, the same body as a request that does not exist. Retry and continue return `400` with a flow-mismatch error naming the instance that does own it. Reattaching to a stream reads the same record and is scoped the same way. [Flows](/docs/fundamentals/flows#how-an-instance-is-addressed) covers the addressing model; [Authentication](/docs/server/authentication#addressed-routes-and-what-they-scope-by) covers which resolver governs the re-entry.

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

## Suspending in generators and routers

The examples above pause at a sequencer step, but a pause can also land inside a generator's tool loop or inside a router's chosen branch. The mechanics are the same: `ctx.suspend()` inside a tool's `execute` pauses the whole request, and resume continues on the same request id.

The difference is what gets replayed. A generator rebuilds its model conversation from the durable item log on resume instead of re-calling the model, so prior turns and completed sibling tools are not regenerated; only the suspended tool re-enters. A router re-runs its selector and validates the branch against the decision it recorded on the first pass, so the branch stays stable across the pause.

See [Generator and router suspend/resume](./generator-and-router-suspend-resume.md) for the tool-approval walkthrough, the reconstruction rules, and the v1 limits.

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

A suspension's resolved status is one of `approved`, `rejected`, `submitted`, `skipped`, `timed_out`, `expired`, or `stopped` (`pending` is the sole non-resolved state). The resume action maps to the status one-to-one: `submit` → `submitted`, `skip` → `skipped`. `stopped` comes from no resume action: it means the request was stopped while it waited on the suspension. The matching `suspension_resume` audit item carries the status in its `resolution` field.

## Error handling

Two errors are relevant to durable execution:

**`SuspensionError`** — Thrown by `ctx.suspend()` as a control-flow signal. The sequencer catches it; rescue handlers do not. You cannot catch this yourself. It is not a block failure.

**`SuspensionRejectedError`** — Thrown when the suspension is resolved with `action: "reject"`, or when an approval expired before anyone answered it. In the second case its `expired` field is `true` and its message says the approval is no longer valid. This one is catchable in a rescue handler:

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

**When `timeoutMs` elapses.** What happens to an unanswered gate depends on what it waits for. An approval resolves as a rejection with `expired: true`, so the `SuspensionRejectedError` rescue above catches it, and a gated tool call returns a result saying the approval is no longer valid. Any other gate is marked `expired`, and the resume endpoint refuses it from then on.

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

The standard store adapters all implement the durability tables, and the `wakes` table [the sweeper fires](#retention-and-cleanup):

| Adapter | Package | Notes |
|---|---|---|
| In-memory | `@flow-state-dev/engine` (`inMemoryStores()`) | Default. State is lost on process restart — suitable for development and testing |
| Filesystem | `@flow-state-dev/engine` (`filesystemStores({ rootDir })`) | Persists to a nested file tree (`.md` content, `.json` state). Survives restarts, not suitable for multi-instance deployments |
| SQLite | `@flow-state-dev/store-sqlite` | Single-file database. Good for single-server deployments |
| Postgres | `@flow-state-dev/store-postgres` | Full persistence with concurrent read/write support |

For production use with crash recovery as a goal, you want SQLite at minimum and Postgres when running multiple instances or on a platform that doesn't guarantee local disk persistence.

A suspended run can be stopped as well. `session.abortRequest()` on a request paused at `ctx.suspend()` resolves the gate it waits on and ends the request `aborted`; a later approve for that gate is refused with `409`. The record keeps the gate's status as `stopped`. If the process dies after the stop is recorded and before the request is written `aborted`, the retention sweeper below finishes it.

Aborting a request that is waiting on a task (see [the task board](/docs/orchestration/task-board#waiting-on-a-task)) also cancels that task. A run already started on it keeps going, and its result is discarded.

A run started in the background, dispatched to a separate process with no browser attached, can be cancelled from any process. `session.abortRequest()` stops it within one `heartbeatIntervalMs` tick (10s by default), provided the interval is nonzero. It also needs a request store shared across processes, the same SQLite-or-Postgres requirement as above. See [Connection Resilience — stopping a request that runs on another server](/docs/server/connection-resilience#stopping-a-request-that-runs-on-another-server).

## Retention and cleanup

Durability writes three kinds of records: checkpoints (sequencer state at step boundaries), suspension records (one per `ctx.suspend()` call), and leases (held briefly during a resume). On a host that runs for weeks, these accumulate. A completed run's checkpoints are dead weight, a resolved approval is only worth keeping for a while, and a process that crashes before it finishes leaves records that nothing comes back to clean up.

Retention is opt-in. With durability on, a server runs a sweeper: a periodic in-process job. Pass a `durabilityRetention` config and the sweeper also reclaims records that are safe to drop. It runs on `sweepIntervalMs`, or sooner when a [wake](#wakes) or a suspension's deadline falls due. It reads the deadlines in the store when it starts, so a suspension `fsdev run` left behind expires on time once a server runs. A suspension another process writes while the server runs is seen at the next tick.

```ts
export const flowstate = createFlowState({
  flows: { contentReview },
  models: { default: "openai/gpt-6-luna" },
  stores: { default: { primary: stores } },
  durabilityRetention: {
    sweepIntervalMs: 600_000,                 // sweep every 10 minutes
    checkpointMaxAgeMs: 86_400_000,           // backstop: drop terminal-run checkpoints after 24h
    suspensionTerminalMaxAgeMs: 604_800_000,  // keep resolved suspensions 7 days, then prune
    orphanCheckpointThresholdMs: 86_400_000,  // an interrupted run is "abandoned" after 24h
    batchLimit: 1000,                         // max records deleted per store per tick
  },
});
```

Every field has a default, so `durabilityRetention: {}` is enough to turn pruning on with the values above. Omitting `durabilityRetention` entirely leaves records in place — nothing is deleted without you asking for it. The sweeper still runs every ten minutes, or sooner for a wake: it finishes requests whose answer or stop was recorded but never acted on, and fires due wakes, which resume waits at their deadline.

What each tick does:

- **Enforces suspension expiry.** A `pending` suspension whose `expiresAt` has passed is flipped to `expired`, so the resume endpoint rejects a stale approval instead of letting it hang forever. The request behind an expired approval doesn't stay paused: the sweeper continues it, in the same tick, as if the approval had been rejected. `ctx.suspend()` throws a `SuspensionRejectedError` with `expired: true`. When the approval guarded a tool call, the tool does not run, and the model gets a tool result saying the approval expired and is no longer valid, then carries on with its turn. The `suspension_resume` item records `expired`. A suspension that allows no `reject` (an input form) is only marked `expired`.
- **Finishes what a crash interrupted.** A request still `suspended` (or `interrupted`) behind a gate that was already resolved, because the process died between the gate's write and the request moving on, is driven on with the recorded outcome: an answer continues it, an expired approval continues it as no longer valid, a stop ends it `aborted`. It runs under the request's lease, so it never races a resume in progress.
- **Finishes a wait that died before it parked.** A wait that starts its own work, a [waiting dispatcher](/docs/server/background-work#waiting-for-the-answer) or a worker's [call](/docs/workforce/messaging-workers#calls) (`sendMessage({ to, text, wait: true })`), records that its request owes a park before it starts that work. If the process dies before the request parks and the request is marked `interrupted`, the sweeper continues it, the same continuation a client's continue performs, within about one `staleSweepThresholdMs`. The replay finds the work it already started through its `ctx.runOnce` results, doesn't send it again, and parks on it. A request someone stopped is not continued. One still owing its park 10 minutes after it first owed it is left `interrupted`, for a client to continue as usual. Until then, session history and retention treat it as a request that will run again, like one parked behind a gate.
- **Fires due wakes.** See [Wakes](#wakes) below. A wait's deadline is a wake: past it, the waiting request is resumed with the work as it stands, and nothing is cancelled.
- **Prunes resolved suspensions** older than `suspensionTerminalMaxAgeMs` (measured from when they were resolved). The window exists so you can still inspect recent approval decisions; after it, they're removed.
- **Prunes expired leases.**
- **Prunes orphaned checkpoints.** Checkpoints of completed, failed, or aborted runs are dropped once they pass `checkpointMaxAgeMs`. An interrupted run keeps its checkpoints until `orphanCheckpointThresholdMs` passes, since you might still resume it.

The one invariant worth internalizing: **checkpoints of an in-progress or suspended run are never pruned by age.** Those are exactly the state a crashed or paused run needs to continue, so the sweeper leaves them alone no matter how old they get. A flow parked on a slow human-approval gate for a week is safe.

When you run multiple hosts against a shared store, the sweeper takes a single lease each tick so only one host sweeps at a time. Deletes are idempotent regardless, so the lease is an efficiency measure, not a correctness one.

### Wakes

A wake is a time by which some work must run in a session. The engine keeps it in the store, so it survives a crash. When the time comes, the sweeper runs the internal entry the wake names in that session, as the session's owner, the way a dispatched request runs. The task board creates them: each time a task it handed out ends, it sets a wake for the filing session, due about two seconds later. A request that waits on a [task](/docs/orchestration/task-board#waiting-on-a-task) or on a [request it dispatched](/docs/server/background-work#waiting-for-the-answer) is resumed at the wait's deadline, even across a restart, with the work still running. A wake that fell due while the server was down fires as soon as it is running again. If the notice of that ending went out, the run finds nothing to do and clears the wake. If it was lost, the run sends it. See [Hearing how a task ended](/docs/orchestration/task-board#hearing-how-a-task-ended).

A host keeps wakes when it has durable execution and its store has a `wakes` store, which all four built-in adapters do. A host without either logs one line at start, `this host keeps no wakes: debts are paid on their fast paths only`. On such a host, a task's notice is sent once, when the task ends, and a lost one isn't sent again, and nothing can wait: `getTask` isn't offered `wait`, and a waiting dispatcher is refused.

A wait's deadline is five minutes unless the call names one. A host sets the default and the bounds a call may name with `waitDeadlines`:

```ts
export const flowstate = createFlowState({
  flows: { issues },
  stores: { default: { primary: sqliteStores({ filename: "./data.sqlite" }) } },
  waitDeadlines: { defaultMs: 120_000, minMs: 1_000, maxMs: 3_600_000 },
});
```

`minMs` defaults to one second, the sweeper's resolution, and `maxMs` to 24 hours. A deadline outside them is refused, never clamped.

If the run a wake starts dies too, the wake fires again 30 seconds later, until a run clears it. Work still owed long after its due time is given up on, so a wake can't fire forever. `maxDebtAgeMs` sets how long, counted from the due time; the default is 24 hours:

```ts
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";

export const flowstate = createFlowState({
  flows: { issues },
  stores: { default: { primary: sqliteStores({ filename: "./data.sqlite" }) } },
  maxDebtAgeMs: 3_600_000,   // give up on a notice still owed an hour past due
});
```

A notice given up on is recorded on its task as undeliverable, and logged.

Before it closes the stores, `dispose()` waits up to 10 seconds for any request a wake started to finish, and for any request working a [dispatched task](/docs/orchestration/task-board#when-a-dispatched-task-is-done), until it has recorded that task's outcome (settled, failed, or waiting on something). Past that, it aborts the wake requests still running and logs how many, and logs how many task requests hadn't recorded an outcome; each aborted request's wake stays, and fires again on the next host. On `createFlowApiRouter`, `shutdownDrainMs` sets the limit, and `disposeFlowApiRouter(router, { drainMs })` overrides it for one call. `serve()` from `@flow-state-dev/node` passes in whatever is left of its shutdown grace.

## Managing suspensions in the DevTool

When a flow suspends for human input, an operator needs to see what's waiting without querying the store by hand. The DevTool has a **Suspensions** tab for this. It lists suspensions for the current session — pending ones at the top, recently resolved and expired ones below — and a detail pane shows each suspension's message, the request it belongs to, and its `resumeSchema` (the shape of the input the flow is waiting for).

From the detail pane you can **approve** or **reject** a pending suspension and supply the resume data. That posts to the same resume endpoint a production client would call, so resolving from the DevTool drives the real flow forward.

The tab reads through the gated debug endpoints, which are disabled by default and loopback-only. It needs a host with durable execution; without it, nothing is held and the tab shows nothing to act on.

The same request panel also lists interrupted runs, not just suspensions — a request that stopped abruptly (a crash, a restart, a mid-execution deploy) but is still resumable. See [DevTool — Interrupted runs and crash recovery](/docs/devtool/overview#interrupted-runs-and-crash-recovery) for spotting one and continuing it.

## See also

- [Human-in-the-Loop guide](/guides/human-in-the-loop) — building an approval gate end to end, from `ctx.suspend()` to the React card that resolves it
- [Idempotency and `runOnce`](./idempotency.md) — for making handlers safe to re-run on retry, which complements crash recovery
- [Error handling](./error-handling.md) — for rescue handlers and structured error flow

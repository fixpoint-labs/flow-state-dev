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

## Tool approval

`ctx.suspend()` pauses an explicit step you wrote. Tool approval pauses a tool call the model chose to make. When a generator runs inside a durable action and the model calls a gated tool, the turn ends, the request suspends, and a human approves or denies the call before the agent continues. Reach for it when a model can take an action with real consequences — sending an email, moving money, deleting a record — and you want a person in the loop on exactly those calls without writing an approval step by hand.

Two layers decide what happens. The tool declares whether it needs approval and how that approval looks. The generator sets the handling policy that orchestrates those declarations.

A tool declares an `approval` object. It lives on any block used as a generator tool (handlers included):

```ts
approval?: {
  required?: boolean | ((args, ctx) => boolean | Promise<boolean>);
  message?: string | ((args, ctx) => string);
  render?: { component: string; props?: Record<string, unknown> };
};
```

`required` decides whether the call needs sign-off. A boolean gates the tool unconditionally. A predicate receives the parsed tool arguments and the block context, and decides per call — gate a `transfer` tool only when the amount is over a threshold, or read session or user state from `ctx` to gate based on who is acting. `message` is the prompt shown in the approval UI, static or derived from the call's arguments and context. `render` names a component the client resolves through its `RendererRegistry` to draw a custom approval panel.

The tool owns its own approval UI. Two tools in the same generator can each declare a different `message` and `render`. A `send-email` tool draws an email confirmation panel; a `transfer` tool draws an amount-and-recipient panel. Neither has to know about the other, and adding a third gated tool means adding one more `approval` block, not editing a central policy.

The generator declares a `toolApproval` handling policy:

```ts
toolApproval?:
  | "manual"   // default: honor each tool's approval.required
  | "auto"     // auto-approve every call, ignoring tool-level approval
  | "all"      // require approval for every call, even tools that don't ask
  | {
      autoApprove?: string[] | ((call: ToolApprovalRequest) => boolean | Promise<boolean>);
      require?: string[] | ((call: ToolApprovalRequest) => boolean | Promise<boolean>);
      timeoutMs?: number;
    };

interface ToolApprovalRequest { toolName: string; arguments: unknown; description?: string; }
```

`"manual"` is the default and honors each tool's `approval.required`. `"auto"` runs every call without gating, even tools that set `required: true` — full autonomy. `"all"` gates every call, even tools that declare no approval. The object form is the targeted override: `autoApprove` exempts named tools (an array of tool names) or tools matching a predicate; `require` forces approval for named tools or matching tools beyond what they declare; `timeoutMs` sets the suspension's expiry.

Precedence: the generator's handling policy wins over the tool's declaration. The generator is the trust boundary, so it has final say. `"auto"` or a matching `autoApprove` exempts a tool even if it set `required: true`. `"all"` or a matching `require` forces approval even on a tool that asks for none. Otherwise the tool's own `approval.required` is honored. When a tool matches both `autoApprove` and `require`, `autoApprove` wins.

### A gated tool in a durable action

```ts
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const sendEmail = handler({
  name: "send-email",
  inputSchema: z.object({ to: z.string(), body: z.string() }),
  outputSchema: z.object({ sent: z.boolean() }),
  approval: {
    required: true,                              // or (args) => args.to.endsWith("@external.com")
    message: "Approve sending this email?",
    render: { component: "email-approval" },
  },
  execute: async (input) => {
    await deliver(input.to, input.body);
    return { sent: true };
  },
});

const assistant = generator({
  name: "assistant",
  model: "openai/gpt-5.4-mini",
  prompt: "Draft and send emails on the user's behalf.",
  history: true,
  user: (input: { message: string }) => input.message,
  tools: [sendEmail],
  toolApproval: "manual",   // default — honor each tool. Or "auto" / { autoApprove: ["send-email"] }
  itemVisibility: { client: true, history: true },
});

const flow = defineFlow({
  kind: "assistant",
  actions: {
    chat: {
      block: sequencer({ name: "chat", durable: true }).step(assistant),
      inputSchema: z.object({ message: z.string() }),
    },
  },
});
```

The gating generator must be a direct step of the root durable sequencer (or the action root itself), and the action must run with a configured `DurabilityProvider` — the same precondition as `ctx.suspend()`. A gated call without a provider fails fast rather than silently executing.

### What the client sees

When the model calls a gated tool, that model turn ends and the request suspends with `reason: "tool_approval"`. A `suspension` item lands on the stream carrying `data.toolCalls` — one entry per pending call. Each entry carries its own `message` and `render`, copied from that tool's `approval` declaration, because a single turn can gate two different tools with two different approval UIs:

```jsonc
{
  "type": "suspension",
  "reason": "tool_approval",
  "message": "Approve sending this email?",
  "data": {
    "toolCalls": [
      {
        "approvalId": "appr_1",
        "toolCallId": "call_abc",
        "toolName": "send-email",
        "args": { "to": "a@b.com", "body": "..." },
        "message": "Approve sending this email?",
        "render": { "component": "email-approval" }
      }
    ]
  }
}
```

The top-level `message` is the single tool's prompt when one call is gated, or a generated summary when several are. There is no top-level `render` — each gated call carries its own. The client resolves each entry's component through its `RendererRegistry` and draws a panel per pending call. See [SSE protocol — suspension items](../streaming/items.md#suspension-items) for the full item shape.

### Resolving the approval

A human resolves through the same resume endpoint as any suspension, with a per-call decisions payload:

```json
{
  "decisions": [
    { "toolCallId": "call_abc", "approved": true },
    { "toolCallId": "call_def", "approved": false, "reason": "wrong recipient" }
  ]
}
```

On approve, the tool executes and the agent continues from there. On reject, the model receives a denial as the tool result and adapts — it might apologize, pick a different action, or ask a clarifying question. A rejected tool is not a hard failure. Posting `action: "reject"` on the endpoint denies every pending call in one shot.

The model call that requested the tools is never replayed. Resume re-enters after the model's decision, runs the approved tools, and feeds their results (and any denials) back into the conversation.

### Limits

This is a v1. The edges worth knowing:

- **Approvals batch per model turn.** Every gated call the model made in one turn surfaces together and resolves together. You can't approve one and leave the rest pending across separate resumes.
- **`timeoutMs` expiry means the gate closed.** Once the suspension expires, the approval can no longer be granted — there's no automatic continuation. Treat expiry as a denial path and handle it with a rescue on `SuspensionTimeoutError`.
- **Provider-executed tools aren't gated.** Native web search and other provider-side tools run inside the model call at the provider; they never reach the block tool loop where gating happens.
- **The gating generator must be a direct step of the root durable sequencer** (or the action root). A generator buried inside a nested sub-sequencer can't gate, because resume re-enters at the root.

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

## See also

- [Idempotency and `runOnce`](./idempotency.md) — for making handlers safe to re-run on retry, which complements crash recovery
- [Error handling](./error-handling.md) — for rescue handlers and structured error flow

---
sidebar_label: Overview
---

# Human-in-the-loop

Some steps can't run to completion on their own. A draft needs a human to approve it before it publishes. An agent wants to send an email, move money, or delete a record, and you want a person to sign off first. A review step needs a decision that takes minutes or hours, not milliseconds.

Flow State handles these by pausing a flow and resuming it later. A block suspends, the request returns control to the caller, and the run picks up exactly where it left off once a human responds — no polling, no blocked threads, no side-channel you have to build yourself. The pause is persisted durably, so the flow survives a server restart while it waits.

There are two ways to pause for a human:

- **A gate you place** — call `ctx.suspend()` at a specific step you wrote. You decide where the gate is.
- **A gate the model triggers** — [tool approval](./tool-approval.md) pauses the tool calls a model chose to make, which you can't place in advance. The model decides when and what to call; you decide which of those calls need a human.

Both build on the same suspend/resume machinery, and both need a `DurabilityProvider` configured on the runtime (see [Durable execution](../advanced/durable-execution.md) for the setup and the durability guarantees).

## Pausing a step with ctx.suspend()

`ctx.suspend()` pauses execution at the current step and waits for an external actor to resolve it. It's how you implement approval gates, human review steps, and anything else that needs an out-of-band decision.

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

When `ctx.suspend()` is called, the sequencer catches the resulting `SuspensionError` at the step boundary, persists a `SuspensionRecord` to the durability store, and transitions the request to `"suspended"` status. A `SuspensionItem` is emitted to the SSE stream before it closes. Clients receive the suspension metadata — `suspensionId`, `reason`, `message`, and optionally a `render` hint for building a UI — and use it to display an approval interface.

The original SSE connection closes cleanly. Nothing blocks a thread.

### SuspendOptions

| Field | Type | Description |
|---|---|---|
| `reason` | `"human_approval" \| "human_input" \| "external_event" \| "tool_approval" \| string` | Machine-readable category for the suspension |
| `message` | `string` | Human-readable description, emitted in the `SuspensionItem` |
| `data` | `Record<string, unknown>` | Arbitrary metadata attached to the suspension record |
| `resumeSchema` | `Record<string, unknown>` | JSON Schema describing the expected resume payload shape |
| `timeoutMs` | `number` | Optional expiry. After this duration the suspension transitions to `timed_out`. |
| `render` | `{ component: string; props?: Record<string, unknown> }` | Hint for client-side rendering of the approval UI |

## Resuming

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

`action` must be `"approve"` or `"reject"`. `data` carries the payload that `ctx.suspend()` returns on the resumed step. `resumedBy` is optional — it's stored on the suspension record for audit purposes.

The endpoint acquires an exclusive lease before re-dispatching, so concurrent resume attempts on the same request get a `409` rather than a double execution. On success it returns `202` with the new `requestId`. If the caller includes `Accept: text/event-stream`, the response streams the resumed execution directly.

Under the hood, resume restores the sequencer from its last checkpoint, replays completed steps from their cached outputs, and re-runs the suspended step — which this time returns the resume data instead of pausing. The original model call (for an agent) is never replayed. See [Durable execution — skip-and-inject](../advanced/durable-execution.md#skip-and-inject-how-resume-works-under-the-hood) for the mechanics.

## Errors

Three errors are relevant when pausing for a human:

**`SuspensionError`** — Thrown by `ctx.suspend()` as a control-flow signal. The sequencer catches it; rescue handlers do not. You cannot catch this yourself, and it is not a block failure.

**`SuspensionRejectedError`** — Thrown when the suspension is resolved with `action: "reject"`. Catchable in a rescue handler:

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

(Tool approval is the exception to the rejection rule: a rejected *tool* call is fed back to the model as a denial, not raised as `SuspensionRejectedError`, so the agent can adapt. See [Tool approval](./tool-approval.md#resolving-the-approval).)

## Operating suspensions in the DevTool

When a flow suspends for human input, an operator needs to see what's waiting without querying the store by hand. The DevTool has a **Suspensions** tab for this. It lists suspensions for the current session — pending ones at the top, recently resolved and expired ones below — and a detail pane shows each suspension's message, the request it belongs to, and its `resumeSchema` (the shape of the input the flow is waiting for).

From the detail pane you can **approve** or **reject** a pending suspension and supply the resume data. That posts to the same resume endpoint a production client would call, so resolving from the DevTool drives the real flow forward.

The tab reads through the gated debug endpoints, which are disabled by default and loopback-only. It requires a configured `durabilityProvider`; without one, the suspension store is empty and the tab shows nothing.

## See also

- [Tool approval](./tool-approval.md) — gate the tool calls an agent makes
- [Durable execution](../advanced/durable-execution.md) — the provider, stores, checkpoints, and retention that suspend/resume builds on
- [SSE protocol — suspension items](../streaming/items.md#suspension-items) — the suspension item shape on the stream

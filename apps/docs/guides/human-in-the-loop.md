---
title: Human-in-the-Loop
description: Build an approval gate end to end — pause a flow for a human decision, then wire the client and React components to resolve it live.
---

# Human-in-the-Loop

Some steps shouldn't run without a person signing off. Publishing content, sending money, deleting records, kicking off an expensive job. Human-in-the-loop (HITL) is the pattern for that: a flow runs until it hits a gate, pauses, waits for a human to approve or reject, then continues from where it stopped.

This guide builds one approval gate from end to end. The server pauses a flow with `ctx.suspend()`, and the React client renders a card the user acts on. When they click Approve, the flow continues and its output streams back into the same conversation, no page refresh.

HITL is built on suspend/resume, which is part of [durable execution](/docs/advanced/durable-execution). That page covers the runtime mechanics in depth (checkpoints, the resume endpoint, retention). Here we focus on building a working approval flow and wiring the UI.

## How a pause works

When a block calls `ctx.suspend()`, three things happen. The runtime saves a suspension record, emits a `suspension` item to the SSE stream, and closes the stream cleanly. The request is now parked. Nothing blocks a thread, and on serverless the function returns instead of timing out.

Later, an external actor (your UI, an admin tool, another service) resolves the suspension. The runtime re-invokes the original action on the same request id, skips the steps that already finished, and re-runs the suspended step. This time `ctx.suspend()` returns the resume payload instead of pausing. Execution carries on.

The whole cycle lives on one request with one continuous item log: the work before the pause, the `suspension` item, a `suspension_resume` audit item, and the work after. That's what lets the UI show the resolution inline.

## Prerequisites: a durability provider

Suspend/resume needs somewhere to persist the pause. Wire a `DurabilityProvider` into your runtime; without one, `ctx.suspend()` is unavailable.

```ts title="src/flowstate.ts"
import {
  createFlowState,
  inMemoryStores,
  createCheckpointDurabilityProvider,
} from "@flow-state-dev/engine";
import { contentReview } from "./flows/content-review/flow";

const stores = inMemoryStores();

export const flowstate = createFlowState({
  flows: { contentReview },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: stores } },
  durabilityProvider: createCheckpointDurabilityProvider(stores),
});
```

`inMemoryStores()` loses state on restart, which is fine for development. For production, back the provider with SQLite or Postgres so a flow parked on a human gate survives a deploy. See [durable execution](/docs/advanced/durable-execution#store-adapters) for the adapter options.

## Server: define the approval gate

The gate is an ordinary handler that calls `ctx.suspend()`. Pass a `reason`, a human-readable `message`, and a `resumeSchema` describing the payload you expect back. The call returns whatever the resolver supplied.

```ts title="src/flows/content-review/flow.ts"
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const reviewGate = handler({
  name: "reviewGate",
  inputSchema: z.object({ content: z.string() }),
  outputSchema: z.object({
    approved: z.boolean(),
    feedback: z.nullable(z.string()),
  }),
  execute: async (input, ctx) => {
    const decision = await ctx.suspend!({
      reason: "human_approval",
      message: `Review before publishing: "${input.content.slice(0, 80)}…"`,
      resumeSchema: {
        type: "object",
        properties: {
          approved: { type: "boolean" },
          feedback: { type: "string" },
        },
        required: ["approved"],
      },
    });
    return decision as { approved: boolean; feedback: string | null };
  },
});

const publish = handler({
  name: "publish",
  inputSchema: z.object({
    approved: z.boolean(),
    feedback: z.nullable(z.string()),
  }),
  outputSchema: z.string(),
  execute: async (input) => {
    if (!input.approved) return "Publication rejected.";
    return "Content published.";
  },
});

export const contentReview = defineFlow({
  kind: "content-review",
  actions: {
    submit: {
      block: sequencer({ name: "reviewPipeline", durable: true })
        .step(reviewGate)
        .step(publish),
      inputSchema: z.object({ content: z.string() }),
    },
  },
});
```

That's the entire server side. The sequencer is `durable: true` (the default), so it checkpoints at each step and can resume after the gate. The resume HTTP endpoint comes for free with the standard server routes; you rarely call it by hand. The React client wraps it.

## Client: render the approval card

The fastest path uses `@flow-state-dev/ui`. Its pre-wired renderer registry, `chatAssistantRenderers`, maps every item type to a default component, including a polished `Approval` card for `suspension` items. Install it:

```bash
fsdev ui add chat-assistant
```

That pulls in `chat-assistant`, the `Approval` card, and their dependencies into your project under `components/flow-state/`. Now wire a surface:

```tsx title="src/components/ContentReview.tsx"
"use client";

import {
  FlowProvider,
  SuspensionResolverProvider,
  useFlow,
  useSession,
  ItemsRenderer,
} from "@flow-state-dev/react";
import { chatAssistantRenderers } from "@/components/flow-state/chat-assistant";
import { SessionItemsProvider } from "@/components/flow-state/session-items-context";
import { Conversation } from "@/components/flow-state/conversation";

export function ContentReview({ userId }: { userId: string }) {
  return (
    <FlowProvider
      flowKind="content-review"
      userId={userId}
      baseUrl="/api/flows"
      renderers={chatAssistantRenderers}
    >
      <ReviewSurface />
    </FlowProvider>
  );
}

function ReviewSurface() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  return (
    <SuspensionResolverProvider resolve={session.resumeSuspension}>
      <SessionItemsProvider value={session.items}>
        <Conversation>
          <ItemsRenderer items={session.items} />
        </Conversation>
      </SessionItemsProvider>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const content = new FormData(e.currentTarget).get("content") as string;
          session.sendAction("submit", { content });
          e.currentTarget.reset();
        }}
      >
        <textarea name="content" placeholder="Draft to review…" />
        <button disabled={session.isStreaming}>Submit for review</button>
      </form>
    </SuspensionResolverProvider>
  );
}
```

Submitting runs the flow until the gate. The `Approval` card appears in the conversation with the gate's message and Approve / Reject buttons. Clicking one resolves the suspension, the flow's continuation streams back into `session.items`, and the card collapses to a one-line receipt (`✓ Approved`).

Two pieces make the live, in-place update work:

- **`SuspensionResolverProvider`** hands the card the session's streaming resume (`session.resumeSuspension`). Without it, the card still resolves, but the continuation only appears after the session refetches. With it, the resumed output streams onto the same request the user is watching. This matters most on serverless, where the continuation runs in a different invocation than the original stream.
- **`SessionItemsProvider`** lets the card see the `suspension_resume` item that records the outcome, so it shows the receipt on resolve and after a reload. It's the same context `TaskPlan` and other stream-aware components use.

### Without the ui registry

If you're not using `@flow-state-dev/ui`, the `@flow-state-dev/react` package ships a minimal built-in default. Set `flowKind` on `FlowProvider` and a `suspension` item renders plain, unstyled Approve / Reject buttons with no extra setup. It's deliberately bare. The `Approval` card above is the styled version.

## Beyond binary approval

Approve / reject is the simplest gate, but a pause can ask for more than a yes/no. The same suspend/resume cycle handles a free-text answer, a small form, or a choice from a fixed set. Two resolution actions drive this: `submit` (the human returns a typed payload) and `skip` (the human declines an optional step).

The server decides what a gate asks for through its `reason` and `resumeSchema`. Use `reason: "human_input"` for an input gate; it defaults to `allow: ["submit"]`. On the client, `ItemsRenderer` reads the schema shape and renders the matching card. The renderer picks a free-text question for no flat schema, a selection for an enum, and a form for a flat object — automatically, with the same wiring as the approval example above.

### A question (free text)

```ts
const askName = await ctx.suspend!({
  reason: "human_input",
  message: "What should we title this draft?",
  resumeSchema: z.object({ title: z.string() }),
});
```

The conversation shows a text box. Submitting returns `{ title }` to the flow.

### A form (a few fields)

A flat object of scalars and enums renders as one combined form, one control per property. Give each field its own context with `.describe()` — it renders as help text under the label, so the person answering doesn't have to scroll back through the run to understand what's being asked:

```ts
const details = await ctx.suspend!({
  reason: "human_input",
  message: "Add publishing details.",
  resumeSchema: z.object({
    clarification: z
      .string()
      .describe("A sentence the editor will see verbatim."),
    priority: z
      .enum(["low", "normal", "urgent"])
      .describe("Urgent jumps the queue; normal is next business day."),
    urgent: z
      .boolean()
      .describe("Check only if readers are currently affected."),
  }),
});
```

Each field reads as its own small question: the property's `.describe()` (or a JSON-Schema `description`) is the context, and a `title` overrides the label. The form's `message` is the overall framing above the fields.

This is the flat-schema boundary. Nested objects, arrays of objects, and unions don't auto-generate. For those, name your own component with the `render.component` hint and register it under `renderers.component`.

### A selection (choose from a set)

A single enum renders as a single-choice control; an array of enums renders as multi-select:

```ts
const pick = await ctx.suspend!({
  reason: "human_input",
  message: "Which channels should this post to?",
  resumeSchema: z.object({
    channels: z.array(z.enum(["blog", "email", "social"])),
  }),
});
```

### Optional steps (skip)

Add `"skip"` to `allow` to let a human decline a step. A skip is normal control flow, not a rejection: `ctx.suspend()` returns the `SUSPENSION_SKIPPED` sentinel instead of throwing, so the author branches on it.

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

The card shows a Skip control whenever `allow` includes `"skip"`. To build a fully custom input instead of the default cards, reach for `useSuspensionForm(item)` — see [React client](/docs/client/react#beyond-approval-questions-forms-and-selections).

## Suspension inside the tool loop

So far the gate has been a sequencer step. But the highest-value place to pause is often inside an agent: the model wants to call a tool that does something consequential (publish, send, charge), and you want a human to sign off before it fires. A generator's tools are just blocks, so the gate goes right where the tool runs.

Call `ctx.suspend()` inside the tool's `execute`, before the tool does its real work. When the model calls that tool, the whole request pauses and emits the same `suspension` item as any other gate. The client resolves it the same way, with the same card and the same hooks. On approval the tool runs its body and the agent continues to its answer; the model is not re-called for the turns that already ran.

```ts title="src/flows/writer/flow.ts"
import { generator, handler } from "@flow-state-dev/core";
import { z } from "zod";

const publishPost = handler({
  name: "publish-post",
  inputSchema: z.object({ title: z.string(), body: z.string() }),
  outputSchema: z.object({ url: z.string() }),
  execute: async (input, ctx) => {
    // Pause before publishing. On resume this returns the human's payload;
    // on reject it throws, and the model sees a denial result.
    const decision = await ctx.suspend!({
      reason: "human_approval",
      message: `Publish "${input.title}"?`,
      resumeSchema: z.object({ note: z.string().nullable() }),
    });

    const url = await cms.publish(input.title, input.body, decision.note);
    return { url }; // the model sees this, not the resume payload
  },
});

const writer = generator({
  name: "writer",
  model: "openai/gpt-5.4-mini",
  prompt: "You draft and publish posts. Call publish-post when the draft is ready.",
  inputSchema: z.object({ request: z.string() }),
  user: (input) => input.request,
  tools: [publishPost],
});
```

There's one rule worth internalizing before you ship this: the suspending tool re-enters from the top on resume, so put `ctx.suspend()` before any side effect (or guard pre-gate work with `runOnce`). A router's chosen branch can suspend the same way and keeps its branch stable across the pause. The [generator and router suspend/resume](/docs/advanced/generator-and-router-suspend-resume) reference covers the full contract, the reconstruction rules, and the v1 limits.

## Custom approval UI with `useApproval`

When you want your own card, build it on `useApproval`. The hook is headless: it owns the resume call, the in-flight and error state, a guard against double-resume, and the resolved outcome. You bring the markup.

Register your component under the `suspension` slot. A registry renderer receives only `{ item }`, so derive the resolved state from the item stream yourself (the built-in default gets it threaded automatically; a custom one does not).

```tsx title="src/components/ReviewCard.tsx"
"use client";

import { useApproval } from "@flow-state-dev/react";
import { useSessionItems } from "@/components/flow-state/session-items-context";
import type {
  SuspensionItem,
  SuspensionResumeItem,
} from "@flow-state-dev/core/items";

export function ReviewCard({ item }: { item: SuspensionItem }) {
  // The resume item that resolves this gate arrives later in the same stream.
  // Find it so the card collapses to a receipt on resolve and after reload.
  const resume = useSessionItems().find(
    (i): i is SuspensionResumeItem =>
      i.type === "suspension_resume" && i.suspensionId === item.suspensionId,
  );

  const a = useApproval(item, {
    isResolved: resume !== undefined,
    resolution: resume?.resolution,
  });

  if (a.resolved) {
    return (
      <p>
        {a.outcome.icon} {a.outcome.label}
      </p>
    );
  }

  return (
    <div>
      <p>{item.message}</p>
      {a.error && <p style={{ color: "red" }}>{a.error}</p>}
      <button disabled={!a.canApprove || a.isResolving} onClick={a.approve}>
        {a.pendingAction === "approve" ? "Approving…" : "Approve"}
      </button>
      <button disabled={!a.canReject || a.isResolving} onClick={a.reject}>
        {a.pendingAction === "reject" ? "Rejecting…" : "Reject"}
      </button>
    </div>
  );
}
```

```tsx
<FlowProvider
  flowKind="content-review"
  renderers={{ ...chatAssistantRenderers, suspension: ReviewCard }}
>
```

`useApproval` resolves through the nearest `SuspensionResolverProvider` when there is one, so your card streams the continuation the same way the default does.

## Custom layouts with `useSuspensions`

Inline cards work for chat. For an approval queue, a sidebar, or a modal, you want the suspensions pulled out of the stream. `useSuspensions` derives the pending and resolved suspensions from `session.items` and gives you `approve` / `reject` callbacks. Suppress the inline cards and drive your own layout:

```tsx
import { useSuspensions } from "@flow-state-dev/react";

function ReviewQueue({ session }) {
  const { pending, approve, reject } = useSuspensions(session, {
    reasons: ["human_approval"],
  });

  return (
    <aside>
      {pending.map(({ item }) => (
        <div key={item.suspensionId}>
          <p>{item.message}</p>
          <button onClick={() => approve(item.suspensionId)}>Approve</button>
          <button onClick={() => reject(item.suspensionId)}>Reject</button>
        </div>
      ))}
    </aside>
  );
}

// Turn off inline rendering so suspensions only show in the queue.
<FlowProvider renderers={{ ...chatAssistantRenderers, suspension: false }}>
```

`approve` and `reject` accept an optional `data` payload that `ctx.suspend()` returns on the resumed step, matching the gate's `resumeSchema`.

## Handling rejection on the server

Rejecting a gate throws `SuspensionRejectedError` inside the action. Catch it with a rescue handler when rejection needs its own path (notify someone, log the decision, roll something back):

```ts
import { SuspensionRejectedError } from "@flow-state-dev/core";

sequencer({ name: "reviewPipeline", durable: true })
  .step(reviewGate)
  .step(publish)
  .rescue([{ when: [SuspensionRejectedError], block: notifyRejected }]);
```

To expire a gate that no one answers, pass `timeoutMs` to `ctx.suspend()`. After it elapses the suspension flips to `timed_out` and resolving it throws `SuspensionTimeoutError`, also catchable in rescue. See [durable execution](/docs/advanced/durable-execution#error-handling) for the full error contract.

## Resolving without a browser

The React layer wraps a plain HTTP endpoint. A server-to-server resolver (a Slack action handler, an admin script) can POST to it directly:

```
POST /:flowKind/requests/:requestId/resume
```

```json
{
  "suspensionId": "susp_abc123",
  "action": "approve",
  "data": { "approved": true, "feedback": null },
  "resumedBy": "user_xyz"
}
```

`data` is the payload `ctx.suspend()` returns. `resumedBy` is recorded on the audit item. `action` is one of `"approve"`, `"reject"`, `"submit"`, or `"skip"`; `submit` carries the validated `data`, `skip` carries none. The server rejects an action outside the gate's `allow` set with a `409`.

## Related

- [Durable execution](/docs/advanced/durable-execution) — the runtime mechanics: checkpoints, the resume endpoint, memoization on resume, retention, and the DevTool Suspensions tab.
- [React client](/docs/client/react#suspensions-and-approvals) — `useSuspensions`, the renderer registry, and inline rendering.
- [Flow-aware components](/docs/ui/flow-aware-components) — the `Approval` card and the rest of the `chatAssistantRenderers` set.
- [Block memoization and replay](/docs/advanced/block-memoization-and-replay) — why the suspending block re-runs, and how to guard side effects with `runOnce`.

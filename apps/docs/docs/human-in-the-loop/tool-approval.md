---
sidebar_label: Tool approval
---

# Tool approval

[`ctx.suspend()`](./overview.md#pausing-a-step-with-ctxsuspend) pauses an explicit step you wrote. Tool approval pauses a tool call the model chose to make. When a generator runs inside a durable action and the model calls a gated tool, the turn ends, the request suspends, and a human approves or denies the call before the agent continues. Reach for it when a model can take an action with real consequences — sending an email, moving money, deleting a record — and you want a person in the loop on exactly those calls without writing an approval step by hand.

Two layers decide what happens. The tool declares whether it needs approval and how that approval looks. The generator sets the handling policy that orchestrates those declarations.

## The tool declares its approval

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

## The generator sets the handling policy

The generator declares a `toolApproval` handling policy:

```ts
toolApproval?:
  | "manual"   // default: honor each tool's approval.required
  | "auto"     // auto-approve every call, ignoring tool-level approval
  | "all"      // require approval for every call, even tools that don't ask
  | {
      autoApprove?: string[] | ((call: ToolApprovalRequest, ctx) => boolean | Promise<boolean>);
      require?: string[] | ((call: ToolApprovalRequest, ctx) => boolean | Promise<boolean>);
      timeoutMs?: number;
    };

interface ToolApprovalRequest { toolName: string; arguments: unknown; description?: string; }
```

`"manual"` is the default and honors each tool's `approval.required`. `"auto"` runs every call without gating, even tools that set `required: true` — full autonomy. `"all"` gates every call, even tools that declare no approval. The object form is the targeted override: `autoApprove` exempts named tools (an array of tool names) or tools matching a predicate; `require` forces approval for named tools or matching tools beyond what they declare; `timeoutMs` sets the suspension's expiry.

Precedence: the generator's handling policy wins over the tool's declaration. The generator is the trust boundary, so it has final say. `"auto"` or a matching `autoApprove` exempts a tool even if it set `required: true`. `"all"` or a matching `require` forces approval even on a tool that asks for none. Otherwise the tool's own `approval.required` is honored. When a tool matches both `autoApprove` and `require`, `autoApprove` wins.

This split is what makes the same tool reusable across agents: a `send-email` tool that declares `required: true` is gated in a supervised assistant and auto-approved in an autonomous batch job, with no change to the tool itself.

## A gated tool in a durable action

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

## What the client sees

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

## Resolving the approval

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

## Limits

This is a v1. The edges worth knowing:

- **Approvals batch per model turn.** Every gated call the model made in one turn surfaces together and resolves together. You can't approve one and leave the rest pending across separate resumes.
- **`timeoutMs` expiry means the gate closed.** Once the suspension expires, the approval can no longer be granted — there's no automatic continuation. Treat expiry as a denial path and handle it with a rescue on `SuspensionTimeoutError`.
- **Provider-executed tools aren't gated.** Native web search and other provider-side tools run inside the model call at the provider; they never reach the block tool loop where gating happens.
- **The gating generator must be a direct step of the root durable sequencer** (or the action root). A generator buried inside a nested sub-sequencer can't gate, because resume re-enters at the root.

## See also

- [Human-in-the-loop overview](./overview.md) — the suspend/resume lifecycle this builds on
- [Durable execution](../advanced/durable-execution.md) — configuring the `DurabilityProvider` tool approval requires
- [Tools](../tools/overview.md) — building the tool blocks you gate

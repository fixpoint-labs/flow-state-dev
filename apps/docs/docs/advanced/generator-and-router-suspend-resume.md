---
sidebar_label: "Generator & Router Suspend/Resume"
---

# Suspending inside generators and routers

Suspend/resume started as a sequencer feature: a pipeline runs step by step, one step pauses for a human, and the request resumes later on the same request id. Generators and routers can pause the same way, using the same `ctx.suspend()` call and the same durable resume. What changes is *where* the pause lands.

A generator is the AI block: it calls a model, and if the model asks to use a tool (any block you hand it in the `tools` array), the framework runs that tool, feeds the result back, and calls the model again. That back-and-forth is the tool loop. With generator suspension, a tool can pause the whole request mid-loop, wait for a human, and then continue past that tool call to a final answer, without re-calling the model for the turns that already ran.

A router picks which block to run at runtime. If the branch it chose suspends somewhere inside, resume keeps that same branch instead of re-deciding.

This page assumes you've read [durable execution](./durable-execution.md) (how suspend/resume and the resume endpoint work) and [block memoization and replay](./block-memoization-and-replay.md) (what re-runs on resume and what doesn't). The canonical use case here is approving a tool call before it fires.

## Suspending inside a generator's tool loop

The gate lives inside a tool. A tool is a block, and inside its `execute` you call `ctx.suspend()` the same way a sequencer step would. When the model calls that tool, the request pauses instead of the tool running to completion.

```ts
import { generator, handler } from "@flow-state-dev/core";
import { z } from "zod";

const publishPost = handler({
  name: "publish-post",
  inputSchema: z.object({ title: z.string(), body: z.string() }),
  outputSchema: z.object({ url: z.string() }),
  execute: async (input, ctx) => {
    // Suspend BEFORE the side effect. On resume this call returns the
    // human's typed payload; on rejection it throws instead of returning.
    const decision = await ctx.suspend!({
      reason: "human_approval",
      message: `Publish "${input.title}"?`,
      resumeSchema: z.object({ note: z.string().nullable() }),
    });

    // Reached only after approval. This is the tool's real work, and its
    // return value is what the model sees next — not the resume payload.
    const url = await cms.publish(input.title, input.body, decision.note);
    return { url };
  },
});

const writer = generator({
  name: "writer",
  model: "openai/gpt-5.4-mini",
  prompt: "You draft and publish blog posts. Call publish-post when the draft is ready.",
  inputSchema: z.object({ request: z.string() }),
  user: (input) => input.request,
  tools: [publishPost],
});
```

When the model calls `publish-post`, the request suspends and a `suspension` item goes out on the stream, exactly as a sequencer gate would. A client resolves it through the same resume endpoint and the same React hooks. Nothing about the client side is generator-specific, so the [Human-in-the-Loop guide](/guides/human-in-the-loop) applies unchanged.

On approval, `ctx.suspend()` returns the payload (here `{ note }`), the tool runs its real body, and the generator continues the loop: the model gets the tool's actual return value and produces its final answer. The approved tool runs once, and the model is not re-called for the turns before the approval.

## How resume reconstructs the conversation

A generator doesn't checkpoint its conversation into a separate blob. The durable record is the item log itself: every model turn's assistant text and every tool's output are already stored there as items. On resume the framework replays that log back into the model's message history rather than re-calling the model.

Two consequences follow, and both are the point of the feature:

- **The model is not re-called for recorded turns.** Prior steps are rebuilt from their stored items, so a resumed run costs the same model calls as an uninterrupted one from the approval point forward.
- **Completed tools are not re-run.** If a single model turn called three tools and the second one suspended, the first and third already recorded their outputs. On resume those two are injected from the log, and only the gated tool re-enters. No completed side effect fires twice.

## Suspending at a router decision

The router half is simpler because the decision is deterministic code, not a model call. When a router's chosen branch suspends somewhere inside it, resume re-runs the router's `execute` selector and validates the fresh choice against the branch recorded on the first pass.

```ts
import { router } from "@flow-state-dev/core";

const triage = router({
  name: "triage",
  routes: [autoReply, humanReview],
  // Pure: reads input only. Re-run on resume, then checked against the
  // branch the first run recorded.
  execute: (input) => (input.risk > 0.8 ? humanReview : autoReply),
});
```

If `humanReview` suspends for a human, resume re-runs `execute`, confirms it still selects `humanReview`, and continues that branch. Completed work inside the branch replays from the log instead of re-executing. If the selector reads something that changed while the request was paused and picks a different route, resume fails with `RouteUnavailableError` rather than silently switching branches. Keep router selectors pure; the [control-flow determinism](./block-memoization-and-replay.md#control-flow-determinism) note covers the same rule for the connector closures a selected route may carry.

## Re-execution and idempotency on resume

The rule from [block memoization](./block-memoization-and-replay.md) holds here with one wrinkle. Prior turns and completed tools are replayed. The suspending tool is not: it re-enters from the top of its `execute` on resume, and only reaches `ctx.suspend()` again partway through.

So any side effect the tool runs *before* its `ctx.suspend()` call runs twice: once on the first pass, once on resume. Two ways to stay safe:

- **Gate first.** Call `ctx.suspend()` before any side effect, as in the example above. The work after it only runs post-approval, and it only runs on the resumed pass.
- **Guard with `runOnce`.** If pre-gate work is unavoidable, wrap it in `ctx.runOnce(key, fn)` so it fires once across the suspend/resume boundary. `runOnce` is a handler primitive, so it's available inside a tool whose block is a handler. See [idempotency and `runOnce`](./idempotency.md).

The resume payload is the human's decision, not the tool's output. The tool still runs its real body after approval and returns its real value. Don't treat the payload as a shortcut around running the tool.

## Rejection

A rejected gate is not a crash. When a human rejects, `ctx.suspend()` throws `SuspensionRejectedError` inside the tool, and the generator surfaces that to the model as a denial tool-result. The model sees "that call was declined" and adapts, the same as it would react to any other tool result. The generator does not fail unless the tool body catches the rejection and re-throws something else.

This mirrors the approval path: both continue the loop, one with the tool's result and one with a denial.

## Behavior contract and limits

These are real constraints in the first version. Design around them rather than against them.

- **The suspending tool re-enters from the top.** Gate before side effects, or guard pre-gate work with `runOnce`. The resume payload is the decision, not the tool output.
- **One approval gate per model turn.** If two tools in the same turn both call `ctx.suspend()`, the first to suspend wins and surfaces its gate; the other re-reaches its gate on the next resume cycle. Multiple gates within a single model turn is not supported.
- **A suspending tool can't be `cacheable`.** Tool-result caching short-circuits before the tool body runs, so a cache hit would skip the gate entirely. Don't mark a gated tool `cacheable`.
- **Provider-native tools from an earlier turn aren't reconstructable.** Provider-native tools (`search`, `providerTools`) run provider-side and don't record a framework `tool_output`. If a generator uses one in an earlier turn and then suspends via a framework-tool gate, that earlier provider-tool turn is absent from the reconstructed conversation on resume. Keep provider-native tools and approval gates in separate runs if you rely on both.
- **A dynamic `tools` resolver must keep the pending tool stable.** If `tools` is a function, it must still return the pending tool, under the same definition, across the suspend window. If the tool disappears or changes between suspend and resume, resume fails fatally instead of running the wrong tool.
- **Streaming generators suspend and resume, but recorded turns aren't re-streamed.** A streaming generator (one whose model streams token deltas) can suspend inside its tool loop and resume the same way. On resume the recorded turns are rebuilt for the model but not replayed onto the client stream, so a live viewer sees the post-resume output, not a re-stream of what already happened before the pause.
- **A suspending tool shouldn't rely on a resume timeout.** If a suspension times out while a generator tool is gated, the tool is not retried, but the timeout is surfaced as a run failure rather than a model-facing outcome. Treat approval timeouts as terminal for the run in this version.

## See also

- [Durable execution](./durable-execution.md) — the resume endpoint, the continuous item log, and the suspend/resume lifecycle.
- [Block memoization and replay](./block-memoization-and-replay.md) — what re-runs on resume, and the `runOnce` side-effect guard.
- [Idempotency and `runOnce`](./idempotency.md) — exactly-once side effects across a resume.
- [Human-in-the-Loop guide](/guides/human-in-the-loop) — building the approval UI end to end.
- [Suspensions and approvals](/docs/client/react#suspensions-and-approvals) — the React hooks and renderers that resolve a gate.

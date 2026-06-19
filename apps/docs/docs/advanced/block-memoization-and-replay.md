---
sidebar_label: "Block Memoization & Replay"
---

# Block memoization and replay

When a suspended request resumes, it continues the same request and runs the suspending block again. Every block that already finished is *memoized* — the runtime reuses that block's recorded output instead of re-executing it. The recorded output comes from the durable item log, where each block's execution is captured as a `block_trace` (the durable record of a block's execution in the item log).

Memoization (reuse a prior run's recorded output instead of re-executing) is automatic. You don't opt in. The cost is a sharp edge: any side effect a block performs that isn't captured in its output will fire again if the block re-executes. The suspending block always re-executes, so its side effects are the ones to watch.

## How it works

On resume, the runtime reads the item log for the continuing request and builds a replay index keyed by each block's logical path (`${requestId}:${path}`). The path is attempt-independent, so the index survives retries and even code edits between suspend and resume. When execution reaches a block whose logical path already has a `completed` `block_trace`, the runtime injects that recorded output and skips the block's `execute`. Replay (return a prior run's recorded output without re-running the block) happens transparently — downstream blocks see the same value they saw on the first run.

The suspending block is the exception. It has no committed output yet (it threw a suspension signal rather than returning), so it re-runs. This time `ctx.suspend()` returns the resume data instead of pausing.

## The sharp edge

A block's output is what gets memoized. A side effect is not. If a block sends an email, writes to an external system, or charges a card, and then the request later suspends and resumes, that block re-executes only if it has no committed output yet. The suspending block is exactly that block.

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

// Unsafe: the email fires every time this block runs. If this block is the
// one that suspends, the resume re-runs it and the customer gets a second email.
const notifyAndWait = handler({
  name: "notify-and-wait",
  inputSchema: z.object({ email: z.string(), draft: z.string() }),
  outputSchema: z.object({ approved: z.boolean() }),
  execute: async (input, ctx) => {
    await sendEmail(input.email, `Please review: ${input.draft}`);
    const decision = await ctx.suspend!({
      reason: "human_approval",
      message: "Awaiting review",
    });
    return decision as { approved: boolean };
  },
});
```

The email is not in the block's output, so memoization can't protect it. On resume the block re-runs from the top, `sendEmail` fires again, and only then does `ctx.suspend()` return the resume data.

## `ctx.runOnce(key, fn)` — the handler-only guard

Wrap a side effect in `ctx.runOnce(key, fn)` to keep it from firing twice. The first call for a given `(requestId, key)` runs `fn` and remembers the result; later calls in the same process return the remembered value without running `fn` again.

```ts
const notifyAndWait = handler({
  name: "notify-and-wait",
  inputSchema: z.object({ email: z.string(), draft: z.string() }),
  outputSchema: z.object({ approved: z.boolean() }),
  execute: async (input, ctx) => {
    await ctx.runOnce("review-email", async () => {
      await sendEmail(input.email, `Please review: ${input.draft}`);
    });
    const decision = await ctx.suspend!({
      reason: "human_approval",
      message: "Awaiting review",
    });
    return decision as { approved: boolean };
  },
});
```

Now the gate re-runs on resume, but `sendEmail` does not fire again. Here is why, and it is the part worth understanding. The re-run happens in a fresh execution, so `runOnce`'s in-process memo is empty. What saves you is its durable backstop: `runOnce` records each result keyed by `(requestId, key)`, and a resumed request keeps the **same** `requestId`. So the re-run looks the key up, finds the result the first run stored, and returns it without calling `fn`. Same-request continuation is exactly what makes this work — the stable id is the join key.

Be precise about the two layers. Within one process, the in-process memo fires `fn` exactly once: concurrent calls with the same key share one inflight promise, and the memo is set the instant `fn` resolves, before any store write. Across a resume (or a crash recovery), the durable record under the stable `requestId` is what dedups — the memo is gone, the record carries the result.

The one remaining gap is narrow: the durable write happens *after* `fn` resolves, so if the process crashes in the window between `fn` completing and that write landing, a later crash recovery starts with neither the memo nor the record and can re-fire the effect. For exactly-once even across that window, pair `runOnce` with provider-key idempotency: pass `ctx.idempotencyKey` to the external API so the provider de-dups even if your guard is gone. See [Idempotency and `runOnce`](./idempotency.md) for that pairing.

`runOnce` is a handler primitive. Generators and the composition layer don't get it.

## `transient: true` — opting out of retention

A block marked `transient: true` records no `block_trace` output, so it has nothing to replay and re-runs on resume. This is the rare case: you want a block to execute fresh every time, even across a pause. Most blocks should retain, so reach for `transient` only when re-execution is what you want.

## Control-flow determinism

The composition layer — the sequencer DSL callbacks (`.map`, `.stepIf`, `.workIf`, connector functions) — runs again on resume to rebuild the control flow up to the suspending block. Keep nondeterministic calls out of it. `Date.now()`, `Math.random()`, and `uuid()` in a connector or a `.stepIf` predicate can steer execution down a different branch on resume than it took the first time, and the replay index won't line up.

Push nondeterminism to a block boundary. Compute the timestamp or id inside a generator or handler whose output is recorded, or wrap it in `runOnce` so the value is fixed on the first run and replayed after. The composition layer then sees the same value both times.

## See also

- [Idempotency and `runOnce`](./idempotency.md) — provider-key idempotency for exactly-once across crashes.
- [Durable execution](./durable-execution.md) — suspend/resume, the continuous item log, and where memoization fits in the resume lifecycle.

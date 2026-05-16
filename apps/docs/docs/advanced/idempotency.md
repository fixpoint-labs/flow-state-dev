---
sidebar_position: 13
---

# Idempotency and `runOnce`

Block-level retries and request-recovery re-dispatches will re-invoke a handler more than once. If that handler talks to Stripe, Twilio, an email API, or anything else with a side effect, the framework needs a way to keep one logical attempt from billing the user twice. Two primitives cover that gap:

- `ctx.idempotencyKey` — a stable string you can hand to an external API as its idempotency header.
- `ctx.runOnce(key, fn)` — a wrapper that memoizes the result of `fn` per `(request, key)` and replays the stored value on retry instead of re-running it.

Both are opt-in. Nothing auto-wraps your handler.

## `ctx.idempotencyKey`

Every handler invocation gets a key of the form `${requestId}:${blockPath}`. It's deliberately scoped without the retry attempt, so all attempts of the same logical step within a request observe the same key. That's the value you want to pass to Stripe's `Idempotency-Key` header, Twilio's idempotency extension, or any provider that de-dups by key.

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const chargeCustomer = handler({
  name: "charge-customer",
  inputSchema: z.object({ amount: z.number(), source: z.string() }),
  outputSchema: z.object({ chargeId: z.string() }),
  retry: { maxAttempts: 3 },
  execute: async ({ amount, source }, ctx) => {
    const charge = await stripe.charges.create(
      { amount, currency: "usd", source },
      { idempotencyKey: ctx.idempotencyKey }
    );
    return { chargeId: charge.id };
  }
});
```

This is the simplest path when the provider supports idempotency natively — Stripe will return the original charge object on the second call rather than billing twice.

## `ctx.runOnce(key, fn)`

When the provider doesn't natively de-dup, or the side effect isn't an HTTP call you control, wrap the work in `runOnce`. The first invocation for a given `(requestId, key)` pair executes `fn` and persists the result. Subsequent invocations within the same request — whether triggered by a block retry, a re-entry, or a concurrent call racing the first — return the stored value without re-running `fn`.

```ts
execute: async (input, ctx) => {
  const message = await ctx.runOnce("sms-confirmation", async () => {
    const result = await twilio.messages.create({
      to: input.phone,
      from: TWILIO_FROM,
      body: `Your order ${input.orderId} is confirmed.`
    });
    return { sid: result.sid, status: result.status };
  });

  return { messageSid: message.sid };
}
```

The user-supplied key is the dedup unit. Concurrent calls inside the same handler that pass the same key share a single inflight promise, so the wrapped function cannot fire twice in a race. Different keys execute independently.

Stored values must be JSON-serializable. The framework writes them through the `RequestStore` — memory, filesystem, SQLite, and Postgres adapters all carry the table.

## What this does NOT guarantee

`runOnce` is request-scoped. Two important consequences:

- **Crash recovery starts fresh.** If a request is interrupted and `retryRequest` (FIX-294) dispatches a new attempt, the recovered request has a new `requestId` and therefore an empty `runOnce` namespace. Handlers that need cross-request de-dup should pass `ctx.idempotencyKey` to the external provider and rely on the provider's own dedup window, or store a user-controlled key in the user/session scope.
- **No distributed cache.** `runOnce` writes through the local request store. A distributed idempotency cache is out of scope for Phase 1; if you're running multiple instances behind a load balancer, rely on provider-side idempotency for cross-instance safety.

The scope boundary is deliberate. Cross-request de-dup is a different problem with different durability requirements (it implies persistent storage indexed by a user-controlled key, not the request lifecycle), and the framework would rather you reach for the external provider's contract than pretend to solve it locally.

## When to reach for which

| Situation | Use |
|---|---|
| Provider supports an idempotency header (Stripe, Twilio, Square) | `ctx.idempotencyKey` |
| Provider does not, but the side effect can be wrapped in a function | `ctx.runOnce(key, fn)` |
| You need to de-dup across requests (different `requestId`s) | A user-controlled external key, not `runOnce` |
| You want every retry to re-run the side effect | Don't wrap it — that's the default |

## Behavior under retry

```ts
let invocations = 0;
const flaky = handler({
  name: "flaky-charge",
  inputSchema: z.object({}),
  outputSchema: z.object({ chargeId: z.string() }),
  retry: { maxAttempts: 5 },
  execute: async (_input, ctx) => {
    const charge = await ctx.runOnce("charge", async () => {
      invocations += 1;
      return stripe.charges.create({ amount: 1000, currency: "usd", source: "tok_visa" });
    });
    if (Math.random() < 0.8) throw new NetworkError("flaky-network");
    return { chargeId: charge.id };
  }
});
```

`invocations` stays at `1` no matter how many times the handler retries. The charge fires once, on the attempt that first reached the `runOnce` call. Every later retry replays the persisted result and proceeds to whatever logic follows it.

The `attempt` counter on `ctx` still increments per retry — that's what lets you observe how many attempts ran, even though the wrapped work only fired once.

---
sidebar_position: 2
---

# Composing Blocks

This page covers the six sequencer methods you'll reach for on day one. They're enough to build most pipelines. The rest of the DSL (parallelism, looping, racing, branching) lives in the [Control Flow Reference](/docs/sequencers/control-flow), and you can ignore it until you actually need it.

The six methods are:

| Method | What it does |
|--------|-------------|
| `step(block)` | Run a block. Its output becomes the next step's input. |
| `map(fn)` | Inline transform. No block. Reshape the value between steps. |
| `tap(block)` | Run a block for its side effect. The pipeline value passes through unchanged. |
| `stepIf(cond, block)` | Run a block only when a condition is true. |
| `work(block)` | Fire a block in the background. The chain continues immediately. |
| `rescue(handlers)` | Catch errors and route to recovery blocks. |

The example in this page builds up an order-processing pipeline one method at a time. Each addition introduces one new method.

## Setup: a few blocks

We'll compose three blocks: a validator, an LLM-based pricing generator, and a recorder that writes the result to session state. The internals are simplified — focus on how they chain together.

```ts
import { handler, generator, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const orderInput = z.object({
  items: z.array(z.object({ sku: z.string(), qty: z.number() })),
  customerId: z.string(),
});

const pricedOrder = z.object({
  total: z.number(),
  discounted: z.boolean(),
});

// Validator: throws on bad input. No output — pipeline value passes through.
const validateOrder = handler({
  name: "validate-order",
  inputSchema: orderInput,
  execute: async (input) => {
    if (input.items.length === 0) throw new Error("Empty order");
  },
});

// Generator: applies pricing rules to the order.
const priceOrder = generator({
  name: "price-order",
  model: "preset/fast",
  prompt: "You apply customer-specific pricing rules.",
  inputSchema: orderInput,
  outputSchema: pricedOrder,
  user: (input) => `Price this order: ${JSON.stringify(input)}`,
});

// Recorder: writes the priced result to session state and returns an order id.
const recordOrder = handler({
  name: "record-order",
  inputSchema: pricedOrder,
  outputSchema: z.object({ orderId: z.string() }),
  sessionStateSchema: z.object({
    lastOrderId: z.string().optional(),
    lastOrderTotal: z.number().optional(),
  }),
  execute: async (input, ctx) => {
    const orderId = crypto.randomUUID();
    await ctx.session.patchState({
      lastOrderId: orderId,
      lastOrderTotal: input.total,
    });
    return { orderId };
  },
});
```

`validateOrder` has no `outputSchema` and returns nothing. That's the correct shape for a pure check: throw if the input is bad, otherwise stay out of the way. We'll attach it with `.tap()` below.

`recordOrder` declares a `sessionStateSchema` so TypeScript types `ctx.session.state` to those fields. See [State and scopes](/docs/fundamentals/state-and-scopes) for the full state API.

## `step` — sequencing blocks

Chain blocks with `.step()`. Each block's output is the next block's input. TypeScript checks the types between steps.

```ts
const orderPipeline = sequencer({
  name: "order-pipeline",
  inputSchema: orderInput,
})
  .step(priceOrder)
  .step(recordOrder);
```

`priceOrder` produces `{ total, discounted }`. `recordOrder` consumes that shape and produces `{ orderId }`. The sequencer's output type is whatever the last step returns.

If the next block expects a different shape, pass a connector function as the first argument:

```ts
.step((output) => ({ amount: output.total }), chargeBlock)
```

The connector receives the previous output and returns the input the next block expects. See [Connectors](/docs/sequencers/connectors).

## `tap` — side effects without changing the payload

Some blocks exist to do something — log, validate, mutate state — without transforming the pipeline value. Use `.tap()`. The block runs, the value passes through unchanged.

```ts
sequencer({ name: "order-pipeline", inputSchema: orderInput })
  .tap(validateOrder)   // throws if invalid; otherwise no-op
  .step(priceOrder)     // still receives the original orderInput
  .step(recordOrder);
```

`priceOrder` gets the original input, not anything from `validateOrder`. `validateOrder` has no output to merge in — it either throws or it doesn't.

This is the right shape for a validator. Don't write a handler that returns its input back out just to satisfy `.step()` — that pollutes the items log with a redundant echo. If a block has no meaningful output, drop the `outputSchema` and use `.tap()`.

The same applies to logging, telemetry, and state mutation. If the only purpose is the side effect, it's a tap.

## `map` — inline transform

Sometimes you need to reshape a value between steps without running a block. Use `.map()`. It's a pure function, not a block, so it doesn't show up as its own step in the items log.

```ts
.step(priceOrder)
.map((priced) => ({ ...priced, totalCents: Math.round(priced.total * 100) }))
.step(recordOrder)
```

`map` is for cheap synchronous reshaping. If the transform has side effects, hits the network, or you want it to appear as a step in the trace, use a handler block with `.step()` instead.

## `stepIf` — run a step only when a condition holds

What if you only want to apply a discount on larger orders that aren't already discounted? Wrap the discount step in `.stepIf()`:

```ts
const applyVolumeDiscount = handler({
  name: "apply-volume-discount",
  inputSchema: pricedOrder,
  outputSchema: pricedOrder,
  execute: async (input) => ({
    total: input.total * 0.9,
    discounted: true,
  }),
});

sequencer({ name: "order-pipeline", inputSchema: orderInput })
  .tap(validateOrder)
  .step(priceOrder)
  .stepIf(
    (value) => value.total > 100 && !value.discounted,
    applyVolumeDiscount
  )
  .step(recordOrder);
```

The condition gets the current pipeline value and the block context. It can be sync or async. When it returns false the step is skipped and the pipeline value passes through unchanged — the next step still receives `priceOrder`'s output.

You can also reach into the context to read state from any scope the surrounding block has declared:

```ts
.stepIf(
  (value, ctx) => ctx.session.state.features.discountsEnabled,
  applyVolumeDiscount
)
```

`stepIf` also accepts a static boolean if the condition is known at build time:

```ts
.stepIf(ENABLE_DISCOUNTS, applyVolumeDiscount)
```

For conditional side effects (a tap that runs only when something is true) use `tapIf`. For conditional background work, `workIf`. Both are in the [Control Flow Reference](/docs/sequencers/control-flow).

## `work` — fire-and-forget background tasks

Some work shouldn't block the user. Analytics is the classic example: you want it to run, but the customer doesn't have to wait for it. `.work()` queues a block in the background and lets the chain continue immediately.

```ts
const trackOrder = handler({
  name: "track-order",
  inputSchema: z.object({ orderId: z.string() }),
  execute: async (input, ctx) => {
    await fetch("https://analytics.example.com/orders", {
      method: "POST",
      body: JSON.stringify({ orderId: input.orderId }),
      signal: ctx.signal,
    });
  },
});

orderPipeline
  .tap(validateOrder)
  .step(priceOrder)
  .step(recordOrder)
  .work(trackOrder);     // dispatched, not awaited
```

`recordOrder` returns immediately. `trackOrder` runs in parallel. The sequencer waits for outstanding `.work()` tasks to settle before it returns, so they don't get orphaned, but they don't slow the main chain.

If a `.work()` block throws, the main chain is *not* aborted. The framework logs the failure and the failed `block_trace` reaches the DevTool via the trace channel; nothing surfaces in the user-visible stream.

For more on background work — including waiting on results, fan-out over arrays, and conditional dispatch — see [Side Chains](/docs/advanced/sequencer-side-chains).

## `rescue` — catch errors, route to recovery

By default a thrown error halts the sequencer. `.rescue()` lets you intercept errors and route them to recovery blocks based on error type.

```ts
class PaymentDeclinedError extends Error {}
class NetworkError extends Error {}

const retryWithDifferentProvider = handler({
  name: "retry-different-provider",
  inputSchema: z.unknown(),
  outputSchema: z.object({ orderId: z.string() }),
  execute: async () => {
    // ... try a backup payment provider, return { orderId } on success
    return { orderId: crypto.randomUUID() };
  },
});

const recordFailedOrder = handler({
  name: "record-failed-order",
  inputSchema: z.unknown(),
  outputSchema: z.object({ orderId: z.string() }),
  execute: async () => {
    return { orderId: "failed" };
  },
});

orderPipeline
  .tap(validateOrder)
  .step(priceOrder)
  .step(recordOrder)
  .rescue([
    { when: [NetworkError], block: retryWithDifferentProvider },
    { when: [PaymentDeclinedError], block: recordFailedOrder },
  ]);
```

Handlers are checked in order. The first match runs. If the recovery block succeeds, its output continues down the chain. If no handler matches, the original error propagates up. Add a final entry without `when` to catch anything else.

If you don't add a rescue, errors bubble out and the sequencer fails — which is usually what you want.

For throwing structured errors with machine-readable codes and `details` that surface in the DevTool, see [Error handling](/docs/advanced/error-handling).

### Per-step rescue: recover and continue

`.rescue()` is also a method on any block, not just the sequencer. Call it on a single block and you get a copy that recovers from its own failure: if the block throws, the first matching handler runs and its output is returned in place of the throw. The handler runs with the block's own context, so it can read sequencer state.

The difference from the chain-level rescue above is scope, not behavior. Put a rescue on one step and the chain *continues* to the next step, because that step returned a value instead of throwing:

```ts
const fallbackPrice = handler({
  name: "fallback-price",
  inputSchema: z.unknown(),
  outputSchema: z.object({ price: z.number() }),
  execute: () => ({ price: 0 }),
});

pipeline
  .step(fetchInventory)
  // priceOrder can fail on its own without taking down the rest of the chain.
  .step(priceOrder.rescue([{ block: fallbackPrice }]))
  .step(recordOrder); // still runs, with the fallback price
```

Reach for a per-step rescue when one step is allowed to fail in isolation — a flaky external call, one element of a fan-out, one branch of a `.parallel`. Reach for the chain-level `.rescue()` when a failure anywhere in the chain should stop it and route to recovery. Both are the same operation; you choose where it applies.

A `.tap()` step that carries a rescue runs its handler for the side effect and leaves the running value unchanged, since `.tap` never changes the value. That is the shape for "mark this record failed and keep going."

On a `.step`, the handler's output replaces the failed block's output and flows on to the next step as that block's output type. The compiler does not check this for you — a rescue handler is typed loosely — so make sure the handler returns a value that satisfies the rescued block's output contract, or the next step receives something its input doesn't expect.

### Querying rescue status

Rescue catches an error and routes it to a recovery block. Sometimes a later step needs to know that happened: did the block before me throw and get recovered, or did it run cleanly? `ctx.wasRescued(...)` answers that without the recovered value having to carry a marker.

Pass it a block name or a block definition — typically a step that carries its own `.rescue()`. It returns `true` only when that block ran as a prior step in the current sequencer and recovered an error through its own rescue. It returns `false` for a clean run, a step that never ran (skipped by `.stepIf`), an unknown name, or a call from outside a sequencer. It never throws.

```ts
// callSearchApi carries its own leaf rescue, so the step recovers in place.
const primarySearch = callSearchApi.rescue([{ block: fallbackSearch }]);

sequencer({ name: "search-pipeline", inputSchema: query })
  .step(primarySearch)
  // Ranking assumes fresh API results, so skip it when the fallback ran.
  .stepIf((results, ctx) => !ctx.wasRescued(primarySearch), rankResults)
  .step(renderResults);
```

The status is transient: it lives for the current sequencer run and is resolved by name, the same way `getBlockResult` resolves a prior block. Under a loop it reflects the current iteration, not an earlier one. Reach for it when a downstream step should adapt to a fallback being taken, and you'd otherwise be tempted to thread a flag through state.

## Putting it together

Here's the pipeline using all six methods:

```ts
const orderPipeline = sequencer({
  name: "order-pipeline",
  inputSchema: orderInput,
})
  .tap(validateOrder)
  .step(priceOrder)
  .map((priced) => ({ ...priced, totalCents: Math.round(priced.total * 100) }))
  .stepIf(
    (value) => value.total > 100 && !value.discounted,
    applyVolumeDiscount
  )
  .step(recordOrder)
  .work(trackOrder)
  .rescue([
    { when: [NetworkError], block: retryWithDifferentProvider },
    { block: recordFailedOrder },
  ]);
```

Read top to bottom: validate (throws on bad input), price, normalize the shape, maybe discount, record, fire analytics in the background, recover from known errors. That covers a real pipeline with a small set of methods.

## When you outgrow this page

The six methods above handle the common cases. The DSL has more once you need it:

- **Run several blocks at once** → [`parallel`, `stepAll`, `forEach`](/docs/sequencers/control-flow#parallelism)
- **Loop until a condition is met** → [`doUntil`, `doWhile`, `loopBack`](/docs/sequencers/control-flow#looping)
- **Conditional taps and work** → [`tapIf`, `workIf`, `exitIf`](/docs/sequencers/control-flow#conditional-sub-cases)
- **Fallback chains and races** → [`stepAny`, `race`, `branch`](/docs/sequencers/control-flow#specialization)
- **Wait on background work before continuing** → [`waitForWork`](/docs/sequencers/control-flow#side-chain-coordination)
- **Wait for a condition over the item stream** → [`waitForCondition`](/docs/sequencers/wait-for-condition)
- **Per-block input adaptation** → [`connectInput`](/docs/sequencers/control-flow#connector-adaptation)

All of these live in the [Control Flow Reference](/docs/sequencers/control-flow), grouped by use case.

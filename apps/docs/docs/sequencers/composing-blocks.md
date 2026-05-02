---
sidebar_position: 2
---

# Composing Blocks

This page covers the six sequencer methods you'll reach for on day one. They're enough to build most pipelines. The rest of the DSL (parallelism, looping, racing, branching) lives in the [Control Flow Reference](/docs/sequencers/control-flow), and you can ignore it until you actually need it.

The six methods are:

| Method | What it does |
|--------|-------------|
| `then(block)` | Run a block. Its output becomes the next step's input. |
| `map(fn)` | Inline transform. No block. Reshape the value between steps. |
| `tap(block)` | Run a block for its side effect. The pipeline value passes through unchanged. |
| `thenIf(cond, block)` | Run a block only when a condition is true. |
| `work(block)` | Fire a block in the background. The chain continues immediately. |
| `rescue(handlers)` | Catch errors and route to recovery blocks. |

The example in this page builds up an order-processing pipeline one method at a time. Each addition introduces one new method.

## Setup: a few blocks

We'll compose four blocks: a validator, an LLM-based pricing generator, a database writer, and an analytics block. The exact internals don't matter — focus on how they chain together.

```ts
import { handler, generator, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const validateOrder = handler({
  name: "validate-order",
  inputSchema: z.object({
    items: z.array(z.object({ sku: z.string(), qty: z.number() })),
    customerId: z.string(),
  }),
  outputSchema: z.object({
    items: z.array(z.object({ sku: z.string(), qty: z.number() })),
    customerId: z.string(),
  }),
  execute: async (input) => {
    if (input.items.length === 0) throw new Error("Empty order");
    return input;
  },
});

const priceOrder = generator({
  name: "price-order",
  model: "preset/fast",
  prompt: "You apply customer-specific pricing rules to orders.",
  inputSchema: z.object({
    items: z.array(z.object({ sku: z.string(), qty: z.number() })),
    customerId: z.string(),
  }),
  outputSchema: z.object({ total: z.number(), discounted: z.boolean() }),
  user: (input) => `Price this order: ${JSON.stringify(input)}`,
});

const saveOrder = handler({
  name: "save-order",
  inputSchema: z.object({ total: z.number(), discounted: z.boolean() }),
  outputSchema: z.object({ orderId: z.string() }),
  execute: async (input, ctx) => {
    const orderId = await ctx.db.insertOrder(input);
    return { orderId };
  },
});
```

## `then` — sequential steps

Chain blocks with `.then()`. Each block's output is the next block's input. TypeScript checks the types between steps.

```ts
const orderPipeline = sequencer({
  name: "order-pipeline",
  inputSchema: z.object({
    items: z.array(z.object({ sku: z.string(), qty: z.number() })),
    customerId: z.string(),
  }),
})
  .then(validateOrder)
  .then(priceOrder)
  .then(saveOrder);
```

`validateOrder` produces an order. `priceOrder` produces `{ total, discounted }`. `saveOrder` produces `{ orderId }`. The sequencer's output type is whatever the last step returns.

If the next block expects a different shape, pass a connector function as the first argument:

```ts
.then((output) => ({ amount: output.total }), chargeBlock)
```

The connector receives the previous output and returns the input the next block expects. See [Connectors](/docs/sequencers/connectors).

## `map` — inline transform

Sometimes you need to reshape the value between steps without running a block. Use `.map()`. It's a pure function, not a block, so it doesn't show up as its own step in the items log.

```ts
.then(priceOrder)
.map((priced) => ({ ...priced, totalCents: Math.round(priced.total * 100) }))
.then(saveOrder)
```

`map` is for cheap synchronous reshaping. If the transform has side effects, hits the network, or you'd want to see it as a step in the trace, use a handler block with `.then()` instead.

## `tap` — side effects without changing the payload

When you need to run a block for its effect (logging, telemetry, state mutation) but the next step still wants the previous value, use `.tap()`.

```ts
const logOrder = handler({
  name: "log-order",
  inputSchema: z.object({ total: z.number(), discounted: z.boolean() }),
  execute: async (input) => {
    console.log(`Pricing complete: $${input.total}`);
  },
});

orderPipeline
  .then(priceOrder)
  .tap(logOrder)        // runs, doesn't change the value
  .then(saveOrder);     // receives the priceOrder output, not logOrder's
```

`saveOrder` still gets `{ total, discounted }`. The pipeline value flows around `tap` like water around a rock. This is the right shape for any block that's purely a side effect — logging, mutating state, dispatching an event you want to await before continuing.

## `thenIf` — run a step only when a condition holds

What if you only want to apply a discount to first-time customers? Wrap the discount step in `.thenIf()`:

```ts
const applyFirstOrderDiscount = handler({
  name: "apply-first-order-discount",
  inputSchema: z.object({ total: z.number(), discounted: z.boolean() }),
  outputSchema: z.object({ total: z.number(), discounted: z.boolean() }),
  execute: async (input) => ({
    total: input.total * 0.9,
    discounted: true,
  }),
});

orderPipeline
  .then(validateOrder)
  .then(priceOrder)
  .thenIf(
    async (value, ctx) => {
      const orderCount = await ctx.db.countOrders(ctx.user.identity.id);
      return orderCount === 0;
    },
    applyFirstOrderDiscount
  )
  .then(saveOrder);
```

The condition gets the current pipeline value and the block context. It can be sync or async. When the condition is false, the step is skipped and the pipeline value passes through unchanged — the next step still receives the `priceOrder` output, just untransformed.

`thenIf` also accepts a static boolean if the condition is known at build time:

```ts
.thenIf(ENABLE_DISCOUNTS, applyFirstOrderDiscount)
```

For conditional side effects (run a tap only when something is true), there's `tapIf`. For conditional background work, there's `workIf`. Both are in the [Control Flow Reference](/docs/sequencers/control-flow).

## `work` — fire-and-forget background tasks

Some work shouldn't block the user. Analytics is the classic example: you want it to run, but the customer doesn't have to wait for it. `.work()` queues a block in the background and lets the chain continue immediately.

```ts
const trackOrder = handler({
  name: "track-order",
  inputSchema: z.object({ orderId: z.string() }),
  execute: async (input, ctx) => {
    await ctx.analytics.send("order_placed", { orderId: input.orderId });
  },
});

orderPipeline
  .then(validateOrder)
  .then(priceOrder)
  .then(saveOrder)
  .work(trackOrder)        // dispatched, not awaited
  .then(returnConfirmation);
```

`returnConfirmation` runs immediately after `saveOrder` finishes. `trackOrder` runs in parallel. The sequencer waits for any outstanding `.work()` tasks to settle before it returns, so they don't get orphaned, but they don't slow the main chain.

If a `.work()` block throws, the main chain is *not* aborted. The error is recorded as a `step_error` item on the work side. This is the right shape for non-essential work where failure is recoverable.

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
  execute: async (input) => {
    // ...
  },
});

const recordFailedOrder = handler({
  name: "record-failed-order",
  inputSchema: z.unknown(),
  outputSchema: z.object({ orderId: z.string() }),
  execute: async (input) => {
    // ...
  },
});

orderPipeline
  .then(validateOrder)
  .then(priceOrder)
  .then(saveOrder)
  .rescue([
    { when: [NetworkError], block: retryWithDifferentProvider },
    { when: [PaymentDeclinedError], block: recordFailedOrder },
    { block: genericRecovery },  // catch-all (no `when`)
  ]);
```

Handlers are checked in order. The first match runs. If the recovery block succeeds, its output continues down the chain. If no handler matches, the original error propagates up.

`rescue` is the only error-handling primitive in the DSL. There's no try/catch wrapping at the chain level. If you don't add `.rescue()`, errors bubble out and the sequencer fails — which is usually what you want.

## Putting it together

Here's the pipeline using all six methods:

```ts
const orderPipeline = sequencer({
  name: "order-pipeline",
  inputSchema: orderInput,
})
  .then(validateOrder)
  .then(priceOrder)
  .map((priced) => ({ ...priced, totalCents: Math.round(priced.total * 100) }))
  .thenIf(isFirstOrder, applyFirstOrderDiscount)
  .tap(logPricing)
  .then(saveOrder)
  .work(trackOrder)
  .rescue([
    { when: [NetworkError], block: retryWithDifferentProvider },
    { block: recordFailedOrder },
  ]);
```

Read top to bottom: validate, price, normalize the shape, maybe discount, log, save, fire analytics in the background, recover from known errors. That covers a real pipeline with a small set of methods.

## When you outgrow this page

The six methods above handle the common cases. The DSL has more once you need it:

- **Run several blocks at once** → [`parallel`, `thenAll`, `forEach`](/docs/sequencers/control-flow#parallelism)
- **Loop until a condition is met** → [`doUntil`, `doWhile`, `loopBack`](/docs/sequencers/control-flow#looping)
- **Conditional taps and work** → [`tapIf`, `workIf`, `exitIf`](/docs/sequencers/control-flow#conditional-sub-cases)
- **Fallback chains and races** → [`thenAny`, `race`, `branch`](/docs/sequencers/control-flow#specialization)
- **Wait on background work before continuing** → [`waitForWork`](/docs/sequencers/control-flow#side-chain-coordination)
- **Per-block input adaptation** → [`connectInput`](/docs/sequencers/control-flow#connector-adaptation)

All of these live in the [Control Flow Reference](/docs/sequencers/control-flow), grouped by use case.

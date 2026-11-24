---
title: Write a capability
type: recipe
description: "Bundle a resource, helper functions, a tool and a prompt section into one capability that any block can list, switch parts off per block, and make it configurable."
---

# Write a capability

Blocks are the steps of a flow. A handler runs your code; a generator calls a model. In a support desk, blocks that work with orders share a resource that remembers which order came up (a resource is named, stored data that a block declares) and helper functions that read it. A generator also wants a tool to look an order up and a line in its prompt about orders. Wired by hand, every block repeats those edits.

A capability packages them under one name. Any block lists it in `uses`, whether a handler, generator, evaluator, router or sequencer, and gets the resource and the helpers. The tool and the prompt line work only on a generator, and other blocks switch them off. This page builds `orders` for two generators, `draftReply` and `summarizeOrder`, and a handler, `refundLastOrder`.

## Step 1: Write the tool

A tool is a block the model calls. This one looks an order up and records which order it saw in a resource, written in step 3. `findOrder` is a stand-in in `src/lib/orders.ts` that returns only the caller's own orders.

```ts title="src/flows/support/tools/look-up-order.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { findOrder } from "../../../lib/orders";
import { orderLog } from "../resources/order-log";

export const lookUpOrder = handler({
  name: "lookUpOrder",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ status: z.string() }),
  resources: { orderLog },
  execute: async (input, ctx) => {
    const order = await findOrder(input.orderId, ctx.session.identity);
    if (!order) return { status: "not found" };
    await ctx.resources.orderLog.patchState({ lastOrderId: input.orderId });
    return { status: order.status };
  },
});
```

The block's `name` is what the model sees in its tool list.

## Step 2: Write the context section

A context section is text added to the generator's prompt. A string is the simplest form:

```text
Quote the order number whenever you mention an order.
```

It goes in the capability in step 4. The [reference](../reference/capabilities.md) says where it lands in the model's messages.

## Step 3: Declare the resource

The resource lives in a file of its own, because the tool and the capability both import it.

```ts title="src/flows/support/resources/order-log.ts"
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

export const orderLog = defineResource({
  scope: "session",
  stateSchema: z.object({ lastOrderId: z.string().nullable().default(null) }),
});
```

## Step 4: Bundle them

`defineCapability` takes a name, the resources, helpers in `fns`, and presets. A preset is a named part of the capability that a block can switch on or off. The context and the tools each get one, and `default` lists the presets that are on unless a block says otherwise.

```ts title="src/flows/support/capabilities/orders.ts"
import { defineCapability, type ContextOf } from "@flow-state-dev/core";
import { orderLog } from "../resources/order-log";
import { lookUpOrder } from "../tools/look-up-order";

export const orders = defineCapability({
  name: "orders",
  resources: { orderLog },
  fns: (ctx) => {
    const log = ctx.resources.orderLog as ContextOf<typeof orderLog>;
    return {
      lastOrderId: (): string | null => log.state.lastOrderId,
      clearLastOrder: () => log.patchState({ lastOrderId: null }),
    };
  },
  presets: {
    context: { context: "Quote the order number whenever you mention an order." },
    tools: { tools: [lookUpOrder] },
    default: ["context", "tools"],
  },
});
```

`fns` runs once per block run with that block's `ctx`; its helpers land at `ctx.cap.orders`, keyed by the capability's name. That `ctx` is not typed with the capability's resources, so the cast to [`ContextOf`](../reference/type-helpers.md) gives `orderLog` its `state` and `patchState`, and `lastOrderId` declares what it returns.

A generator lists it.

```ts title="src/flows/support/blocks/draft-reply.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { orders } from "../capabilities/orders";

export const draftReply = generator({
  name: "draftReply",
  model: "openai/gpt-6-luna",
  prompt: "Answer the customer's question about their order.",
  inputSchema: z.string(),
  user: (input) => input,
  uses: [orders],
});
```

`draftReply` has the context section in its prompt, `lookUpOrder` in its tool list, the `orderLog` resource and the helpers. A flow that includes `draftReply` declares nothing: the resource comes with the block.

## Step 5: Turn a preset off

`summarizeOrder` should see the order context and never call a tool. `.with({ tools: false })` switches the `tools` preset off for the one block that lists it.

```ts title="src/flows/support/blocks/summarize-order.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { orders } from "../capabilities/orders";

export const summarizeOrder = generator({
  name: "summarizeOrder",
  model: "openai/gpt-6-luna",
  prompt: "Summarize the order in one sentence.",
  inputSchema: z.string(),
  user: (input) => input,
  uses: [orders.with({ tools: false })],
});
```

`summarizeOrder` is offered no tools and gets the context and the resource. `orders` itself is unchanged, so `draftReply` keeps its tool. A misspelled key, as in `orders.with({ tool: false })`, throws at the call. The [reference](../reference/capabilities.md) covers the other ways to switch a preset.

## Step 6: Call a helper from a handler

`refundLastOrder` refunds the order `lookUpOrder` last looked up, read through the helper, with no model involved. `refundOrder` is a stand-in in `src/lib/orders.ts`.

```ts title="src/flows/support/blocks/refund-last-order.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { refundOrder } from "../../../lib/orders";
import { orders } from "../capabilities/orders";

export const refundLastOrder = handler({
  name: "refundLastOrder",
  inputSchema: z.object({}),
  outputSchema: z.object({ orderId: z.string(), refundCents: z.number() }).nullable(),
  uses: [orders.with({ context: false, tools: false })],
  execute: async (_input, ctx) => {
    const orderId = ctx.cap.orders.lastOrderId();
    if (orderId === null) return null;
    const { refundCents } = await refundOrder(orderId, ctx.session.identity);
    await ctx.cap.orders.clearLastOrder();
    return { orderId, refundCents };
  },
});
```

A handler that lists `orders` with its context or tools on throws when it is built, so it switches both off. Presets don't control `fns`, so the helpers and the resource stay. `ctx.cap.orders` is typed from `uses`: a misspelled helper is a compile error. After a refund, a second call refunds nothing and returns `null`.

## Step 7: Take a value with a factory

Presets switch parts the capability already has. They cannot change a resource's scope, which is set where the resource is defined. To let each app pick it, write a function that returns the capability. The file below replaces `capabilities/orders.ts` from step 4. The tool and the resource depend on the scope, so they move into the function; delete `tools/look-up-order.ts` and `resources/order-log.ts`.

```ts title="src/flows/support/capabilities/orders.ts"
import { defineCapability, defineResource, handler, type ContextOf } from "@flow-state-dev/core";
import { z } from "zod";
import { findOrder } from "../../../lib/orders";

export function createOrdersCapability(options: { scope: "session" | "user" }) {
  const orderLog = defineResource({
    scope: options.scope,
    stateSchema: z.object({ lastOrderId: z.string().nullable().default(null) }),
  });

  const lookUpOrder = handler({
    name: "lookUpOrder",
    inputSchema: z.object({ orderId: z.string() }),
    outputSchema: z.object({ status: z.string() }),
    resources: { orderLog },
    execute: async (input, ctx) => {
      const order = await findOrder(input.orderId, ctx.session.identity);
      if (!order) return { status: "not found" };
      await ctx.resources.orderLog.patchState({ lastOrderId: input.orderId });
      return { status: order.status };
    },
  });

  return defineCapability({
    name: "orders",
    resources: { orderLog },
    fns: (ctx) => {
      const log = ctx.resources.orderLog as ContextOf<typeof orderLog>;
      return {
        lastOrderId: (): string | null => log.state.lastOrderId,
        clearLastOrder: () => log.patchState({ lastOrderId: null }),
      };
    },
    presets: {
      context: { context: "Quote the order number whenever you mention an order." },
      tools: { tools: [lookUpOrder] },
      default: ["context", "tools"],
    },
  });
}

export const orders = createOrdersCapability({ scope: "session" });
```

With `scope: "session"`, a customer who comes back in a new session starts fresh: `lastOrderId` reads `null` until the tool writes it. With `scope: "user"` there is one log per user per organization, and it follows the customer between sessions.

The capability stores nothing itself. The resource lives in the flow's store, which is in memory by default and lost on restart unless you use a file, SQLite or Postgres store. See [Persistence](../concepts/persistence.md).

Call the factory once, in this file, and have every block import `orders`. If two blocks each called `createOrdersCapability({ scope: "session" })` in their own files, each call would make its own `orderLog`, and building the flow would throw `Resource conflict`.

A plain value, such as a limit, can go through `.config()` instead; see the [reference](../reference/capabilities.md).

## Next

- [Capabilities](../concepts/capabilities.md) explains the idea behind the bundle and how it differs from a kit.
- [Capabilities reference](../reference/capabilities.md) lists every preset rule, config option and limit.
- [Resources](../concepts/resources.md) covers scopes, storage and what a browser can see.

---
title: Write a capability
type: recipe
description: "Bundle a tool, a prompt section and a resource into one capability, switch parts off per block, and make it configurable."
---

# Write a capability

A generator is a block that calls a model. One that answers questions about orders needs three things: a tool the model can call to look an order up, a line in its prompt about how to talk about orders, and a resource to remember which order came up. A resource is named, stored data that a block declares. Wired by hand, every generator that touches orders repeats those three edits.

A capability packages them under one name. A block lists it in `uses` and gets all three. This page builds an `orders` capability for the support desk, listed by two generators, `draftReply` and `summarizeOrder`. For what a capability is and how it fits with kits, see [Capabilities](../concepts/capabilities.md). For every field and rule, see the [capabilities reference](../reference/capabilities.md).

## Step 1: Write the tool

A tool is a block the model calls. This one looks an order up and records which order it saw in a resource, written in step 3. `findOrder` is a stand-in in `src/lib/orders.ts`.

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
    const order = await findOrder(input.orderId);
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

It goes in the capability in step 4. Context and tools are for generators only; the [reference](../reference/capabilities.md) says where a context section lands in the model's messages and what happens on other block kinds.

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

`scope: "session"` gives each session its own `orderLog`.

## Step 4: Bundle them

`defineCapability` takes a name, the resources, and presets. A preset is a named part of the capability that a block can switch on or off. The context and the tools each get one, and `default` lists the presets that are on unless a block says otherwise.

```ts title="src/flows/support/capabilities/orders.ts"
import { defineCapability } from "@flow-state-dev/core";
import { orderLog } from "../resources/order-log";
import { lookUpOrder } from "../tools/look-up-order";

export const orders = defineCapability({
  name: "orders",
  resources: { orderLog },
  presets: {
    context: { context: "Quote the order number whenever you mention an order." },
    tools: { tools: [lookUpOrder] },
    default: ["context", "tools"],
  },
});
```

A generator gets all three by listing it.

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

`draftReply` has the context section in its prompt, `lookUpOrder` in its tool list and the `orderLog` resource. A flow that includes `draftReply` gets the resource from the block, so the flow declares nothing.

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

`summarizeOrder` is offered no tools and gets the context and the resource. `orders` itself is unchanged, so `draftReply` keeps its tool. A misspelled key is refused, not ignored. `orders.with({ tool: false })` throws at the call, naming the key and listing the presets `[context, tools]`, and for a capability with no config it is also a compile error. `orders.presets({ tool: false })` throws `Unknown preset "tool"` when the block is built. The [reference](../reference/capabilities.md) covers the other ways to switch a preset.

## Step 6: Take a value with a factory

Presets switch parts the capability already has. They cannot change a resource's scope, because the scope is set where the resource is defined. To let each app pick it, write a function that returns the capability. This replaces `capabilities/orders.ts` from step 4. The tool and the resource move inside the function, since both depend on the scope, so delete `tools/look-up-order.ts` and `resources/order-log.ts`.

```ts title="src/flows/support/capabilities/orders.ts"
import { defineCapability, defineResource, handler } from "@flow-state-dev/core";
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
      const order = await findOrder(input.orderId);
      await ctx.resources.orderLog.patchState({ lastOrderId: input.orderId });
      return { status: order.status };
    },
  });

  return defineCapability({
    name: `orders:${options.scope}`,
    resources: { orderLog },
    presets: {
      context: { context: "Quote the order number whenever you mention an order." },
      tools: { tools: [lookUpOrder] },
      default: ["context", "tools"],
    },
  });
}

export const orders = createOrdersCapability({ scope: "session" });
```

With `scope: "session"` there is one `orderLog` per session. A customer who comes back in a new session starts fresh: `lastOrderId` reads `null` until the tool writes it. With `scope: "user"` there is one per user per organization, so the log follows the customer between sessions.

The capability stores nothing itself. The resource lives in the flow's store, which is in memory by default and lost on restart unless you use a file, SQLite or Postgres store. See [Persistence](../concepts/persistence.md).

The name includes the scope because two different capability calls with the same name in one block throw `Capability name collision`. Call the factory once, in this file, and have every block import `orders`. If `draftReply` and `summarizeOrder` each called `createOrdersCapability({ scope: "session" })` in their own files, each call would make its own `orderLog`, and building the flow would throw `Resource conflict`. The [reference](../reference/capabilities.md) lists what else throws when names or resources collide.

For a value that is not a resource, such as a limit or a list, a capability can also take config through `.config()`. The [reference](../reference/capabilities.md) covers it.

## Next

- [Capabilities](../concepts/capabilities.md) explains the idea behind the bundle and how it differs from a kit.
- [Capabilities reference](../reference/capabilities.md) lists every preset rule, config option and limit.
- [Resources](../concepts/resources.md) covers scopes, storage and what a browser can see.

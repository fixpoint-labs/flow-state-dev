---
title: Capabilities
type: concept
description: A capability bundles the tools, context and resources for one ability, so a block gets all of it with one line.
---

# Capabilities

A support generator that answers questions about orders needs three things: the order data, a note in its prompt on how to use that data, and a tool that looks an order up. Wire them by hand and every generator that touches orders repeats the same three edits. Adding a second tool means finding all of them again.

A capability is those pieces packaged under one name. A block lists it in `uses` and gets everything the capability carries. A generator is the block that calls a model, and a resource is named, stored data a block declares. The examples are a support desk with an `orders` capability.

## A capability, defined once

The capability carries a resource, a section of prompt context, and a tool the model can call. The context and the tool sit in named presets, which a block can switch on and off. `default` lists the presets that are on unless a block says otherwise.

```ts title="src/flows/support/tools/look-up-order.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const lookUpOrder = handler({
  name: "lookUpOrder",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ status: z.string() }),
  execute: async (input) => ({ status: `Order ${input.orderId} has shipped.` }),
});
```

```ts title="src/flows/support/capabilities/orders.ts"
import { defineCapability, defineResource } from "@flow-state-dev/core";
import { z } from "zod";
import { lookUpOrder } from "../tools/look-up-order";

const orderLog = defineResource({
  scope: "session",
  stateSchema: z.object({ lastOrderId: z.string().nullable().default(null) }),
});

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

`lookUpOrder` is a block the model calls as a tool, and it lives in its own file beside the flow. `orderLog` is session-scoped, so each session gets its own record.

## One line in the block

The generator lists the capability and nothing else.

```ts title="src/flows/support/blocks/draft-reply.ts"
import { generator } from "@flow-state-dev/core";
import { orders } from "../capabilities/orders";

export const draftReply = generator({
  name: "draftReply",
  model: "openai/gpt-6-luna",
  prompt: "Answer the customer's question about their order.",
  uses: [orders],
});
```

`draftReply` has the `orderLog` resource, the context section in its prompt and `lookUpOrder` in its tool list. A flow that includes `draftReply` gets the resource from the block, so the flow declares nothing. Handlers, sequencers and routers take `uses` too. Context and tools only apply to a generator.

## Turning a part off

A reply drafter that should see the order context but never call a tool switches the `tools` preset off for that block.

```ts title="src/flows/support/blocks/summarize-order.ts"
import { generator } from "@flow-state-dev/core";
import { orders } from "../capabilities/orders";

export const summarizeOrder = generator({
  name: "summarizeOrder",
  model: "openai/gpt-6-luna",
  prompt: "Summarize the order in one sentence.",
  uses: [orders.with({ tools: false })],
});
```

`.with()` returns a new capability and leaves `orders` alone, so `draftReply` keeps its tool. A misspelled preset name throws. [The Reference page](../reference/capabilities.md) covers how `.with()` treats other keys and the values some capabilities accept through it.

## Tools a block names itself

A generator's `tools:` is the complete list of tools the model may call. Declare it and the tools a capability would have added are dropped.

```ts title="src/flows/support/blocks/refund-reply.ts"
import { generator } from "@flow-state-dev/core";
import { orders } from "../capabilities/orders";
import { issueRefund } from "../tools/issue-refund";

export const refundReply = generator({
  name: "refundReply",
  model: "openai/gpt-6-luna",
  prompt: "Handle the refund request.",
  tools: [issueRefund],
  uses: [orders],
});
```

`issueRefund` is another tool block, in `tools/issue-refund.ts`. The context section and the `orderLog` resource arrive, but `lookUpOrder` does not. Declaring the slot is what counts: `tools: []` means no tools at all, and leaving `tools:` out means the capability's tools reach the model. To keep one, name it in the list yourself.

Some tools, called controls, appear because the block's own settings asked for them, like the skill loader. They reach the model whatever `tools:` says.

## A capability that takes a value

When a capability needs a value at build time, such as which scope its resource has, export a function that returns the capability.

```ts title="src/flows/support/capabilities/create-orders-capability.ts"
import { defineCapability, defineResource } from "@flow-state-dev/core";
import { z } from "zod";
import { lookUpOrder } from "../tools/look-up-order";

export function createOrdersCapability(options: { scope: "session" | "user" }) {
  return defineCapability({
    name: `orders:${options.scope}`,
    resources: {
      orderLog: defineResource({
        scope: options.scope,
        stateSchema: z.object({ lastOrderId: z.string().nullable().default(null) }),
      }),
    },
    presets: { tools: { tools: [lookUpOrder] } },
  });
}
```

`scope: "session"` keeps the order log for one session, and `scope: "user"` keeps it across a user's sessions. Code that reads the log has to use the same scope. Two calls with different arguments need different names, which is why the scope is in the name.

## Who owns what it stores

A capability stores nothing itself. What it carries can: the resource it declares, whose scope is set on the resource. With `scope: "session"`, one `orderLog` exists per session, and the browser sees it only if the resource's client config exposes fields. [Resources](./resources.md) covers where it lives and how it is exposed.

## What it gets you

- **One edit reaches every block.** Add a second tool to the `tools` preset and every generator that lists `orders` has it.
- **One line per block.** `uses: [orders]` brings the resource, the context and the tool, so no block repeats the wiring.
- **A block can opt out of one part.** `orders.with({ tools: false })` changes one block. The others keep their tools.
- **Types follow.** A block that lists a capability sees the state and resources the capability declares in its `ctx`, with no second declaration.
- **Mistakes show up when the block is built.** A preset the block cannot take, or two different capabilities with one name, fail before the first request.

Helper functions a capability exposes on `ctx.cap.orders` are covered in [Write a capability](../build/write-a-capability.md).

## How it fits with the others

A kit packages a whole feature, with its flows and screens, that an app installs with one config object. A kit can contain capabilities, but a capability does not contain kits: it attaches to one block. Reach for a kit when the feature has screens or flows of its own, and a capability when you are bundling one ability for blocks. A capability can bring tools, but a tool is still a block the model calls, covered in [Generators and tools](./generators-and-tools.md).

## Next

- [Write a capability](../build/write-a-capability.md) builds one step by step, with helper functions and presets.
- [Kits and slots](./kits-and-slots.md) shows how a whole feature is packaged for an app.
- [Generators and tools](./generators-and-tools.md) covers the tool list a capability adds to.
- [Capabilities reference](../reference/capabilities.md) lists every field, preset rule, config option and limit.

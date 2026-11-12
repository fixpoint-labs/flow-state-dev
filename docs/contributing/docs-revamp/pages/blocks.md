---
title: Blocks
type: concept
description: A block is one named piece of work with a typed input and output. Flows are built by putting blocks inside blocks.
---

# Blocks

A customer writes in: "Where is my refund?" Before a reply goes back, a few things happen. The message is cleaned up. Something decides whether it's a refund question or a general one. A model writes the answer, and may need to look up an order first. Each step is a different kind of work, and you want to change one without touching the others.

A block is one of those steps: a named piece of work with a typed input and a typed output. You build a flow, the backend your app calls, by putting blocks together. Blocks can hold other blocks, so a whole pipeline is a block too.

![A sequencer containing a handler and a router, with generators and a tool inside](./figures/blocks.svg)

*A flow's blocks, nested. Description for the site's `Figure`: One large box, a sequencer named handleTicket, contains two steps joined by an arrow. The first step is a handler named cleanMessage. The second is a router named pickReply, which contains two generators, refundReply and draftReply. Inside draftReply, highlighted, is a handler named lookUpOrder that the model can call as a tool. This page builds the flow one piece at a time.*

## The smallest flow

Start with two blocks and a sequencer that runs them in order.

```ts title="src/flows/support/blocks/clean-message.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const cleanMessage = handler({
  name: "clean-message",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ text: z.string(), truncated: z.boolean() }),
  execute: async (input) => {
    const text = input.message.trim();
    return { text: text.slice(0, 2000), truncated: text.length > 2000 };
  },
});
```

```ts title="src/flows/support/blocks/draft-reply.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const draftReply = generator({
  name: "draft-reply",
  model: "openai/gpt-6-luna",
  prompt: "You answer customer support messages. Be brief and specific.",
  inputSchema: z.string(),
  user: (input) => input,
  itemVisibility: { client: true, history: true },
});
```

```ts title="src/flows/support/blocks/handle-ticket.ts"
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { cleanMessage } from "./clean-message";
import { draftReply } from "./draft-reply";

export const handleTicket = sequencer({
  name: "handle-ticket",
  inputSchema: z.object({ message: z.string() }),
})
  .step(cleanMessage)
  .step((cleaned) => cleaned.text, draftReply);
```

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { handleTicket } from "./blocks/handle-ticket";

export default defineFlow({
  kind: "support",
  actions: { reply: { block: handleTicket } },
})();
```

`cleanMessage` is a handler, a block that runs your code. `draftReply` is a generator, a block that asks a model to write. Each has a `name` and schemas for what goes in and what comes out.

The sequencer runs `cleanMessage`, then hands its output to the next step. That output is an object, and `draftReply` wants a string, so the second step starts with a small function that reshapes one into the other. It's called a connector.

The flow exposes `handleTicket` as an action named `reply`, a call a client can make. It can do that because a sequencer is a block like any other. Without `itemVisibility`, a generator streams nothing to the user. This one streams its reply and keeps it in the conversation.

## The five kinds

| Kind | What it does | In this flow |
| --- | --- | --- |
| Handler | Runs your code | `cleanMessage` |
| Generator | Asks a model to write: text, tool calls, or a typed object | `draftReply` |
| Evaluator | Asks a model questions whose answers you already know, and gets typed answers back | Could answer "is this about a refund?" |
| Sequencer | Runs blocks in order | `handleTicket` |
| Router | Picks one block to run | `pickReply`, below |

The first three do work. The last two only arrange other blocks, which is why they nest.

A handler sends the user nothing unless it calls `ctx.emit.message`, so it can do its work quietly. An evaluator is for when your code is going to branch on a model's answer. You give it questions such as `choice`, `score` and `boolean`, and the answer comes back typed, so `answers.team.choice` is one of your options rather than a string. It needs a model that supports evaluation. A model that can only write text is refused before any call is made.

## Picking one block at run time

Refund questions deserve their own prompt. A router chooses between blocks while the flow runs.

```ts title="src/flows/support/blocks/pick-reply.ts"
import { router } from "@flow-state-dev/core";
import { z } from "zod";
import { draftReply } from "./draft-reply";
import { refundReply } from "./refund-reply";

export const pickReply = router({
  name: "pick-reply",
  inputSchema: z.string(),
  outputSchema: z.string(),
  routes: [refundReply, draftReply],
  execute: (input) => (input.toLowerCase().includes("refund") ? refundReply : draftReply),
});
```

`refundReply` is a second generator, shaped like `draftReply` with a prompt about the refund policy. It lives in its own file beside the others.

The router lists every block it might pick in `routes`, and `execute` returns one of them. Return a block that isn't listed and the router throws. Every route takes the router's input and returns its output, so the sequencer can treat the router as one step:

```ts title="src/flows/support/blocks/handle-ticket.ts"
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { cleanMessage } from "./clean-message";
import { pickReply } from "./pick-reply";

export const handleTicket = sequencer({
  name: "handle-ticket",
  inputSchema: z.object({ message: z.string() }),
})
  .step(cleanMessage)
  .step((cleaned) => cleaned.text, pickReply);
```

This continues the sequencer above, with `pickReply` in place of `draftReply`. Plain code made the choice here. When a model should make it, an evaluator answers and the router reads the answer.

## Giving a block to a model

A generator can call blocks as tools. Any block will do: a handler, a router, or a sequencer that runs a whole pipeline behind one tool call.

```ts title="src/flows/support/tools/look-up-order.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

// A stand-in for your order system.
const orders: Record<string, string> = { "A-1001": "shipped Tuesday" };

export const lookUpOrder = handler({
  name: "look-up-order",
  description: "Look up where an order is. Use it when the customer gives an order id.",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.string(),
  execute: async (input) => orders[input.orderId] ?? "No order with that id.",
});
```

```ts title="src/flows/support/blocks/draft-reply.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { lookUpOrder } from "../tools/look-up-order";

export const draftReply = generator({
  name: "draft-reply",
  model: "openai/gpt-6-luna",
  prompt: "You answer customer support messages. Be brief and specific.",
  inputSchema: z.string(),
  user: (input) => input,
  tools: [lookUpOrder],
  itemVisibility: { client: true, history: true },
});
```

This continues `draftReply` with one new line, `tools`. The model decides when to call `lookUpOrder` from its name and description. The framework runs the block and gives the result back to the model.

A block from a pattern or another package may have a name that reads wrong to the model. `block.as({ name, description })` returns a copy under a new name or description and leaves the original alone. Two different blocks with the same name in one generator's `tools` make it throw.

## What a block carries with it

A block declares the state and resources it uses. A resource is stored data a flow declares, such as a document or a list. The flow that includes the block supplies them. So a block moves into another flow on its own, with nothing to wire up by hand, and a block that needs a resource brings its declaration along.

## What a block won't do

- Run itself. A flow action, a parent block, or a model's tool call runs it. You can't call a block like a function.
- Call other blocks from inside its code. A handler that needs another block's output belongs after that block in a sequencer.
- Show anything to the user by default. A generator needs `itemVisibility`, and a handler needs `ctx.emit`.

## Next

- [Generators and tools](./generators-and-tools.md) goes deeper on prompts, history, structured output and giving a model tools.
- [Composition](./composition.md) covers the rest of the sequencer: parallel steps, loops, side chains and error recovery.
- [Flows and actions](./flows-and-actions.md) shows how a block becomes something a client can call.
- [Blocks reference](../reference/blocks.md) lists every option each kind takes.

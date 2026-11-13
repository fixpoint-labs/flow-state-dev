---
title: Blocks
type: concept
description: A block is one named piece of work with a typed input and output. Flows are built by putting blocks inside blocks.
---

import Figure from "@site/src/components/Figure";
import Blocks from "./figures/blocks.svg";

# Blocks

A block is a typed unit of work that the framework runs: a name, a schema for what goes in, a schema for what comes out, and the work in between, which is your code or a model. You build a flow, the backend your app calls, by putting blocks together. Blocks can hold other blocks, so a whole pipeline is a block too.

The example on this page is a support desk's reply pipeline: clean up a customer's message, have a model draft the answer, and let the model look up an order.

<Figure svg={Blocks} caption="A flow's blocks, nested" description={"One large box, a sequencer named handleTicket, contains two steps joined by an arrow that means each step's output becomes the next step's input. The first step is a handler named cleanMessage, which trims long messages. The second is a generator named draftReply, which asks a model to write the reply. Inside draftReply, highlighted, is a handler named lookUpOrder that the model can call as a tool: a tool is a block too. Every box is a block, with typed input in and typed output out."} />

## The smallest flow

A handler is a block that runs your code. A generator is a block that asks a model to write. Here is one of each.

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

A sequencer, a block that runs other blocks in order, joins them:

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

Look at the two kinds first. The handler is plain code with a schema for what goes in and what comes out. The generator is a model, a prompt, and what to send it as the user's message.

Then the connector. `cleanMessage` returns an object, and `draftReply` wants a string, so the second step begins with a small function that reshapes one into the other.

`itemVisibility: { client: true, history: true }` shows the reply to the user and keeps it in the model's history for later turns. The [items reference](../reference/items.md) lists the other settings and the defaults for each kind of block.

A flow exposes a block as an action, a call a client can make. `defineFlow({ kind: "support", actions: { reply: { block: handleTicket } } })` makes this one callable as `reply`, because a sequencer is a block like any other.

## What passes between steps

For `draftReply` to trust the value it receives, two blocks each declare their half of the contract. The producer, `cleanMessage`, declares an `outputSchema`. The consumer declares an `inputSchema`. Both are Zod schemas.

The framework checks each side. When the shapes of two neighbouring steps differ, you reshape the value with a connector, the function in `.step(connector, block)`.

The check happens when the flow runs, not when TypeScript compiles. Connecting `cleanMessage` straight to `draftReply` with no connector type-checks, then fails the first time it runs, because `draftReply` wants a string and gets an object. The [blocks reference](../reference/blocks.md) lists the order of the checks, what a failed one looks like, and what a missing schema does.

## The five kinds

| Kind | What it does | In this flow |
| --- | --- | --- |
| Handler | Runs your code | `cleanMessage` |
| Generator | Asks a model to write: text, tool calls, or a typed object | `draftReply` |
| Evaluator | Asks a model a question and gets a typed answer: a choice, a score, a yes or no | Not used here |
| Sequencer | Runs blocks in order | `handleTicket` |
| Router | Picks one block to run | Not used here |

## Blocks inside blocks

Look at the last two rows. A sequencer and a router do no work of their own. They arrange other blocks, and because they are blocks, they nest. `handleTicket` could be a step in a longer sequencer, or the block a router picks.

A router returns one of the blocks it lists, chosen by your code. Every route takes the router's input and returns its output, so a sequencer can treat the router as one step.

An evaluator is for when your code will branch on a model's answer, such as whether a message is about a refund. [Generators and tools](./generators-and-tools.md) covers it.

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

Add `tools: [lookUpOrder]` to `draftReply`, importing `lookUpOrder` from `../tools/look-up-order`. The model decides when to call it from its name and description. The framework runs the block and gives the result back to the model.

The model sees the same three things for any block: its `name`, its `description`, and its `inputSchema` as the parameters. So you could hand it `handleTicket` the same way, and it would see a name, a description and an input shape, not the steps. What the sequencer returns, its last step's output, goes back to the model as the tool result.

If `lookUpOrder` read a stored list of orders, it would declare that list as a resource, stored data a flow keeps. Any flow that includes the block gets the resource, with no extra setup. [Resources](./resources.md) covers them.

## What a block gets you

Each step in its own block gets you these:

- **A finished block is a checkpoint.** Its output is recorded. On a store that persists, such as SQLite or Postgres, a run that dies after `cleanMessage` picks up at `draftReply` when you continue it. The message is not cleaned twice. An in-memory store keeps no checkpoints, so a crashed run there cannot be continued. Use a filesystem, SQLite or Postgres store to get them. The [durable execution reference](../reference/durable-execution.md) covers how to continue a run.
- **A block can wait.** A block can pause the run for a user, such as a manager approving a refund, and carry on when the answer arrives. The [durable execution reference](../reference/durable-execution.md) covers how a wait is answered.
- **Every block is traced.** Each time a block runs, the run is recorded, and the DevTool shows it. You can see which step was slow or wrong without adding any logging.
- **A block moves.** It knows only its own input and output. `lookUpOrder` can be a step in this flow, a tool in another, and a piece of something a teammate builds later.

## How it fits with the others

A block is not a function you call from your code. The framework runs it, as an action, a step, a route or a tool, and the [blocks reference](../reference/blocks.md) lists the limits that follow. A flow is the layer above: the set of blocks a client can reach.

## Next

- [Generators and tools](./generators-and-tools.md) goes deeper on prompts, history, structured output, evaluators and giving a model tools.
- [Composition](./composition.md) covers the rest of the sequencer: parallel steps, loops, side chains and error recovery.
- [Flows and actions](./flows-and-actions.md) shows how a block becomes something a client can call.
- [Blocks reference](../reference/blocks.md) lists every option each kind takes.

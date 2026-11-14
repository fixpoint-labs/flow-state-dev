---
title: Composition
type: concept
description: Blocks join in sequence, by choice, side by side, or alongside the reply. Each join is a block too, so joined pipelines nest.
---

import Figure from "@site/src/components/Figure";
import FourWays from "./figures/composition-four-ways.svg";
import Passes from "./figures/composition-passes.svg";

# Composition

Flow State has five kinds of block and no special feature for each shape you might build from them. A pipeline, a branch, lookups that run side by side and logging that runs in the background are all blocks joined together, and the join is a block too. Most of what an app needs is a composition of what already exists, which keeps the framework small and every part of it working the same way.

A block is a named unit of work that declares what goes in and what comes out. Blocks join one after another, as one of several, several at once, or alongside the reply without holding it up.

The result of a join is a block. A router is one, and a sequencer is one however it mixes `.step()`, `.parallel()` and `.sideChain()`. A pipeline you build from five blocks can be a step in a bigger one.

<Figure svg={FourWays} caption="Four ways to join blocks" description={"Four boxes side by side on one canvas. Sequence: cleanMessage, then an arrow down to draftReply, one after the other. Router: routeTicket with an arrow to each of two routes, refund and answer, where your code picks one route. Parallel: three lookups named order, account and stock each with an arrow into one box holding one object; all start together and the next step waits for the slowest. Side chain: draftReply with a solid arrow down to the next step and a dashed arrow to a log block; the chain goes on at once and the turn ends after the log. A solid arrow means a block passes its output on. The dashed arrow means the log runs only alongside and nothing waits for it."} />

The example is a support desk's reply pipeline, `handleTicket`: clean the customer's message, then have a model draft the answer.

## A sequence

A sequencer is the block that runs other blocks in order. You add blocks with `.step()`. Each step starts when the one before it has finished.

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

`cleanMessage` and `draftReply` are blocks, each in its own file beside this one. `cleanMessage` returns `{ text, truncated }`. `draftReply` takes a string.

The sequencer takes the first step's input and returns the last step's output.

## What passes between steps

<Figure svg={Passes} caption="What passes between steps" description={"The sequencer handleTicket, which takes an object with a message and returns a string, drawn as a row of three boxes. A handler, cleanMessage, passes an object with text and truncated along an arrow to a highlighted connector, cleaned.text. The connector passes a string along a second arrow to a generator, draftReply. A line below says a step receives the step before it, and nothing earlier. The key explains the arrow as one step passing its output on, and the highlighted box as the reshaping step."} />

A step receives the previous step's output, and nothing from earlier steps. When the next block wants a different shape, the reshaping goes between them. In `handleTicket` it is the function `(cleaned) => cleaned.text`, a connector that runs before `draftReply` and returns what `draftReply` takes. Neither block changes. TypeScript does not check that one step's output fits the next step's input, so a mismatch shows up at run time: the next block's `inputSchema` rejects the value, and the error names the block and the field.

The reshaping can also stand on its own line, with `.map()`.

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
  .map((cleaned) => cleaned.text)
  .step(draftReply);
```

A `.map()` is a plain function, not a block. When to use a handler instead, and how shapes are checked, is in [Sequencer methods](../reference/sequencer-methods.md).

## A choice

A router is a block that picks one of several blocks to run. It lists its routes, and its `execute` function returns the one to run.

```ts title="src/flows/support/blocks/route-ticket.ts"
import { router } from "@flow-state-dev/core";
import { z } from "zod";
import { answer } from "./answer";
import { refund } from "./refund";

export const routeTicket = router({
  name: "route-ticket",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.string(),
  routes: [refund, answer],
  execute: (input) => (input.message.toLowerCase().includes("refund") ? refund : answer),
});
```

`refund` and `answer` are sequencers shaped like `handleTicket`. Every route takes the router's input and returns its output, which is why a router can be one step in a sequencer.

To run one extra step only sometimes, use `.stepIf(condition, block)`, covered in [Sequencer methods](../reference/sequencer-methods.md).

## Side by side

`.parallel()` runs several blocks at once on the same input and hands the next step one object, keyed by the names you gave them.

```ts title="src/flows/support/blocks/gather-context.ts"
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { lookUpAccount } from "./look-up-account";
import { lookUpOrder } from "./look-up-order";
import { lookUpStock } from "./look-up-stock";

export const gatherContext = sequencer({
  name: "gather-context",
  inputSchema: z.object({ orderId: z.string() }),
}).parallel({ order: lookUpOrder, account: lookUpAccount, stock: lookUpStock });
```

The three lookups start together, each taking `{ orderId }`. The next step runs when the slowest has finished and receives `{ order, account, stock }`, each holding that lookup's output.

One failing lookup fails the whole step. A `.rescue()` on a lookup's block lets it fail alone: a recovery block runs, and its output is that lookup's value in the object. [Sequencer methods](../reference/sequencer-methods.md) has the details.

## Work that does not block the answer

`.sideChain()` starts a block alongside the chain and moves to the next step at once. The next step gets the value the chain already had.

```ts title="src/flows/support/blocks/log-ticket.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const logTicket = handler({
  name: "log-ticket",
  inputSchema: z.string(),
  execute: async (reply) => {
    console.log("replied:", reply);
  },
});
```

In `handleTicket`, add `.sideChain(logTicket)` after the `draftReply` step. The log gets the reply, and the chain moves on without waiting for it.

If `logTicket` throws, the reply is unaffected. How a side chain fails and how a later step waits for one are in [Sequencer methods](../reference/sequencer-methods.md), along with `.tap()`, which runs a block the same way but waits for it.

A side chain does not survive a restart. A turn is the run that answers one message. Work that must outlast it belongs on [background work](./background-work.md).

## What it gets you

- **A step can be swapped without touching its neighbours.** Replacing `draftReply` with another block changes at most the connector.
- **The whole pipeline is one block.** `handleTicket` is called as an action, nested in a router's routes, or handed to a model as a tool, and callers see a name, an input and an output.
- **Each step is recorded.** A failed turn can be read step by step in DevTool, the local debugger `fsdev dev` opens, and a router's choice is recorded with the route it took.
- **Failures stay where you put them.** A step's failure fails the chain, a side chain's does not, and a `.rescue()` changes that for one step.

## How it fits with the others

A sequencer's steps are fixed when you write it, and it runs inside one turn. A generator, the block that calls a model, lets the model choose at run time which blocks to call as tools. In a sequencer or router, your code makes that choice.

## Next

- [Generators and tools](./generators-and-tools.md): the model-driven alternative, where a model chooses which blocks to call.
- [Flows and actions](./flows-and-actions.md): how a sequencer becomes something a client can call.
- [Background work](./background-work.md): work that outlives the turn.
- [Sequencer methods](../reference/sequencer-methods.md): every join, loops, and the options each takes.

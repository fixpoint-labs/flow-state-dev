---
title: Generators and tools
type: concept
description: There is no agent() in Flow State. A generator is the block that calls a model, and a generator with tools is an agent. You choose how much the model decides.
---

import Figure from "@site/src/components/Figure";
import GeneratorLoop from "./figures/generator-loop.svg";
import GeneratorSpectrum from "./figures/generator-spectrum.svg";

# Generators and tools

There is no `agent()` in Flow State. A generator is the block that calls a model, and a block is the framework's unit of work: a name, a typed input, a typed output and the work between. Give a generator tools, which are other blocks it may call by name, and it is what other frameworks call an agent. How much the model decides is up to you.

The example on this page is a support desk. A customer writes "Where is my refund?", and the model can look up the order and issue the refund.

## If you know agents

In most frameworks an agent is a model, a prompt, some tools and a loop the framework runs. A generator with tools is that. The model calls a tool, the framework runs it and hands back the result, and the model is called again until it answers. You never write the loop.

The difference is what surrounds it. A generator is a block like any other, so it goes wherever a block can. Put it in a pipeline and your code decides when the model runs and what happens after. Hand it everything and the model decides.

## A generator with a tool

A tool is a block. This one is a handler, a block that runs your code.

```ts title="src/flows/support/tools/issue-refund.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const issueRefund = handler({
  name: "issue-refund",
  description: "Refund an order. Use it when the customer asks for money back.",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ reply: z.string(), refundCents: z.number() }),
  execute: async (input) => ({
    reply: `Refund issued for order ${input.orderId}.`,
    refundCents: 1200,
  }),
});
```

```ts title="src/flows/support/blocks/support-agent.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { issueRefund } from "../tools/issue-refund";
import { lookUpOrder } from "../tools/look-up-order";

export const supportAgent = generator({
  name: "support-agent",
  model: "openai/gpt-6-luna",
  prompt: "You answer customer support messages. Look up the order before you refund it.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
  tools: [lookUpOrder, issueRefund],
  itemVisibility: { client: true, history: true },
});
```

`lookUpOrder` is a handler like `issueRefund` that returns where an order is. It lives in its own file beside it.

Look at `tools`. Nothing marks a block as a tool except being listed there. The model sees each block's `name`, `description` and `inputSchema`, so the description is what tells it when to call, and you write it for the model. When it calls, the framework checks the arguments against the schema, runs the block and returns the output.

A tool is a block in a role. The same block can be an action a client calls, a step in a sequencer, or a tool.

## The loop the generator runs

<Figure svg={GeneratorLoop} caption="The loop a generator with tools runs" description={"Inside one dashed outline, which lasts one action run, the model and a tool pass work back and forth. On the left, a box for supportAgent, the model, with the row 'the model picks the next call' highlighted. An arrow numbered 01 runs from the model to the box on the right, lookUpOrder, a handler passed in tools, which takes an order id and returns 'shipped Tuesday'. An arrow numbered 02 returns the result to the model. When the model asks for no more calls, its text is the answer. The loop is the framework's, not code you write."} />

Each trip is one model call. If the model asks for a tool, the framework runs it, adds the result to the conversation and calls the model again. A call that asks for no tool ends the loop. The model can call one tool, several, or none and answer straight away.

A tool that fails does not end the run. The model is told what went wrong and can try again or answer. The [generators reference](../reference/generators.md) covers failed calls and the limits on the loop.

## How much the model decides

<Figure svg={GeneratorSpectrum} caption="The same reply, with the model deciding more" description={"Three columns side by side, each a version of the support reply. The first, a check after the model, is a sequencer named handleTicket that runs supportAgent and then checkRefundPolicy: the model chooses inside its step and the step after it always runs. The second, a pipeline as one tool, is supportAgent with one tool, refund, which is a sequencer holding issueRefund and then checkRefundPolicy. The check row is highlighted: the model decides whether to call refund, and when it does the check runs. The third, free tool choice, is supportAgent with lookUpOrder and issueRefund, and the model picks which, in what order and when to stop."} />

The third column is the `supportAgent` you started with: the model picks which tool, in what order and when to stop.

Say you want the model to choose between `lookUpOrder` and `issueRefund`, and you never want the policy check skipped. The first two columns keep the check. Both use the same check, a handler that takes a refund's result, a reply and an amount.

```ts title="src/flows/support/blocks/check-refund-policy.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const checkRefundPolicy = handler({
  name: "check-refund-policy",
  inputSchema: z.object({ reply: z.string(), refundCents: z.number() }),
  outputSchema: z.object({ reply: z.string(), needsReview: z.boolean() }),
  execute: async (input) => ({
    reply: input.reply,
    needsReview: input.refundCents > 5000,
  }),
});
```

The first way puts the check after the model, in a sequencer, a block that runs blocks in order. The model chooses inside its step. The step after it always runs.

The check reads the model's answer, so the model's answer must be in a shape code can read. Without an `outputSchema` a generator answers in text. Add `outputSchema: z.object({ reply: z.string(), refundCents: z.number() })` to `supportAgent` and it returns that object. The [generators reference](../reference/generators.md) says what happens to a reply that does not fit.

```ts title="src/flows/support/blocks/handle-ticket.ts"
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { checkRefundPolicy } from "./check-refund-policy";
import { supportAgent } from "./support-agent";

export const handleTicket = sequencer({
  name: "handle-ticket",
  inputSchema: z.object({ message: z.string() }),
})
  .step(supportAgent)
  .step(checkRefundPolicy);
```

The second way is a pipeline as the tool. A sequencer in `tools` reaches the model as one tool, with a name, a description and an input schema. The model never sees its steps. Here the check reads `issueRefund`'s output, so `supportAgent` needs no `outputSchema`.

```ts title="src/flows/support/tools/refund.ts"
import { sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { checkRefundPolicy } from "../blocks/check-refund-policy";
import { issueRefund } from "./issue-refund";

export const refund = sequencer({
  name: "refund",
  description: "Refund an order. Use it when the customer asks for money back.",
  inputSchema: z.object({ orderId: z.string() }),
})
  .step(issueRefund)
  .step(checkRefundPolicy);
```

In `supportAgent`, `refund` takes the place of `issueRefund`. The check runs whenever the model refunds, and the model gets back the check's result, `reply` and `needsReview`.

## What the model is told

A generator builds the model's input from four slots: `prompt`, `context`, `history` and `user`. `prompt` is the standing instructions you write, and it can live in a [prompt file](../build/prompt-files.md). `context` is what changes per turn. `history` loads earlier turns, and `user` is this turn's message.

Say the model needs the customer's plan. The plan differs per customer, so it goes in `context`, not `prompt`. Read it from state in a `context` function.

```ts title="src/flows/support/lib/customer-plan.ts"
import { contextFn } from "@flow-state-dev/core";
import { z } from "zod";

export const customerPlan = contextFn(
  { session: z.object({ plan: z.string().optional() }) },
  ({ session }) => `The customer is on the ${session.plan ?? "free"} plan.`,
);
```

Add `context: customerPlan` to `supportAgent`. `context` takes other forms too; the [generators reference](../reference/generators.md) lists them and the order the slots are assembled in.

## What it gets you

- **You choose how much the model decides, in one place.** `lookUpOrder`, `issueRefund` and `checkRefundPolicy` are the same in all three. Moving between columns changes how they are composed.
- **A tool keeps what a block has.** `lookUpOrder` has typed input and output, and it can be a tool here and a step in another flow.
- **The model reaches only what you hand it.** The `tools` list is its whole reach. Declaring `tools`, even `tools: []`, also drops any tools a capability would have added, so list those yourself if you want them.
- **You can see what it did.** Each tool call is recorded as an item, an entry in the run's stream, with its input and output, and the DevTool, the local debugging UI, shows the run as a tree.

## How it fits with the others

A router also picks what runs next, but your code makes the pick. In a generator with tools, the model makes it. An evaluator asks a model a question and gets a typed answer, which is the shape for branching on a model's judgement. A pattern such as a supervisor is a ready-made composition of generators with tools and sequencers.

## Next

- [Generators reference](../reference/generators.md) lists every option, the loop limits, and how failed calls and bad output behave.
- [Blocks](./blocks.md) covers the five kinds and how they nest.
- [Composition](./composition.md) covers parallel steps, loops and error recovery in a sequencer.
- [Models](./models.md) covers choosing and configuring the model a generator calls.

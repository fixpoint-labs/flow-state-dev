---
sidebar_position: 1
---

# Overview

Most frameworks force a choice: Agent (the LLM decides what to do next) or Workflow (your code decides). flow-state.dev rejects that split. Sequencers are the composition model. You chain blocks with `.then()`, `.thenIf()`, `.tap()`, and other DSL methods. Each step's output feeds into the next step's input. Type inference flows through the whole chain.

You can interleave deterministic and non-deterministic steps. Validate input with a handler, generate a response with a generator, extract structured data with a handler, refine with another generator. All in one pipeline. No artificial boundary between "AI steps" and "logic steps."

## Sequencers compose blocks

A **block** is the unit of work: a handler (deterministic logic), a generator (LLM call), a router (runtime dispatch), or another sequencer. See [Blocks](/docs/fundamentals/blocks) for the four block kinds. Sequencers compose them:

```ts
import { handler, generator, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const validate = handler({
  name: "validate",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ message: z.string() }),
  execute: async (input) => {
    if (!input.message.trim()) throw new Error("Empty message");
    return input;
  },
});

const agent = generator({
  name: "agent",
  model: "preset/fast",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
});

const extractJson = handler({
  name: "extract-json",
  inputSchema: z.string(),
  outputSchema: z.record(z.unknown()),
  execute: async (input) => {
    const match = input.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  },
});

const pipeline = sequencer({
  name: "chat-pipeline",
  inputSchema: z.object({ message: z.string() }),
})
  .then(validate)
  .then(agent)
  .map((out) => out.text)
  .then(extractJson);
```

Here, a handler validates, a generator produces text, a `.map()` extracts the text, and a handler parses JSON. The chain's output type is inferred from the last step.

## DSL methods

The DSL has 21 methods. You'll only use six on day one. The rest are there when you need them, organized by use case in the reference.

**[Composing Blocks](/docs/sequencers/composing-blocks)** — the six methods you'll reach for first:

| Method | Purpose |
|--------|---------|
| `then` | Run a block, pass output to the next step |
| `map` | Inline transform between steps (no block) |
| `tap` | Run a block for side effects, payload passes through |
| `thenIf` | Run a block only when a condition holds |
| `work` | Fire a block in the background, don't wait |
| `rescue` | Catch errors and route to recovery blocks |

**[Control Flow Reference](/docs/sequencers/control-flow)** — everything else, grouped by use case:

| Group | Methods |
|-------|---------|
| Parallelism | `parallel`, `forEach`, `forEachBackground`, `thenAll` |
| Looping | `doUntil`, `doWhile`, `loopBack` |
| Conditional sub-cases | `tapIf`, `workIf`, `exitIf` |
| Specialization (rarely needed) | `thenAny`, `race`, `branch` |
| Side-chain coordination | `waitForWork` |
| Connector adaptation | `connectInput` |

Each method returns a sequencer. You chain them: `.then(a).thenIf(cond, b).tap(c).then(d)`.

## Output flows forward

The pipeline is linear: step 1 output → step 2 input → step 2 output → step 3 input. Connectors let you reshape data when types don't match. See [Connectors](/docs/sequencers/connectors) for details. TypeScript infers the chain's output from the last step's schema.

## Sequencers are blocks

A sequencer is a block. It composes with any other block. You can nest sequencers, use a sequencer as a generator tool, or register it as a flow action:

```ts
const inner = sequencer({ name: "inner" }).then(blockA).then(blockB);
const outer = sequencer({ name: "outer" })
  .then(inner)
  .then(blockC);

// As a tool
const agent = generator({
  name: "agent",
  tools: [inner],
  // ...
});
```

## Container wrapping

A sequencer can emit a `container` item that groups its child items for UI display. Register a component for the container on the client to control how it renders.

```ts
sequencer({
  name: "chat-pipeline",
  inputSchema: chatInputSchema,
  container: {
    component: "chat-container",
    label: "Processing chat message",
  },
});
```

This is a rendering hint — it has no effect on execution order or block behavior.

## Where to go next

- **[Composing Blocks](/docs/sequencers/composing-blocks)** — start here. The six methods you'll use day one, with a worked example.
- **[Control Flow Reference](/docs/sequencers/control-flow)** — the remaining methods, grouped by use case.
- **[Connectors](/docs/sequencers/connectors)** — shaping data between steps, typed refs, and portability.
- **[Side Chains](/docs/advanced/sequencer-side-chains)** — fire-and-forget work with `.work()` and `.waitForWork()`.

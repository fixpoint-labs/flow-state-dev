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

| Method | Purpose |
|--------|---------|
| `then` | Run a block, pass output to next step |
| `thenIf` | Run a block only when a condition holds |
| `map` | Inline transform (no block) |
| `parallel` | Run multiple blocks concurrently, merge named outputs |
| `thenAll` | Run blocks concurrently, collect results as ordered array |
| `thenAny` | Try blocks sequentially, return first success |
| `race` | Run blocks concurrently, return first success |
| `exitIf` | Exit the chain early when a condition is true |
| `forEach` | Process array items with a block (blocking) |
| `forEachBackground` | Fire-and-forget fan-out over array items (non-blocking) |
| `doUntil` | Loop until a condition is true |
| `doWhile` | Loop while a condition is true |
| `loopBack` | Jump back to a named step |
| `work` / `background` | Fire-and-forget side work (doesn't block) |
| `workIf` | Conditional variant of `work` — dispatches only when condition is truthy |
| `waitForWork` | Wait for `.work()` tasks, optional `failOnError` |
| `tap` | Run a block or function without changing the payload |
| `tapIf` | Conditional tap |
| `rescue` | Catch errors, route to recovery blocks |
| `branch` | Route to first matching branch |
| Inline block factories | `.then(handler, { outputSchema, execute })` etc. |

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

- **[Control Flow](/docs/sequencers/control-flow)** — Common composition patterns with code examples
- **[Side Chains](/docs/sequencers/side-chains)** — Fire-and-forget work with `.work()` and `.waitForWork()`
- **[Connectors](/docs/sequencers/connectors)** — Shaping data between steps, typed refs, and portability

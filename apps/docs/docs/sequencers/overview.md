---
sidebar_position: 1
---

# Overview

Most frameworks force a choice: Agent (the LLM decides what to do next) or Workflow (your code decides). flow-state.dev rejects that split. Sequencers are the composition model. You chain blocks with `.step()`, `.stepIf()`, `.tap()`, and other DSL methods. Each step's output feeds into the next step's input. Type inference flows through the whole chain.

You can interleave deterministic and non-deterministic steps. Validate input with a handler, generate a response with a generator, extract structured data with a handler, refine with another generator. All in one pipeline. No artificial boundary between "AI steps" and "logic steps."

## Sequencers compose blocks

A **block** is the unit of work: a handler (deterministic logic), a generator (LLM call), a router (runtime dispatch), or another sequencer. See [Blocks](/docs/fundamentals/blocks) for the four block kinds. Sequencers compose them:

```ts
import { handler, generator, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const chatInputSchema = z.object({ message: z.string() });

const validate = handler({
  name: "validate",
  inputSchema: chatInputSchema,
  execute: async (input) => {
    if (!input.message.trim()) throw new Error("Empty message");
  },
});

const agent = generator({
  name: "agent",
  model: "preset/fast",
  prompt: "You are a helpful assistant.",
  inputSchema: chatInputSchema,
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
  inputSchema: chatInputSchema,
})
  .tap(validate)
  .step(agent)
  .map((out) => out.text)
  .step(extractJson);
```

Here, a handler validates as a tap (it throws on bad input but produces no output of its own), a generator produces text, a `.map()` extracts the text, and a handler parses JSON. The chain's output type is inferred from the last step.

`validate` is chained with `.tap()` because it has no output to feed downstream — its job is to assert that the input is valid. A block that only mutates state, validates, or otherwise has no transformation should never declare an `outputSchema` or `return input`. Use `.tap()`. See [Composing Blocks](/docs/sequencers/composing-blocks) for the full rule.

## DSL methods

The DSL has 21 methods. You'll only use six on day one. The rest are there when you need them, organized by use case in the reference.

**[Composing Blocks](/docs/sequencers/composing-blocks)** — the six methods you'll reach for first:

| Method | Purpose |
|--------|---------|
| `step` | Run a block, pass output to the next step |
| `map` | Inline transform between steps (no block) |
| `tap` | Run a block for side effects, payload passes through |
| `stepIf` | Run a block only when a condition holds |
| `work` | Fire a block in the background, don't wait |
| `rescue` | Catch errors and route to recovery blocks |

**[Control Flow Reference](/docs/sequencers/control-flow)** — everything else, grouped by use case:

| Group | Methods |
|-------|---------|
| Parallelism | `parallel`, `forEach`, `forEachBackground`, `stepAll` |
| Looping | `doUntil`, `doWhile`, `loopBack` |
| Conditional sub-cases | `tapIf`, `workIf`, `exitIf` |
| Specialization (rarely needed) | `stepAny`, `race`, `branch` |
| Side-chain coordination | `waitForWork` |
| Connector adaptation | `connectInput` |

Each method returns a sequencer. You chain them: `.step(a).stepIf(cond, b).tap(c).step(d)`.

## Declaring and validating output schemas

A sequencer can declare an `outputSchema` in its config. When set, the framework validates the value the sequencer actually returns against that schema at runtime. It does this no matter how the value left the chain: the natural tail, an `exitIf` early return, or a `rescue` recovery all go through the same check. A separate `.validate()` method catches structural drift earlier, at build time, before the flow ever runs.

This is separate from the `outputSchema` you put on a handler or generator. A per-block `outputSchema` validates that one block's own output. A sequencer's `outputSchema` validates the composed output of the whole chain, after every step has run.

### Why declare a schema

Declaring `outputSchema` on a sequencer gives downstream consumers an explicit contract. A nested sequencer, a flow action, or a client renderer reading the output knows the shape it will get. The declaration catches drift: if you later add a step that changes the tail shape, the check fails instead of silently passing a different shape forward. And it makes the chain's output type visible to callers without them tracing every step.

### Runtime enforcement

The runtime check is a single gate at the sequencer boundary. Whatever value the sequencer is about to return runs through `safeParse` against the declared `outputSchema`. The gate sits after the natural tail, after an `exitIf` early return, and after a `rescue` recovery, so every exit path is covered the same way.

On a mismatch the sequencer throws `SequencerOutputSchemaError`. It is a `FlowError` subclass (`code: "sequencer_output_schema_error"`, `retryable: false`). A parent sequencer can catch it like any other typed error:

```ts
parent.rescue([
  { when: [SequencerOutputSchemaError], block: recover },
]);
```

When the schema uses `.transform()`, the sequencer returns the post-transform value. `safeParse` returns `result.data`, so the transformed shape is what flows out.

When `outputSchema` is omitted, there is no validation and no cost. Behavior is identical to before.

### Build-time validation with .validate()

`.validate()` is a conservative structural check you call when you build the sequencer. It compares the declared `config.outputSchema` against the schema inferred from the chain's tail. It returns `void` and throws `SequencerSchemaMismatchError` (a `FlowError` subclass, `code: "sequencer_schema_mismatch"`) on a mismatch.

The comparison is one level deep. It checks the top-level zod kind (a `ZodObject` declared against a `ZodString` tail fails), object key sets, one level of object value-kinds, and array element kind. That is the whole scope.

Be clear about what it does NOT catch:

- Deep nested shapes. It does not recurse past one level.
- Refinements and brands.
- Union variants.

`.validate()` is a no-op in two cases: when no `outputSchema` is declared, and when the tail schema has been erased by a schema-erasing op (`stepAny`, `race`, `stepAll`, `branch`). In the erased case there is nothing to compare against at build time, but the runtime gate still catches an actual mismatch. `.validate()` returns `void` and is terminal, not fluent. Operations added after the `.validate()` call are not covered by that call.

```ts
const pipeline = sequencer({
  name: "summarize",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ summary: z.string(), wordCount: z.number() }),
})
  .step(summarizeBlock); // produces { summary, wordCount }

pipeline.validate(); // no throw — declared shape matches the tail
```

### Runtime mismatch caught by a parent

A mismatch the conservative `.validate()` can't see (a value that drifts at runtime) still trips the runtime gate. Catch it in a parent's `.rescue()`:

```ts
const inner = sequencer({
  name: "extract",
  inputSchema: z.object({ raw: z.string() }),
  outputSchema: z.object({ id: z.string() }),
}).step(extractBlock);

const outer = sequencer({ name: "outer" })
  .step(inner)
  .rescue([
    { when: [SequencerOutputSchemaError], block: handleBadShape },
  ]);
```

### exitIf early exit

An `exitIf` early return is validated against the same `outputSchema`. The value you exit with must match the declared shape, because it becomes the sequencer's output:

```ts
const flow = sequencer({
  name: "review",
  inputSchema: z.object({ draft: z.string() }),
  outputSchema: z.object({ draft: z.string(), approved: z.boolean() }),
})
  .step(scoreBlock) // produces { draft, approved, score }
  .map(({ draft, approved }) => ({ draft, approved })) // drop the extra score field
  .exitIf((value) => value.approved)
  .step(reviseBlock);
```

The `.map()` reshapes the value to the declared output shape before the early exit. Without it, the early-exit value would carry the extra `score` field and trip the gate.

### When to declare vs. omit

Declare `outputSchema` when the composed output is consumed by something that depends on the shape: a downstream block, a flow action, a client renderer. Those callers benefit from the contract and the drift check.

Omit it for internal scratch pipelines or background work where nothing downstream reads the typed shape. There the validation is just overhead.

See [`SequencerOutputSchemaError`](/docs/advanced/error-handling#sequenceroutputschemaerror) for the runtime error. Internal contributors: BP-025 covers the judgment call on when to reach for this.

## Output flows forward

The pipeline is linear: step 1 output → step 2 input → step 2 output → step 3 input. Connectors let you reshape data when types don't match. See [Connectors](/docs/sequencers/connectors) for details. TypeScript infers the chain's output from the last step's schema.

## Sequencers are blocks

A sequencer is a block. It composes with any other block. You can nest sequencers, use a sequencer as a generator tool, or register it as a flow action:

```ts
const inner = sequencer({ name: "inner" }).step(blockA).step(blockB);
const outer = sequencer({ name: "outer" })
  .step(inner)
  .step(blockC);

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

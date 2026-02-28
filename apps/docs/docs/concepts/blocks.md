---
sidebar_position: 1
---

# Blocks

Everything in Flow State Dev is a block. Every LLM call, every data transform, every branching decision, every multi-step pipeline — it's all composed from four block kinds. No more, no less.

This constraint is the point. Four primitives that compose freely means you can build any AI workflow without inventing new abstractions.

## The four kinds

### Handler — pure logic

Handlers do the work that isn't AI: validate input, transform data, update state, implement tool logic. They take input, run `execute`, and return output.

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const counter = handler({
  name: "counter",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sessionStateSchema: z.object({ count: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ count: 1 });
    return input;
  },
});
```

Handlers are **silent by default** — they don't emit anything to the client unless you explicitly call `ctx.emitMessage()` or `ctx.emitComponent()`. This gives you precise control over what the user sees.

### Generator — the AI block

Generators call LLMs. But unlike a raw API call, the framework manages everything around it: prompt assembly, conversation history, tool execution loops, streaming, structured output with schema repair.

```ts
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

const agent = generator({
  name: "agent",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  history: (_input, ctx) => ctx.session.items.llm(),
  user: (input) => input.message,
  tools: [searchTool, createArtifactTool],
  emit: { reasoning: true, messages: true },
});
```

What the framework handles for you:
- **Prompt assembly** from four slots: system prompt, context entries, conversation history, and user message
- **Tool execution loops** — tools are blocks, auto-compiled to provider-native format (see below)
- **Streaming** — content deltas flow to the client as they're generated
- **Structured output repair** — if the LLM returns invalid JSON, the framework can auto-retry or route to a rescue block

#### Any block can be a tool

Any block or sequence of blocks can be used as a tool. A generator's `tools` array accepts handlers, sequencers, routers — anything with the block contract. That means a single tool call can trigger an entire multi-step pipeline:

```ts
// A simple handler as a tool
const readDoc = handler({
  name: "read-doc",
  inputSchema: z.object({ docId: z.string() }),
  outputSchema: z.string(),
  execute: async (input, ctx) => {
    const doc = ctx.session.resources.get("docs")?.state.byId[input.docId];
    return doc?.content ?? "Document not found.";
  },
});

// A full pipeline as a tool — search, rank, summarize
const deepResearch = sequencer({ name: "deep-research" })
  .then(searchIndex)
  .then(rankResults)
  .then(summarize);

// Both work as tools — the framework compiles them for the LLM
const agent = generator({
  name: "agent",
  tools: [readDoc, deepResearch],
  // ...
});
```

When the LLM calls `deep-research`, the framework runs the full sequencer pipeline, collects the output, and feeds it back as the tool result — all within the generator's tool loop. Your tools can be as sophisticated as any other part of your workflow.

### Sequencer — the composition engine

Sequencers compose blocks into pipelines using a fluent DSL. Each step's output feeds into the next step's input.

```ts
import { sequencer } from "@flow-state-dev/core";

const pipeline = sequencer({
  name: "chat-pipeline",
  inputSchema: z.object({ message: z.string() }),
})
  .then(analyzeInput)
  .thenIf((result) => result.needsContext, enrichWithContext)
  .then(agent)
  .tap(analyticsBlock)
  .rescue([
    { when: [NetworkError], block: retryWithBackup },
    { when: [ModelError], block: fallbackModel },
    { block: genericRecovery },
  ]);
```

The DSL has 14 methods: `then`, `thenIf`, `parallel`, `forEach`, `doUntil`, `doWhile`, `map`, `tap`, `tapIf`, `rescue`, `branch`, `work`, `waitForWork`, `loopBack`. See [Sequencer Patterns](/docs/guides/sequencer-patterns) for recipes.

### Router — runtime dispatch

Routers inspect input or state and pick which block (or pipeline) to run next. Routes are declared statically so the framework can validate them, but selection happens at runtime.

```ts
import { router } from "@flow-state-dev/core";

const modeRouter = router({
  name: "mode-router",
  inputSchema,
  outputSchema: z.string(),
  sessionStateSchema: z.object({ mode: modeSchema }),
  routes: [chatPipeline, planPipeline, reviewPipeline],
  execute: (input, ctx) => {
    const mode = ctx.session.state.mode;
    if (mode === "plan") return planPipeline;
    if (mode === "review") return reviewPipeline;
    return chatPipeline;
  },
});
```

## The block context

Every block's `execute` function receives a context object with access to scoped state, resources, and framework services:

```ts
execute: async (input, ctx) => {
  // Read and write scoped state
  const mode = ctx.session.state.mode;
  await ctx.session.patchState({ mode: "agent" });

  // Access resources
  const plan = ctx.session.resources.get("plan");
  await ctx.session.resources.plan.patchState({ status: "active" });

  // Emit items to the client
  await ctx.emitMessage("Processing your request...");
  await ctx.emitComponent("progress-bar", { percent: 50 });

  // Resolve AI models
  const model = ctx.resolveModel("gpt-5-mini");
}
```

## Blocks are composable

A sequencer is a block. A router is a block. This means you can nest them freely — a sequencer can contain routers, a router can dispatch to sequencers, sequencers can nest inside sequencers:

```ts
const innerPipeline = sequencer({ name: "inner" })
  .then(blockA)
  .then(blockB);

const outerPipeline = sequencer({ name: "outer" })
  .then(innerPipeline)    // Sequencer inside sequencer
  .then(modeRouter)       // Router inside sequencer
  .then(blockC);
```

## Connecting blocks with different shapes

An immediate question: if blocks have typed inputs and outputs, how do they fit together when their types don't match? The answer is **connectors** — lightweight functions that transform one block's output into the next block's input.

### Sequencer connectors

The most common pattern. Pass a transform function before the block in any sequencer method:

```ts
const pipeline = sequencer({ name: "pipeline", inputSchema })
  // Block A outputs { text: string, metadata: {...} }
  // Block B expects { query: string }
  .then(blockA)
  .then(
    (output) => ({ query: output.text }),  // Connector: reshape the data
    blockB
  );
```

Connectors receive the previous step's output and the block context, and return the shape the next block expects. They work across the entire sequencer DSL:

```ts
pipeline
  .then((output) => ({ query: output.text }), searchBlock)         // then
  .thenIf(needsReview, (output) => output.results, reviewBlock)    // thenIf
  .parallel({                                                       // parallel
    summary: summaryBlock,
    tags: { connector: (output) => output.text, block: tagBlock },
  })
  .forEach((output) => output.items, processBlock)                 // forEach
```

The type system tracks these transformations — TypeScript knows the connector's return type must match the next block's input schema.

### Block-level connections

You can also attach transforms directly to a block with `connectInput` and `connectOutput`. This is useful when you want a block to always accept a different input shape:

```ts
// Create an adapted version of searchBlock that accepts a string
const searchFromText = searchBlock.connectInput(
  (text: string) => ({ query: text, limit: 10 })
);

// Now it fits directly in the pipeline without a sequencer connector
pipeline.then(searchFromText);
```

### Why this matters for portability

Connectors are how blocks from different packages work together. A community search block expects `{ query: string, limit: number }`. Your pipeline produces `{ text: string, metadata: object }`. A one-line connector bridges the gap — no wrapper blocks, no adapters, no type gymnastics:

```ts
pipeline.then(
  (output) => ({ query: output.text, limit: 5 }),
  communitySearchBlock
);
```

## Blocks are portable

Because every block has the same contract — typed input, typed output, declared state dependencies — blocks are inherently shareable. A handler that validates email addresses, a sequencer that does multi-step research, a generator pre-configured for code review — each can be packaged independently and composed into any flow.

Connectors make this practical: when types don't align, a simple transform function bridges the gap. No wrapper blocks, no inheritance hierarchies. The framework's four-primitive constraint and partial state schemas mean blocks don't leak assumptions about the flows they live in.

## Key rules

- **Always use `block.run()`** — never call `block.config.execute` directly. The framework manages validation, retry, lifecycle, and streaming through `block.run()`.
- **Schemas are contracts** — `inputSchema` and `outputSchema` are validated at runtime. TypeScript catches mismatches at compile time.
- **Names must be unique** — within a flow, each block needs a unique `name` for provenance tracking and debugging.
- **Partial state schemas** — each block declares only the state fields it touches, not the full flow-level schema. This keeps blocks reusable.

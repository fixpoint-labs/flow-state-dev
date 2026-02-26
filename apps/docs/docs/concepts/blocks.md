---
sidebar_position: 1
---

# Blocks

Blocks are the runtime units of Flow State Dev. Every piece of work — calling an LLM, validating input, transforming data, choosing a path — is a block.

## Four Block Kinds

### Handler

Synchronous logic blocks for validation, state updates, and transformations.

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const counter = handler({
  name: "counter",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sessionStateSchema: z.object({ count: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.patchState({ count: (ctx.session.state.count ?? 0) + 1 });
    return input;
  },
});
```

### Generator

LLM-calling blocks with tool loops, structured output, and streaming.

```ts
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

const chatGen = generator({
  name: "chat",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ response: z.string() }),
  user: (input) => input.message,
  tools: [searchTool, calculatorTool],
});
```

Generators handle:
- Prompt assembly (system, context, history, user messages)
- Tool execution loops (call tools, feed results back, repeat)
- Structured output with schema repair
- Streaming content deltas to the client

### Sequencer

Pipeline composition using a fluent DSL for chaining, branching, parallelism, and error recovery.

```ts
import { sequencer } from "@flow-state-dev/core";

const pipeline = sequencer({
  name: "chat-pipeline",
  inputSchema: z.object({ message: z.string() }),
})
  .then(validateBlock)
  .then(chatGen)
  .tap(analyticsBlock)
  .rescue([
    { when: [NetworkError], block: retryBlock },
  ]);
```

See [Sequencer Patterns](/docs/guides/sequencer-patterns) for composition recipes.

### Router

Runtime block selection based on input or state.

```ts
import { router } from "@flow-state-dev/core";

const modeRouter = router({
  name: "mode-router",
  inputSchema: z.object({ message: z.string(), mode: z.string() }),
  routes: {
    chat: chatPipeline,
    agent: agentPipeline,
    search: searchPipeline,
  },
  execute: async (input, ctx) => {
    return input.mode; // returns the route key
  },
});
```

## Block Context

Every block receives a `BlockContext` with access to scopes and framework services:

```ts
execute: async (input, ctx) => {
  // Scope access
  ctx.session.state;                    // Read session state
  await ctx.session.patchState({...});  // Update state

  // Resources
  ctx.session.resources.plan.state;     // Read resource
  await ctx.session.resources.plan.patchState({...});

  // Framework services
  ctx.resolveModel(modelId);            // Resolve AI model
  ctx.emit(item);                       // Emit stream item
}
```

## Blocks Are Composable

Any block can be used wherever a block is expected. A sequencer is a block. A router is a block. This means you can nest them freely:

```ts
const innerPipeline = sequencer({ name: "inner", ... })
  .then(blockA)
  .then(blockB);

const outerPipeline = sequencer({ name: "outer", ... })
  .then(innerPipeline)  // Sequencer inside sequencer
  .then(blockC);
```

## Key Rules

- **Execute via `block.run()`** — Never call `block.config.execute` directly. The framework manages validation, retry, and lifecycle through `block.run()`.
- **Schemas define the contract** — `inputSchema` and `outputSchema` are validated at runtime. Trust the types.
- **Names must be unique** — Each block within a flow needs a unique `name` for provenance tracking and debugging.

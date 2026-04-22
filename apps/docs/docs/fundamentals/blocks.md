---
sidebar_position: 2
---

# Blocks

Everything in flow-state.dev is a block. Every LLM call, every data transform, every branching decision, every multi-step pipeline — it's all composed from four block kinds. No more, no less.

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
  model: "preset/fast",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  history: true,
  user: (input) => input.message,
  tools: [searchTool, createArtifactTool],
  agentType: "agent",
});
```

What the framework handles for you:
- **Prompt assembly** from four slots: system prompt, context entries, conversation history, and user message
- **Tool execution loops** — tools are blocks, auto-compiled to provider-native format (see below)
- **Streaming** — content deltas flow to the client as they're generated
- **Structured output repair** — if the LLM returns invalid JSON, the framework can auto-retry or route to a rescue block

#### Generator identity — who is emitting?

Each generator declares its identity via `agentType`, which governs where its auto-emitted items flow:

| `agentType` | Client UI | LLM History | DevTool |
|-------------|:--:|:--:|:--:|
| `"agent"` | ✓ | ✓ | ✓ |
| `"sub-agent"` | ✓ | — | ✓ |
| `"trace"` | — | — | ✓ |
| *unset* | no auto-emission — only `block_output` flows via graph edges |

Set `agentType` explicitly on every generator that should stream. There is no position-inferred default — each generator's identity is visible in its own config.

```ts
// User-facing chatbot. Messages + reasoning go to UI and enter history.
const chatbot = generator({ agentType: "agent", /* ... */ });

// Worker inside a supervisor pattern. Visible to the user for observability,
// but its output does not pollute the orchestrator's next-turn history.
const worker = generator({ agentType: "sub-agent", /* ... */ });

// Background observer. Items appear in the devtool stream for debugging;
// they never reach the client or the LLM.
const memoryObserver = generator({ agentType: "trace", /* ... */ });

// Pure structured-output transformer. Feeds its typed output to the next
// block via graph edges. No session items at all.
const classifier = generator({
  model: "preset/fast",
  prompt: "Classify input as A, B, or C.",
  outputSchema: z.enum(["A", "B", "C"]),
  // agentType omitted — no auto-emission.
});
```

Optionally, set `agentName` to give the identity a stable label — useful for parallel workers that should share or differ:

```ts
// Collaborative: all parallel instances share one identity.
// selectForContext({ agentName: "researcher" }) returns them all.
generator({ agentType: "sub-agent", agentName: "researcher", /* ... */ });

// Isolated: each instance has a unique identity.
generator({ agentType: "sub-agent", agentName: `researcher-${id}`, /* ... */ });
```

`agentName` defaults to the block's `name` when omitted.

See [Generator identity](../streaming/items#generator-identity) for the full model.

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

#### Web search

Generators have first-class support for provider-native web search. Add `search: true` and the framework handles the rest — detecting your provider, creating the right search tool, and returning grounded results with source citations:

```ts
const agent = generator({
  name: "research-agent",
  model: "claude-sonnet-4-20250514",
  prompt: "You are a research assistant. Search the web when needed.",
  search: true,
  tools: [readDoc, updateDoc],
  // ...
});
```

The model decides when to search, the provider executes the search server-side, and source URLs come back as `source` items in the stream. No API keys for a separate search service. No extra handler block. The search runs inside the model's tool loop at the provider level.

For fine-grained control, pass a config object instead of `true`:

```ts
const agent = generator({
  name: "docs-agent",
  model: "claude-sonnet-4-20250514",
  search: {
    maxUses: 3,
    allowedDomains: ["docs.anthropic.com", "developer.mozilla.org"],
    blockedDomains: ["pinterest.com"],
    userLocation: { type: "approximate", country: "US", region: "CA" },
    searchDepth: "high",
  },
  // ...
});
```

All config fields are optional and provider-normalized. The framework maps them to the right provider-specific parameters:

| Field | Anthropic | OpenAI | Google |
|-------|-----------|--------|--------|
| `maxUses` | `maxUses` | — | — |
| `allowedDomains` | `allowedDomains` | — | — |
| `blockedDomains` | `blockedDomains` | — | — |
| `userLocation` | `userLocation` | `userLocation` | — |
| `searchDepth` | — | `searchContextSize` | — |

Fields that a provider doesn't support are silently ignored. This means you can write `search: { maxUses: 3, searchDepth: "high" }` and it works across Anthropic and OpenAI — each provider picks up the fields it understands.

Search requires your model resolver to receive the provider object directly (not just a model factory function). See [Custom Model Resolver](/docs/server/custom-model-resolver#provider-search-tools) for setup details.

#### Provider tools

Block tools go through the full framework lifecycle — schema compilation, execution tracking, item emission, retry. But some AI SDK providers offer **provider-defined tools** that execute server-side (code execution, search, file analysis). These can't be handler blocks because the provider handles execution, not your code.

The `providerTools` escape hatch passes raw provider tool objects directly to the AI SDK:

```ts
import { generator, providerTool } from "@flow-state-dev/core";
import { anthropic } from "@ai-sdk/anthropic";

const agent = generator({
  name: "code-agent",
  model: "claude-sonnet-4-20250514",
  providerTools: [
    providerTool("code_execution", anthropic.tools.codeExecution()),
  ],
  tools: [readDoc, updateDoc],  // block tools work alongside
  // ...
});
```

Provider tools bypass the block lifecycle entirely — no `inputSchema` validation, no item emission, no retry. They're opaque objects passed through to the AI SDK. Use block tools when you want framework integration; use `providerTools` when you need raw provider capabilities.

You can combine `search`, `providerTools`, and block `tools` freely. They all merge into the same generation request:

```ts
const agent = generator({
  name: "full-agent",
  model: "claude-sonnet-4-20250514",
  search: true,                                    // provider-native search
  providerTools: [                                  // raw provider tools
    providerTool("code_exec", anthropic.tools.codeExecution()),
  ],
  tools: [readDoc, updateDoc],                     // block tools
});
```

### Sequencer — the composition engine

Sequencers compose blocks into pipelines using a fluent DSL with 15 chainable methods. Each step's output feeds into the next step's input, with full type inference through the chain.

#### Sequential steps

The basics — chain blocks in order, conditionally skip steps, or transform values inline:

```ts
const pipeline = sequencer({ name: "pipeline", inputSchema })
  .then(analyzeInput)                                            // always runs
  .thenIf((result) => result.needsContext, enrichWithContext)     // conditional
  .map((result) => ({ ...result, timestamp: Date.now() }))       // inline transform
  .then(agent);
```

#### Parallel execution

Run multiple blocks concurrently with a single step. Output is an object keyed by step name:

```ts
const enriched = sequencer({ name: "enrich" })
  .then(parseQuery)
  .parallel({
    web: searchWeb,
    docs: searchInternalDocs,
    memory: { connector: (input) => input.userId, block: searchUserHistory },
  }, { maxConcurrency: 3 })
  // output: { web: WebResults, docs: DocResults, memory: HistoryResults }
  .then(mergeResults);
```

#### Collection processing

Process arrays concurrently with `forEach`. Supports dynamic block selection per item:

```ts
pipeline
  .forEach(processChunk, { maxConcurrency: 5 })               // static block
  .forEach((input) => input.urls, fetchUrl, { maxConcurrency: 10 })  // extract array first
  .forEach((item, index) => item.type === "pdf" ? parsePdf : parseText);  // dynamic block
```

#### Loops

Three loop constructs — each with built-in guards to prevent infinite loops:

```ts
pipeline
  // Loop until condition is true (checked after each iteration)
  .doUntil((result) => result.confidence > 0.9, refineBlock)

  // Loop while condition is true (checked after each iteration)
  .doWhile((result) => result.remaining > 0, processNextBatch)

  // Jump back to a named step — requires explicit max iterations
  .then(generateBlock)
  .then(validateBlock)
  .loopBack("generate-block", {
    when: (result) => !result.isValid,
    maxIterations: 3,
  });
```

#### Background work

Queue non-blocking tasks that run alongside the main pipeline. The main chain continues immediately — background failures emit `step_error` items but never abort the pipeline:

```ts
pipeline
  .then(coreLogic)
  .work(logAnalytics)                          // fire and forget
  .work((output) => output.metrics, reportMetrics)  // with connector
  .then(moreWork)
  .waitForWork({ timeoutMs: 5000 });           // optionally converge later
```

#### Branching

Route to different blocks based on runtime conditions. First matching branch wins:

```ts
pipeline.branch({
  urgent: [
    (input) => input,
    (input) => input.priority === "critical",
    urgentPipeline,
  ],
  standard: [
    (input) => input,
    (input) => input.priority === "normal",
    standardPipeline,
  ],
  fallback: [
    (input) => input,
    () => true,  // catch-all
    defaultPipeline,
  ],
});
```

#### Side effects

Run blocks or functions for observation without changing the payload:

```ts
pipeline
  .tap(auditLogBlock)                                    // block side effect
  .tap((value, ctx) => console.log("checkpoint", value)) // inline side effect
  .tapIf((value) => value.score < 0.5, alertBlock);      // conditional side effect
```

#### Error recovery

Catch errors from prior steps and route to recovery blocks by error type:

```ts
pipeline.rescue([
  { when: [RateLimitError], block: retryWithBackoff },
  { when: [ModelError], block: fallbackModel },
  { block: genericRecovery },  // catch-all
]);
```

#### Putting it all together

These compose into sophisticated workflows that would be painful to build from scratch:

```ts
const researchAgent = sequencer({ name: "research-agent" })
  .then(parseQuery)
  .parallel({
    web: searchWeb,
    docs: searchDocs,
    memory: searchMemory,
  })
  .then(mergeAndRank)
  .doUntil((r) => r.confidence > 0.9, refineResults)
  .work(logAnalytics)
  .then(synthesize)
  .tapIf((r) => r.citations.length > 5, notifyReviewer)
  .rescue([{ when: [SearchError], block: fallbackSearch }]);
```

That's a parallel search across three sources, iterative refinement until confidence is high, background analytics, synthesis, conditional notification, and error recovery — all as a single composable block that can be nested inside other sequencers, used as a generator tool, or registered as a flow action.

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
  const model = ctx.resolveModel("preset/fast");

  // Access typed targets — named ancestor blocks declared in config
  const research = ctx.targets.research;  // StateRef<{ progress: number }> | undefined
  await research?.patchState({ progress: 75 });

  // Or use getTarget for dynamic/untyped access
  const dynamic = ctx.getTarget("some-block");

  // Access the parent block's identity and input
  if (ctx.parent) {
    console.log(ctx.parent.name);  // parent block name
    console.log(ctx.parent.kind);  // "sequencer" | "router" | "generator" | "handler"
    console.log(ctx.parent.input); // the input that was passed to the parent block
  }
}
```

Targets give a block typed access to the state of named ancestor blocks in the execution tree. They are declared via `targetStateSchemas` in the block config — see [Target state](/docs/fundamentals/state-and-scopes#target-state) for details.

### `ctx.parent`

When a block runs inside another block (a step in a sequencer, a tool inside a generator, a route inside a router), `ctx.parent` provides the immediate parent's identity and the input it was called with:

```ts
ctx.parent?.name   // "my-sequencer"
ctx.parent?.kind   // "sequencer"
ctx.parent?.input  // the input value passed to the parent block
```

This is useful when a nested block needs context from its parent that isn't part of its own input — for example, reading the original request ID from a sequencer's input inside a downstream handler step.

For type-safe parent input access, declare `parentInputSchema` on the block:

```ts
const saveResult = handler({
  name: "save-result",
  inputSchema: z.object({ summary: z.string() }),
  parentInputSchema: z.object({ id: z.string(), title: z.string() }),
  execute: async (input, ctx) => {
    const { id } = ctx.parent!.input; // typed as { id: string, title: string }
    await ctx.session.resources.results.get(id).patchState({ summary: input.summary });
  },
});
```

`ctx.parent` is `undefined` at the root level (the flow's top-level action block).

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

## Blocks declare their resources

Just like blocks declare their state dependencies with partial schemas, blocks can declare their **resource dependencies** using `sessionResources`, `userResources`, and `projectResources`. These accept `defineResource()` values:

```ts
import { defineResource, handler } from "@flow-state-dev/core";

const planResource = defineResource({
  stateSchema: z.object({
    steps: z.array(z.string()).default([]),
    status: z.enum(["draft", "active", "complete"]).default("draft"),
  }),
  writable: true,
});

const planManager = handler({
  name: "plan-manager",
  sessionResources: { plan: planResource },
  execute: async (input, ctx) => {
    await ctx.session.resources.plan.patchState({ status: "active" });
    return input;
  },
});
```

The framework collects these declarations automatically:
- **Sequencers** merge declared resources from all child blocks in the chain
- **`defineFlow`** collects resources from all action blocks and merges them into the flow's scope configs
- **Flow-level** resource declarations take priority over block-declared ones

This means blocks bring their own resource requirements — you don't have to repeat them in the flow definition. It follows the same philosophy as partial state schemas: blocks are self-documenting about their dependencies.

## Blocks are portable

Because every block has the same contract — typed input, typed output, declared state dependencies — blocks are inherently shareable. A handler that validates email addresses, a sequencer that does multi-step research, a generator pre-configured for code review — each can be packaged independently and composed into any flow.

Connectors make this practical: when types don't align, a simple transform function bridges the gap. No wrapper blocks, no inheritance hierarchies. The framework's four-primitive constraint and partial state schemas mean blocks don't leak assumptions about the flows they live in.

## Utility blocks

The four primitives give you full control, but common AI patterns — summarization, task decomposition, intent classification — require the same boilerplate configuration every time. **Utility blocks** are pre-built factories that return fully configured blocks for these patterns:

```ts
import { utility } from "@flow-state-dev/core";

const summarize = utility.summarizer({ name: "brief", granularity: "brief" });
const classify = utility.intentClassifier({ name: "triage", categories: { ... } });
const decompose = utility.decomposer({ name: "plan" });
```

Each utility returns a standard block — composable in sequencers, routers, and flows like any block you build yourself. Nine utilities produce generator blocks (LLM-powered), and one (`combiner`) produces a handler block (deterministic, no LLM).

See the [Core Utilities guide](/docs/patterns/utility-blocks/core) for the full catalog with examples and output schemas, or [Extension Utilities](/docs/patterns/utility-blocks/extensions) for adapter-driven utilities.

## Key rules

- **Let the framework run your blocks** — compose blocks into sequencers, register them as flow actions, or pass them as tools. The framework handles validation, retry, lifecycle, and streaming. Don't call block internals directly.
- **Schemas are contracts** — `inputSchema` and `outputSchema` are validated at runtime. TypeScript catches mismatches at compile time.
- **Names must be unique** — within a flow, each block needs a unique `name` for provenance tracking and debugging.
- **Partial state schemas** — each block declares only the state fields it touches, not the full flow-level schema. This keeps blocks reusable.

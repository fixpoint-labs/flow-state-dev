---
sidebar_position: 5
title: Building Agents
---

# Building Agents

If you're coming from another AI framework, you're probably looking for the `agent()` function. There isn't one. This page explains why, and shows how the existing primitives compose into agents that are more capable than what a single abstraction could express.

## Why there's no agent primitive

The AI tooling ecosystem has narrowed "agent" to mean one specific thing: a model in a loop that decides which tools to call. That's a useful pattern. It's also a small fraction of what real agentic systems need.

Production agents have persistent state across conversations. They coordinate multiple models. They mix deterministic scaffolding with non-deterministic AI steps. They need structured output contracts, error recovery, and observability. Wrapping all of that in a single `agent()` builder means either the builder does too little (and you're back to writing glue code) or it does too much (and you're fighting its opinions).

flow-state.dev takes a different approach. The four block kinds (handler, generator, sequencer, router) compose into any agent architecture. A generator with tools is the classic agentic loop. A sequencer with a generator step is a structured pipeline with AI in the middle. Nested sequencers with multiple generators are multi-agent systems. Same primitives, different compositions.

Naming blocks honestly reflects what they actually do. A `generator` generates. A `sequencer` sequences. A `handler` handles. When you see a flow definition, you know what each piece contributes. "Agent" obscures that.

## The determinism spectrum

Flows exist on a spectrum from fully deterministic to highly non-deterministic. Where you land on that spectrum is a composition choice, not a framework choice. Here's how it looks in practice.

### Level 1: Pure handler pipelines

Every step is a function. The path through the flow is known at build time. No AI, no non-determinism. Useful for data pipelines, validation chains, and structured transformations.

```ts
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const parseInput = handler({
  name: "parse-input",
  inputSchema: z.object({ raw: z.string() }),
  outputSchema: z.object({ intent: z.string(), entities: z.array(z.string()) }),
  execute: async (input) => {
    const parsed = JSON.parse(input.raw);
    return { intent: parsed.intent, entities: parsed.entities ?? [] };
  },
});

const validate = handler({
  name: "validate",
  inputSchema: z.object({ intent: z.string(), entities: z.array(z.string()) }),
  outputSchema: z.object({ intent: z.string(), entities: z.array(z.string()), valid: z.boolean() }),
  execute: async (input) => ({
    ...input,
    valid: input.intent.length > 0 && input.entities.length > 0,
  }),
});

const pipeline = sequencer({
  name: "deterministic-pipeline",
  inputSchema: z.object({ raw: z.string() }),
})
  .then(parseInput)
  .then(validate);
```

Nothing here calls an LLM. Given the same input, you get the same output. This is a perfectly valid flow. Not every workflow needs AI.

### Level 2: Sequencer with a generator step

The sequencer controls flow structure. That part is deterministic: step A runs, then step B, then step C. But one of those steps is a generator, which means the model has freedom within its step. The step sequence is fixed; what happens inside the AI step is not.

```ts
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

const enrichContext = handler({
  name: "enrich",
  inputSchema,
  outputSchema: z.object({ message: z.string(), context: z.string() }),
  sessionStateSchema: z.object({ previousTopics: z.array(z.string()).default([]) }),
  execute: async (input, ctx) => ({
    message: input.message,
    context: `Previous topics: ${ctx.session.state.previousTopics.join(", ") || "none"}`,
  }),
});

const respond = generator({
  name: "respond",
  model: "preset/fast",
  prompt: "You are a helpful assistant. Use the provided context to give relevant answers.",
  inputSchema: z.object({ message: z.string(), context: z.string() }),
  context: (input) => input.context,
  user: (input) => input.message,
  history: true,
});

const trackTopic = handler({
  name: "track-topic",
  sessionStateSchema: z.object({ previousTopics: z.array(z.string()).default([]) }),
  execute: async (_input, ctx) => {
    // Extract topic from the latest assistant message
    const lastMessage = ctx.session.items.history().at(-1);
    if (lastMessage) {
      await ctx.session.pushState("previousTopics", "conversation-turn");
    }
  },
});

const chatPipeline = sequencer({ name: "chat", inputSchema })
  .then(enrichContext)
  .then(respond)
  .tap(trackTopic);
```

The pipeline always runs: enrich, then respond, then track. The generator's output varies per call, but the surrounding structure is predictable. You can reason about this flow statically, test the handlers deterministically, and mock the generator for end-to-end tests.

### Level 3: Generator with tools

This is the classic agentic loop. The model decides which tools to call, in what order, how many times, and when it's done. Most frameworks call this an "agent." In flow-state.dev, it's a generator with a `tools` array.

```ts
import { generator, handler } from "@flow-state-dev/core";
import { z } from "zod";

const searchDocs = handler({
  name: "search-docs",
  description: "Search the documentation for relevant information",
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.object({ title: z.string(), snippet: z.string() })) }),
  execute: async (input) => {
    const results = await performSearch(input.query);
    return { results };
  },
});

const createNote = handler({
  name: "create-note",
  description: "Save a note for future reference",
  inputSchema: z.object({ title: z.string(), content: z.string() }),
  outputSchema: z.object({ id: z.string() }),
  sessionStateSchema: z.object({ noteCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    const id = crypto.randomUUID();
    await ctx.session.incState({ noteCount: 1 });
    return { id };
  },
});

const agent = generator({
  name: "research-agent",
  model: "preset/capable",
  prompt: "You are a research assistant. Search documentation and save notes as needed.",
  inputSchema: z.object({ message: z.string() }),
  history: true,
  user: (input) => input.message,
  tools: [searchDocs, createNote],
  maxIterations: 10,
});
```

When the model calls `search-docs`, the framework runs the handler, validates the input against its schema, executes it, and feeds the output back as a tool result. The model decides what to do next. This continues until the model produces a final response or hits `maxIterations`.

The generator's tool loop is fully managed: schema compilation to the provider's format, input validation, execution tracking, streaming of tool call status events, and retry on failure. You define the tools. The framework runs the loop.

### Level 4: Multi-agent coordination

Nested sequencers with multiple generators. This is where you build supervisor patterns, planning-then-execution flows, and systems where different models handle different responsibilities.

```ts
import { generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const planSchema = z.object({
  steps: z.array(z.object({ task: z.string(), tool: z.string() })),
});

// A planner that decides what to do
const planner = generator({
  name: "planner",
  model: "preset/capable",
  prompt: "Break the user's request into concrete steps. Return a JSON plan.",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: planSchema,
  user: (input) => input.message,
});

// A worker that executes individual tasks
const worker = generator({
  name: "worker",
  model: "preset/fast",
  prompt: "Execute the assigned task. Use tools as needed.",
  inputSchema: z.object({ task: z.string(), tool: z.string() }),
  tools: [searchDocs, createNote, analyzeData],
  maxIterations: 5,
});

// A synthesizer that combines results
const synthesizer = generator({
  name: "synthesizer",
  model: "preset/capable",
  prompt: "Combine the results from all completed tasks into a coherent response.",
  inputSchema: z.object({ results: z.array(z.unknown()) }),
  user: (input) => JSON.stringify(input.results),
});

const multiAgent = sequencer({
  name: "plan-and-execute",
  inputSchema: z.object({ message: z.string() }),
})
  .then(planner)
  .forEach((plan) => plan.steps, worker, { maxConcurrency: 3 })
  .then((results) => ({ results }), synthesizer);
```

Three models, three roles. The planner produces a structured plan. The worker processes each step in parallel (up to 3 at a time), with its own tool loop per step. The synthesizer combines everything. The sequencer coordinates. Each generator is independently testable and replaceable.

## Tools are just blocks

This is the structural insight that makes the composition above possible. In most frameworks, tools are a special object type: a name, a JSON schema, a function. In flow-state.dev, tools passed to a generator are the same `BlockDefinition` instances used everywhere else.

That means:

**Tools can read and write state.** A tool isn't limited to returning a value. It can update session state, read user preferences, increment counters. State mutations persist across turns.

```ts
const bookmark = handler({
  name: "bookmark",
  description: "Save a URL for the user",
  inputSchema: z.object({ url: z.string(), label: z.string() }),
  outputSchema: z.object({ saved: z.boolean() }),
  sessionStateSchema: z.object({
    bookmarks: z.array(z.object({ url: z.string(), label: z.string() })).default([]),
  }),
  execute: async (input, ctx) => {
    await ctx.session.pushState("bookmarks", { url: input.url, label: input.label });
    return { saved: true };
  },
});
```

**Tools can emit items to the stream.** A tool can send status updates, progress indicators, or UI components to the client while it's running. The user sees something happening, not just a spinner.

```ts
const analyzeData = handler({
  name: "analyze-data",
  description: "Run analysis on a dataset and show progress",
  inputSchema: z.object({ datasetId: z.string() }),
  outputSchema: z.object({ summary: z.string(), rowCount: z.number() }),
  execute: async (input, ctx) => {
    await ctx.emitStatus("Loading dataset...");
    const data = await loadDataset(input.datasetId);

    await ctx.emitStatus("Running analysis...");
    const result = analyzeRows(data);

    ctx.emitComponent("analysis-card", {
      summary: result.summary,
      charts: result.charts,
    });

    return { summary: result.summary, rowCount: data.length };
  },
});
```

**Tools can be entire pipelines.** A sequencer is a block. Blocks are tools. So a single tool call can trigger a multi-step pipeline with its own error recovery, parallel execution, and intermediate processing.

```ts
const deepResearch = sequencer({ name: "deep-research" })
  .then(parseQuery)
  .parallel({
    web: searchWeb,
    docs: searchInternalDocs,
    memory: searchMemory,
  })
  .then(mergeAndRank)
  .doUntil((result) => result.confidence > 0.9, refineResults);

// The model calls "deep-research" as a tool.
// The framework runs the full pipeline and returns the result.
const agent = generator({
  name: "agent",
  model: "preset/capable",
  prompt: "You are a research assistant.",
  tools: [deepResearch, bookmark, analyzeData],
  // ...
});
```

The model doesn't know `deep-research` is a pipeline. It sees a tool with an input schema and a description. The framework handles compilation to the provider's native tool format, execution of the full pipeline, and collection of the output as a tool result.

**Tools can even contain generators.** An outer generator can orchestrate inner generators as tools. This is how you build hierarchical agent systems where a coordinator delegates to specialist sub-agents.

```ts
const codeReviewer = generator({
  name: "code-reviewer",
  model: "preset/capable",
  prompt: "You are a code review specialist. Analyze the code for bugs and style issues.",
  inputSchema: z.object({ code: z.string(), language: z.string() }),
  outputSchema: z.object({ issues: z.array(z.string()), score: z.number() }),
});

const securityAuditor = generator({
  name: "security-auditor",
  model: "preset/capable",
  prompt: "You are a security specialist. Check for vulnerabilities.",
  inputSchema: z.object({ code: z.string(), language: z.string() }),
  outputSchema: z.object({ vulnerabilities: z.array(z.string()), severity: z.string() }),
});

// The coordinator uses specialist generators as tools
const coordinator = generator({
  name: "coordinator",
  model: "preset/capable",
  prompt: "You coordinate code analysis. Delegate to specialists as needed.",
  tools: [codeReviewer, securityAuditor],
  // ...
});
```

Each specialist runs its own LLM call when invoked. The coordinator decides which specialists to consult and synthesizes their findings. All of this happens within the coordinator's tool loop, managed by the framework.

## What the generator does at runtime

When a generator with tools runs, the framework executes a loop:

1. **Assemble the prompt** from four slots: system prompt, context entries, conversation history, and current user message.
2. **Call the model** with the assembled prompt and compiled tool definitions.
3. **If the model returns a tool call**, validate the input against the tool's schema, execute the tool block, and feed the result back. Go to step 2.
4. **If the model returns a final response**, validate it against `outputSchema` (if defined), emit it to the stream, and exit.
5. **If `maxIterations` is reached**, stop the loop. The last response becomes the output.

The framework manages streaming throughout. Text deltas flow to the client as the model generates them. Tool call events show which tool was called and what it returned. Status items track progress.

If a tool call fails, the framework can retry based on the generator's `retry` config. If structured output parsing fails, the framework can attempt schema repair or route to a `repairOutput` function. You configure the policies. The framework runs the machinery.

## Choosing the right composition

There's no universal answer. But here's a practical decision framework.

**Use a generator with tools** when the model needs to decide what to do. The classic case: a chat agent that might search, might create content, might do nothing, depending on the user's message. The model's judgment is the value. You want the loop.

```ts
const agent = generator({
  name: "assistant",
  tools: [search, create, analyze],
  // ...
});
```

**Use a sequencer with a generator step** when you know the steps but want AI in one of them. A pipeline that validates input, calls an LLM, then post-processes the result. The structure is fixed. The AI handles the creative part. You get predictability around the non-deterministic core.

```ts
const pipeline = sequencer({ name: "pipeline" })
  .then(validateInput)
  .then(generateResponse)
  .then(formatOutput);
```

**Use nested sequencers with multiple generators** when different parts of the task need different models or different tool sets. A planner that uses a capable model, workers that use a fast model, a synthesizer that combines results. Each generator is scoped to its role. The sequencer coordinates.

```ts
const system = sequencer({ name: "system" })
  .then(planner)                         // capable model, no tools
  .forEach(plan => plan.steps, worker)   // fast model, task-specific tools
  .then(synthesizer);                    // capable model, final synthesis
```

**Use a router** when the right approach depends on runtime state. Different modes need different pipelines. The router inspects state or input and dispatches to the right one.

```ts
const modeRouter = router({
  name: "mode-router",
  routes: [chatPipeline, researchPipeline, reviewPipeline],
  execute: (input, ctx) => {
    const mode = ctx.session.state.mode;
    if (mode === "research") return researchPipeline;
    if (mode === "review") return reviewPipeline;
    return chatPipeline;
  },
});
```

These patterns compose. A router can dispatch to sequencers. A sequencer can contain generators with tools. A tool can be a sequencer that contains another generator. The framework doesn't impose a ceiling on composition depth. You stop nesting when the problem stops needing it.

---

## Go deeper

- [Blocks](/docs/fundamentals/blocks) -- Handler, generator, sequencer, router in detail
- [Sequencers](/docs/sequencers/overview) -- Control flow, side-chains, connectors
- [Flows and Actions](/docs/fundamentals/flows) -- Flow definition, actions, lifecycle
- [Patterns](/docs/patterns/overview) -- Coordinator, supervisor, plan-and-execute, response auditor
- [Anatomy of a Flow](/guides/anatomy-of-a-flow) -- Mental map of how flows fit together

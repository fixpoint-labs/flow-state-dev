---
slug: philosophy
title: "The flow-state.dev Philosophy"
authors: [flowstatedev]
tags: [philosophy, design]
---

Every framework encodes beliefs. Most of the time they're implicit, buried in API shapes and naming choices. This is ours, written down.

These are the principles behind flow-state.dev. They're what we keep coming back to when we're making a hard design call.

<!-- truncate -->

## Build foundations, not patterns

Nobody knows what the best AI agents look like yet. The patterns that dominate today (ReAct loops, linear chains, RAG pipelines) are starting points. The teams doing interesting things are the ones that went off-script.

We didn't want to build a framework that locked you into our guesses about what good agents look like. So instead of shipping patterns, we focused on the smallest set of composable pieces that could express any pattern. You get four kinds of building blocks (plain functions, LLM callers, pipelines, and routers), a way to compose them with full type safety, and a streaming runtime underneath.

What you can actually build with that turns out to be much more interesting than what we would have designed directly.

```ts
// A multi-step research pipeline used as a single tool call
const deepResearch = sequencer({ name: "deep-research" })
  .then(parseQuery)
  .parallel({ web: searchWeb, docs: searchInternalDocs, memory: searchMemory })
  .then(mergeAndRank)
  .doUntil((result) => result.confidence > 0.9, refineResults);

// The agent doesn't know deepResearch is a whole pipeline. It's just a tool.
const agent = generator({
  name: "agent",
  tools: [deepResearch, analyze, readDoc],
});
```

When the community builds blocks on top of this and shares them, their patterns become your building blocks too. That compounding is intentional.

## State that the model can actually use

The standard approach to AI memory is: keep a message list, truncate it when it gets too long, hope the model finds what it needs. This works for demos.

In practice, state worth keeping is worth keeping explicitly. When a research tool discovers something, it shouldn't just return it to the model and hope it shows up in context later. It should write it somewhere structured, so the next turn can use it deliberately.

In flow-state.dev, tools can read and write session state as a normal part of execution. That state persists across turns in a conversation. You control what shape it takes, and the framework makes it available to the model in subsequent calls.

```ts
const stateSchema = z.object({
  coveredTopics: z.array(z.string()).default([]),
  keyFindings: z.record(z.string()).default({}),
});

// The tool does real work, and records what it found in session state.
// The return value goes to the LLM now. The state persists for future turns.
const researchTopic = handler({
  name: "research-topic",
  input: z.object({ topic: z.string() }),
  sessionStateSchema: stateSchema,
  execute: async (input, ctx) => {
    const findings = await fetchResearch(input.topic);

    await ctx.session.pushState("coveredTopics", input.topic);
    await ctx.session.setStateRecord("keyFindings", input.topic, findings.summary);

    return findings;
  },
});
```

The model won't re-research a topic it already covered, because the state system tracks what's been done and feeds it back into context. This is different from hoping it shows up in the transcript.

## Evolve the cloud-native filesystem

A filesystem gives you bytes at a path. That's a low enough abstraction that almost anything can use it, but it pushes all the meaning-making onto the application. The filesystem doesn't know what a "draft document" is, which user it belongs to, or whether a write was valid.

Resources are the typed, scoped alternative. A resource is a named container attached to a scope — a session, a user, or a project — that combines structured state with file content. You define what a resource means: its schema, its content type, its mutability. A `draft` resource isn't a path; it's a contract any block can work with directly.

```ts
const draftResource = defineResource({
  stateSchema: z.object({
    title: z.string().default(""),
    wordCount: z.number().default(0),
    lastEditedAt: z.number().optional(),
  }),
  allowedExtensions: [".md", ".txt"],
  writable: true,
});
```

When an agent edits a document, it mutates a resource with known structure rather than writing bytes to a path. Blocks declare which resources they need; the framework provides them. The definition is portable — publish it as a package and any flow that references it gets the same typed contract, no configuration required.

A journaling layer is planned. When that lands, every mutation gets an append-only log: what changed, when, and what caused it. That turns typed storage into something closer to a version-controlled file — the kind of substrate an AI system can reason about over time, not just read from.

## Built for an ecosystem

Blocks don't belong to flows. A block is just a typed unit of logic: input, output, optional state dependencies. That's the whole contract. It doesn't know or care what flow it runs in.

This makes sharing straightforward. A block you write for one flow works in another flow without modification. A block someone else publishes works with yours because you share the same contract. There's no adapter layer or inheritance hierarchy to make compatible things compatible — if the types line up, it composes.

```ts
// A block defined in a shared package
import { deepResearch } from "@myorg/research-blocks";

// Works in a research flow
const researchFlow = defineFlow({
  kind: "researcher",
  actions: { research: { block: deepResearch } },
});

// Works as a tool in a chat agent in a completely different flow
const chatFlow = defineFlow({
  kind: "chat",
  actions: {
    chat: { block: generator({ name: "agent", tools: [deepResearch] }) },
  },
});
```

Resources work the same way. A `defineResource()` definition isn't tied to any specific flow. If a community block declares a dependency on a `plan` resource and your flow already defines one with the same schema, the framework wires them together. Same contract, same instance, no glue code.

## AI workflows are not web requests

Most backend frameworks are built around a request coming in and a response going out. That model works fine for web apps. It does not work for AI.

An AI request might run for 30 seconds. It probably calls an LLM multiple times. The LLM calls tools, which might call more LLMs. Results stream as they're produced. State needs to persist across turns in a conversation. When something goes wrong, you want to retry specific steps, not the whole thing.

Adapting a request/response framework to handle this produces a lot of workarounds. We started from the other end: what does a framework look like if streaming, long-running execution, multi-turn state, and LLM tool loops are the default case?

```ts
const agent = generator({
  name: "agent",
  model: "preset/fast",
  prompt: "You are a research assistant.",
  // history feeds completed turns back to the model automatically
  history: true,
  tools: [deepResearch, analyze, readDoc, writeDoc],
});

export default defineFlow({
  kind: "research-assistant",
  session: { stateSchema, resources: { docs: docResource } },
  actions: { chat: { block: agent } },
})({ id: "default" });
```

The LLM tool loop, streaming, state persistence, and error recovery are all handled. You define what the agent can do. The framework runs it.

## Server to screen, no gaps

A lot of AI orchestration tools stop at the server. They'll run your LLM pipeline, but getting the output to your users is your problem.

flow-state.dev covers the full path. The server package runs flows and streams results over SSE. The client package manages sessions and dispatches actions from any environment (Node, browser, edge). The React package gives you hooks and a stream renderer. Every layer talks to the others without glue code, because they share the same type contracts.

That said, the server and core packages work fine on their own. If you're building a CLI tool or a mobile backend, you don't pull in React.

```ts
// Server: register your flow, get a REST + SSE API for free
const registry = createFlowRegistry();
registry.register(researchFlow);
export const { GET, POST, DELETE } = createFlowApiRouter({ registry });

// React: one provider wraps the whole session lifecycle
function App() {
  return (
    <FlowProvider flowKind="research-assistant" userId="user_1" baseUrl="/api">
      <ResearchApp />
    </FlowProvider>
  );
}
```

## The framework runs the loop

When you're managing your own LLM tool loop, you're also managing retries, timeout handling, context assembly, and streaming. These are solvable problems, but solving them in application code means solving them differently every time, which means they're hard to test, hard to debug, and impossible to instrument consistently.

We made a deliberate call: the framework owns the execution machinery. You define what your agent can do (the blocks) and what the flow looks like (the composition). The framework runs everything.

This also gave us somewhere to put type safety. The pipeline DSL infers types across every step. If `mergeAndRank` expects `SearchResults` and you pass it `ParsedQuery`, TypeScript catches it before you ship it.

```ts
const pipeline = sequencer({ name: "pipeline" })
  .then(parseQuery)          // output: ParsedQuery
  .parallel({                // output: { web: WebResults, docs: DocResults }
    web: searchWeb,
    docs: searchInternalDocs,
  })
  .then(mergeAndRank)        // expects the parallel output, infers RankedResults
  .doUntil(
    (result) => result.confidence > 0.9,
    refineResults
  );
```

The constraints compound. Type-safe composition makes wrong wiring a compile error. Consistent execution makes observability possible. Observability makes debugging tractable.

## Types that travel

TypeScript and AI pipelines have a tense relationship. You spend a lot of time re-declaring the same types at different boundaries: annotate a function's return, re-annotate the next function's input, assert the shape halfway through because the chain got too complex for inference to follow.

The DSL is designed so types travel automatically through the chain. Each step infers its input from the previous step's output. You write schemas at the edges — inputs and outputs you actually want to validate — and TypeScript figures out the rest.

```ts
const pipeline = sequencer({ name: "research" })
  .then(parseQuery)    // infers: input from sequencer, output ParsedQuery
  .then(
    // inline definition — input is inferred as ParsedQuery, no annotation needed
    handler, {
      name: "enrich",
      execute: async (input, ctx) => ({
        ...input,
        timestamp: Date.now(),
      }),
    }
  )
  .then(searchAndRank); // infers enriched output as its input
```

Schema bubbling works the same way. A block only needs to declare the state fields it actually uses, not the full flow-level schema. The framework merges declarations upward — the block sees only what it asked for, fully typed.

```ts
// This block only sees callCount in ctx.session.state
// even if the session has 20 other fields
const trackUsage = handler({
  name: "track-usage",
  sessionStateSchema: z.object({ callCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.patchState({ callCount: ctx.session.state.callCount + 1 });
    return input;
  },
});
```

When you need to adapt types at a boundary — like connecting a community block that expects a different shape — `connectInput` and `connectOutput` handle the mapping without casting.

```ts
// Bridge a shape mismatch with a typed mapper, not an assertion
const adapted = communityBlock.connectInput(
  (output: MyOutput) => ({ query: output.searchText, limit: 10 })
);

pipeline.then(adapted);
```

The goal is to make the type system work with your composition, not against it.

## Streaming is the default

Streaming isn't a mode you opt into. It's how the execution model works.

As blocks run, they emit items: text chunks, tool calls, structured components your UI can render. Those items flow to the client as they're produced, with a sequence number on each one. If the connection drops, reconnect with the last sequence number you saw and pick up from there.

The React hooks abstract over all of this. You can write a streaming chat UI without thinking about SSE. But if you want to work with the stream directly, the same data is there.

```ts
// Any block can emit a component item to the stream mid-execution
.tap((report, ctx) => {
  ctx.emitComponent("report-card", {
    title: report.title,
    findings: report.findings,
    confidence: report.score,
  });
});

// Resume from a cursor after a dropped connection
const stream = client.streamRequest(requestId, { cursor: lastSequenceNumber });
```

Batch mode exists (you can await the full result), but it's just streaming with the waiting done for you.

## The stream is the trace

Observability in most frameworks requires instrumentation: add a tracing library, wrap your functions, configure an exporter, figure out why your spans don't line up with what actually happened.

In flow-state.dev, every item emitted during execution carries its context: which block emitted it, which block is its parent, which phase of execution it came from, what step it was in. The dev tools consume these items. Your UI consumes these items. They're the same stream.

```ts
// A stream item, with no custom instrumentation
{
  sequenceNumber: 42,
  blockName: "analyze",
  parentBlockName: "agent",
  phase: "tool-result",
  stepIndex: 3,
  type: "component",
  component: "report-card",
  data: { title: "...", findings: [...], confidence: 0.94 }
}
```

If you can render stream items, you can build a debugger. You don't need a separate observability system because the execution model already produces what you'd want a separate system to capture.

## We own the runtime. You own the rest.

Blocks are functions in your repo. Flows are declarations in your repo. The framework ships the runtime that executes them.

There's no hidden orchestration. No platform that your code has to conform to. You can read every line of what the framework does with your blocks, because the boundary is explicit. UI components and starter patterns are meant to be copied into your project and modified, not kept in `node_modules` behind an abstraction you can't change.

```ts
// A block is a function with a typed contract
const parseQuery = handler({
  name: "parse-query",
  input: z.object({ message: z.string() }),
  output: z.object({ intent: z.string(), entities: z.array(z.string()) }),
  run: async (input) => {
    return parseIntent(input.message);
  },
});

// A flow is a declaration
export default defineFlow({
  kind: "research-assistant",
  actions: {
    chat: { block: agent, userMessage: (i) => i.message },
  },
  session: { stateSchema, resources: { docs: docResource } },
})({ id: "default" });
```

The framework executes what you declared. You can take your blocks elsewhere if you need to.

---

These aren't principles we came up with afterward to justify decisions we'd already made. They're what we kept writing on whiteboards while we were figuring out what this thing should be.

If you want to see them in practice, [get started](/docs/getting-started/quick-start).

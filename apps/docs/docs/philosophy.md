---
sidebar_position: 2
---

# Framework Philosophy

flow-state.dev is opinionated. Not in the way that forces you into predefined patterns, but in the way that removes everything standing between you and the thing you're trying to build. These eight principles explain how the framework thinks — and why it was built the way it was.

---

## 1. Foundations That Unlock Paradigms

The framework provides primitives — blocks, scoped state, resources, projections, streaming items, sequencer composition — not pre-built solutions for known AI patterns. The goal is to create foundations powerful enough that developers and the community discover patterns we haven't imagined yet.

Recursive language model architectures. Advanced memory systems. Structured thinking pipelines. The framework can't predict these. Instead, it provides the building blocks and gets out of the way. Every utility and block in the ecosystem is a jumpstart, not a ceiling — a starting point, not a constraint.

The patterns that emerge become new blocks to build with and on. This compounding effect is intentional. When a block is portable and composable by default, the community's work extends the framework's reach far beyond what any single team could ship.

```ts
// deepResearch is a tool — but it's also a sequencer you can compose further
const deepResearch = sequencer({ name: "deep-research" })
  .then(parseQuery)
  .parallel({ web: searchWeb, docs: searchInternalDocs, memory: searchMemory })
  .then(mergeAndRank)
  .doUntil((result) => result.confidence > 0.9, refineResults);

// Use it as a tool in a generator — or compose it into a larger pipeline
const agent = generator({
  name: "agent",
  tools: [deepResearch, analyze, readDoc],
});
```

---

## 2. Built for AI Execution

AI applications are long-running, non-deterministic, streaming, and stateful. Traditional frameworks treat these as edge cases. flow-state.dev treats them as the default execution model.

Every primitive was designed around the reality that AI-driven applications have fundamentally different requirements than request/response web apps. Flows don't terminate when a response is sent — they persist session state, accumulate resources, and can be resumed. Generators run a tool loop managed entirely by the framework, not by application code.

This isn't an AI layer bolted onto a CRUD framework. It's an execution model born from AI needs.

```ts
// The framework manages the generator tool loop — you declare what you need
const agent = generator({
  name: "agent",
  model: "gpt-5-mini",
  prompt: "You are a research assistant.",
  history: (_input, ctx) => ctx.session.items.llm(),
  tools: [deepResearch, analyze, readDoc, writeDoc],
});

// Sessions persist across requests — state accumulates over time
export default defineFlow({
  kind: "research-assistant",
  session: {
    stateSchema,
    resources: { docs: docResource },
  },
  actions: { chat: { block: agent } },
})({ id: "default" });
```

---

## 3. Full-Stack, Platform-Ready

The framework covers the full path from flow definition to UI rendering — server execution, streaming transport, client consumption, React hooks. There's no integration gap between where AI runs and where users see it.

The server package provides the execution runtime and REST + SSE API. The client package provides isomorphic session management and action dispatch. The React package wraps the client with hooks and an item renderer that resolves streaming components to registered renderers. Each layer is independent and composable.

But core works standalone. CLI tools, mobile backends, embedded contexts — the execution model doesn't assume a browser on the other end. You can use `@flow-state-dev/core` and `@flow-state-dev/server` without touching React.

```ts
// Server: register flows, get a full API
const registry = createFlowRegistry();
registry.register(researchFlow);
export const { GET, POST, DELETE } = createFlowApiRouter({ registry });

// Client: manage sessions, dispatch actions
const client = createFlowClient({ baseUrl: "/api" });

// React: hooks consume the stream directly
function App() {
  return (
    <FlowProvider flowKind="research-assistant" userId="user_1" baseUrl="/api">
      <ResearchApp />
    </FlowProvider>
  );
}
```

---

## 4. State That Evolves

State, resources, and projections form the framework's memory system. State evolves through typed operations. Projections compute derived views from that state — and those views feed directly back into the model's context on every subsequent turn.

Tools don't just return outputs to the LLM — they read and write system state as part of execution. A tool that researches a topic records its findings in session state. A projection transforms that accumulated state into a context string the model can reason over. The next time the agent loop runs, the model knows what it already knows — not because the transcript happened to mention it, but because the state system guarantees it.

Memory isn't a conversation transcript you hope fits in the context window. It's structured, scoped, and engineered.

```ts
const stateSchema = z.object({
  coveredTopics: z.array(z.string()).default([]),
  keyFindings: z.record(z.string()).default({}),
});

// A tool that does real work AND updates session state as a side effect.
// The return value goes to the LLM. The state update persists across turns.
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

// The generator references the projection — not raw state.
// Every turn, the model receives an up-to-date summary of what it already knows.
const agent = generator({
  name: "agent",
  model: "gpt-5-mini",
  prompt: "You are a research assistant.",
  context: [projectionText("session.researchProgress")],
  history: (_input, ctx) => ctx.session.items.llm(),
  tools: [researchTopic, synthesize],
});

export default defineFlow({
  kind: "researcher",
  actions: { chat: { block: agent, userMessage: (i) => i.message } },
  session: {
    stateSchema,
    projections: {
      researchProgress: (ctx) => {
        const { coveredTopics, keyFindings } = ctx.session.state;
        if (coveredTopics.length === 0) return "";
        return [
          `Topics already researched: ${coveredTopics.join(", ")}`,
          ...coveredTopics.map((t) => `- ${t}: ${keyFindings[t]}`),
        ].join("\n");
      },
    },
  },
})({ id: "default" });
```

---

## 5. The Framework Owns the Machinery

The framework runs the generator tool loop, manages retries, persists state, assembles context, and streams items. You define blocks with typed input/output contracts. The framework orchestrates everything else.

This division isn't just convenient — it's the design. Application code that manages its own tool loop is application code that's hard to test, hard to reason about, and impossible to instrument uniformly. By owning the machinery, the framework can guarantee behavioral contracts: sequencers compose predictably, streaming items carry consistent provenance, state transitions are atomic.

The architecture itself is the enforcement mechanism: four block kinds, typed schemas at every boundary, a sequencer DSL that composes blocks with full type inference through the chain. These aren't opinions you can opt out of — they're structural constraints that make the wrong thing hard to express.

```ts
// The sequencer DSL enforces type safety through the chain
const pipeline = sequencer({ name: "pipeline" })
  .then(parseQuery)          // ParsedQuery
  .parallel({                // { web: WebResults, docs: DocResults }
    web: searchWeb,
    docs: searchInternalDocs,
  })
  .then(mergeAndRank)        // RankedResults
  .doUntil(
    (result) => result.confidence > 0.9,
    refineResults             // TypeScript ensures refineResults accepts RankedResults
  );
```

---

## 6. Streaming-First

The execution model is streaming by default. Items flow from server to client as they're produced — LLM text chunks, component emissions, status updates — with resume support built in via sequence cursors.

You don't have to consume streams. The client SDK and React hooks abstract over them. But the architecture doesn't degrade to support batch. Batch is a simplification of the streaming model, not the other way around. When you query a completed session's items, you're reading from the same item store the stream was writing to.

Disconnect mid-response? Reconnect with a cursor and resume from where you left off. The sequence number is on every item. The infrastructure handles the rest.

```ts
// Blocks emit items into the stream as they execute
const analyze = sequencer({ name: "analyze" })
  .then(gatherEvidence)
  .then(scoreFindings)
  .tap((report, ctx) => {
    ctx.emitComponent("report-card", {
      title: report.title,
      findings: report.findings,
      confidence: report.score,
    }).done();
  });

// Client resumes from cursor after reconnect
const stream = client.streamRequest(requestId, { cursor: lastSequenceNumber });
```

---

## 7. Observability is Structural

The stream is the trace. Every item carries provenance — block name, instance ID, parent block, phase, step index. You don't instrument your code for observability; the execution model produces it as a structural guarantee.

This means dev tools, flow inspection, and execution replay all consume the same public APIs any developer can build on. There's no separate observability layer, no custom telemetry to configure. If you can build a UI that renders items, you can build a debugger.

Structural observability also means the trace is always complete — it reflects exactly what the runtime did, not what the code said it was doing. There's no gap between the log and the execution.

```ts
// Every item carries full provenance — no custom instrumentation needed
{
  id: "item_abc123",
  sequenceNumber: 42,
  blockName: "analyze",
  blockInstanceId: "inst_xyz",
  parentBlockName: "agent",
  phase: "tool-result",
  stepIndex: 3,
  type: "component",
  component: "report-card",
  data: { title: "...", findings: [...], confidence: 0.94 }
}

// Dev tools consume the same stream items your UI does
const items = await client.getSessionItems(sessionId);
const agentSteps = items.filter(i => i.blockName === "agent");
```

---

## 8. Your Code, Your Control

Application code lives in your repo — blocks, flows, schemas, projections. The framework owns the runtime; you own everything above it.

There's no hidden orchestration layer, no magic that only works until it doesn't. When you define a block, you're writing a function. When you define a flow, you're declaring a composition. The framework's job is to execute what you described, predictably, at scale.

UI components and starter patterns copy into your project rather than hiding in `node_modules`. When you need to modify a renderer or adapt a pattern, you're editing your own code — not fighting an abstraction or waiting for a package update.

```ts
// Your blocks are plain functions with typed contracts
const parseQuery = handler({
  name: "parse-query",
  input: z.object({ message: z.string() }),
  output: z.object({ intent: z.string(), entities: z.array(z.string()) }),
  run: async (input) => {
    // Your logic, your dependencies, your repo
    return parseIntent(input.message);
  },
});

// Your flow is a declaration — the framework handles execution
export default defineFlow({
  kind: "research-assistant",
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: agent,
      userMessage: (i) => i.message,
    },
  },
  session: { stateSchema, resources: { docs: docResource } },
})({ id: "default" });
```

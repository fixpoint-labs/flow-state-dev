---
sidebar_position: 1
slug: /intro
---

# Why flow-state.dev?

Every AI feature needs the same infrastructure: call an LLM, stream the response, manage state across turns, handle errors gracefully, sync everything to the UI. Teams rebuild this from scratch every time — ad-hoc orchestration, hand-rolled SSE, application-specific retry logic, state scattered across closures and databases.

flow-state.dev makes these concerns **framework primitives**. You write the logic that matters. The framework handles everything else.

## What it looks like

```ts
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";

const chat = generator({
  name: "chat",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant.",
  history: (_input, ctx) => ctx.session.items.llm(),
  user: (input) => input.message,
  tools: [searchDocs, createArtifact],
});

const pipeline = sequencer({ name: "pipeline" })
  .then(chat)
  .then(trackUsage)
  .rescue([{ when: [ModelError], block: fallback }]);

export default defineFlow({
  kind: "my-app",
  actions: { chat: { block: pipeline, userMessage: (i) => i.message } },
  session: { stateSchema, resources, clientData },
})({ id: "default" });
```

That gives you: streaming over SSE with resume, conversation history, tool loops, atomic state operations, typed clientData to the client, error recovery, and lifecycle hooks. From that one definition.

## What you get

### Four block primitives

Every piece of logic — calling an LLM, validating input, choosing a path, composing a pipeline — is one of exactly four block kinds:

| Block | What it does | When to reach for it |
|-------|-------------|---------------------|
| **Handler** | Pure logic: validate, transform, mutate state | Data processing, state updates, tool implementations |
| **Generator** | LLM calls with managed tool loops and streaming | Chat, extraction, any AI generation |
| **Sequencer** | Compose blocks into pipelines | Multi-step workflows with branching, parallelism, error recovery |
| **Router** | Dispatch to different pipelines at runtime | Mode switching, intent routing, conditional flows |

All blocks share the same contract: `block.run(input, ctx)`. Any block composes with any other block — and any block or sequence of blocks can be used as a tool. That means a single tool call can trigger a handler, a multi-step sequencer pipeline, or even a router that dispatches to different strategies. Your AI's tools can be as simple or as sophisticated as any other part of your workflow.

### Flows are full APIs

Define a flow, register it with the server, and you have a complete REST API — action execution, session management, SSE streaming, state snapshots — with zero route wiring. Every flow you register becomes instantly callable from any client:

```
POST /api/flows/my-app/actions/chat          → Execute an action
GET  /api/flows/my-app/requests/:id/stream   → Stream results via SSE
GET  /api/flows/sessions/:id/state            → State snapshot with clientData
```

Multiple flows can coexist in the same server. Each one is self-contained with its own actions, state, and resources.

### Resumable streaming

Items stream over SSE as blocks execute — messages, reasoning, tool calls, state changes, custom components. Every event has a sequence number. Disconnect mid-response? Reconnect with a cursor and pick up exactly where you left off. No data loss. No duplicates. No manual SSE plumbing.

### Scoped state that scales

Four isolation levels with atomic operations:

| Scope | Lifetime | Example |
|-------|----------|---------|
| **Request** | Single action execution | Temporary processing data |
| **Session** | Across requests in a conversation | Chat history, mode, counters |
| **User** | Across sessions for a user | Preferences, accumulated knowledge |
| **Project** | Shared across users | Configuration, global data |

Each block declares only the state fields it needs via partial schemas. A counter block doesn't need to know about a preferences block's state.

### Resources: hybrid memory and filesystem

**Resources** are more than key-value stores. Each resource combines rich text content with structured atomic state — like a file that carries metadata. An artifact resource can hold a document's full text alongside its title, tags, and timestamps, all in one typed container with atomic operations. Scoped to sessions, users, or projects, resources give your AI a persistent, typed workspace.

**clientData** entries are derived values computed from state and resources — the mechanism for exposing data to clients. You can't accidentally leak internal state because clientData is the sole data gateway.

### Built for an ecosystem

Blocks and flows are portable by design. A tool block, a validation handler, a complete agentic workflow — each is a self-contained unit with typed inputs, outputs, and declared state dependencies. Share them across projects or publish them as packages. The uniform block contract means community blocks compose with yours without adapters or glue code.

### Full-stack type safety

Define a Zod schema once. It validates at runtime, infers at compile time, and flows from server blocks through the client SDK to React hooks. One type system. Zero glue code. No code generation step.

## The full stack

| Package | What it does |
|---------|-------------|
| [`@flow-state-dev/core`](/docs/api/core) | Block builders, flow definitions, type contracts |
| [`@flow-state-dev/server`](/docs/api/server) | Execution runtime, stores, SSE streaming, HTTP routes |
| [`@flow-state-dev/client`](/docs/api/client) | Isomorphic API client — works in Node, browser, edge |
| [`@flow-state-dev/react`](/docs/api/react) | React hooks and renderers — wraps client, no transport logic |
| [`@flow-state-dev/testing`](/docs/api/testing) | Deterministic test harnesses with generator mocks |

## Next steps

- **[Quick Start](/docs/getting-started/quick-start)** — Build a streaming chat app in 5 minutes
- **[Blocks](/docs/concepts/blocks)** — Deep dive into the four primitives
- **[Building a Chat App](/docs/guides/building-a-chat-app)** — Complete walkthrough from blocks to React UI to tests

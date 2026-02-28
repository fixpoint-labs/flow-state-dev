---
sidebar_position: 1
slug: /intro
---

# Why Flow State Dev?

Every AI feature needs the same infrastructure: call an LLM, stream the response, manage state across turns, handle errors gracefully, sync everything to the UI. Teams rebuild this from scratch every time — ad-hoc orchestration, hand-rolled SSE, application-specific retry logic, state scattered across closures and databases.

Flow State Dev makes these concerns **framework primitives**. You write the logic that matters. The framework handles everything else.

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
  session: { stateSchema, resources, projections },
})({ id: "default" });
```

That gives you: streaming over SSE with resume, conversation history, tool loops, atomic state operations, typed projections to the client, error recovery, and lifecycle hooks. From that one definition.

## What you get

### Four block primitives

Every piece of logic — calling an LLM, validating input, choosing a path, composing a pipeline — is one of exactly four block kinds:

| Block | What it does | When to reach for it |
|-------|-------------|---------------------|
| **Handler** | Pure logic: validate, transform, mutate state | Data processing, state updates, tool implementations |
| **Generator** | LLM calls with managed tool loops and streaming | Chat, extraction, any AI generation |
| **Sequencer** | Compose blocks into pipelines | Multi-step workflows with branching, parallelism, error recovery |
| **Router** | Dispatch to different pipelines at runtime | Mode switching, intent routing, conditional flows |

All blocks share the same contract: `block.run(input, ctx)`. Any block composes with any other block.

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

### Resources and projections

**Resources** are typed data containers — think artifacts, plans, documents — scoped to sessions, users, or projects. **Projections** are derived views computed from state and resources, and the *only* way to expose data to clients. You can't accidentally leak internal state because projections are the sole data gateway.

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

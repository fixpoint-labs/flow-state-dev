---
sidebar_position: 1
slug: /intro
---

# Why flow-state.dev?

Most agentic frameworks hold up fine for the tutorial case. Call an LLM, stream a response, keep a chat history. Then requirements get real: parallel branches with merged outputs, background workers that shouldn't block the stream, state that accumulates across turns and across sessions, error recovery that doesn't unwind your entire flow. You push on the framework and there's nothing there to push against.

The problem isn't capability. It's opacity. The framework makes decisions for you, and when you need to change one, you can't — because you can't see inside it.

flow-state.dev is built from the opposite direction. Four composable block primitives, a typed state system, and a library of production-ready implementations that are themselves built from those same primitives. Nothing is a black box. Every implementation is yours to take apart, understand, and rebuild your way.

## Four primitives

Every piece of logic in a flow-state.dev application is one of exactly four block kinds:

## What it looks like

```ts
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";

const chat = generator({
  name: "chat",
  model: "preset/fast",
  prompt: "You are a helpful assistant.",
  history: (_input, ctx) => ctx.session.items.history(),
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

| Block | What it does | When to use it |
|-------|-------------|----------------|
| **Generator** | LLM interaction with managed tool loops and streaming output | Chat, extraction, any AI generation |
| **Handler** | Deterministic compute — validate, transform, mutate state | Data processing, state updates, tool implementations |
| **Sequencer** | Compose blocks into arbitrarily complex pipelines | Multi-step workflows with branching, parallelism, loops, error recovery |
| **Router** | Dispatch to different pipelines at runtime | Mode switching, intent routing, conditional flows |

Every block shares the same typed contract: typed input in, typed output out. Any block composes with any other. A tool call can trigger a handler, a multi-step sequencer, or a router that dispatches to entirely different strategies. There's no special casing for "agentic" versus "deterministic" steps. Same primitive.

## The sequencer

The sequencer is the orchestration primitive at the center of every flow. It chains methods that read like the logic they encode:

- `.then()` — sequential steps, full type safety from input to output
- `.parallel()` — fan out to multiple blocks simultaneously; results merge into a single typed payload
- `.work()` — background workers that run async alongside the main pipeline without blocking the stream
- `.doUntil()` / `.doWhile()` — iterative loops with configurable exit conditions
- `.rescue()` — per-step error recovery without unwinding the whole flow

Sequencers compose inside sequencers to any depth. Every nested flow is a reusable block.

```typescript
const researchPipeline = sequencer({ name: "research-pipeline" })
  .then(parseQuery)
  .parallel({
    web:  searchWeb,
    docs: searchDocs,
    past: recall,
  })
  .then(synthesize)          // generator — reads ctx.session.state.query and parallel output
  .work(handler, {
    name: "save-draft",
    sessionResources: { draft: draftResource },
    sessionStateSchema: z.object({ lastResearched: z.string() }),
    execute: async (input, ctx) => {
      await ctx.session.resources.draft.setContent(input.response)
      await ctx.session.state.patch({ lastResearched: input.query })
    },
  })
  .work(updateMemory)        // async — never blocks the stream
```

Three parallel searches, a synthesis generator reading from session state, a background worker writing to a resource — all without blocking the response stream. This is the substrate every strategy in the library is built from.

## State

State is a first-class primitive. Four scopes with atomic operations:

| Scope | Lifetime | Example |
|-------|----------|---------|
| **Request** | Single action execution | Temporary processing data |
| **Session** | Across requests in a conversation | Chat history, current mode, counters |
| **User** | Across all sessions for a user | Preferences, accumulated knowledge |
| **Project** | Shared across all sessions | Configuration, global data |

Each block declares only the fields it touches via partial schemas. A counter block doesn't need to know about a preferences block's schema.

**Resources** go a step further. A resource has both a content body — a document, a plan, a code file — and structured metadata alongside it. Both live in one typed container with atomic operations, scoped to sessions, users, or projects. Your agent can read a draft, revise it, and update its metadata in one call.

## Composable, not chaotic

No prescribed implementation doesn't mean no structure. The block model naturally produces consistent, readable, maintainable agent code — not because the framework enforces conventions, but because well-designed building blocks are self-structuring.

Think of it like MVC: a clear mental model for organizing responsibility, without constraining what you can build. Every flow you write will look like it was designed. Because it was.

## Flows are full APIs

Define a flow, register it with the server, and you have a complete REST API — action execution, session management, SSE streaming, state snapshots — with no route wiring required:

```
POST /api/flows/my-app/actions/chat         → Execute an action
GET  /api/flows/my-app/requests/:id/stream  → Stream results via SSE
GET  /api/flows/sessions/:id/state          → State snapshot with clientData
```

Items stream over SSE as blocks execute. Every event has a sequence number. Disconnect mid-response, reconnect with a cursor, and pick up exactly where you left off. No data loss, no duplicates, no manual SSE plumbing.

## Strategies: built to be remixed

The strategy library is built from the same blocks you use. That's the point. Every strategy is something you can open, understand, and change.

**Multi-agent coordination patterns** — Supervisor, Coordinator, Chain of Agents, Blackboard, Debate, Round Robin

**Reasoning & planning patterns** — Plan and Execute, Self-Ask, Self-Consistency, Skeleton of Thought, Least-to-Most, Step-Back Prompting

**Memory & retrieval patterns** — RAPTOR, Mind-Map Memory, Context Folding, RLM, Self-querying, Episodic Replay

**Inference-time scaling patterns** — RSA, Tree of Thoughts, Mixture of Agents, Best-of-N, Sequential Revision

**Reactive patterns** — Observer, Reflector, Self-Healing Loop, Response Auditor, Citation Verifier

**Human-in-the-loop patterns** — Approval Gates, Tool Call Approval, Human Feedback, Collaborative Editing, Preference Elicitation

More are added regularly. The primitives are everything you need to build and share your own.

## The production stack

The primitives are the foundation. The rest ships with the framework:

- **DevTools** — Full visibility into every block execution, stream item, and state change across the entire flow chain. Debug what's actually happening, not what you think is happening.
- **Testing & Evals** — Deterministic test harnesses for individual blocks and full flows, with mock generators. An eval framework for scoring outputs against datasets. Ship confidently.
- **Client SDK & React** — Typed client SDK and React hooks that connect your frontend directly to your flows — streaming, session state, and clientData projections included. One type system, zero glue code.
- **CLI** — Scaffold new blocks and flows, run evals, inspect outputs — all from `fsdev`.
- **Model flexibility** — Provider-agnostic. Swap models per block, define semantic model groups, automatic retry and fallback without changing your flow logic.

All composable, all optional.

## Thought Fabric

Thought Fabric is what the primitives make possible when you push them. A full cognitive architecture — working memory, episodic memory, semantic memory, attention, reasoning — built entirely from flow-state.dev blocks.

Not a feature of the framework. Proof of concept.

Memory and attention are shipped. Identity, perception, and metacognition are on the roadmap.

[Learn about Thought Fabric →](/thought-fabric/introduction)

## Get started

- **[Quick Start](/docs/getting-started/quick-start)** — Build a streaming chat app in five minutes
- **[Blocks](/docs/fundamentals/blocks)** — Deep dive into the four primitives
- **[Building a Chat App](/guides/building-a-chat-app)** — Complete walkthrough from blocks to React UI to tests

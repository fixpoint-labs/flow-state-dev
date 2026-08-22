---
sidebar_position: 1
slug: /intro
---

# Why flow-state.dev?

flow-state.dev is a TypeScript framework for agents and agentic systems. You write typed, composable **blocks**. The framework runs them, streams items over SSE, holds state in four scopes, and turns a flow into an HTTP API.

With the core packages you can ship a streaming chat or an agent with tools. Ecosystem packages (patterns, memory, UI, a task board) compose on the same primitives when you need them. Nothing in the ecosystem is required.

## What it looks like

```ts
import { defineFlow, generator, sequencer } from "@flow-state-dev/core";

const chat = generator({
  name: "chat",
  model: "openai/gpt-5.4-mini",
  prompt: "You are a helpful assistant.",
  history: true,
  user: (input) => input.message,
  itemVisibility: { client: true, history: true },
  tools: [searchDocs, createArtifact],
});

const pipeline = sequencer({ name: "pipeline" })
  .step(chat)
  .step(trackUsage)
  .rescue([{ when: [ModelError], block: fallback }]);

export default defineFlow({
  kind: "my-app",
  actions: { chat: { block: pipeline, userMessage: (i) => i.message } },
  session: { stateSchema, client },
  resources,
})({ id: "default" });
```

From that definition you get streaming with resume, conversation history, tool loops, atomic state operations, typed client-visible state, and error recovery.

## Four block kinds

Every piece of logic is one of four kinds. Same typed contract: input in, output out. Any block composes with any other.

| Kind | What it does |
|------|----------------|
| **Generator** | Calls a model. The framework handles prompt assembly, tool loops, and streaming. |
| **Handler** | Deterministic compute: validate, transform, mutate state, implement a tool. |
| **Sequencer** | Chains blocks: steps, parallel work, loops, rescue. A sequencer is itself a block. |
| **Router** | Picks one child block at runtime (mode switch, intent routing). |

A tool call can be a handler, a sequencer, or a router. There is no separate "agent" primitive.

The sequencer methods (`.step`, `.parallel`, `.sideChain`, `.doUntil`, `.rescue`, …) are covered in [Composition](/docs/sequencers/overview). You do not need them to finish the Quick Start.

## State and resources

State has four scopes, each with atomic operations:

| Scope | Lifetime |
|-------|----------|
| **Request** | One action run |
| **Session** | One conversation |
| **User** | Every session for a user |
| **Org** | Shared across users in an org |

A **resource** is a named document plus typed metadata in one of those scopes. An agent can read a draft, revise the body, and update metadata in one call. See [State and scopes](/docs/fundamentals/state-and-scopes) and [Resources](/docs/resources/overview).

## A flow is an API

Register a flow with `createFlowState` and a platform adapter. You get action execution, session management, SSE streaming, and state snapshots without writing routes:

```
POST /api/flows/my-app/actions/chat         → start an action
GET  /api/flows/my-app/requests/:id/stream  → SSE with sequence-number resume
GET  /api/flows/sessions/:id/state          → snapshot (only what `client` exposes)
```

Disconnect mid-response, reconnect with a cursor, and continue from the last sequence number.

## Where settings live

Settings live in three places. Each catalog sits next to the concept it configures: [Flow options](/docs/configuration/flow) after Flows, [Block options](/docs/configuration/blocks) after Blocks, [Runtime options](/docs/configuration/runtime) after Server setup. The [Configuration map](/docs/configuration/overview) at the end of Core is the lookup when you already know which object you are editing.

| Layer | Object | Typical file |
|-------|--------|--------------|
| Flow | `defineFlow({ ... })` | `src/flows/<name>/flow.ts` |
| Runtime | `createFlowState({ ... })` | `fsdev.config.ts` |
| Environment | keys, `FSD_ENV`, intent overrides | `.env.local` |

## What else ships

All optional. Skip anything you are not using.

- **React hooks** — `FlowProvider`, `useSession`, `ItemsRenderer` for the stream and session state
- **CLI** — `fsdev run` and `fsdev dev` use the same `createFlowState` handle as the server
- **DevTool** — inspect blocks, items, and state while a flow runs
- **Testing** — `testBlock` / `testFlow` with mocked generators
- **Models** — provider-agnostic ids, named intents, retry and fallback on the resolver

## Learn the framework

Read these in order. Guides sit next to Docs in the nav if you prefer a walkthrough.

1. **[Anatomy of a flow](/guides/anatomy-of-a-flow)** — the mental model, no project to build
2. **[Installation](/docs/getting-started/installation)** — packages to install
3. **[Setting up models](/docs/getting-started/setting-up-models)** — one API key
4. **[Quick Start](/docs/getting-started/quick-start)** — a streaming chat in one sitting
5. **[Your first flow](/docs/getting-started/your-first-flow)** — the same app, with the why
6. **[Fundamentals](/docs/fundamentals/overview)** — blocks, flows, state, capabilities. Field catalogs sit on the page after each concept.

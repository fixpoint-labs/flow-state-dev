# Architecture Overview

`@flow-state-dev` gives you four composable block primitives — **handler**, **generator**, **sequencer**, **router** — and a runtime that handles execution, streaming, state persistence, retries, and client rendering so you don't have to.

You define flows composed of blocks. The framework does the rest.

This document provides the system-level view. For deep dives into each subsystem, see the companion docs linked throughout.

## The idea in 30 seconds

Every AI feature needs the same infrastructure: call an LLM, stream the response, manage state, handle errors, sync with the UI. Teams rebuild this for every project. `@flow-state-dev` makes these concerns framework primitives.

```ts
// Define blocks
const chat = generator({ name: "chat", model: "gpt-5-mini", prompt: "..." });
const track = handler({ name: "track", execute: async (input, ctx) => {
  await ctx.session.incState({ count: 1 });
  return input;
}});

// Compose into a pipeline
const pipeline = sequencer({ name: "pipeline" })
  .then(chat)
  .then(track)
  .rescue([{ when: [Error], block: fallback }]);

// Expose as a flow
export default defineFlow({
  kind: "my-app",
  actions: { chat: { block: pipeline } },
  session: { stateSchema },
})({ id: "default" });
```

The framework gives you: SSE streaming with resume, atomic state operations, retry policies, rescue boundaries, lifecycle hooks, typed client SDK, React hooks — all from this definition.

## Package structure

Six packages with strict dependency boundaries:

```
@flow-state-dev/core       Isomorphic builders, type contracts, item taxonomy
@flow-state-dev/server     Execution runtime, stores, SSE streaming, HTTP routes
@flow-state-dev/client     Isomorphic API client (actions, sessions, streams)
@flow-state-dev/react      React hooks and renderers (wraps client)
@flow-state-dev/testing    Test harnesses and mocks
@flow-state-dev/cli        Terminal interface (fsdev)
apps/devtool               First-party inspector app
```

## Dependency graph

```
core ─────────────────────────────────┐
  ↑                                   │
  ├── server                          │
  │     ↑                             │
  │     ├── testing                   │
  │     └── cli ─── testing           │
  │                                   │
  ├── client ─────────────────────────┤
  │     ↑                             │
  │     └── react ────────────────────┘
  │           ↑
  │           └── apps/devtool
  └── client
```

**Boundary rules (locked):**
- `server` never depends on `react` or `client` — server knows nothing about transport consumers
- `client` never depends on `server` or `react` — works in any JavaScript environment
- `react` has no transport logic — it wraps `client` with hooks and renderers
- `cli` uses `server` + `testing`, never `react` or `client`
- `apps/devtool` uses only public APIs from `client` and `react`

## Core abstractions

### Blocks — the four primitives

Every piece of logic in the framework is one of exactly four block kinds:

| Kind | What it does | When to use it |
|------|-------------|----------------|
| **handler** | `input → execute → output` | Validation, data transforms, state mutations, tool implementations |
| **generator** | LLM call with framework-managed tool loop | Chat, structured extraction, agent tool use, any AI generation |
| **sequencer** | Fluent DSL composing blocks into pipelines | Building multi-step workflows with branching, parallelism, error recovery |
| **router** | Runtime block selection based on input or state | Dispatching to different pipelines based on mode, intent, or conditions |

All blocks share the same execution contract: `block.run(input, ctx)`. This uniformity means any block can be composed with any other block. See [Blocks](./blocks.md).

### Flows — the entry point

A flow ties blocks to **actions** (entry points), **scopes** (state containers), and **lifecycle hooks**:

```ts
const myFlow = defineFlow({
  kind: "my-flow",
  requireUser: true,
  actions: {
    chat: { inputSchema, block: chatPipeline, userMessage: (i) => i.message }
  },
  session: { stateSchema, resources: { ... }, clientData: { ... } },
  user: { stateSchema, clientData: { ... } },
});
```

Actions are the flow's public API. Clients call them by name. Each action maps to a root block that the framework executes. See [Flows and Actions](./flows-and-actions.md).

### Scopes — state that scales

Four nested state scopes, each with typed atomic operations:

```
request → session → user → project
(one run)  (conversation)  (across sessions)  (shared across users)
```

Each scope provides `patchState`, `setState`, `incState`, `pushState`, `atomicState`, and more — all CAS-guarded for concurrency safety. Blocks declare only the state fields they need via partial schemas, so a counter block doesn't need to know about a preferences block's state. See [State and Scopes](./state-and-scopes.md).

### Streaming — resilient by default

SSE-based item/content streaming with built-in resume:

- **Items** have types (`message`, `reasoning`, `component`, `status`, `error`, etc.) and lifecycle states (`in_progress` → `completed`)
- **Content** streams within items via delta events — text appears token-by-token
- **Sequence-number cursors** enable replay after disconnect — no data loss, no duplicates
- **Item types determine audience routing** — some items go to the UI, some to the LLM context, some to devtools

See [Streaming](./streaming.md).

### Resources and client data — data with policy

**Resources** are named, typed state containers scoped to sessions, users, or projects. Think of them as structured data stores that blocks can read and write. Blocks declare their resource dependencies via `defineResource()`, and the framework collects and merges these declarations automatically through sequencers up to the flow level. For dynamic collections where the instance count isn't known ahead of time, [Resource Namespaces](./resource-namespaces.md) let you create and destroy instances at runtime under a shared schema.

**Client data** entries are derived views computed from state and resources — the mechanism for exposing data to clients. Every `clientData` entry is client-visible. Raw state never reaches the client. This is deliberate: you can't accidentally leak internal state because `clientData` is the sole data gateway.

See [Resources and Client Data](./resources-and-client-data.md).

### Utility blocks — pre-built building blocks

Utility blocks are factory functions that wrap `generator` or `handler` blocks into specialized, high-level capabilities: context reduction, memory extraction, task decomposition, summarization, analysis, and more. Each utility returns a standard `BlockDefinition` — composable in sequencers, routers, and flows like any other block.

```ts
const summarize = utility.summarizer({ name: "brief", granularity: "brief" });
const analyze = utility.analyzer({ name: "check", criteria: ["accuracy"] });

const pipeline = sequencer({ name: "review" })
  .then(summarize)
  .then(analyze);
```

Ten utilities ship in Phase 1, grouped into five categories: Context & Memory, Planning & Decomposition, Synthesis & Output, Evaluation, and Routing. See [Utility Blocks](./utility-blocks.md).

## Data flow

A typical request flows through the system:

```
Client                    Server                           Store
  │                         │                               │
  ├─ POST action ──────────►│                               │
  │                         ├─ validate input                │
  │                         ├─ resolve session ─────────────►│
  │                         ├─ create execution context      │
  │                         ├─ emit user message item        │
  │                         ├─ execute root block            │
  │                         │   ├─ block.run(input, ctx)     │
  │                         │   ├─ emit items/content ──────►│ (persist)
  │                         │   └─ state ops ───────────────►│ (CAS write)
  │◄── SSE stream ──────────┤                               │
  │  (items, deltas, status)│                               │
  │                         ├─ fire lifecycle hooks          │
  │                         ├─ terminal request status       │
  │◄── request.completed ───┤                               │
  │                         │                               │
  ├─ GET state snapshot ───►│──────────────────────────────►│
  │◄── snapshot response ───┤                               │
```

Key points:
1. **Async by design** — POST returns `202 Accepted` immediately. Execution happens in the background.
2. **Live streaming** — Items stream via SSE as blocks execute. The client sees results as they're produced.
3. **Correctness path** — Client refetches the state snapshot on `request.completed` to get the authoritative final state.
4. **Resilient resume** — Reconnect after disconnect using `Last-Event-ID` or `starting_after` query param. The server replays missed events from the sequence cursor.

## Locked contracts (Phase 1)

These decisions are canonical and cannot change without architecture review:

- Block kinds are exactly: `handler`, `generator`, `sequencer`, `router`
- Actions are flow-level (`defineFlow({ actions })`)
- Required caller input: `userId`
- Stream model: item/content lifecycle (no part-envelope model)
- Stream cursor: `${requestId}:${sequence_number}`
- Resume: both `Last-Event-ID` and `starting_after`
- Generator provider: Vercel AI SDK in Phase 1
- Observational hooks: past tense (`onStarted`, `onCompleted`, `onErrored`, `onFinished`)

## Canonical authority

For edge cases and detailed contracts, the canonical specs in `../preperation/architecture/` are authoritative. The docs in this directory are adapted summaries — when in doubt, check the source spec.

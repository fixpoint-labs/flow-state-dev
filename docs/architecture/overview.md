# Architecture Overview

`@flow-state-dev` is a block-based AI workflow framework. You define **flows** composed of **blocks**, and the framework handles execution, streaming, state persistence, retries, and client rendering.

This document provides the system-level view. For deep dives into each subsystem, see the companion docs linked throughout.

## Package Structure

The framework ships as six packages plus one first-party app:

```
@flow-state-dev/core       Isomorphic builders, type contracts, item taxonomy
@flow-state-dev/server     Execution runtime, stores, SSE streaming, HTTP routes
@flow-state-dev/client     Isomorphic API client (actions, sessions, streams)
@flow-state-dev/react      React hooks and renderers (wraps client)
@flow-state-dev/testing    Test harnesses and mocks
@flow-state-dev/cli        Terminal interface (fsdev)
apps/devtool               First-party inspector app
```

## Dependency Graph

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

**Boundary rules:**
- `server` never depends on `react` or `client`
- `client` never depends on `server` or `react`
- `react` has no transport logic — it wraps `client`
- `cli` uses `server` + `testing`, never `react` or `client`
- `apps/devtool` uses only public APIs from `client` and `react`

## Core Abstractions

### Blocks

Four block kinds compose all framework behavior:

| Kind | Purpose | Example |
|------|---------|---------|
| **handler** | Synchronous logic: `input → execute → output` | Validate input, transform data, update state |
| **generator** | LLM call with framework-managed tool loop | Chat completion, structured extraction, agent tool use |
| **sequencer** | Fluent DSL composing blocks into pipelines | `then`, `parallel`, `forEach`, `rescue`, `work` |
| **router** | Runtime block selection | Route to different pipelines based on input/state |

All blocks share the same execution contract: `block.run(input, ctx)`. See [Blocks](./blocks.md).

### Flows

A flow ties blocks to **actions** (entry points), **scopes** (state containers), and **lifecycle hooks**:

```ts
const myFlow = defineFlow({
  kind: "my-flow",
  requireUser: true,
  actions: {
    chat: { inputSchema, block: chatPipeline, userMessage: (i) => i.message }
  },
  session: { stateSchema }
});
```

See [Flows and Actions](./flows-and-actions.md).

### Scopes

Four nested state scopes with typed operations:

```
request → session → user → project
```

Each scope provides atomic state operations (`patchState`, `incState`, `pushState`, etc.) with CAS-based concurrency. See [State and Scopes](./state-and-scopes.md).

### Streaming

SSE-based item/content streaming model:

- Items have types (`message`, `reasoning`, `component`, `status`, `error`, etc.)
- Content streams within items via delta events
- Sequence-number cursors enable replay/resume
- Item types determine audience routing (client, LLM, devtools)

See [Streaming](./streaming.md).

## Data Flow

A typical request flows through the system like this:

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
1. POST returns `202 Accepted` immediately — execution is async
2. Items stream live via SSE as blocks execute
3. Client refetches state snapshot on `request.completed` (correctness path)
4. Resume after disconnect uses `Last-Event-ID` or `starting_after` query param

## Locked Contracts (Phase 1)

These decisions are canonical and cannot change without architecture review:

- Block kinds are exactly: `handler`, `generator`, `sequencer`, `router`
- Actions are flow-level (`defineFlow({ actions })`)
- Required caller input: `userId`
- Stream model: item/content lifecycle (no part-envelope model)
- Stream cursor: `${requestId}:${sequence_number}`
- Resume: both `Last-Event-ID` and `starting_after`
- Generator provider: Vercel AI SDK in Phase 1
- Observational hooks: past tense (`onStarted`, `onCompleted`, `onErrored`, `onFinished`)

## Canonical Authority

For edge cases and detailed contracts, the canonical specs in `../preperation/architecture/` are authoritative. The docs in this directory are adapted summaries — when in doubt, check the source spec.

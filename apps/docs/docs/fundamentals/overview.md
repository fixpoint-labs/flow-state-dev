---
sidebar_position: 1
---

# Overview

flow-state.dev is a block-based AI workflow framework for TypeScript. You compose four block primitives into flows. The framework runs them, streams the output, and manages state. This page is a map, not a textbook.

## Four block kinds

Every piece of logic is exactly one of four kinds:

- **Handler** — Pure logic. Validate input, transform data, mutate state, implement tool logic. No LLM, no streaming. Silent by default.
- **Generator** — LLM calls. The framework manages prompt assembly, tool loops, streaming, and structured output. This is where AI happens.
- **Sequencer** — Compose blocks into pipelines. Chain steps, run work in parallel, add rescue boundaries for error recovery.
- **Router** — Dispatch to different blocks at runtime based on input or state. Mode switching, intent routing, conditional flows.

All blocks share the same contract: `block.run(input, ctx)`. Any block composes with any other. Any block or pipeline can be used as a tool.

## Flows tie everything together

A flow defines your API: actions (entry points), state schemas, resources, clientData, lifecycle hooks. Register a flow with the server and you get REST endpoints for action execution, session management, SSE streaming, and state snapshots. No route wiring.

See [Flows](/docs/fundamentals/flows) and [Actions](/docs/fundamentals/actions).

## State in four scopes

State lives in four nested scopes with atomic operations:

| Scope | Lifetime |
|-------|----------|
| Request | Single action run |
| Session | Across requests in a conversation |
| User | Across sessions for a user |
| Project | Shared across users |

Each scope supports `patchState`, `setState`, `incState`, `pushState`, `atomicState`. Operations are CAS-guarded. Blocks declare only the state fields they need.

See [State and Scopes](/docs/fundamentals/state-and-scopes).

## Streaming is structural

Streaming is not raw text. The framework streams **typed items** — messages, reasoning, tool calls, state changes, custom components. Each item has a type, a lifecycle (added → content.delta → done), and a sequence number. Clients can disconnect and resume from a cursor. No data loss.

See [Streaming](/docs/streaming/overview) and [Items](/docs/streaming/items).

## Everything composes

Blocks inside blocks. Sequencers as tools. Routers dispatching to sequencers. Type safety from flow definition through the client SDK to React hooks. One Zod schema, validated at runtime and inferred at compile time.

## Next steps

- [Blocks](/docs/fundamentals/blocks) — Deep dive into the four primitives
- [Quick Start](/docs/getting-started/quick-start) — Build a streaming chat app in 5 minutes
- [Building a Chat App](/docs/tutorials/building-a-chat-app) — Full walkthrough

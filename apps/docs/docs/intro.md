---
sidebar_position: 1
slug: /intro
---

# Introduction

Flow State Dev is a block-based AI workflow framework for TypeScript. It gives you typed building blocks for AI interactions, composable pipelines, resumable streaming, and scoped state management — all with one type system from server to UI.

## Why Flow State Dev?

Building AI features typically means stitching together orchestration, retries, streaming, state, and UI rendering in application-specific ways. Flow State Dev makes these concerns first-class framework primitives:

- **Typed blocks** — Define handlers, generators, sequencers, and routers with input/output schemas that are validated at runtime and inferred at compile time.
- **Composable flows** — Chain blocks into pipelines with branching, parallelism, error recovery, and background work using a fluent DSL.
- **Resumable streaming** — Item-first SSE streaming with sequence-number replay. Clients reconnect mid-stream without losing data.
- **Scoped state** — Four scope levels (request, session, user, project) with typed state operations, resources, and projections.
- **Full-stack TypeScript** — One type system across server execution, client transport, and React UI. Schemas defined once, validated everywhere.

## How It Works

A **flow** is the top-level unit. It declares **actions** (entry points) that execute **blocks** (the runtime units). Blocks come in four kinds:

| Block | Purpose |
|-------|---------|
| **Handler** | Synchronous logic — validation, state updates, transformations |
| **Generator** | LLM calls with tool loops, structured output, and streaming |
| **Sequencer** | Pipeline composition — chaining, branching, parallelism |
| **Router** | Runtime block selection based on input or state |

Blocks compose into pipelines via the **sequencer DSL**. Pipelines execute on the **server**, stream results to the **client** via SSE, and render in **React** through hooks and renderers.

## Package Overview

| Package | Purpose |
|---------|---------|
| `@flow-state-dev/core` | Block builders, flow definitions, type contracts |
| `@flow-state-dev/server` | Action runtime, stores, SSE streaming |
| `@flow-state-dev/client` | HTTP/SSE transport client (no React dependency) |
| `@flow-state-dev/react` | React hooks, renderers, context providers |
| `@flow-state-dev/testing` | Test harnesses for blocks, flows, generators |

## Next Steps

- [Quick Start](/docs/getting-started/quick-start) — Build your first flow in 5 minutes
- [Concepts](/docs/concepts/blocks) — Understand the core abstractions
- [Guides](/docs/guides/building-a-chat-app) — Build a complete chat application

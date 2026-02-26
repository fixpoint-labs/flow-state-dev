# @flow-state-dev/core

Isomorphic builders, type contracts, and item taxonomy for Flow State Dev.

This is the foundation package — every other package depends on it. It defines the block builders, flow model, type system, and item/event taxonomy used across the framework.

## What This Package Is For

Use `@flow-state-dev/core` to:
- Define blocks (`handler`, `generator`, `sequencer`, `router`)
- Define flows (`defineFlow`)
- Define resources and projections (`defineResource`, `defineProjection`)
- Import shared types and item definitions

This package is **isomorphic** — no platform-specific code (Node, browser, etc.).

## Quick Start

```ts
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

// Define a generator block
const chatGen = generator({
  name: "chat",
  model: "gpt-5-mini",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
});

// Define a handler block
const counter = handler({
  name: "counter",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sessionStateSchema: z.object({ count: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.patchState({ count: (ctx.session.state.count ?? 0) + 1 });
    return input;
  },
});

// Compose into a pipeline
const pipeline = sequencer({ name: "chat-pipeline", inputSchema: z.object({ message: z.string() }) })
  .then(chatGen)
  .then(counter);

// Define the flow
const flow = defineFlow({
  kind: "my-chat",
  requireUser: true,
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: pipeline,
      userMessage: (input) => input.message,
    },
  },
  session: {
    stateSchema: z.object({ count: z.number().default(0) }),
  },
});

export default flow({ id: "default" });
```

## Exports

### Main (`@flow-state-dev/core`)

**Block Builders:**
- `handler(config)` — Synchronous logic block
- `generator(config)` — LLM call with tool loop
- `sequencer(config)` — Fluent composition DSL
- `router(config)` — Runtime block selection

**Flow:**
- `defineFlow(definition)` — Create a flow type

**Resources & Projections:**
- `defineResource(config)` — Portable resource definition
- `defineProjection(config)` — Portable projection definition
- `resource(uri, opts?)` — Resource slot reference for generators
- `projection(uri, opts?)` — Projection slot reference
- `projectionText(uri, opts?)` — Text projection reference
- `projectionData(uri, opts?)` — Data projection reference
- `projectionMessages(uri, opts?)` — Message projection reference

**Type Helpers:**
- `StateOf<T>` — Extract state type from schema or resource
- `ContextOf<T, Kind>` — Get context handle type for scope/resource
- `ResourceContext<T>` — Resource context type
- `BlockInput<T>` / `BlockOutput<T>` — Infer block I/O types

### Types (`@flow-state-dev/core/types`)

Block, flow, resource, scope, streaming, and model type definitions. Use this subpath for type-only imports in client/react code.

### Items (`@flow-state-dev/core/items`)

Canonical output item unions, content types, and stream event helpers. Use this subpath for item-related type imports.

## Dependencies

- `zod` ^3.24.1 — Schema validation

## Scripts

- `pnpm --filter @flow-state-dev/core build`
- `pnpm --filter @flow-state-dev/core typecheck`
- `pnpm --filter @flow-state-dev/core test`

## Architecture Reference

See `docs/architecture/` for detailed documentation:
- [Blocks](../../docs/architecture/blocks.md)
- [Flows and Actions](../../docs/architecture/flows-and-actions.md)
- [Sequencer DSL](../../docs/architecture/sequencer-dsl.md)
- [State and Scopes](../../docs/architecture/state-and-scopes.md)
- [Resources and Projections](../../docs/architecture/resources-and-projections.md)

---
sidebar_position: 1
---

# Overview

Resources are named, schema-typed containers attached to scopes (session, user, project). Each resource combines structured state with optional rich text content. Unlike scope state, which is a flat key-value object, resources are self-contained units with identity. Use them when data has structure, lifecycle, or content that doesn't fit a simple field.

## defineResource

Declare a reusable resource with `defineResource()`:

```ts
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

const planResource = defineResource({
  stateSchema: z.object({
    steps: z.array(z.string()).default([]),
    status: z.enum(["draft", "active", "complete"]).default("draft"),
    updatedAt: z.number().default(0),
  }),
  writable: true,
});
```

Config options:

- **stateSchema** — Zod schema for structured state
- **content** or **contentFile** — optional rich text body (mutually exclusive)
- **render** — optional template renderer `(content, state) => string`
- **writable** — whether blocks can patch/write the resource
- **llmReadable**, **llmWritable** — control LLM access (see [LLM access](#llm-access-patterns))

## Resources vs scope state

| | Scope state | Resources |
|--|-------------|-----------|
| Shape | Flat key-value | Named container with state + optional content |
| Identity | Field names | Resource name |
| Content | No | Yes (optional) |
| Namespace | Shared across blocks (bubbles up) | Per-resource, no collision |

Use **scope state** for simple fields: mode flags, counters, config values. Use **resources** when data has identity, structure, or content. See [State Storage](/docs/resources/storage) for the full decision guide.

## Resource config

```ts
defineResource({
  stateSchema: z.object({ ... }),
  default: { ... },           // initial state
  content: "# Hello {{ title }}",  // static template
  contentFile: "./templates/plan.md",  // or load from file
  render: (content, state) => content.replace(/\{\{(\w+)\}\}/g, (_, k) => state[k]),
  writable: true,
  llmReadable: true,
  llmWritable: false,
});
```

`content` and `contentFile` are mutually exclusive. `readContent()` returns the rendered text; `readContentRaw()` returns the stored body. Use `render` to interpolate state into templates.

## LLM access patterns

Resources are not automatically exposed to generators. Add `readResourceContentTool()` or `writeResourceContentTool()` to a generator when you want the LLM to read or write resource content. Set `llmReadable` / `llmWritable` on the resource to control what the tools can do. See the API docs for tool wiring.

## Block-level resource declarations

Blocks declare resource dependencies with `sessionResources`, `userResources`, and `projectResources`:

```ts
import { defineResource, handler } from "@flow-state-dev/core";

const planResource = defineResource({
  stateSchema: z.object({ steps: z.array(z.string()).default([]) }),
  writable: true,
});

const planManager = handler({
  name: "plan-manager",
  sessionResources: { plan: planResource },
  execute: async (input, ctx) => {
    await ctx.session.resources.plan.patchState({ steps: ["step1", "step2"] });
    return input;
  },
});
```

The block brings its own resource requirements. No need to repeat them in the flow.

## Automatic resource collection

Sequencers merge `declaredResources` from all child blocks. `defineFlow` collects resources from action blocks and merges them into the flow's scope configs. Flow-level resource declarations take priority over block-level ones. Blocks are self-documenting: their resource needs bubble up automatically.

## Resource scope levels

| Scope | Lifetime |
|-------|----------|
| **session** | One conversation |
| **user** | Across sessions for a user |
| **project** | Shared across users in a project |

Choose the scope that matches the data's lifetime. Session for conversation-local data, user for personal persistence, project for team-shared data.

## Where to go next

- **[Storage](/docs/resources/storage)** — When to use resources vs scope state, scoping decisions, block-private vs shared
- **[State & Scopes](/docs/fundamentals/state-and-scopes)** — Broader state model, clientData, targets

---
sidebar_position: 2
title: "Setup"
---

# DevTool Setup

How to get the DevTool running against your own flows.

## Prerequisites

You need:
- `@flow-state-dev/cli` installed (provides the `fsdev` command)
- `@flow-state-dev/devtool` installed (provides the pre-built UI assets)
- At least one flow definition in a conventional location

```bash
pnpm add -D @flow-state-dev/cli @flow-state-dev/devtool
```

## Project structure

The CLI discovers flows from standard directories. A minimal project looks like this:

```
my-project/
├── src/
│   └── flows/
│       └── my-flow/
│           └── flow.ts    ← exports a FlowInstance as default
├── package.json
└── .env.local             ← optional, loaded automatically
```

The flow file should default-export a `FlowInstance` created by `defineFlow`:

```ts
import { defineFlow, handler } from "@flow-state-dev/core";

const echo = handler({
  name: "echo",
  execute: async (input) => input,
});

export default defineFlow({
  kind: "my-flow",
  actions: {
    echo: { block: echo },
  },
})({ id: "default" });
```

## Starting the server

Run from your project root:

```bash
fsdev dev
```

Output looks like:

```
  DevTool server running at http://localhost:4200

  Flows:  my-flow
  API:    http://localhost:4200/api/flows
  Data:   .fsdev/data/
```

The DevTool opens in your browser. Select your flow from the navigator, create a session, and dispatch actions.

## Custom flow directories

If your flows live somewhere non-standard, use `--flow-dir`:

```bash
fsdev dev --flow-dir ./lib/workflows
```

This flag is repeatable. When specified, the default `src/flows/` and `flows/` discovery is skipped.

## Model overrides

During development you might want a faster or cheaper model. Use `--model` to override all generator blocks:

```bash
fsdev dev --model gpt-4o-mini
```

## Environment variables

The CLI loads `.env.local` files automatically, walking up from your working directory. Put API keys and configuration there:

```bash
# .env.local
OPENAI_API_KEY=sk-...
```

## Data persistence

Session data persists to `.fsdev/data/` relative to your working directory. Delete this directory to start fresh. The directory is created automatically on first use.

## Monorepo support

In monorepos, `fsdev dev` scans one level under `packages/`, `examples/`, `apps/`, and `labs/` for flow directories. Run it from the monorepo root to discover flows across all packages.

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

## Connecting to a secured flow

Some flows authenticate every request with a bearer secret. Their principal resolver rejects anything that arrives without a valid token. DevTool has no token to send by default, so those flows look inert: you dispatch an action and nothing happens.

Declare a `devtool` block in your `fsdev.config.ts`:

```ts
export default createFlowState({
  // ...flows, stores...
  devtool: {
    userId: "owner",
    bearerToken: process.env.MY_FLOW_SECRET,
  },
});
```

`fsdev dev` reads it and wires DevTool from it. `userId` becomes the session identity DevTool creates sessions and dispatches as. `bearerToken` is sent as `Authorization: Bearer` on every flow request. Use the identity the flow's resolver expects: a bearer flow that resolves to a fixed `owner` needs `userId: "owner"`, so the session and the action agree on who is acting.

The wiring is local-only. The token is injected into the loopback page `fsdev dev` serves and nowhere else. `fsdev serve` and deploy paths ignore the `devtool` block.

For a one-off you can skip the config and set a bearer token ad hoc in the Settings sheet (the gear icon). Precedence is straightforward: a `userId` from the config wins over a previously-saved Settings value on load.

## Environment variables

The CLI loads `.env.local` files automatically, walking up from your working directory. Put API keys and configuration there:

```bash
# .env.local
OPENAI_API_KEY=sk-...
```

## Data persistence

By default, session data persists to `.fsdev/data/` relative to your working directory. Delete this directory to start fresh. The directory is created automatically on first use.

This is the no-config default. When your project ships an `fsdev.config.ts`, stores come from the app's own wiring instead, whatever profile that config declares. See [App Configuration](/docs/cli/configuration).

## Monorepo support

In monorepos, `fsdev dev` scans one level under `packages/`, `examples/`, `apps/`, and `labs/` for flow directories. Run it from the monorepo root to discover flows across all packages.

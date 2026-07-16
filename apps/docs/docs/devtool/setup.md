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

## Development auth

Some flows gate every request behind a bearer token. The flow's principal resolver rejects anything without a valid secret, which is what you want in production. It also means you can't drive that flow from DevTool, because DevTool has no token to send.

`fsdev dev --dev-auth` relaxes that locally. It trusts the `userId` in the request body for HTTP actions and skips the flow's own resolver. Create a session, send actions as any `userId`, and the bearer check never runs.

```bash
fsdev dev --dev-auth
```

The scope is deliberately narrow:

- Opt-in and off by default. Plain `fsdev dev` enforces real transport auth, the same as production.
- Only HTTP-action traffic is affected, the requests DevTool sends. MCP, webhook, and scheduled transports keep their real auth.
- The dev server binds `127.0.0.1` and prints a warning at startup naming the store it will use.
- It refuses to start when `FSD_DB_URL` or `DATABASE_URL` is set. A config-based `fsdev dev` can point at a real backend, so dev-auth stays disabled until you unset the database URL.

Under the hood the flag sets `FSDEV_DEV_AUTH=1`, which the server honors directly (this is how a config-based `fsdev dev` opts in). Never set that variable on a deployed server: it trusts the caller's `userId` with no authentication. As a backstop, `fsdev serve` refuses to bind a non-loopback host while `FSDEV_DEV_AUTH=1` is set, so a misconfigured production server fails fast instead of running open.

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

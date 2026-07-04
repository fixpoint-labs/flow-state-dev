---
sidebar_position: 3
title: Next.js Setup
---

# Next.js Setup

A focused guide on integrating flow-state-dev with a Next.js App Router application. If you're building your first flow-state app in Next.js, start here.

---

## Prerequisites

- **Next.js 15+** (App Router) — required by `@flow-state-dev/next` and `@flow-state-dev/vercel/next`
- **Node.js 22+**
- **pnpm** or npm/yarn

You'll need the framework packages: core, server, client, and react. The server runs your flows. The client talks to the server over HTTP and SSE. React wraps the client with hooks.

---

## Install packages

```bash
pnpm add @flow-state-dev/core @flow-state-dev/engine @flow-state-dev/client @flow-state-dev/react zod
```

`zod` is a peer dependency. Used for schema validation everywhere. The React package brings in the client automatically, but listing both keeps dependencies explicit.

Add a platform adapter for the route handler. On Vercel:
```bash
pnpm add @flow-state-dev/vercel
```
On non-Vercel Next.js deployments:
```bash
pnpm add @flow-state-dev/next
```

For development:
```bash
pnpm add -D @flow-state-dev/testing @flow-state-dev/cli
```

---

## Create the FlowState

Describe the runtime once with `createFlowState`. Pass your flows, a model config, and where state lives. Keep it in its own file so the route handler imports a configured instance.

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import chatFlow from "@/flows/hello-chat/flow";

export const flowstate = createFlowState({
  flows: { chatFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: inMemoryStores() } },
});
```

`stores` is a map of named profiles. A profile maps capability slots (typed containers for a category of storage) to adapters. The required slot is `primary`, the catch-all state store. Swap `inMemoryStores()` for a persistent adapter when you're ready. See [Server Setup](/docs/server/setup).

## Sharing config with the CLI

The `fsdev` CLI can run your flows with this same wiring, your models and your stores, if it can find the FlowState. Move the `createFlowState` call into an `fsdev.config.ts` at your project root and have it default-export the handle:

```ts title="fsdev.config.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import chatFlow from "./src/flows/hello-chat/flow";

export default createFlowState({
  flows: { chatFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: inMemoryStores() } },
});
```

Then re-export it from the server entry your route handler imports, so both sides reference one object:

```ts title="lib/flowstate.ts"
export { default as flowstate } from "../fsdev.config";
```

Now `fsdev run` uses the app's registry, resolver, and stores instead of CLI defaults:

```bash
pnpm fsdev run hello-chat chat -i '{"message":"hi"}'
```

Note the config's import chain uses relative paths (`./src/flows/...`), not the `@/` alias. Native TypeScript stripping ignores `tsconfig` path aliases. See [App Configuration](/docs/cli/configuration) for runtime requirements and caveats.

## Create the API route

The framework expects a single catch-all route. It handles routing internally. You don't create separate routes for actions, streams, or state.

For Vercel-hosted Next.js, use `createVercelNextHandler` from `@flow-state-dev/vercel/next`. It adds Vercel's SSE header shaping:

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
```

For non-Vercel Next.js deployments (for example Next-on-Cloudflare), use `createNextHandler` from `@flow-state-dev/next` instead:

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createNextHandler } from "@flow-state-dev/next";

export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate);
```

**Why a catch-all?** The framework uses path-based routing: `/api/flows/:kind/actions/:action`, `/api/flows/:kind/requests/:requestId/stream`, etc. A single `[...path]` segment captures the rest of the path. The router parses it and dispatches to the right handler. One file, full API.

**What this creates:**
- POST for action execution (with or without session ID)
- GET for SSE streams and state snapshots
- DELETE for session cleanup

All under `/api/flows/`. Add more flows by listing them in `flows` on `createFlowState`.

---

## Model resolution

Generators specify a model string (e.g. `"openai/gpt-5.4-mini"`). At runtime, the server resolves that to an actual AI SDK model. You need a model resolver.

You configure models on `createFlowState`. `models.default` is the fallback. The resolver auto-detects providers from environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) and auto-wires the Vercel AI Gateway when `AI_GATEWAY_API_KEY` is set.

```ts title="lib/flowstate.ts"
export const flowstate = createFlowState({
  flows: { chatFlow },
  models: {
    default: "openai/gpt-5.4-mini",
    intents: {
      chat: ["vercel/anthropic/claude-sonnet-4.6", "vercel/openai/gpt-5.5"],
    },
  },
  stores: { default: { primary: inMemoryStores() } },
});
```

Model strings use slash format: `"openai/gpt-5.4-mini"`, `"anthropic/claude-sonnet-4-6"`. For gateway routing: `"vercel/openai/gpt-5.4"`. `intents` maps a named intent to an ordered list of candidate models the resolver tries in turn.

---

## Add FlowProvider

The React hooks need context. Wrap your layout or the page that uses flows.

```tsx title="app/layout.tsx"
import { FlowProvider } from "@flow-state-dev/react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <FlowProvider flowKind="hello-chat" userId="devuser">
          {children}
        </FlowProvider>
      </body>
    </html>
  );
}
```

Or wrap a specific page if only part of your app uses flows:

```tsx title="app/chat/page.tsx"
"use client";

import { FlowProvider } from "@flow-state-dev/react";
import { ChatUI } from "@/components/ChatUI";

export default function ChatPage() {
  return (
    <FlowProvider flowKind="hello-chat" userId="devuser">
      <ChatUI />
    </FlowProvider>
  );
}
```

**Important:** Hooks like `useFlow`, `useSession`, and `useClientData` must run in client components. Add `"use client"` at the top of any component that uses them. FlowProvider can live in a layout (which may be a server component) as long as the hooks only run in client children.

---

## Environment variables

Set `OPENAI_API_KEY` (or your provider's key) for real LLM calls:

```
OPENAI_API_KEY=sk-...
```

If using the default Vercel AI Gateway: `AI_GATEWAY_API_KEY`. For custom resolvers, use whatever your provider expects. Never commit keys. Use `.env.local` for local development.

To pick a store profile per environment, set `FSD_ENV` to the profile name. It wins over `defaultProfile`. `NODE_ENV` is not consulted, so a production build doesn't silently point at production infrastructure. See [Profile selection](/docs/server/setup#profile-selection).

---

## Project structure

Suggested layout:

```
app/
  api/
    flows/
      [...path]/
        route.ts          # Single catch-all (imports lib/flowstate)
  layout.tsx
  page.tsx

lib/
  flowstate.ts            # createFlowState config

src/
  flows/
    hello-chat/
      flow.ts             # Flow definition
      blocks/
        chat-gen.ts       # Generator
        counter.ts        # Handler
  components/
    ChatApp.tsx           # FlowProvider + hooks
```

Flows can live under `src/flows/` or `app/flows/`. The CLI and most examples use `src/flows/`. Keep blocks next to their flow. Shared blocks can go in `src/blocks/` or `src/flows/shared/`.

---

## Common pitfalls

### Server vs client components

Hooks require client components. If you see "useSession can only be used in a Client Component," add `"use client"` at the top of the file. FlowProvider can wrap from a layout; the children that call hooks must be client components.

### Pass the flowstate object, not its router

`createVercelNextHandler(flowstate)` takes the `FlowState` handle, not the resolved router. Don't call `createVercelNextHandler(flowstate.getRouter())`. The handler resolves the router lazily on the first request, which is what lets stores initialize without top-level await.

### API route exports

The route must export `GET`, `POST`, `PATCH`, and `DELETE`. The framework uses all four. If you only export `POST`, streaming and state fetches will fail. The destructuring form (`export const { GET, POST, PATCH, DELETE } = ...`) exports all of them at once.

### FlowProvider placement

Put FlowProvider as high as needed. Every component that uses `useFlow`, `useSession`, or `useClientData` must be a descendant. If you have multiple flows in one app, use nested providers or switch `flowKind` based on route.

### Base URL for the client

The client defaults to `/api/flows` when running in the browser. If your API lives elsewhere (e.g. a separate backend), configure the base URL in the client or FlowProvider. See the [Client API](/docs/api/client) for options.

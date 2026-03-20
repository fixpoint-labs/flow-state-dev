---
sidebar_position: 3
title: Next.js Setup
---

# Next.js Setup

A focused guide on integrating flow-state-dev with a Next.js App Router application. If you're building your first flow-state app in Next.js, start here.

---

## Prerequisites

- **Next.js 14+** (App Router)
- **Node.js 18+** (20+ recommended)
- **pnpm** or npm/yarn

You'll need the framework packages: core, server, client, and react. The server runs your flows. The client talks to the server over HTTP and SSE. React wraps the client with hooks.

---

## Install packages

```bash
pnpm add @flow-state-dev/core @flow-state-dev/server @flow-state-dev/client @flow-state-dev/react zod
```

`zod` is a peer dependency. Used for schema validation everywhere. The React package brings in the client automatically, but listing both keeps dependencies explicit.

For development:
```bash
pnpm add -D @flow-state-dev/testing @flow-state-dev/cli
```

---

## Create the API route

The framework expects a single catch-all route. It handles routing internally. You don't create separate routes for actions, streams, or state.

```ts title="app/api/flows/[...path]/route.ts"
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";
import chatFlow from "@/flows/hello-chat/flow";

const registry = createFlowRegistry();
registry.register(chatFlow);

const router = createFlowApiRouter({ registry });

export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
```

**Why a catch-all?** The framework uses path-based routing: `/api/flows/:kind/actions/:action`, `/api/flows/:kind/requests/:requestId/stream`, etc. A single `[...path]` segment captures the rest of the path. The router parses it and dispatches to the right handler. One file, full API.

**What this creates:**
- POST for action execution (with or without session ID)
- GET for SSE streams and state snapshots
- DELETE for session cleanup

All under `/api/flows/`. Add more flows by registering them in the same registry.

---

## Model resolution

Generators specify a model ID string (e.g. `"gpt-5-mini"`). At runtime, the server resolves that to an actual AI SDK model. You need a model resolver.

**Default:** The framework can use the Vercel AI Gateway. Set `AI_GATEWAY_API_KEY` or use Vercel OIDC.

**Custom resolver with OpenAI:**

```ts
import { createAiSdkModelResolver } from "@flow-state-dev/core/models";
import { openai } from "@ai-sdk/openai";

const router = createFlowApiRouter({
  registry,
  modelResolver: createAiSdkModelResolver((modelId) => {
    return openai(modelId);
  }),
});
```

Install the provider: `pnpm add @ai-sdk/openai`. For Anthropic: `pnpm add @ai-sdk/anthropic` and use `anthropic(modelId)`.

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

---

## Project structure

Suggested layout:

```
app/
  api/
    flows/
      [...path]/
        route.ts          # Single catch-all
  layout.tsx
  page.tsx

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

### API route exports

The route must export `GET`, `POST`, and `DELETE`. The framework uses all three. If you only export `POST`, streaming and state fetches will fail.

### FlowProvider placement

Put FlowProvider as high as needed. Every component that uses `useFlow`, `useSession`, or `useClientData` must be a descendant. If you have multiple flows in one app, use nested providers or switch `flowKind` based on route.

### Base URL for the client

The client defaults to `/api/flows` when running in the browser. If your API lives elsewhere (e.g. a separate backend), configure the base URL in the client or FlowProvider. See the [Client API](/docs/api/client) for options.

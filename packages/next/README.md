# @flow-state-dev/next

Platform-agnostic Next.js App Router adapter for flow-state-dev.

## Installation

```bash
pnpm add @flow-state-dev/next
```

`createNextHandler` mounts a `FlowState` (from `createFlowState`) onto a
catch-all route. It resolves the runtime lazily on the first request and
awaits Next.js 15's async `params`. There's no Vercel-specific behavior here,
so the same handler works on Next-on-Cloudflare and other non-Vercel Next
deployments.

```ts
// app/api/flows/[...path]/route.ts
import { flowstate } from "@/flowstate";
import { createNextHandler } from "@flow-state-dev/next";

export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

Deploying to Vercel? Use `@flow-state-dev/vercel/next`'s
`createVercelNextHandler` instead — it adds SSE header shaping and keeps the
serverless function alive for background work via `waitUntil`.

Requires Next.js 15 or later (for the stable async `params` contract).

See the [Server Setup guide](https://flow-state.dev/docs/server/setup) for the
full `createFlowState` reference.

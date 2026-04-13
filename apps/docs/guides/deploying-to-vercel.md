---
sidebar_position: 7
title: Deploying to Vercel
---

# Deploying to Vercel

How to deploy a flow-state-dev Next.js application to Vercel. This covers the App Router pattern, SSE streaming configuration, persistence on serverless, and the common problems you'll hit.

If you haven't set up a Next.js project with the framework yet, start with the [Next.js Setup](/guides/nextjs-setup) guide first.

---

## Prerequisites

- A Next.js 14+ project with flow-state-dev integrated ([setup guide](/guides/nextjs-setup))
- A [Vercel account](https://vercel.com)
- The [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`) — optional but useful for testing
- At least one LLM provider API key (e.g., `OPENAI_API_KEY`)

---

## 1. Configure the API route

Your catch-all route handler needs one critical setting:

```ts title="app/api/flows/[...path]/route.ts"
import { router } from "@/lib/server";
import { type NextRequest } from "next/server";

// Required: prevents Next.js from buffering the response body.
// Without this, SSE tokens arrive in bursts instead of real-time.
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  const params = await ctx.params;
  return router.GET(req, { params });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const params = await ctx.params;
  return router.POST(req, { params });
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const params = await ctx.params;
  return router.DELETE(req, { params });
}
```

You also need a sibling route for the bare `/api/flows` path, because Next.js `[...path]` catch-all requires at least one segment:

```ts title="app/api/flows/route.ts"
import { router } from "@/lib/server";
import { type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  return router.GET(req, { params: { path: [] } });
}

export async function POST(req: NextRequest) {
  return router.POST(req, { params: { path: [] } });
}
```

**Why `force-dynamic`?** Next.js aggressively optimizes routes. Without this flag, it may try to statically render or cache the response, which breaks SSE streaming entirely. This is the single most common deployment issue.

---

## 2. Configure Next.js

If your flow-state-dev packages are local workspace dependencies (monorepo), tell Next.js to transpile them:

```js title="next.config.mjs"
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@flow-state-dev/core",
    "@flow-state-dev/client",
    "@flow-state-dev/react",
    "@flow-state-dev/server",
  ],
};

export default nextConfig;
```

If you're consuming published packages from npm, you can skip `transpilePackages`.

---

## 3. Choose a persistence store

Vercel serverless functions run in ephemeral containers. The filesystem doesn't persist between invocations. This means:

- **In-memory store**: works, but every cold start loses all data
- **Filesystem store**: don't use it — writes succeed but data disappears on the next invocation
- **SQLite store**: partially works for short-lived demos (the DB file is ephemeral), but don't rely on it for production persistence

For production on Vercel, use an external database. The SQLite adapter works for demos where losing data on cold start is acceptable:

```ts title="lib/server.ts"
import { createModelResolver } from "@flow-state-dev/core/models";
import {
  createFlowApiRouter,
  createFlowRegistry,
} from "@flow-state-dev/server";
import myFlow from "@/flows/my-flow/flow";

const registry = createFlowRegistry();
registry.register(myFlow);

export const router = createFlowApiRouter({
  registry,
  modelResolver: createModelResolver(),
  // In-memory is the default. Fine for stateless or demo use.
  // For production persistence, use an external database adapter
  // when one becomes available (PostgreSQL, MongoDB).
});
```

---

## 4. Set environment variables

In your Vercel project settings (Settings > Environment Variables), add:

```
OPENAI_API_KEY=sk-...
```

Or whichever provider keys your flows need. The model resolver reads these at runtime.

For local testing with `vercel dev`, use `.env.local`:

```bash title=".env.local"
OPENAI_API_KEY=sk-...
```

---

## 5. Deploy

**From the CLI:**

```bash
vercel --prod
```

**From Git:** Push to your connected repository. Vercel builds and deploys automatically.

**Monorepo?** Set the root directory in your Vercel project settings to your app's subdirectory (e.g., `apps/my-app` or `examples/hello-chat`). Also set:
- **Build Command:** `cd ../.. && pnpm install && pnpm --filter @flow-state-dev/example-hello-chat build` (adjust the filter to your package name)
- **Output Directory:** `.next`

---

## 6. Verify

```bash
# 1. Check the API responds
curl https://your-app.vercel.app/api/flows

# 2. Run an action
curl -X POST https://your-app.vercel.app/api/flows/hello-chat/actions/chat \
  -H "Content-Type: application/json" \
  -d '{"userId": "test", "input": {"message": "Hello"}}'

# 3. Stream the response (use the requestId from step 2)
curl -N https://your-app.vercel.app/api/flows/hello-chat/requests/REQUEST_ID/stream
```

---

## Serverless timeout limits

Vercel serverless functions have execution time limits:

| Plan | Timeout |
|------|---------|
| Hobby | 10 seconds |
| Pro | 60 seconds |
| Enterprise | 900 seconds |

If your flow takes longer than the limit, the function is killed and the SSE stream drops. The client will see an incomplete response.

**What this means in practice:**

- Simple chat flows (single LLM call) usually complete in 5-15 seconds. Fine on any plan.
- Multi-step agent flows with tool calls can take 30-120 seconds. Needs Pro or higher.
- Long-running workflows (research agents, multi-model pipelines) may need a different platform entirely.

There's no workaround for this limit on Vercel. If your flows consistently exceed the timeout, consider [Railway](/guides/deploying-to-railway) or [Docker](/guides/deploying-with-docker) instead.

---

## Troubleshooting

### SSE stream arrives all at once

Your route is missing `export const dynamic = "force-dynamic"`. Add it to the catch-all route file.

### "Module not found" for @flow-state-dev packages

Add the packages to `transpilePackages` in `next.config.mjs`. This is needed for workspace dependencies in a monorepo.

### Function timeout on Hobby plan

Your flow takes longer than 10 seconds. Upgrade to Pro (60s limit) or switch to a container-based platform for long-running flows.

### Cold start latency

The first request after a period of inactivity takes longer because Vercel starts a new function instance. This is inherent to serverless. The framework initializes quickly (registry + model resolver), but the LLM call itself adds latency. Subsequent requests reuse the warm instance.

### CORS errors from a different frontend

If your frontend is on a different domain than the API, you'll need to add CORS headers. The framework doesn't add them by default. Wrap your route handlers:

```ts title="app/api/flows/[...path]/route.ts"
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://your-frontend.com",
  "Access-Control-Allow-Methods": "GET, POST, DELETE",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function GET(req: NextRequest, ctx: RouteContext) {
  const params = await ctx.params;
  const response = await router.GET(req, { params });
  Object.entries(corsHeaders).forEach(([k, v]) => response.headers.set(k, v));
  return response;
}

// Repeat for POST, DELETE, and add an OPTIONS handler
```

### Environment variable not found

Make sure the variable is set in the Vercel dashboard (not just in `.env.local`). Vercel doesn't automatically sync local env files. Also verify the variable is set for the correct environment (Production, Preview, or Development).

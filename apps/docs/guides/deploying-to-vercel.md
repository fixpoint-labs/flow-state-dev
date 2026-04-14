---
sidebar_position: 7
title: Deploying to Vercel
---

# Deploying to Vercel

How to deploy a flow-state-dev Next.js application to Vercel. The `@flow-state-dev/vercel` package handles SSE headers, heartbeats, and runtime configuration so you don't have to.

If you haven't set up a Next.js project with the framework yet, start with the [Next.js Setup](/guides/nextjs-setup) guide first.

---

## Prerequisites

- A Next.js 14+ project with flow-state-dev integrated ([setup guide](/guides/nextjs-setup))
- A [Vercel account](https://vercel.com)
- The [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`) — optional but useful for testing
- At least one LLM provider API key (e.g., `OPENAI_API_KEY`)

---

## 1. Install the adapter

```bash
pnpm add @flow-state-dev/vercel
```

---

## 2. Configure the API route

Create a single catch-all route file. The `[[...path]]` optional catch-all handles both `/api/flows` and `/api/flows/anything/else` — no sibling route file needed.

```ts title="app/api/flows/[[...path]]/route.ts"
import { createVercelHandler } from "@flow-state-dev/vercel";
import { router } from "@/lib/server";

export const { GET, POST, PATCH, DELETE } = createVercelHandler(router);
export { runtime, maxDuration, dynamic } from "@flow-state-dev/vercel/config";
```

`createVercelHandler` takes care of:
- Unwrapping Next.js 15's async params
- Adding SSE headers (`Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`) to prevent Vercel's edge layer from buffering tokens
- Injecting periodic heartbeat comments to keep long-lived connections alive
- Setting `maxDuration` to 300 seconds (overridable)

If your router setup is async (e.g. Postgres pool creation), pass a factory:

```ts
export const { GET, POST, PATCH, DELETE } = createVercelHandler(() => getRouter());
```

The factory is called once and cached.

### Config exports

The `@flow-state-dev/vercel/config` module exports these defaults:

| Export | Default | Purpose |
|--------|---------|---------|
| `runtime` | `"nodejs"` | Vercel runtime |
| `maxDuration` | `300` | Max function execution time in seconds |
| `dynamic` | `"force-dynamic"` | Prevents Next.js from caching SSE routes |

To override `maxDuration`, export your own value instead:

```ts
export const { GET, POST, PATCH, DELETE } = createVercelHandler(router);
export { runtime, dynamic } from "@flow-state-dev/vercel/config";
export const maxDuration = 60;
```

---

## 3. Configure Next.js

If your flow-state-dev packages are local workspace dependencies (monorepo), tell Next.js to transpile them:

```js title="next.config.mjs"
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@flow-state-dev/core",
    "@flow-state-dev/client",
    "@flow-state-dev/react",
    "@flow-state-dev/server",
    "@flow-state-dev/vercel",
  ],
};

export default nextConfig;
```

If you're consuming published packages from npm, you can skip `transpilePackages`.

---

## 4. Choose a persistence store

Vercel serverless functions run in ephemeral containers. The filesystem doesn't persist between invocations. This means:

- **In-memory store**: works, but every cold start loses all data
- **Filesystem store**: don't use it — writes succeed but data disappears on the next invocation
- **SQLite store**: partially works for short-lived demos (the DB file is ephemeral), but don't rely on it

For production on Vercel, use an external database like Postgres (via `@flow-state-dev/store-postgres`):

```ts title="lib/server.ts"
import { createModelResolver } from "@flow-state-dev/core/models";
import {
  createFlowApiRouter,
  createFlowRegistry,
} from "@flow-state-dev/server";
import { createPostgresStores } from "@flow-state-dev/store-postgres";
import myFlow from "@/flows/my-flow/flow";

const registry = createFlowRegistry();
registry.register(myFlow);

async function createStores() {
  if (process.env.DATABASE_URL) {
    return createPostgresStores({ connectionString: process.env.DATABASE_URL });
  }
  // Fallback to in-memory for local dev
  const { createInMemoryStores } = await import("@flow-state-dev/server");
  return createInMemoryStores();
}

let _router: Promise<ReturnType<typeof createFlowApiRouter>> | null = null;

export function getRouter() {
  if (!_router) {
    _router = createStores().then((stores) =>
      createFlowApiRouter({
        registry,
        stores,
        modelResolver: createModelResolver(),
      })
    );
  }
  return _router;
}
```

---

## 5. Set environment variables

In your Vercel project settings (Settings > Environment Variables), add:

```
OPENAI_API_KEY=sk-...
DATABASE_URL=postgresql://...
```

Or whichever provider keys and connection strings your flows need.

For local testing with `vercel dev`, use `.env.local`:

```bash title=".env.local"
OPENAI_API_KEY=sk-...
```

---

## 6. Deploy

**From the CLI:**

```bash
vercel --prod
```

**From Git:** Push to your connected repository. Vercel builds and deploys automatically.

**Monorepo?** Set the root directory in your Vercel project settings to your app's subdirectory (e.g., `apps/my-app` or `examples/hello-chat`). Also set:
- **Build Command:** `cd ../.. && pnpm install && pnpm --filter @flow-state-dev/example-hello-chat build` (adjust the filter to your package name)
- **Output Directory:** `.next`

---

## 7. Verify

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

The `@flow-state-dev/vercel/config` module exports `maxDuration = 300`. If your Vercel plan's limit is lower, the plan limit takes precedence. The adapter sets the max so that plan upgrades immediately unlock longer execution times without redeploying.

**What this means in practice:**

- Simple chat flows (single LLM call) usually complete in 5-15 seconds. Fine on any plan.
- Multi-step agent flows with tool calls can take 30-120 seconds. Needs Pro or higher.
- Long-running workflows (research agents, multi-model pipelines) may need a different platform entirely.

If your flows consistently exceed the timeout, consider [Railway](/guides/deploying-to-railway) or [Docker](/guides/deploying-with-docker) instead.

---

## Troubleshooting

### SSE stream arrives all at once

If you're not using `@flow-state-dev/vercel`, make sure your route file exports `export const dynamic = "force-dynamic"`. The adapter handles this automatically.

### "Module not found" for @flow-state-dev packages

Add the packages to `transpilePackages` in `next.config.mjs`. This is needed for workspace dependencies in a monorepo.

### Function timeout on Hobby plan

Your flow takes longer than 10 seconds. Upgrade to Pro (60s limit) or switch to a container-based platform for long-running flows.

### Cold start latency

The first request after a period of inactivity takes longer because Vercel starts a new function instance. This is inherent to serverless. The framework initializes quickly (registry + model resolver), but the LLM call itself adds latency. Subsequent requests reuse the warm instance.

### CORS errors from a different frontend

If your frontend is on a different domain than the API, you'll need to add CORS headers. The framework doesn't add them by default. Handle this at the Next.js middleware level or by wrapping the handler response.

### Environment variable not found

Make sure the variable is set in the Vercel dashboard (not just in `.env.local`). Vercel doesn't automatically sync local env files. Also verify the variable is set for the correct environment (Production, Preview, or Development).

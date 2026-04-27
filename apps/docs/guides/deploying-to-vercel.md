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

## 2. Configure the API routes

You need two route files. The catch-all handles all paths with segments, and a bare sibling handles `/api/flows` itself (Next.js `[...path]` requires at least one segment).

```ts title="app/api/flows/[...path]/route.ts"
import { createVercelHandler } from "@flow-state-dev/vercel";
import { router } from "@/lib/server";

export const { GET, POST, PATCH, DELETE } = createVercelHandler(router);

// Next.js reads these statically — must be literal declarations, not re-exports.
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
```

```ts title="app/api/flows/route.ts"
import { createVercelBareHandler } from "@flow-state-dev/vercel";
import { router } from "@/lib/server";

export const { GET, POST } = createVercelBareHandler(router);
```

`createVercelHandler` takes care of:
- Unwrapping Next.js 15's async params
- Adding SSE headers (`Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`) to prevent Vercel's edge layer from buffering tokens
- Injecting periodic heartbeat comments to keep long-lived connections alive

If your router setup is async (e.g. Postgres pool creation), pass a factory function:

```ts
export const { GET, POST, PATCH, DELETE } = createVercelHandler(getRouter);
export const { GET, POST } = createVercelBareHandler(getRouter); // in route.ts
```

The factory is called once and cached.

### Route config values

Next.js reads `runtime`, `maxDuration`, and `dynamic` via static analysis at build time. They must be **literal `export const` declarations** in the route file — `export { runtime } from '...'` re-exports will not work.

| Field | Recommended value | Purpose |
|--------|---------|---------|
| `runtime` | `"nodejs"` | Vercel runtime |
| `maxDuration` | `300` | Max function execution time in seconds |
| `dynamic` | `"force-dynamic"` | Prevents Next.js from caching SSE routes |

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
import { after } from "next/server";
import { openai } from "@ai-sdk/openai";
import { createGateway } from "@ai-sdk/gateway";
import { createModelResolver } from "@flow-state-dev/core/models";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  type StoreRegistry,
} from "@flow-state-dev/server";
import { createPostgresStores } from "@flow-state-dev/store-postgres";
import myFlow from "@/flows/my-flow/flow";

// Pass explicit provider/gateway instances. The model resolver's dynamic
// require() path doesn't work in bundled Next.js — static imports do.
const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
const modelResolver = createModelResolver({
  providers: { openai },
  gateways: gatewayApiKey
    ? { vercel: createGateway({ apiKey: gatewayApiKey }) }
    : undefined,
});

const registry = createFlowRegistry();
registry.register(myFlow);

async function createStores(): Promise<StoreRegistry> {
  const dbUrl = process.env.FSD_DB_URL ?? process.env.DATABASE_URL;
  if (dbUrl) {
    return createPostgresStores({
      connectionString: dbUrl,
      // Schema is initialized at build time (see step 6); skip it on cold starts.
      skipSchemaInit: !!process.env.VERCEL,
    });
  }
  return createInMemoryStores();
}

let _router: Promise<ReturnType<typeof createFlowApiRouter>> | null = null;

export function getRouter() {
  if (!_router) {
    _router = createStores().then((stores) =>
      createFlowApiRouter({
        registry,
        stores,
        modelResolver,
        detectInterruptedOnStartup: false,
        onBackgroundWork: (promise) => after(() => promise),
      })
    );
  }
  return _router;
}
```

**Key points:**
- **Explicit provider/gateway instances**: Next.js bundles server code, breaking the model resolver's dynamic `require()` path. Pass providers and gateways as static imports instead.
- **`detectInterruptedOnStartup: false`**: Disables a background Postgres query on startup that can exhaust the pool during serverless cold starts.
- **`onBackgroundWork` + `after()`**: Keeps the serverless function alive for fire-and-forget action execution. Without this, Vercel kills the function after the response is sent.
- **`skipSchemaInit: !!process.env.VERCEL`**: By default `createPostgresStores` runs ~30 idempotent `CREATE TABLE/INDEX IF NOT EXISTS` statements plus an advisory-lock acquisition every time it's called — once per cold start on Vercel. Skipping it requires running migrations as a build step instead (see step 6).

---

## 5. Set environment variables

In your Vercel project settings (Settings > Environment Variables), add:

```
AI_GATEWAY_API_KEY=...
FSD_DB_URL=postgresql://...
```

`FSD_DB_URL` is preferred over `DATABASE_URL` to avoid collisions with other services. The store adapter checks both (`FSD_DB_URL` first).

Or whichever provider keys and connection strings your flows need.

For local testing with `vercel dev`, use `.env.local`:

```bash title=".env.local"
OPENAI_API_KEY=sk-...
```

---

## 6. Run schema migration as a build step

`createPostgresStores` initializes the schema (~30 idempotent `CREATE TABLE/INDEX IF NOT EXISTS` statements + an advisory-lock acquisition) every time it's called — once per cold start on Vercel. Move that work into the build instead, then pass `skipSchemaInit: true` at runtime (already done in step 4).

Add a one-shot migration script to your app:

```ts title="scripts/migrate.ts"
import { createPostgresStores } from "@flow-state-dev/store-postgres";

const dbUrl = process.env.FSD_DB_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  console.log("[migrate] No FSD_DB_URL/DATABASE_URL set — skipping.");
  process.exit(0);
}

console.log("[migrate] Initializing Postgres schema…");
const stores = await createPostgresStores({ connectionString: dbUrl });
await stores.close();
console.log("[migrate] Done.");
```

Wire it into your build via `package.json`. The script needs to run via `tsx` (or another bundler-aware runner) — `@flow-state-dev/store-postgres` uses TypeScript's bundler module resolution and emits extensionless relative imports, which raw Node ESM can't resolve:

```json
{
  "scripts": {
    "vercel-build": "next build && tsx scripts/migrate.ts"
  },
  "devDependencies": {
    "tsx": "^4.19.0"
  }
}
```

The script exits 0 when no DB URL is set, so preview deployments without a database wired up don't fail the build. On a real DB, migration failures fail the build — better to know at deploy time than at first request.

**Make `FSD_DB_URL` available to builds:** in Vercel project settings, env vars are visibility-scoped per environment (production / preview / development) and per process (build / runtime). The migration script needs `FSD_DB_URL` available to **build**, not just runtime. Check the "Build" checkbox when adding the variable.

---

## 7. Deploy

**From the CLI:**

```bash
vercel --prod
```

**From Git:** Push to your connected repository. Vercel builds and deploys automatically.

**Monorepo?** Set the root directory in your Vercel project settings to your app's subdirectory (e.g., `apps/my-app` or `examples/hello-chat`). Also set:
- **Build Command:** `cd ../.. && pnpm install && pnpm --filter @flow-state-dev/example-hello-chat build && cd apps/my-app && tsx scripts/migrate.ts` (adjust the filter to your package name)
- **Output Directory:** `.next`

---

## 8. Verify

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

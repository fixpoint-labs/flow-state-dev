---
title: Deploy to Vercel
type: recipe
description: "How to deploy a flow-state-dev Next.js application to Vercel."
---

# Deploy to Vercel

The `@flow-state-dev/vercel` package mounts the API on a Next.js route and keeps streamed responses from being buffered. Vercel functions lose their disk between invocations, so the recipe also moves your data to Postgres.

If you haven't set up a Next.js project with the framework yet, start with [Add to an existing app](../../start/add-to-an-existing-app.md).

## Prerequisites

- A Next.js 15+ project with flow-state-dev set up
- A [Vercel account](https://vercel.com), and optionally the [Vercel CLI](https://vercel.com/docs/cli)
- A Postgres database, such as Neon
- A model key: `AI_GATEWAY_API_KEY`, or a provider key such as `OPENAI_API_KEY`

## 1. Install the packages

```bash
pnpm add @flow-state-dev/vercel @flow-state-dev/store-postgres
pnpm add -D tsx
```

## 2. Mount the API route

`createVercelNextHandler` takes the `flowstate` handle you define in step 3.

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
```

Write the three config lines as literal `export const` declarations. Re-exports such as `export { runtime } from "..."` don't work, because Next.js reads them at build time. `dynamic` stops Next.js caching the stream routes. `maxDuration` is the longest a function may run, in seconds. Your Vercel plan's limit wins if it is lower.

While a stream is open, the engine sends a `: ping` comment every 15 seconds, and the adapter's headers (below) stop Vercel's proxy holding the stream back.

A `[...path]` catch-all needs at least one segment, so the bare `/api/flows` listing endpoint needs its own route. `createVercelBareHandler` takes a function that returns the router:

```ts title="app/api/flows/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelBareHandler } from "@flow-state-dev/vercel";

export const { GET, POST } = createVercelBareHandler(() => flowstate.getRouter());
```

On event-stream responses the adapter sets `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, so Vercel's proxy doesn't buffer tokens. See the [`@flow-state-dev/vercel` reference](../../reference/api/vercel.md) for every export.

## 3. Describe the runtime

```ts title="lib/flowstate.ts"
import { after } from "next/server";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { vercelPostgresStores } from "@flow-state-dev/vercel/store";
import myFlow from "@/flows/my-flow/flow";

export const flowstate = createFlowState({
  flows: [myFlow],
  models: { default: "openai/gpt-6-luna" },
  stores: {
    prod: { primary: vercelPostgresStores() },
    dev: { primary: inMemoryStores() },
  },
  defaultProfile: "dev",
  detectInterruptedOnStartup: false,
  onBackgroundWork: (promise) => after(() => promise),
});
```

- **`stores`** holds one profile per environment. `vercelPostgresStores()` reads `FSD_DB_URL`, then `DATABASE_URL`. Use it on Vercel. The in-memory store loses everything on each cold start, and filesystem or SQLite files vanish between invocations.
- **`FSD_ENV`** picks the profile. `NODE_ENV` is not consulted. Without `FSD_ENV`, the runtime uses `defaultProfile`. A name with no matching profile, such as `FSD_ENV=production` here, is an error: the runtime throws `FlowStateConfigError` listing the declared profiles, and does not fall back.
- **`onBackgroundWork`** keeps the function alive after the response, so fire-and-forget actions finish. Set it on `createFlowState`, not on the route handler.
- **`detectInterruptedOnStartup: false`** skips a startup query that can exhaust the connection pool on a cold start. With it off, a run abandoned by a stopped function is not marked `interrupted`, and is not offered for resume, until something calls `POST /api/flows/users/:userId/check-interrupted`. Call it from a scheduled route if you need resume.

Options are in the [runtime reference](../../reference/runtime.md).

## 4. Require a credential

The handlers refuse every request with a 500 while a flow takes its `userId` from the request body. Give the flow a `resolvePrincipal` that checks a credential. A shared secret is enough to start:

```ts title="flows/my-flow/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/engine";
import { chatPipeline } from "./blocks/chat-pipeline";

const myFlow = defineFlow({
  kind: "my-flow",
  authentication: {
    resolvePrincipal: createBearerSecretPrincipalResolver({
      secret: process.env.FLOW_API_SECRET ?? "",
      principal: { userId: "smoke-test", orgId: "my-org" },
    }),
  },
  actions: { chat: { block: chatPipeline } },
});

export default myFlow();
```

Runs and session reads need the secret; `/healthz`, the flow list and `/api/flows/capabilities` answer without it. An empty secret throws when the module loads. For signed-in users, write `resolvePrincipal` around your own session, as [Auth and tenancy](../../concepts/auth-and-tenancy.md) shows.

## 5. Set environment variables

In your Vercel project, open Settings, Environment Variables, and add:

```
AI_GATEWAY_API_KEY=...
FSD_DB_URL=postgresql://...
FSD_ENV=prod
FLOW_API_SECRET=...
```

Use `FSD_DB_URL` if another service already owns `DATABASE_URL`. Make `FLOW_API_SECRET` a long random value. Add any provider keys your flows use. Values in `.env.local` are not synced to Vercel, so set each one for the environments you deploy to (Production, Preview, Development). Make `FSD_DB_URL` available to builds as well as at runtime: the migration in step 6 reads it during the build. See the [environment reference](../../reference/environment.md).

## 6. Create the schema at build time

`vercelPostgresStores()` skips schema setup. Create the tables in the build, so cold starts don't pay for it.

```ts title="scripts/migrate.ts"
import { createPostgresStores } from "@flow-state-dev/store-postgres/host";

async function main() {
  const connectionString = process.env.FSD_DB_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("[migrate] No database URL set, skipping.");
    return;
  }
  const stores = await createPostgresStores({ connectionString });
  await stores.close();
  console.log("[migrate] Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

```json title="package.json"
{
  "scripts": {
    "vercel-build": "next build && tsx scripts/migrate.ts"
  }
}
```

Run it with `tsx`. Plain `node` can't load the package.

Without a database URL the script exits cleanly, so previews with no database build normally. With one, a failed migration fails the build.

## 7. Deploy

Run `vercel --prod`, or push to the repository Vercel is connected to. In a monorepo, set the project's Root Directory to your app's folder.

## 8. Verify

```bash
curl https://your-app.vercel.app/api/flows

curl -X POST https://your-app.vercel.app/api/flows/my-flow/actions/chat \
  -H "Authorization: Bearer $FLOW_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"input": {"message": "Hello"}}'

# Use the requestId from the response above
curl -N https://your-app.vercel.app/api/flows/my-flow/requests/REQUEST_ID/stream \
  -H "Authorization: Bearer $FLOW_API_SECRET"
```

## Limits

- A Vercel function can run only as long as your plan allows (see [Vercel's function limits](https://vercel.com/docs/functions/limitations)). A flow that outruns it is cut off. For long-running flows, use [Railway](./railway.md) or [Docker](./docker.md).
- Files users upload to a session are kept in the runtime's blob store. On Vercel, an upload is refused with status 501 if that blob store writes to the function's local disk. Use a hosted blob store.
- The HTTP API adds no CORS headers. If your frontend is on another domain, add them in Next.js middleware.

## Troubleshooting

- **The stream arrives all at once.** Check that the route file exports `dynamic = "force-dynamic"` and mounts the adapter's handler.
- **"Module not found" for `@flow-state-dev` packages.** In a monorepo with local workspace packages, list them in `transpilePackages` in `next.config.mjs`.
- **A variable is "not found".** It is set only in `.env.local`, or only for another environment. Set it in the Vercel dashboard for the environment you deploy to.
- **The first request after idle is slow.** Vercel is starting a new function instance.

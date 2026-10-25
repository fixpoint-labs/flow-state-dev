---
sidebar_position: 9
title: Host adapters
sidebar_label: Host adapters
---

# Host adapters

Your `createFlowState` config describes the engine — flows, models, stores. It says nothing about how HTTP requests reach it. Hosting is the web-server face of that engine. A host adapter is the glue: it takes incoming requests, hands them to the flow router, and streams responses back.

The router itself is portable. It speaks Web standard `Request` and `Response`, so the same app runs long-lived on a Node process, on AWS Lambda, on Bun, or on Deno. What changes per platform is the thin wrapper around it. This page covers which wrapper to reach for.

---

## The adapter matrix

| Adapter | Import | Runtime | Reach for it when |
| --- | --- | --- | --- |
| `serve()` | `@flow-state-dev/node` | Long-lived Node process | Self-hosting on Railway, Render, Fly, a VPS, or Docker. Also what `fsdev dev` and `fsdev serve` use. |
| `createServerApp()` | `@flow-state-dev/node/app` | Any (Web Fetch) | You want the portable app to wrap for a serverless target yourself. |
| `createLambdaHandler()` | `@flow-state-dev/node/aws-lambda` | AWS Lambda | Deploying to Lambda with response streaming. |
| `createVercelHandler()` | `@flow-state-dev/vercel` | Vercel + Next.js | Your app is on Next.js and you deploy to Vercel. |

The first three are the same app underneath. `serve()` runs the portable app long-lived; `createLambdaHandler()` runs it on Lambda. `@flow-state-dev/vercel` is a separate adapter shaped around Next.js App Router.

---

## The portable app

`createServerApp()` returns the app every Node-runtime adapter wraps. It owns the host concerns that don't belong to any one platform: a `/healthz` endpoint (200 once stores are ready, 503 while initializing, 500 if init fails permanently) and the API router itself.

```ts
import { createServerApp } from "@flow-state-dev/node/app";
import { flowstate } from "./flowstate";

const { app } = createServerApp(flowstate);

// `app.fetch` is a Web Fetch handler — hand it to any host:
//   @hono/node-server  → serve({ fetch: app.fetch })   (this is what serve() does)
//   AWS Lambda         → see createLambdaHandler
//   Bun                → export default app
//   Deno               → Deno.serve(app.fetch)
```

It deliberately does not serve static assets. Static and SPA-fallback serving (for the DevTool UI) is a long-lived-host concern that lives in `serve()`, so the portable app stays importable from any runtime.

### Where the API is mounted

Both `serve()` and `createServerApp()` mount the flow API at `/api/flows`. Pass `basePath` to mount it somewhere else. The value replaces `/api/flows`, so `basePath: "/flows"` serves the API at `/flows/…`.

```ts
import { serve } from "@flow-state-dev/node";

await serve(flowstate, { basePath: "/flows" });
```

Point the client at a custom mount by passing the same value as `apiPath`, either `createClient({ ..., apiPath: "/flows" })` or, in React, `<FlowProvider apiPath="/flows">`. See [Choosing `apiPath`](/docs/configuration/client#choosing-apipath).

---

## Calling flows in the same process

Sometimes the caller and the engine share a process: a script, a test, a queue worker, a CLI. `createInProcessFetch` from `@flow-state-dev/engine` gives that caller a fetch-shaped function that hands each request straight to the engine, with no web server and no port.

```ts
import { createFlowState, createInProcessFetch } from "@flow-state-dev/engine";
import { createClient } from "@flow-state-dev/client";
import { support } from "./flows/support";

const flowState = createFlowState({ flows: { support } });

const fsd = createClient({ userId: "user_1", fetcher: createInProcessFetch(flowState) });
const sent = await fsd.flow("support").send("reply", { text: "Hi" });
await sent.wait();
```

`createInProcessFetch(app, { basePath? })` takes a `FlowState` or a router from `createFlowApiRouter`, and returns `(input, init?) => Promise<Response>`. Pass it as a client's `fetcher`, or as `FlowProvider`'s.

- Only the URL's path is read. The origin is ignored, and a relative path such as `/api/flows/support/actions/reply` works, which is what a client with no `baseUrl` sends.
- `basePath` is where the API is mounted, `"/api/flows"` by default. Match it to the client's `apiPath`. A path outside it answers `404`.
- Each call waits for the stores to initialize. If they failed to, it answers `500 { error: "Server failed to initialize" }`.
- `GET`, `POST`, `PATCH` and `DELETE` reach the router. Any other method, `HEAD` included, answers `405`.
- SSE responses stream, and an `AbortSignal` in `init` reaches the route.

The routes, checks and answers are the same as over HTTP. Credentials ride the request headers and go through your `resolvePrincipal`; being in the same process grants nothing extra.

---

## Choosing an adapter

Walk it in this order:

1. **On Next.js, deploying to Vercel?** Use `@flow-state-dev/vercel`. It handles Vercel's SSE shaping for you.
2. **Running a long-lived process** (Railway, Render, Fly, Docker, a VPS)? Use `serve()`. One call gives you health checks, static serving, and graceful shutdown.
3. **Deploying to a Node-runtime serverless platform** other than Vercel? Use the portable app — `createLambdaHandler()` for AWS Lambda, or wrap `app.fetch` yourself for Bun or Deno.

Edge runtimes (Cloudflare Workers, Vercel Edge) are not supported: the engine relies on Node primitives. "Serverless" here means a Node runtime.

---

## Writing a custom adapter

A custom adapter is small. Build the app, then hand `app.fetch` to whatever your platform's entry point expects:

```ts
import { createServerApp } from "@flow-state-dev/node/app";
import { flowstate } from "./flowstate";

const { app } = createServerApp(flowstate);

// Bun
export default app;
```

For Bun and Deno that is the whole adapter. For platforms with an event-shaped entry (like Lambda), use the matching Hono adapter — that is exactly what `createLambdaHandler()` does with `hono/aws-lambda`.

---

## See also

- [Deployment overview](/guides/deployment) — SSE and persistence per platform
- [Deploying to AWS Lambda](/guides/deploying-to-aws-lambda) — a worked Lambda example
- [Engine setup](/docs/server/setup) — configuring the router
- [CLI API](/docs/api/cli) — `fsdev serve` wraps `serve()` to run a config from the terminal

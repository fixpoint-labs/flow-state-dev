# @flow-state-dev/node

A host adapter for running a flow-state-dev app as a long-lived Node process. A
host adapter is the small piece of glue between your `createFlowState` config and
a particular runtime — `@flow-state-dev/vercel` is the serverless one; this is the
plain-Node one. `serve(flowState)` stands up an HTTP server in a single call.

It does the parts you'd otherwise hand-write: translating Node's `http` requests
to the Web `Request`/`Response` the flow router speaks, streaming SSE through
unbuffered, answering health checks, and shutting down cleanly on `SIGTERM`.

Use it to self-host on Railway, Render, Fly, a VPS, or anywhere a Node process
runs. It is also the foundation for Node-runtime serverless: the same app `serve()`
runs long-lived is exported as a portable Hono app you can wrap for AWS Lambda, Bun,
or Deno (see [Portable app for serverless](#portable-app-for-serverless)). For
Vercel + Next.js, reach for `@flow-state-dev/vercel` instead.

Under the hood `serve()` runs on [`@hono/node-server`](https://github.com/honojs/node-server)
rather than a hand-rolled `node:http` bridge; the public API is unchanged.

## Installation

```bash
pnpm add @flow-state-dev/node
```

## `serve(flowState)`

```ts
import { createFlowState } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { flows } from "./flows.js";

const flowState = createFlowState({
  flows,
  stores: { default: { primary: /* your store adapter */ } },
});

// Binds process.env.PORT (then 3000) on 0.0.0.0, mounts the API under
// /api/flows, and serves /healthz. Resolves once the server is listening.
await serve(flowState);
```

`serve` resolves as soon as the port is bound — not when stores finish opening —
so a platform health check passes during a cold start. `/healthz` returns `503`
until the router's stores are ready, then `200`.

`SIGTERM`/`SIGINT` trigger a graceful shutdown: the server stops accepting
connections, drains in-flight requests (force-closing after the grace window),
then disposes the router and the `FlowState`.

## Serving a built `FlowApiRouter` directly

If you already hold a router (for example from `createFlowApiRouter`, or to manage
store lifecycle yourself), pass it instead of a `FlowState`. It is treated as
ready immediately, and `close()` disposes the router but leaves your stores alone.

```ts
import { createFlowApiRouter } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";

const router = createFlowApiRouter({ registry, stores, runtimeConfig });
const handle = await serve(router, { port: 8080 });
// ... later
await handle.close();
```

## Portable app for serverless

`createServerApp(flowState)` returns the portable Hono app that `serve()` wraps —
the `/healthz` endpoint plus the flow router, as a Web Fetch handler. The same app
runs long-lived here or on a serverless target, so you don't re-plumb the request
bridge per platform.

```ts
import { createServerApp } from "@flow-state-dev/node/app";

const { app } = createServerApp(flowState);
// app.fetch is a Web Fetch handler: (Request) => Promise<Response>
//   Bun  → export default app
//   Deno → Deno.serve(app.fetch)
```

For AWS Lambda, the `./aws-lambda` subpath wires the app to Lambda's response
streaming (so SSE works), deployed behind a Function URL in `RESPONSE_STREAM` mode:

```ts title="handler.ts"
import { createLambdaHandler } from "@flow-state-dev/node/aws-lambda";
export const handler = createLambdaHandler(flowState);
```

See [Host adapters](https://flow-state.dev/docs/server/host-adapters) for guidance
on choosing between these, and [Deploying to AWS Lambda](https://flow-state.dev/guides/deploying-to-aws-lambda)
for a worked example.

## Network-bind authentication guard

`assertNetworkBindIsAuthenticated(app, { host, allowUnauthenticated? })` refuses a
network bind when any served flow runs on the framework default (unauthenticated)
principal resolver — exposing it on a network interface would leave it open to
anyone who can reach the port. It throws for a non-loopback `host` unless
`allowUnauthenticated` is `true`. Loopback hosts pass unconditionally.
`isLoopbackHost(host)` is the loopback predicate it uses.

```ts
import { assertNetworkBindIsAuthenticated, isLoopbackHost } from "@flow-state-dev/node";

assertNetworkBindIsAuthenticated(app, { host: "0.0.0.0" });
```

`fsdev serve` runs this before it binds. Call it yourself from a hand-written
entrypoint that adds custom middleware, so a network deploy fails closed the same
way.

## Health checks and PaaS deployment

Point your platform's health check at `healthPath` (default `/healthz`). Pair
this package with a long-lived host that attaches Postgres (and Redis, if you run
durable background work). See the deployment guides for the full topology:

- [Deploying to Railway](https://flow-state.dev/guides/deploying-to-railway)
- [Deploying with Docker](https://flow-state.dev/guides/deploying-with-docker)

## API reference

### `ServeOptions`

| Option | Default | Description |
| --- | --- | --- |
| `port` | `process.env.PORT` then `3000` | Port to bind. |
| `host` | `"0.0.0.0"` | Host to bind. Keep `0.0.0.0` on a PaaS. |
| `basePath` | `"/api/flows"` | API mount prefix (matches `createFlowApiRouter`). |
| `healthPath` | `"/healthz"` | Health endpoint. `200` once ready, `503` before. |
| `staticDir` | — | Directory served for non-API routes, with `index.html` SPA fallback. |
| `shutdownGraceMs` | `10000` | Grace window before lingering connections are force-closed. |

### `ServeHandle`

| Member | Description |
| --- | --- |
| `server` | The underlying `node:http` server. |
| `port` | The bound port (useful when binding port `0`). |
| `close()` | Stop accepting connections, drain, then dispose the router and `FlowState`. Idempotent. |

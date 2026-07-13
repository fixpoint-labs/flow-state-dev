---
sidebar_position: 6
title: Deployment Overview
---

# Deployment Overview

What to think about when moving a flow-state-dev application from `pnpm dev` to production.

The framework's router is built on Web standard APIs (`Request`, `Response`, `ReadableStream`). It speaks the same `fetch(request)` shape on every runtime, so a thin host adapter is all that connects it to a platform. That means it runs anywhere modern JavaScript runs: Node.js 22+, Vercel serverless functions, AWS Lambda, Railway containers, a Docker image behind nginx. See [Host adapters](/docs/server/host-adapters) for the wrapper that fits each one.

But each platform handles two things differently: **SSE streaming** and **persistence**. Get those right and everything else is straightforward.

---

## Platform comparison

| Platform | SSE streaming | Persistence | Best for |
|----------|--------------|-------------|----------|
| **Vercel** (Next.js) | Works with `force-dynamic`. Serverless timeout limits apply (10s hobby / 60s pro). | No filesystem. Use SQLite (ephemeral) or external DB. | Apps already on Next.js. Short-lived flows. |
| **AWS Lambda** | Works with a Function URL in `RESPONSE_STREAM` mode. Per-invocation timeout applies. | No persistent filesystem. Use an external DB. | Bursty traffic, custom infra, non-Vercel serverless. |
| **Railway** | Works natively. Long-running containers. | Filesystem persists within container. SQLite works well. | Production APIs. Long-running agents. |
| **Fly.io** | Works natively. Persistent volumes available. | Filesystem or SQLite on a volume. | Stateful, latency-sensitive deployments. |
| **Docker** (self-hosted) | Works natively. Watch for reverse proxy buffering. | Full filesystem control. SQLite or any external DB. | Full control. On-premise. Custom infra. |

---

## The two things that break

### 1. SSE streaming gets buffered

The framework returns a `202 Accepted` when you trigger an action, then streams results over Server-Sent Events. If anything between your server and the client buffers the response, tokens arrive in bursts instead of real-time. Or the connection times out before the flow completes.

Common culprits:
- **Reverse proxies** (nginx, Caddy) buffering responses by default
- **CDN edge caching** intercepting `text/event-stream` responses
- **Serverless function timeouts** killing long-running streams
- **Next.js static optimization** trying to cache the API route

The fix is always the same: tell the layer in front of your server not to buffer SSE responses. Each platform guide covers the specifics.

### 2. Persistence doesn't survive restarts

The default in-memory store loses everything when the process exits. The filesystem store writes to disk, which works on container platforms but not serverless. Serverless functions start fresh on every cold start.

Pick your store based on where you're deploying:

| Store | Survives restart? | Multi-instance safe? | When to use |
|-------|-------------------|---------------------|-------------|
| **In-memory** (default) | No | No | Development, testing, demos |
| **Filesystem** | Yes (containers) | No | Single-server containers |
| **SQLite** | Yes | No (single-writer) | Single-server production |
| **PostgreSQL** | Yes | Yes | Multi-server production (coming soon) |

---

## Environment variables

Every deployment needs LLM provider API keys. The model resolver auto-detects from standard environment variables:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
```

Set whichever keys match the models your flows use. If a flow references `"openai/gpt-5-mini"`, the server needs `OPENAI_API_KEY`. That's it.

Never commit API keys. Use your platform's secrets management: `.env.local` for development, environment variable settings in your platform's dashboard for production.

---

## The server entry point

All deployments start the same way: describe the runtime with `createFlowState`, naming your flows, models, and stores.

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import myFlow from "./flows/my-flow/flow";

export const flowstate = createFlowState({
  flows: { myFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: inMemoryStores() } },
});
```

What changes per platform is how you connect this runtime to incoming HTTP requests, and which store adapter backs `primary`. That connection is a [host adapter](/docs/server/host-adapters): Next.js uses a platform handler around `flowstate`; a long-lived Node process uses `serve(flowstate)` from `@flow-state-dev/node`; other serverless targets wrap the same portable app. The platform-specific guides cover each approach.

If your app already default-exports a FlowState from a committed `fsdev.config.*`, you can skip the entry file. `fsdev serve` starts a long-lived server straight from that config: it binds `0.0.0.0:$PORT`, shuts down gracefully on `SIGTERM`, mounts no DevTool, and runs the loopback-bind guard that refuses a network bind when a flow has no authentication configured. The tradeoff is control. Reach for `fsdev serve` when the built-in server does what you need. Write your own `serve(flowstate)` entry file when you need custom middleware or extra routes, since the CLI command has no hook for either.

```bash
PORT=3000 fsdev serve
```

See the [CLI API Reference](/docs/api/cli) for the full flag set and guard behavior, and [Host adapters](/docs/server/host-adapters) for the `serve()` wrapper underneath.

## Serverless beyond Vercel

Vercel's Next.js serverless is one path. For other Node-runtime serverless platforms — AWS Lambda, Bun, Deno — the same portable app from `@flow-state-dev/node` runs unchanged; you wrap its `fetch` handler with the platform's adapter. See [Host adapters](/docs/server/host-adapters) for the full breakdown and [Deploying to AWS Lambda](/guides/deploying-to-aws-lambda) for a worked example. Edge runtimes (Cloudflare Workers, Vercel Edge) are not supported — the engine relies on Node primitives.

---

## Verifying your deployment

After deploying, confirm three things:

**1. The API responds:**
```bash
curl https://your-app.example.com/api/flows
```
You should see a JSON array of registered flows.

**2. Actions execute:**
```bash
curl -X POST https://your-app.example.com/api/flows/hello-chat/actions/chat \
  -H "Content-Type: application/json" \
  -d '{"userId": "test", "input": {"message": "Hello"}}'
```
You should get a `202 Accepted` with a `requestId`.

**3. SSE streams work:**
```bash
curl -N https://your-app.example.com/api/flows/hello-chat/requests/REQUEST_ID/stream
```
Replace `REQUEST_ID` with the ID from step 2. You should see events streaming in real-time, not all at once after the flow completes.

---

## Multi-tenant isolation

Serving several customers from one deployment? Route a tenant id into the `x-tenant-id` header (or set a custom name with `createFlowApiRouter({ tenantIdHeader })`), and session data isolates by tenant automatically. Two tenants using the same session id get separate sessions, state, and history.

Set the header where you already enforce auth — a gateway, or your client's `fetch` wrapper. Common sources are a JWT claim, a subdomain, or an API-key-to-tenant mapping. A minimal example in front of the API:

```ts
// e.g. Next.js middleware — derive the tenant from the verified JWT
const tenantId = getClaim(request, "tenant");
request.headers.set("x-tenant-id", tenantId);
```

Send the same header on every call — actions, session reads, state, resources — so they all resolve the same tenant. Session and request data isolate by tenant; user and org scopes stay shared (org policy and user preferences are meant to span tenants).

One constraint: tenant ids can't contain a colon (`:`) — the framework reserves it as the session-key separator, and a request with a colon in the tenant header is rejected with a 400. Use any other stable id (a uuid, an org slug, a subdomain). Session ids are unrestricted.

Verify in staging that two tenants don't collide:

```bash
curl ... -H "x-tenant-id: acme"   -d '{"userId":"u","sessionId":"chat-1", ...}'
curl ... -H "x-tenant-id: globex" -d '{"userId":"u","sessionId":"chat-1", ...}'
# Each tenant's /state for chat-1 reflects only its own turns.
```

Single-tenant deployments do nothing here: when no header is sent, behavior and storage keys are unchanged, and there's no migration. See [State and scopes](/docs/fundamentals/state-and-scopes#multi-tenant-isolation) for what is and isn't isolated.

---

## Platform guides

- [Deploying to Vercel](/guides/deploying-to-vercel) — Next.js App Router on Vercel's serverless platform
- [Deploying to AWS Lambda](/guides/deploying-to-aws-lambda) — Serverless functions with response streaming
- [Deploying to Railway](/guides/deploying-to-railway) — Long-running Node.js containers
- [Deploying with Docker](/guides/deploying-with-docker) — Self-hosted with Dockerfile and nginx reverse proxy

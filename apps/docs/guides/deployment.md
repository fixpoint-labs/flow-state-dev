---
sidebar_position: 6
title: Deployment Overview
---

# Deployment Overview

What to think about when moving a flow-state-dev application from `pnpm dev` to production.

The framework's server is built on Web standard APIs (`Request`, `Response`, `ReadableStream`). It doesn't depend on Express, Hono, or any specific Node.js HTTP library. That means it runs anywhere modern JavaScript runs: Node.js 18+, Vercel serverless functions, Railway containers, a Docker image behind nginx.

But each platform handles two things differently: **SSE streaming** and **persistence**. Get those right and everything else is straightforward.

---

## Platform comparison

| Platform | SSE streaming | Persistence | Best for |
|----------|--------------|-------------|----------|
| **Vercel** (Next.js) | Works with `force-dynamic`. Serverless timeout limits apply (10s hobby / 60s pro). | No filesystem. Use SQLite (ephemeral) or external DB. | Apps already on Next.js. Short-lived flows. |
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
import { createFlowState, inMemoryStores } from "@flow-state-dev/server";
import myFlow from "./flows/my-flow/flow";

export const flowstate = createFlowState({
  flows: { myFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: inMemoryStores() } },
});
```

What changes per platform is how you connect this runtime to incoming HTTP requests, and which store adapter backs `primary`. Next.js uses a platform handler around `flowstate`. Standalone Node.js calls `await flowstate.getRouter()` and uses `http.createServer`. The platform-specific guides cover each approach.

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

## Platform guides

- [Deploying to Vercel](/guides/deploying-to-vercel) — Next.js App Router on Vercel's serverless platform
- [Deploying to Railway](/guides/deploying-to-railway) — Long-running Node.js containers
- [Deploying with Docker](/guides/deploying-with-docker) — Self-hosted with Dockerfile and nginx reverse proxy

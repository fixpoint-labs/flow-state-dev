---
sidebar_position: 8
title: Deploying to Railway
---

# Deploying to Railway

How to deploy a flow-state-dev application as a long-running Node.js server on Railway. Railway runs containers, so SSE streaming works without workarounds and the filesystem persists within the container lifecycle. This makes it a good fit for production flows that take more than a few seconds.

---

## Prerequisites

- Node.js 22+ project with flow-state-dev
- A [Railway account](https://railway.app)
- The [Railway CLI](https://docs.railway.app/guides/cli) — optional but useful
- At least one LLM provider API key

---

## 1. Create a standalone server

Railway runs a long-lived Node.js process. You need a server file that creates an HTTP server and routes requests to the framework's router.

The framework's router uses Web standard `Request`/`Response` objects. You bridge them to Node.js `http.createServer` like this:

```ts title="src/server.ts"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createFlowState, filesystemStores } from "@flow-state-dev/engine";
import myFlow from "./flows/my-flow/flow.js";

const port = parseInt(process.env.PORT ?? "3000", 10);

// 1. Describe the runtime. Filesystem persistence works on Railway's
//    long-lived disk; `primary` is the catch-all state slot.
const flowstate = createFlowState({
  flows: { myFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: filesystemStores({ rootDir: ".flow-state-data" }) } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});

// 2. Resolve the router once. getRouter() opens stores lazily and is cached.
const router = await flowstate.getRouter();

// 3. Start HTTP server
const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (url.startsWith("/api/flows")) {
    await handleFlowRequest(req, res, url);
    return;
  }

  // Health check
  if (url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`API: http://localhost:${port}/api/flows`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  server.close(() => process.exit(0));
});

// Bridge Node.js HTTP to Web API
async function handleFlowRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();

  // Extract path after /api/flows
  const pathAfterPrefix = url.replace(/^\/api\/flows\/?/, "");
  const [pathPart] = pathAfterPrefix.split("?", 2);
  const pathSegments = pathPart.split("/").filter((s) => s.length > 0);

  // Read body for POST/PATCH
  let body: string | undefined;
  if (method === "POST" || method === "PATCH") {
    body = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

  // Build Web API Request
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }

  const webRequest = new Request(`http://localhost${url}`, {
    method,
    headers,
    body,
  });

  // Dispatch
  const handler = router[method as keyof typeof router];
  if (!handler) {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const webResponse = await handler(webRequest, { params: { path: pathSegments } });

  // Write response
  res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));

  const contentType = webResponse.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream") && webResponse.body) {
    // Stream SSE responses
    res.flushHeaders();
    const reader = webResponse.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      const final = decoder.decode();
      if (final) res.write(final);
    } catch {
      // Client disconnect — expected
    } finally {
      res.end();
    }
    return;
  }

  res.end(await webResponse.text());
}
```

**Why not Express?** You can use Express if you prefer. The bridge code above is the same pattern the framework's own CLI uses. Express adds a dependency but doesn't simplify much — the key work is converting between Node.js and Web API objects, and that's the same either way.

---

## 2. Add build and start scripts

```json title="package.json (relevant fields)"
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js"
  }
}
```

Make sure your `tsconfig.json` outputs to `dist/` and targets a Node.js-compatible module format:

```json title="tsconfig.json (relevant fields)"
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

---

## 3. Choose a persistence store

Railway containers persist their filesystem within the container lifecycle. Data survives process restarts (Railway restarts your process, not the container, on most deployments). But a full redeploy or container migration will lose filesystem data.

**For most cases:** Use the filesystem store (shown above). Simple, no external dependencies. Acceptable when losing historical sessions on redeploy is fine.

**For durability:** Use the SQLite adapter with Railway's [volumes](https://docs.railway.app/reference/volumes):

```ts title="src/server.ts"
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";

const stores = createSQLiteStores({
  filename: "/data/flows.db",
});
```

Mount a Railway volume at `/data`. This survives redeploys and container migrations.

**Add `@flow-state-dev/store-sqlite` to your dependencies:**
```bash
pnpm add @flow-state-dev/store-sqlite
```

Note: `better-sqlite3` (the SQLite driver) is a native module. Railway handles building native modules during deployment, but if you're using a custom Dockerfile, you'll need build tools installed (see the [Docker guide](/guides/deploying-with-docker)).

---

## 4. Set environment variables

In Railway dashboard (your service > Variables):

```
PORT=3000
OPENAI_API_KEY=sk-...
```

Railway sets `PORT` automatically if you don't. The framework's model resolver reads the provider API keys at runtime.

---

## 5. Deploy

**From Git (recommended):**

1. Connect your GitHub repository in the Railway dashboard
2. Select the branch to deploy
3. Railway auto-detects Node.js and runs `npm run build` then `npm run start`
4. Set your environment variables in the dashboard

**From CLI:**

```bash
railway login
railway init
railway up
```

**Custom start command:** If Railway doesn't detect your setup automatically, set the start command in your service settings:
- **Build:** `pnpm install && pnpm build`
- **Start:** `node dist/server.js`

---

## 6. Verify

```bash
# Get your Railway URL from the dashboard, then:

# 1. Health check
curl https://your-app.up.railway.app/health

# 2. List flows
curl https://your-app.up.railway.app/api/flows

# 3. Run an action
curl -X POST https://your-app.up.railway.app/api/flows/hello-chat/actions/chat \
  -H "Content-Type: application/json" \
  -d '{"userId": "test", "input": {"message": "Hello"}}'

# 4. Stream the response
curl -N https://your-app.up.railway.app/api/flows/hello-chat/requests/REQUEST_ID/stream
```

---

## Scaling considerations

Railway can run multiple replicas of your service. If you do:

- **Don't use filesystem store** — each replica has its own filesystem. Sessions created on replica A aren't visible to replica B.
- **Don't use SQLite** — SQLite is single-writer. Concurrent writes from multiple replicas will fail.
- **Use an external database** — PostgreSQL or MongoDB store adapters (when available) handle concurrent access properly.

For a single replica (the default), filesystem or SQLite works fine.

---

## Troubleshooting

### "Cannot find module" on startup

Check that `outDir` in your tsconfig matches your start script. If you build to `dist/`, your start script should be `node dist/server.js`.

### SSE stream works locally but not on Railway

Railway's built-in proxy handles SSE correctly by default. If you're using a custom domain with an external proxy (Cloudflare, etc.), make sure it's not buffering responses. See [Deployment Overview](/guides/deployment#1-sse-streaming-gets-buffered).

### Native module build failures

If `better-sqlite3` (from `@flow-state-dev/store-sqlite`) fails to build, Railway might be missing build tools. Add a `nixpacks.toml` to your project root:

```toml title="nixpacks.toml"
[phases.setup]
aptPkgs = ["build-essential", "python3"]
```

### Container restarts losing data

Use a Railway volume for persistent storage. Mount it to the path your store uses (e.g., `/data` for SQLite, or `.flow-state-data/` for the filesystem store).

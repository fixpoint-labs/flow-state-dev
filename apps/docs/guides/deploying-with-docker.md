---
sidebar_position: 9
title: Deploying with Docker
---

# Deploying with Docker

How to containerize and self-host a flow-state-dev application. This covers a production Dockerfile, SQLite persistence with volumes, and nginx reverse proxy configuration for SSE streaming.

---

## Prerequisites

- A flow-state-dev Node.js application (standalone server, not Next.js — see [Railway guide](/guides/deploying-to-railway) for the server setup pattern)
- [Docker](https://docs.docker.com/get-docker/) installed
- Basic familiarity with Docker and reverse proxies

---

## 1. Dockerfile

A multi-stage build keeps the final image small. The first stage installs dependencies and compiles TypeScript. The second stage copies only what's needed to run.

```dockerfile title="Dockerfile"
# --- Build stage ---
FROM node:20-slim AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build

# --- Production stage ---
FROM node:20-slim AS runner

# better-sqlite3 needs these at runtime if used
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy only production dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Create data directory for persistence
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
```

If you're not using the SQLite store, you can remove the `libsqlite3-0` install.

---

## 2. The server entry point

Use the same standalone server pattern from the [Railway guide](/guides/deploying-to-railway). Here's the version configured for Docker with SQLite persistence on a volume:

```ts title="src/server.ts"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createModelResolver } from "@flow-state-dev/core/models";
import {
  createFlowApiRouter,
  createFlowRegistry,
} from "@flow-state-dev/server";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import myFlow from "./flows/my-flow/flow.js";

const port = parseInt(process.env.PORT ?? "3000", 10);

const registry = createFlowRegistry();
registry.register(myFlow);

// SQLite on a Docker volume — survives container restarts and image updates
const stores = createSQLiteStores({
  filename: "/data/flows.db",
});

const router = createFlowApiRouter({
  registry,
  stores,
  modelResolver: createModelResolver(),
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (url.startsWith("/api/flows")) {
    await handleFlowRequest(req, res, url);
    return;
  }

  if (url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  server.close(() => process.exit(0));
});

// handleFlowRequest — same bridge function as the Railway guide
// See: /guides/deploying-to-railway#1-create-a-standalone-server
async function handleFlowRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  const pathAfterPrefix = url.replace(/^\/api\/flows\/?/, "");
  const [pathPart] = pathAfterPrefix.split("?", 2);
  const pathSegments = pathPart.split("/").filter((s) => s.length > 0);

  let body: string | undefined;
  if (method === "POST" || method === "PATCH") {
    body = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

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

  const handler = router[method as keyof typeof router];
  if (!handler) {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const webResponse = await handler(webRequest, { params: { path: pathSegments } });
  res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));

  const contentType = webResponse.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream") && webResponse.body) {
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
      // Client disconnect
    } finally {
      res.end();
    }
    return;
  }

  res.end(await webResponse.text());
}
```

---

## 3. Build and run

```bash
# Build the image
docker build -t my-flow-app .

# Run with a persistent volume and API key
docker run -d \
  --name flow-app \
  -p 3000:3000 \
  -v flow-data:/data \
  -e OPENAI_API_KEY=sk-... \
  my-flow-app
```

The `-v flow-data:/data` creates a named Docker volume. Your SQLite database at `/data/flows.db` persists across container restarts and image updates.

**Verify it's running:**

```bash
curl http://localhost:3000/health
# {"status":"ok"}

curl http://localhost:3000/api/flows
# [{"kind":"my-flow", ...}]
```

---

## 4. Docker Compose

For a more reproducible setup:

```yaml title="docker-compose.yml"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - flow-data:/data
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    restart: unless-stopped

volumes:
  flow-data:
```

```bash
# Start
docker compose up -d

# View logs
docker compose logs -f app

# Stop
docker compose down
```

---

## 5. nginx reverse proxy

If you're putting nginx in front of the application (for TLS termination, multiple services, etc.), you need to disable response buffering for SSE to work. Without this, nginx collects the entire response before forwarding it, which defeats real-time streaming.

```nginx title="nginx.conf"
upstream flow_app {
    server app:3000;
}

server {
    listen 80;
    server_name your-domain.com;

    # For SSL, add listen 443 ssl and certificate config here

    location /api/flows/ {
        proxy_pass http://flow_app;
        proxy_http_version 1.1;

        # Required for SSE streaming
        proxy_buffering off;
        proxy_cache off;

        # Prevent nginx from closing idle SSE connections
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        # Pass through headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Tell downstream proxies not to buffer
        add_header X-Accel-Buffering no;
    }

    # Non-API routes (if serving a frontend from the same domain)
    location / {
        proxy_pass http://flow_app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

The critical directives:
- `proxy_buffering off` — disables nginx's response buffering
- `proxy_cache off` — prevents caching of SSE responses
- `proxy_read_timeout 86400s` — keeps the connection open for long-running streams (24 hours)
- `X-Accel-Buffering no` — tells any upstream proxy not to buffer either

**With Docker Compose:**

```yaml title="docker-compose.yml (with nginx)"
services:
  app:
    build: .
    volumes:
      - flow-data:/data
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - NODE_ENV=production
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - app
    restart: unless-stopped

volumes:
  flow-data:
```

---

## 6. Caddy alternative

If you prefer Caddy over nginx, the config is simpler. Caddy handles TLS automatically and doesn't buffer by default:

```text title="Caddyfile"
your-domain.com {
    reverse_proxy app:3000 {
        flush_interval -1
    }
}
```

`flush_interval -1` disables response buffering. Caddy's default behavior already handles most SSE cases, but setting this explicitly prevents issues.

---

## Production checklist

- [ ] **Health check endpoint** — `/health` returns 200. Docker and orchestrators use this to restart unhealthy containers.
- [ ] **Graceful shutdown** — Handle `SIGTERM` to close the server cleanly. Docker sends `SIGTERM` before `SIGKILL` on stop.
- [ ] **Persistent volume** — Mount a volume for the SQLite database or filesystem store data.
- [ ] **Environment variables** — Never bake API keys into the image. Pass them at runtime via `-e` or `docker-compose.yml`.
- [ ] **Reverse proxy** — Disable buffering for `/api/flows/` routes if using nginx.
- [ ] **Logging** — The `onError` callback in the router options logs API errors. Consider also logging to a file or log aggregator.
- [ ] **Resource limits** — Set memory and CPU limits in Docker Compose or your orchestrator to prevent runaway LLM calls from consuming all resources.

---

## Troubleshooting

### SSE stream buffers behind nginx

Check that `proxy_buffering off` is set in the nginx location block for `/api/flows/`. Also check that no upstream CDN or load balancer is buffering. The `X-Accel-Buffering: no` header should propagate the no-buffering signal.

### better-sqlite3 fails to load

The native module needs to be compiled for the same platform as the runtime. If you build on macOS but run in a Linux container, the binary won't work. The multi-stage Dockerfile handles this by installing dependencies inside the container. If you're copying `node_modules` from your host, don't — let Docker install them.

### Container exits immediately

Check the logs with `docker logs flow-app`. Common causes:
- Missing environment variable (the model resolver fails if no API keys are set and a flow tries to use a model)
- Port conflict (another process using port 3000)
- Missing flow files in the built output (check your `tsconfig.json` paths)

### SQLite "database is locked"

SQLite supports one writer at a time. If you're running multiple container replicas pointing at the same database file, writes will fail. Use a single replica, or switch to an external database for multi-instance deployments.

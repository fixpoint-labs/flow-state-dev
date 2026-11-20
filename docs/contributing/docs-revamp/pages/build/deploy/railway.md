---
title: Deploy to Railway
type: recipe
description: "How to deploy a Flow State app as a long-running Node.js server on Railway, with SQLite on a volume."
---

# Deploy to Railway

Railway runs your app as a long-lived Node.js process in a container, so SSE streaming works without workarounds. This recipe starts the server with `fsdev serve`, keeps data in SQLite on a Railway volume, and ends with a health check against the deployed URL.

## Prerequisites

- A Node.js 22+ Flow State project with at least one flow
- A [Railway account](https://railway.app)
- The [Railway CLI](https://docs.railway.app/guides/cli), optional
- At least one LLM provider API key

## 1. Put the stores in `fsdev.config.ts`

`fsdev.config.ts` is the file that wires your app: it default-exports the result of `createFlowState`. Point the `primary` store at a SQLite file inside a volume you will mount at `/data` in step 4.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import helloChat from "./src/flows/hello-chat/flow";

export default createFlowState({
  flows: [helloChat],
  stores: { default: { primary: sqliteStores({ filename: "/data/flowstate.db" }) } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
```

`helloChat` is a flow defined in its own file. The folder in `filename` must already exist; the file is created on first use.

Install the SQLite store:

```bash
pnpm add @flow-state-dev/store-sqlite
```

`better-sqlite3`, the SQLite driver, is a native module. If the build fails for lack of compilers, add a `nixpacks.toml` to your project root:

```toml title="nixpacks.toml"
[phases.setup]
aptPkgs = ["build-essential", "python3"]
```

## 2. Add a start script

`fsdev serve` starts a production HTTP server from that config. It binds `$PORT` on `0.0.0.0`, serves the flow API at `/api/flows` and a health check at `/healthz`, and shuts down cleanly on `SIGTERM`.

```json title="package.json (relevant fields)"
{
  "scripts": {
    "start": "fsdev serve"
  }
}
```

`fsdev` ships in `@flow-state-dev/fsdev`. Add that package to the project if it is not there.

`fsdev serve` refuses to bind a network address when a flow has no `authentication.resolvePrincipal`, because the server would trust any `userId` a caller sends. Configure authentication on your flows. To deploy without it, use `fsdev serve --allow-unauthenticated`.

To own the entry file instead, call `serve(flowState)` from `@flow-state-dev/node`. It refuses the same way; pass `allowUnauthenticated: true` to override.

## 3. Set variables

In the Railway dashboard, open your service, then Variables. Set an API key for each provider your models use:

```text
OPENAI_API_KEY=sk-...
```

Do not set `PORT`. Railway provides it.

## 4. Mount a volume

Without a volume, the SQLite file sits on the container's own disk, and a redeploy replaces it. In the service settings, add a volume and mount it at `/data`, the folder in `filename`.

## 5. Deploy

From Git: connect your repository in the Railway dashboard, pick the branch, and Railway detects Node.js and runs your `build` and `start` scripts. From the CLI:

```bash
railway login
railway init
railway up
```

If detection fails, set the build command to `pnpm install && pnpm build` and the start command to `pnpm start` in the service settings.

## 6. Verify

```bash
curl https://your-app.up.railway.app/healthz
```

The path is `/healthz`, not `/health`. What comes back:

| Response | Meaning |
| --- | --- |
| `200` `{"status":"ok"}` | The server is ready and the stores are open. |
| `503` `{"status":"initializing"}` | Only with the authentication check overridden: the port is bound but the stores are opening, so this is normal for a moment. Retry. With the check on, the stores open before the port listens, and until then connections are refused. |
| `500` | Store initialization failed for good. The process is up but requests error, and the deploy fails fast. Read the service logs. |

Under `fsdev serve`, an initialization failure exits the process with code `3` instead of returning `500`.

## Run one replica

SQLite allows one writer and one file cannot be shared across replicas, so run a single replica. For more, use Postgres with `@flow-state-dev/store-postgres`.

## Troubleshooting

**Data is gone after a redeploy.** The SQLite `filename` is not inside the mounted volume. Check that both say `/data`.

**The stream stalls behind a custom domain.** A proxy in front of Railway, such as Cloudflare, may be buffering responses. See [Choose where to deploy](../deploy.md).

**"Refusing to bind 0.0.0.0".** A flow has no authentication. See step 2.

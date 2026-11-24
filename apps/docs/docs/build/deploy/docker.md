---
title: Deploy with Docker
type: recipe
description: "How to containerize a Flow State app, keep its SQLite data on a Docker volume, and run it behind a reverse proxy."
---

# Deploy with Docker

You'll build a production image that starts the app with `fsdev serve`, keep the SQLite file on a Docker volume, and check that data survives a restart.

## Prerequisites

- A Flow State app with an `fsdev.config.ts` and at least one flow, on Node.js 22 or later.
- [Docker](https://docs.docker.com/get-docker/) installed.
- One LLM provider API key.

## 1. Put the SQLite file on `/data`

`fsdev.config.ts` default-exports the result of `createFlowState`. Point the `primary` store, the one the app uses by default, at a file in a folder you will mount as a volume.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import support from "./src/flows/support/flow";

export default createFlowState({
  flows: [support],
  stores: { default: { primary: sqliteStores({ filename: "/data/flowstate.db" }) } },
});
```

`support` is a flow defined in its own file. `flows` is a list, not an object. The folder in `filename` must exist before the store opens, and the Dockerfile below creates it. The file itself is created on first use.

## 2. Write the Dockerfile

`fsdev serve` loads `fsdev.config.ts` from the working directory and starts the server, so the image needs your config, your sources and production dependencies. Add `@flow-state-dev/fsdev`, `@flow-state-dev/engine` and `@flow-state-dev/store-sqlite` to `dependencies`, not `devDependencies`. The config imports the last two directly, and `--prod` skips anything under `devDependencies`.

```dockerfile title="Dockerfile"
FROM node:22-slim

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY fsdev.config.ts tsconfig.json ./
COPY src/ ./src/

RUN mkdir -p /data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node_modules/.bin/fsdev", "serve"]
```

`fsdev serve` binds `0.0.0.0` and `$PORT`, which defaults to `3000`. It serves the flow API at `/api/flows` and a health check at `/healthz`. On `SIGTERM` it stops accepting connections, finishes in-flight requests and closes the store. The `CMD` is in exec form so Docker's signal reaches it.

Install dependencies inside the image. `better-sqlite3`, the SQLite driver, is a native module, and a `node_modules` folder copied from macOS will not load in a Linux container. Add `node_modules` to `.dockerignore`. If your package manager blocks build scripts (pnpm 10 does by default), allow `better-sqlite3`.

`fsdev serve` refuses to bind a network address when a flow has no `authentication.resolvePrincipal`, because the server would trust any `userId` a caller sends. Configure authentication on your flows. To run without it, change the `CMD` to `["node_modules/.bin/fsdev", "serve", "--allow-unauthenticated"]`.

## 3. Build and run

```bash
docker build -t support-app .

docker run -d \
  --name support-app \
  -p 3000:3000 \
  -v support-data:/data \
  -e OPENAI_API_KEY=sk-... \
  support-app
```

`-v support-data:/data` creates a named Docker volume and mounts it where the config writes the database. Pass keys with `-e`; do not copy a `.env.local` into the image.

## 4. Check it

```bash
docker logs support-app
# Server running at http://0.0.0.0:3000
# API:    http://0.0.0.0:3000/api/flows
# Config: /app/fsdev.config.ts

curl http://localhost:3000/healthz
# {"status":"ok"}

curl http://localhost:3000/api/flows
# {"flows":[...]}

# Send the credential your flow's resolvePrincipal accepts.
curl -X POST http://localhost:3000/api/flows/support/sessions \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{}'
# {"session":{"id":"sess_...", ...}}
```

`/healthz` returns `200` once the stores are open. The server opens them before it listens, so until then the port refuses connections; only with `--allow-unauthenticated` does it listen at once and answer `503` while they open. An orchestrator should probe that path and wait until it answers `200`. The `node:22-slim` image has no `curl`, so probe from outside the container or install it in the image.

To check persistence, run the `POST` above and copy the `id` from its response. Then run `docker restart support-app` and fetch it with `curl -H "authorization: Bearer $TOKEN" http://localhost:3000/api/flows/sessions/<id>`. The same session comes back. Remove the container and start a new one with the same `-v`, and the data is there too. Without the volume, the file lives on the container's own disk and goes with it.

## 5. Put a reverse proxy in front

A proxy that terminates TLS must not buffer or cache responses under `/api/flows/`, or streams arrive all at once at the end. It must also keep idle connections open longer than your longest run. The directives for nginx and Caddy are in the [HTTP API reference](../../reference/http-api.md).

## Run one container

SQLite allows one writer, so one container per volume. Replicas pointing at the same file fail with `database is locked`. For more than one, use the Postgres store. See [Stores](../../reference/stores.md).

## Troubleshooting

**The container exits immediately.** Read `docker logs support-app`. The usual cause is `Refusing to bind 0.0.0.0`: a flow has no authentication. See step 2. A port already in use or flows missing from the copied `src/` also stop startup.

**A model call fails with `No provider available`.** The provider's API key is not set in the container. The server starts without it and fails on the first call that needs a model. Variables and the keys each provider reads are in [Environment variables](../../reference/environment.md).

**`better-sqlite3` fails to load.** It was installed on a different platform than it runs on. Install inside the image and keep `node_modules` out of the build context.

**Data is gone after `docker rm`.** The container ran without `-v`, or `filename` is not under the mounted folder. Check that both say `/data`.

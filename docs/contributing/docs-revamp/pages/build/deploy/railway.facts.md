# Fact sheet: Deploy to Railway (B-09, recipe, 600 words)

Pass 1. Every fact the page may state, with file and line. Sources are limited to existing user
docs, the exported surface and its doc comments, tests, and `examples/` (ER-9). Line numbers are
from the tree at the time of writing. Paths are repo-relative.

Short names used below:

- OLD = `apps/docs/guides/deploying-to-railway.md` (the page being kept and rewritten)
- NODE-README = `packages/node/README.md`
- SERVE = `packages/node/src/serve.ts`
- APP = `packages/node/src/app.ts`
- GUARD = `packages/node/src/bind-guard.ts`
- SQLITE-REG = `packages/store-sqlite/src/registry.ts`
- SQLITE-README = `packages/store-sqlite/README.md`
- CLI = `apps/docs/docs/api/cli.md`
- FSDEV-SERVE = `packages/fsdev/src/commands/serve.ts`

## 0. Corrections the page must make to OLD

OLD does not match the code in four places. The recipe is rewritten around the Node host call, so
none of these carry over.

| OLD says | Code says | Cite |
| --- | --- | --- |
| A hand-written `http.createServer` bridge, 75 lines, is needed (OLD:22-156) | `serve(flowState)` is the whole server: request bridge, unbuffered SSE, health check, graceful shutdown | NODE-README:3-10, 27-50; SERVE:1-28 |
| `flows: { myFlow }` (OLD:38) | `flows` is a list: `flows: [myFlow]`. The keyed record is refused with an error | `packages/engine/src/flowstate/createFlowState.ts:371-377` |
| Health check at `/health` (OLD:59, 258) | Health path is `/healthz` by default | SERVE:58; APP:80; NODE-README:154 |
| `createSQLiteStores({ filename })` assigned to `stores` (OLD:198-203) | The adapter `createFlowState` takes is `sqliteStores({ filename })`. `createSQLiteStores` is the registry factory, on `@flow-state-dev/store-sqlite/host` | SQLITE-REG:1-5, 90-107; `packages/store-sqlite/src/index.ts:9`; `packages/store-sqlite/src/host.ts:7` |
| "Don't use SQLite... PostgreSQL or MongoDB adapters (when available)" (OLD:280) | A Postgres adapter exists: `@flow-state-dev/store-postgres` | `examples/knowledge-base/package.json:19` depends on `@flow-state-dev/store-postgres`; state only "a Postgres adapter" and link to its page |

## 1. What the task is

- Railway runs the app as a long-lived Node process in a container. SSE streaming works without
  workarounds. (OLD:8; `apps/docs/guides/deployment.md:22`)
- `@flow-state-dev/node` is "A host adapter for running a flow-state-dev app as a long-lived Node
  process." A host adapter is "the small piece of glue between your `createFlowState` config and a
  particular runtime". NODE-README:3-6.
- Named targets include Railway, Render, Fly, a VPS. NODE-README:12; `packages/node/src/index.ts:6-8`.
- Node 22+. `packages/node/package.json:69-71`; `packages/store-sqlite/package.json:59-61`; OLD:14.
- Needs a Railway account and at least one LLM provider key. OLD:14-17.
- The Railway CLI is optional. OLD:16.

## 2. Step: a Node server (question: what starts the server?)

**Answer: `serve(flowState)` from `@flow-state-dev/node`, called from an entry file. `fsdev serve`
is the same call run for you.**

### The call

- Import: `import { serve } from "@flow-state-dev/node";` NODE-README:27-42; `packages/node/src/index.ts:14`.
- Install: `pnpm add @flow-state-dev/node`. NODE-README:21-25.
- Signature: `serve(app: FlowState | FlowApiRouter, options?: ServeOptions): Promise<ServeHandle>`. SERVE:184-187.
- It "stands up a long-lived HTTP server ... and resolve[s] once it is listening". SERVE:176-183.
- Reference example (verbatim shape): NODE-README:29-42

  ```ts
  const flowState = createFlowState({ flows, stores: { default: { primary: /* your store adapter */ } } });
  // Binds process.env.PORT (then 3000) on 0.0.0.0, mounts the API under
  // /api/flows, and serves /healthz. Resolves once the server is listening.
  await serve(flowState);
  ```

- `createFlowState` comes from `@flow-state-dev/engine`. NODE-README:30.
- A config file that default-exports `createFlowState({...})` is the app's wiring; the CLI and a
  hand-written entry both read it. `examples/hello-chat/fsdev.config.ts:13-21` (default export);
  `apps/docs/docs/configuration/runtime.md:9` ("export from `fsdev.config.ts` for the CLI").
  Example imports it as `import flowstate from "./fsdev.config"`: NODE-README:134-144.

### What `serve` does for you (guarantees the page may state)

- Binds `process.env.PORT`, then `3000`. SERVE:51-54, 166-174; NODE-README:39-40, 167.
- Binds host `0.0.0.0` by default, "required for most PaaS". SERVE:54-55, 144; NODE-README:168.
- A non-numeric `PORT` falls through to 3000. SERVE:166-174. (Reference-row material; leave off the page.)
- Mounts the flow API at `/api/flows`. SERVE:56-57; NODE-README:40, 169.
- Serves the health path, `/healthz` by default: `200` once ready, `503` before. SERVE:58, 178-182;
  NODE-README:44-46, 154-155; test `packages/node/test/serve.test.ts:165-185`
  (503 body `{status:"initializing"}`, then 200 body `{status:"ok"}`).
- `500` from `/healthz` when store initialization fails permanently. APP:86-88;
  `packages/node/test/serve.test.ts:187-200` ("500 (not 503) so a PaaS fails the deploy fast instead of retrying").
- Resolves as soon as the port is bound, not when stores finish opening, so a platform health check
  passes during a cold start. NODE-README:44-46; SERVE:178-181.
- Streams SSE unbuffered. NODE-README:8-10; SERVE:11-13; test `packages/node/test/serve.test.ts:117-125`.
- On `SIGTERM` and `SIGINT`: stops accepting connections, drains in-flight requests, force-closes
  after a grace window (default 10 seconds, `shutdownGraceMs`), then disposes the router and the
  `FlowState`. NODE-README:48-50, 176; SERVE:92, 145, 262-297.
- Disposing the `FlowState` calls each store adapter's `dispose`, which closes the SQLite
  connection. `packages/engine/src/flowstate/createFlowState.ts:442-512` (loop at 508-514);
  SQLITE-REG:103-105.
- Also serves push (a WebSocket for `client.subscribe`) at `<basePath>/users/:userId/stream`. Needs
  nothing on a single process. NODE-README:52-60; SERVE:106-112. Several processes behind one
  address need one `FSD_PUSH_SECRET`; and a change bus that crosses processes. NODE-README:61-75.
  (One replica is the case for this page: leave to Reference, or one clause.)
- Handle: `{ server, port, close() }`. `close()` is idempotent. SERVE:129-141; NODE-README:197-203.

### `fsdev serve`, the same call as a command

- `pnpm fsdev serve` "Start a production HTTP server for the flow API and MCP endpoints, with no
  DevTool UI." CLI:163-169.
- Requires a committed `fsdev.config.*` that default-exports a FlowState; no directory discovery.
  CLI:181; FSDEV-SERVE:1-13, 85-95.
- Binds `$PORT` then `3000` on `$HOST` then `0.0.0.0`. CLI:175-176, 183; FSDEV-SERVE:97-102.
- "Under the hood it wraps `serve()` from `@flow-state-dev/node` with no `staticDir`." CLI:183;
  FSDEV-SERVE:119-126.
- Shuts down on `SIGTERM` and `SIGINT`. CLI:187; FSDEV-SERVE:139-153.
- The guard below runs before it binds. CLI:185; FSDEV-SERVE:104-117.
- Invalid port, missing config, guard refusal, or a bind failure exits with code `3`. CLI:187.
- `fsdev` is the `@flow-state-dev/fsdev` package; the example app exposes it as a script
  `"serve": "fsdev serve"`. `examples/knowledge-base/package.json:8-14`.
- `fsdev` is a dev dependency in the example. `examples/knowledge-base/package.json` devDependencies
  (`"@flow-state-dev/fsdev": "workspace:*"`). A deployed app needs it in `dependencies` for
  Railway's install to have it; **this is inference, not stated anywhere. Do not state it.**

### The guard (what the reader sees if they bind the network unauthenticated)

- `serve()` does not run the guard. A hand-written entry calls
  `assertNetworkBindIsAuthenticated(flowState, { host })` before `serve`. NODE-README:121-150;
  GUARD:73-105.
- It throws for a non-loopback `host` when any served flow has no `authentication.resolvePrincipal`
  (or the framework default). Loopback hosts pass; `allowUnauthenticated: true` skips it.
  GUARD:42-48, 73-105; tests `packages/node/test/bind-guard.test.ts:55-120`.
- Error text begins `Refusing to bind <host>: flow "<kind>" has no authentication configured, so a
  network-exposed server would accept a caller-supplied userId.` GUARD:97-104; test
  `bind-guard.test.ts:64-68`.
- Three ways out: configure `authentication.resolvePrincipal`, bind `127.0.0.1`, or opt out
  (`--allow-unauthenticated` on the CLI, `allowUnauthenticated: true` in code). GUARD:99-103; CLI:185.
- On a non-loopback host the guard initializes the stores before the port binds. NODE-README:148-150.
- Railway needs `0.0.0.0` (a PaaS host), so this guard is what a reader hits first. (The "PaaS needs
  0.0.0.0" half is SERVE:54-55, not Railway documentation.)

### Options the page may name (all in `ServeOptions`, SERVE:51-120)

`port`, `host`, `basePath` (default `/api/flows`), `healthPath` (default `/healthz`), `staticDir`
(serves a directory for non-API routes with `index.html` fallback; `SERVE:60`), `shutdownGraceMs`.
NODE-README:165-179 has the full table; the page names at most `port` and `healthPath`, the rest is Reference.

### Build and start scripts

- OLD:162-185 shows `"build": "tsc"`, `"start": "node dist/server.js"` and tsconfig fields
  (`target: ES2022`, `module: Node16`, `moduleResolution: Node16`, `outDir: dist`, `rootDir: src`).
  That is an existing-doc claim about the reader's own project; it is not verified by code.
- With `fsdev serve` the start script is `fsdev serve` and needs no build step beyond what the
  config's imports need. **Unverified**: whether `fsdev` loads a `.ts` config without a build. The
  example runs it directly from TypeScript (`examples/knowledge-base/package.json:14`, config at
  `examples/knowledge-base/fsdev.config.ts`), so `pnpm fsdev serve` with a `.ts` config is the
  shown pattern. Config discovery covers `fsdev.config.{ts,mts,js,mjs}`. FSDEV-SERVE:43.

## 3. Step: the store (question: where does SQLite's file live?)

**Answer: wherever `filename` says. On Railway that must be a path inside a mounted volume, or the
file is lost on redeploy.**

### The call

- Install: `pnpm add @flow-state-dev/store-sqlite`. OLD:207-210; SQLITE-README:12.
- Import: `import { sqliteStores } from "@flow-state-dev/store-sqlite";`. `packages/store-sqlite/src/index.ts:9`.
- Use: `stores: { default: { primary: sqliteStores({ filename: "/data/flowstate.db" }) } }`.
  Shape from `apps/docs/guides/deploying-with-docker.md:97`, NODE-README:36,
  SQLITE-README:19-27. (OLD:200 is wrong, see section 0.)
- `stores` is `Record<profileName, { primary, ... }>`; `primary` is required and holds "Sessions,
  state, items, requests, content, checkpoints, traces, suspensions, leases". Profile chosen by
  `FSD_ENV`, then `defaultProfile`, then the first key. `apps/docs/docs/configuration/runtime.md:86-99`;
  `createFlowState.ts:920-925`.
- The registry opens lazily and is memoized: the connection opens on first resolve, once.
  SQLITE-REG:90-101.
- `better-sqlite3` is a native module, `^11.0.0`. `packages/store-sqlite/package.json:67`. If the
  build lacks tools, OLD:296-303 adds a `nixpacks.toml` with
  `[phases.setup]` / `aptPkgs = ["build-essential", "python3"]`. (Existing-doc claim about Railway's
  builder; no code cite.)
- Docker page says it needs build tools too. `apps/docs/guides/deploying-with-docker.md:45-49, 390`.

### The four questions, for the SQLite file

| Question | Answer | Cite |
| --- | --- | --- |
| **Who owns it** | The deployed server process. It opens one connection when the stores first resolve and closes it when the `FlowState` is disposed (shutdown). Nothing else in the app writes to it. | SQLITE-REG:90-106; `createFlowState.ts:508-514` |
| **Who can see it** | Callers see its contents only through the flow API, under each flow's `authentication.resolvePrincipal`. The file itself is readable by anyone with shell or volume access to the service. A flow with no resolver trusts a caller-supplied `userId`; the bind guard refuses that on a network host. | NODE-README:121-133; GUARD:1-25 (default resolver trusts `body.userId`); `bind-guard.test.ts:64-68` |
| **Where it is stored** | The path in `filename`. "If the file doesn't exist, it will be created automatically." The folder must already exist. A Railway volume mounted at `/data` gives `/data/flowstate.db`. Without a volume the file sits on the container's own disk, which a redeploy replaces. | SQLITE-README:43; `apps/kitchen-sink/fsdev.config.ts:40-48` (comment: "SQLite opens a file in a folder that exists"); OLD:191, 195-205 (volume claims, Railway behaviour not code-verifiable) |
| **How many exist** | One file per `primary` store, one connection per process. Single writer. WAL mode is on, so readers (SSE streams) run alongside the writer. One service replica. The registry reports `sharedAcrossProcesses: false`. | SQLITE-README:71, 78-81, 53-60 (WAL); `schema.ts:3-9` (PRAGMAs); NODE-README:61-75 |

### What the file holds (for "what is lost if it is lost")

Sessions, users, orgs, request items and stream events, resource state and content, sequencer
checkpoints, suspensions, leases, traces, wakes; all survive a restart. SQLITE-README:87-96.

- Trace retention defaults to the last 50 requests (1000 when `NODE_ENV=development`).
  SQLITE-REG:29-32; SQLITE-README:46. (Reference row; not for the page.)
- Schema is created on first open (`skipSchemaInit` defaults to `false`). SQLITE-REG:36-42, 59-66.
- Durable execution is on by default over SQLite, so a request that dies mid-run resumes after a
  restart. `apps/docs/docs/configuration/runtime.md:60`. (A reason to prefer SQLite over the
  in-memory store; one clause at most.)

### The alternatives (one sentence, then a link)

- `inMemoryStores()` is "the default for local dev and tests", ephemeral.
  `packages/engine/src/stores/index.ts:262-266`.
- `filesystemStores({ rootDir })` persists JSON on disk. `packages/engine/src/stores/index.ts:278-284`.
  CLI:125 says it is "single-process".
- Postgres: `@flow-state-dev/store-postgres`. The Node README pairs `serve()` with "a long-lived host
  that attaches Postgres". NODE-README:154-156.
- More than one replica: SQLite is single-writer, the filesystem store is per-container, so use
  Postgres. OLD:276-282; SQLITE-README:71, 81. (The "one replica by default" half is a Railway
  claim, OLD:282.)

## 4. Step: environment

- Provider keys are read from env vars at runtime; the model resolver "auto-detects providers from
  env vars". `examples/hello-chat/fsdev.config.ts:6-10`. Names: `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`.
  `apps/docs/docs/configuration/environment.md:19-23`.
- Set in the Railway dashboard under the service's Variables. OLD:218-222.
- Railway sets `PORT` itself if you do not. OLD:225. `serve()` and `fsdev serve` read it. SERVE:166-174;
  FSDEV-SERVE:70-71. So the page does not need to set `PORT`. (OLD:221 sets `PORT=3000`; drop it.)
- `HOST`: `fsdev serve` reads `$HOST`; `serve()` itself does not read `HOST` (it takes the `host`
  option, default `0.0.0.0`). FSDEV-SERVE:97-102; SERVE:189, 51-55; NODE-README:134-143 reads it by hand.
- `FSD_PUSH_SECRET` read by `serve()` when set. SERVE:114-119. Needed only across processes.
- `FSD_ENV` picks a store profile. `createFlowState.ts:920`; runtime.md:88-93.
- `CRON_SECRET` is read by scheduled-flow dispatch: the app's schedule tick bears it to the dispatch endpoint when the environment sets it (`packages/engine/src/flowstate/createFlowState.ts:1340-1353`).
  Out of scope for this page.
- `better-sqlite3` and `NODE_ENV`: `NODE_ENV=development` raises trace retention; do not set it on
  Railway. SQLITE-REG:29-32. (Reference row.)

## 5. Step: deploy

All of this is existing-doc claim about Railway itself (OLD:229-248), not checkable in code.

- From Git: connect the repo in the Railway dashboard, pick the branch; Railway detects Node.js and
  runs the `build` then `start` scripts. OLD:231-236.
- From the CLI: `railway login`, `railway init`, `railway up`. OLD:238-244.
- If detection fails, set Build to `pnpm install && pnpm build` and Start to the start command
  (OLD:246-248 uses `node dist/server.js`; with `fsdev serve` it is `pnpm fsdev serve`).
- Verify: `curl https://<your-app>.up.railway.app/healthz` returns `200` with `{"status":"ok"}`.
  Body from `serve.test.ts:182-185`; path SERVE:58. OLD:258 uses `/health`, which is wrong.
- Other OLD verify curls (`GET /api/flows`, `POST /api/flows/<flow>/actions/<action>`, stream
  `GET /api/flows/<flow>/requests/<id>/stream`, OLD:261-269) are **not verified here**. Do not
  carry them onto the page without a test cite. `packages/node/test/serve.test.ts:111-125` proves
  only that `/api/flows/*` routes reach the router.
- SSE behind an external proxy such as Cloudflare must not buffer. OLD:292-294;
  `apps/docs/guides/deployment.md` section "SSE streaming gets buffered" (linked at OLD:294).
  Railway's own proxy is fine by default (OLD:294, platform claim).

## 6. Limits the page may state flat

- One replica. SQLite is single-writer and the SQLite registry reports not shared across processes.
  SQLITE-README:71, 81.
- A filesystem or SQLite file outside a mounted volume does not survive a redeploy. OLD:191, 305-307.
- `serve()` binds `0.0.0.0` by default, so an app with no `authentication.resolvePrincipal` that
  starts via `fsdev serve` is refused; via a bare `serve()` call it is not checked. NODE-README:121-150;
  FSDEV-SERVE:104-117; SERVE (no guard call anywhere in the file).
- `serve()` mid-stream SSE failures leave no server-side log. SERVE:15-19. (Reference row at most.)
- No DevTool UI under `fsdev serve`, and a non-API GET such as `/index.html` returns 404. CLI:183.
  A bare `serve()` with no `staticDir` returns `{ "error": "Not found" }` 404 for non-API GETs:
  SERVE:252 applies only when a `staticDir` or `pageHandler` is set; otherwise the portable app's
  not-found. Only state it for `fsdev serve`.

## 7. Troubleshooting rows (Reference or one line each; the page has 600 words)

- "Cannot find module": `outDir` must match the start script. OLD:288-290. Only applies to the
  `tsc` route.
- Native build failure for `better-sqlite3`: `nixpacks.toml` above. OLD:296-303.
- Data gone after restart or redeploy: put the store path on a volume. OLD:305-307.
- Server refuses to start with "Refusing to bind 0.0.0.0": see the guard. GUARD:97-104.
- `/healthz` stays `503`: stores are still opening. `500`: store init failed; the process is up but
  every request errors; read the logs. APP:86-88; serve.test.ts:165-200. For `fsdev serve`, an init
  failure instead exits with code 3 and "Server failed to initialize". FSDEV-SERVE:164-178.

## 8. Example plan (the code the page ends on)

One app, the standard layout from `docs/contributing/user-docs.md` (Code examples). Files:

1. `src/server.ts` (or `fsdev.config.ts` plus the command) holding the `serve` call. Verified
   pieces: `createFlowState` from `@flow-state-dev/engine`, `serve` from `@flow-state-dev/node`,
   `sqliteStores` from `@flow-state-dev/store-sqlite`, `flows: [list]`, `stores: { default: {
   primary: sqliteStores({ filename }) } }`, `await serve(flowState)`.
2. `package.json` scripts: `"start": "node dist/server.js"` (tsc route) or `"start": "fsdev serve"`.
3. Railway variables: the provider key. No `PORT`.

No example in `examples/` or `labs/` calls `serve()` directly (searched `examples/`, `labs/`,
`apps/kitchen-sink`); the shape comes from NODE-README:29-42 and :134-144, so the example must be
type-checked at pass 4. `examples/knowledge-base` reaches the server through `fsdev serve`
(`package.json:14`) with `@flow-state-dev/store-postgres`, not SQLite.

## 9. Left out, and why

- The 75-line `http.createServer` bridge, the Express remark and `decodePathSegments` (OLD:22-158):
  `serve()` replaces them.
- The `tsconfig` block (OLD:173-185): about the reader's project, not the framework. Keep at most
  the `outDir` / start-script match if the tsc route is shown.
- Scaling section beyond one line: Reference.
- `staticDir`, `pageMeta`, `pageScript`, `pageHandler`, `devtoolConfig`: Reference
  (NODE-README:165-179).

## 10. Open items for later passes

- No test or goal exercises a Railway deploy. Every Railway-side claim (volume mounting, PORT, build
  detection, nixpacks, the CLI commands) rests on OLD alone. Pass 5 cannot confirm them against code.
  Mark them as platform behaviour.
- `docs/contributing/docs-revamp/pages/build/deploy/docker.md` still links the old Railway guide for
  the server pattern and prints the hand-written bridge. Its `flows: { myFlow }` is the same removed
  form (line 95 of the Docker guide). That page's own pass fixes it; this page does not.
- OLD sits at `/guides/deploying-to-railway`; the NODE-README (:158) and CLI docs link to it. Cutover
  decides the new slug `build/deploy/railway`.

## 11. Revise round 1

The page now uses `fsdev serve` as the start command and `fsdev.config.ts` as the one example block; a short `serve()` entry file is shown as the alternative. The `http.createServer` bridge, the Express remark, the filesystem store, `decodePathSegments`, the scaling bullets and the `/health` curls are gone (section 9). Page claims and their cites: `/healthz` 200/503, SERVE:58 and serve.test.ts:165-185; `fsdev serve` exit code 3 on init failure, FSDEV-SERVE:164-178; guard and `--allow-unauthenticated`, GUARD:97-104, CLI:185; `serve()` does not run the guard, NODE-README:121-150; `sqliteStores` is the adapter, SQLITE-REG:95; one replica, SQLITE-README:71, 81. The SQLite single-writer limit is stated as one file per volume, not as a refusal, since the store runs WAL with a busy timeout (`packages/store-sqlite/src/schema.ts:4-5`). The `fsdev` in `dependencies` line is an install instruction, not a code claim.

## 13. Revise round 3

Step 6 now carries a three-row table for `/healthz`: `200` `{"status":"ok"}` (ready), `503` `{"status":"initializing"}` (port bound, stores opening; serve resolves on bind so a cold-start check passes), `500` (store initialization failed permanently, process up, requests error, deploy fails fast, read logs), plus the note that `fsdev serve` instead exits with code 3, and that the path is `/healthz`, not `/health`. Cites: SERVE:58, 178-182; APP:86-88; serve.test.ts:165-200; FSDEV-SERVE:164-178; CLI:187. Section 7 already states these.

## 12. Revise round 2

The `src/server.ts` example is gone: the page gave no runner for it, and the tsc route's `dist` path is unverified against the example layout. The page now names `serve(flowState)` from `@flow-state-dev/node` in one sentence (NODE-README:27-50; no guard, NODE-README:121-150). The `fsdev` in `dependencies` claim is removed, as section 2 required; the page says only to add `@flow-state-dev/fsdev`. Confirmed against code: `/healthz` is `503` while stores open (serve.test.ts:165-185) and `fsdev serve` exits with code `3` when initialization fails (FSDEV-SERVE:156-178; CLI:187). `PORT` is stated once, in the variables step ("Do not set `PORT`").

# Facts for Deploy to Vercel (B-08, recipe)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`. Nothing here was run against a real Vercel deployment; claims are read from source and pinned by tests where marked.

Paths are from the repo root. Abbreviations:

- `old` = `apps/docs/guides/deploying-to-vercel.md` (the page this one replaces; its kitchen-sink specifics are cut)
- `h` = `packages/vercel/src/handler.ts`
- `nx` = `packages/vercel/src/next.ts`
- `ty` = `packages/vercel/src/types.ts`
- `ix` = `packages/vercel/src/index.ts`
- `st` = `packages/vercel/src/store.ts`
- `pg` = `packages/vercel/src/pg.ts`
- `ht` = `packages/vercel/test/handler.test.ts`
- `nt` = `packages/vercel/test/next.test.ts`
- `rd` = `packages/vercel/README.md`
- `fst` = `packages/engine/src/flowstate/types.ts`
- `fsc` = `packages/engine/src/flowstate/createFlowState.ts`
- `env` = `apps/docs/docs/configuration/environment.md`
- `ov` = `apps/docs/docs/streaming/overview.md`
- `cr` = `apps/docs/docs/server/connection-resilience.md`

Legend: **[page]** the page states it. **[ref]** belongs on `reference/runtime` or `reference/environment`; the page links. **[test]** pinned by a test. **[verify]** not confirmed against running code or a platform I can't query; keep off the page or soften. **[contradiction]** two sources disagree; ruling given. **[cut]** in the old page, stays off this one. **[answers Qn]** the sitemap question it answers (Q1 which handler on Vercel, Q2 what keeps a long stream open, Q3 where keys go).

## Contradictions and corrections

- **[contradiction] Who sends heartbeats.** `old` line 48-51 and `rd` "What it does" say the Vercel handler injects heartbeat comments. `h:7-9` and `h:94-96` say the engine emits them for every live and GET-attach stream and the adapter does not. `ht:137-144` pins that a POST SSE response through the adapter carries no `: ping`. Ruling: the engine sends them, default every 15 s (`packages/engine/src/routes/http-handlers.ts:211,282-285`; `createFlowApiRouter.ts:163`; `ov:157-159`). The page does not say who sends them (round 2: nothing on the page asks). Config: `createFlowState({ defaultSseHeartbeatMs })` (`fst:265`), per flow `defineFlow({ request: { sseHeartbeatMs } })` (`ov:159`). `0` disables (`createFlowApiRouter.ts:163`). [ref]
- **[contradiction] "Next.js 14+" prerequisite.** `old:16` says Next.js 14+; `nx` import path `@flow-state-dev/vercel/next` requires Next.js 15+ (`old:53`, `rd` "`@flow-state-dev/vercel/next`"). Ruling: the page says 15+ for this handler. The lower-level `createVercelHandler` also awaits `ctx.params` as a Promise (`h:54-55,126`), which is the Next 15 shape.
- **[verify]** `waitUntil` is declared on `VercelHandlerOptions` (`ty:33-39`) but `handler.ts` never reads `options.waitUntil` (`h:66` reads only `onAbort`; grep finds no other use). The working keep-alive is `createFlowState({ onBackgroundWork })` (`fst:208-217`). Keep `waitUntil` off the page. Also `createVercelBareHandler` does not call `onAbort` (`h:162-170`).

## Q1. Which handler do you use on Vercel? [answers Q1]

1. **[page]** One catch-all route file mounts the app: `export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);` at `app/api/flows/[...path]/route.ts`. `old:36-46`, `nx:17-21`, `nt:27`.
2. **[page]** Import: `createVercelNextHandler` from `@flow-state-dev/vercel/next`. `old:38`, `package.json` exports `./next` (`packages/vercel/package.json:47-50`).
3. **[page]** The argument is the `FlowState` handle returned by `createFlowState`, not `flowstate.getRouter()`. The router is resolved on the first request, not at import, so async store setup needs no top-level await. `nx:1-9,17-21`, `old:53`, `rd`. **[test]** `nt:7-42`: `getRouter` is called 0 times before a request and once after it.
4. **[page]** It returns four handlers, `GET`, `POST`, `PATCH`, `DELETE`. `h:110-118`, `nt:28-31`.
5. **[page]** It unwraps Next.js 15's async `params` for you. `h:94-95,126`, `old:49`.
6. **[page]** It adds SSE headers to event-stream responses only: `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`, so the platform's proxy does not buffer or compress the stream. `h:17-26,77-86`. **[test]** `ht:128-135` (GET SSE gets both), `ht:100-114` area (non-SSE JSON response passes through unchanged, `x-accel-buffering` absent), `nt:39-41`.
7. **[page]** The adapter's SSE shaping applies to POST SSE responses too (`wrapResponse` is applied on every method, `h:127-128`); `ht:137-144` pins POST SSE passes through with body intact.
8. **[page]** `/api/flows` (no path segment) needs a second route file because a Next.js `[...path]` catch-all needs at least one segment: `app/api/flows/route.ts` with `createVercelBareHandler(() => flowstate.getRouter())` from `@flow-state-dev/vercel`, exporting `GET` and `POST`. `old:55-62`, `h:140-175`, `ix:9`. The bare route is the flow listing endpoint (`old:55`).
9. **[page]** Other exports from `@flow-state-dev/vercel`: `createVercelHandler`, `createVercelBareHandler`, types `FlowApiRouter`, `VercelHandlerInput`, `VercelHandlerOptions`. `ix:9-14`. `createVercelHandler(app, options?)` takes a router or a function returning a router or promise of one, and `options.onAbort(req)` runs when the client disconnects. `ty:20-31`, `h:121-125`. [ref]
10. **[page]** For a non-Vercel Next.js deployment use `createNextHandler` from `@flow-state-dev/next` instead. `nx:1-6`, `rd`, `packages/next/src/createNextHandler.ts`.
11. **[page]** For a long-lived Node server (Railway, Docker), `@flow-state-dev/node`'s `serve()`; see the Railway and Docker recipes (`docs/contributing/docs-revamp/pages/build/deploy/railway.md`, `docker.md`). `rd` top note.
12. **[page]** On Vercel (`VERCEL` env var set, which the platform sets) the adapter tells the router its disk does not last between requests. An attachment upload to a blob store that keeps bytes on the host is then refused with HTTP 501 and body `{ error: "attachments_unavailable" }`. A hosted blob store is unaffected. Off Vercel (`next dev`, `next start` on a machine) a local blob store takes uploads, status 201. `h:33-45`, **[test]** `ht:11-41`. [ref]

## Q2. What keeps a long stream open? [answers Q2]

1. **[page]** Three things together: the engine's `: ping` comment frames every 15 s on every live and GET-attach stream (see contradiction above), the adapter's no-buffer headers (Q1.6), and `export const maxDuration = 300` on the route. `old:48-51,66-72`, `h:7-9,17-26`.
2. **[page]** `maxDuration` is route segment config; the route file must carry literal `export const` declarations for `runtime = "nodejs"`, `maxDuration = 300`, `dynamic = "force-dynamic"`. Re-exporting them from another module does not work because Next.js reads them by static analysis at build time. `old:42-45,64-72`, `rd` "Route config values".
3. **[page]** `dynamic = "force-dynamic"` stops Next.js caching the SSE routes. `old:71`. `runtime = "nodejs"` is the Vercel runtime used. `old:69`. `maxDuration` is the max function execution time in seconds. `old:70`.
4. **[page]** The plan limits `maxDuration`: if the plan's limit is lower, the plan limit wins. `old:321`. The old page's table (Hobby 10 s, Pro 60 s, Enterprise 900 s, `old:313-319`) is **[verify]**: it is Vercel's pricing and changes, and I cannot confirm it from this repo. Say "your plan's limit takes precedence" and link Vercel's docs rather than reprint numbers.
5. **[page]** When a stream drops, the client can reattach; heartbeat, stale-request sweeper, and the client watchdog `session.isStuck` are described in `cr:25-31`. [ref] `reference/runtime` or Connection Resilience; do not explain on the page.
6. **[page]** Rough fit, from the old page (`old:323-331`, experience claims, soften or cut): single-LLM-call chat flows complete in seconds; multi-step tool flows run tens of seconds to minutes; flows that routinely outrun the function limit belong on a container host (Railway, Docker). The page can say the last as a limit: Vercel functions have a maximum duration, so a flow that outruns it is cut off; use Railway or Docker.
7. **[page]** Work that continues after the HTTP response (fire-and-forget action execution, scheduled dispatches, post-202 execution) is kept alive by `createFlowState({ onBackgroundWork: (promise) => after(() => promise) })`, with `after` from `next/server`. Without it Vercel can freeze the function once the response is sent. It is a `createFlowState` option, not a handler option, because the router is built inside `createFlowState`. `fst:208-217`, `nx:8-12`, `old:151`, `rd`. Matches the example in `old:142-143`.
8. **[page]** `detectInterruptedOnStartup: false` skips the startup check for requests an earlier run left interrupted (on by default; `fst:219-224`). On serverless the check issues background queries at cold start that can exhaust the connection pool (`fst:219-224`, `old:140-141`). Cost: a request abandoned by a stopped process is not marked `interrupted` at startup, so it is not offered for resume; the periodic sweeper does not reliably cover this on a serverless target (`old:150`). Recovery path: call `POST /api/flows/users/:userId/check-interrupted` from a scheduled route (`old:150`; route exists: `packages/engine/src/routes/router.ts:112`; documented `cr:36`). It answers `{ interrupted: [{ requestId, sessionId?, flowKind, flowId, actionName, interruptedAt }] }` (`cr:41`). [ref] The "sweeper timer does not hold the function open and a serverless process is frozen between invocations" reasoning is in `old:150`; state the consequence, drop the mechanism.

## Q3. Where do keys go? [answers Q3]

1. **[page]** Variables are set in the Vercel project: Settings, Environment Variables. `old:157-171`. A value in `.env.local` is not synced; it must be set in the dashboard, for the right environment (Production, Preview, or Development). `old:355-357`.
2. **[page]** `AI_GATEWAY_API_KEY`: Vercel AI Gateway key. `env:22`. Used by the example's `createGateway({ apiKey })` (`old:123-128`). A provider key such as `OPENAI_API_KEY` works for models addressed `openai/...` (`old:20,174-178`). [ref] `reference/environment` lists keys.
3. **[page]** `FSD_DB_URL`: connection string for `vercelPostgresStores()`. Falls back to `DATABASE_URL` when unset. `FSD_DB_URL` is preferred so the name does not collide with another service. `st:36-41,73-76`, `env:33`, `old:157-171`.
4. **[page]** `FSD_ENV`: names the store profile to use. Set `FSD_ENV=prod` on Vercel. Without it the runtime uses `defaultProfile`, else the first declared profile. Chain: `FSD_ENV` then `defaultProfile` then first declared. An unknown `FSD_ENV` name throws `FlowStateConfigError` listing the declared profiles. `NODE_ENV` is not read. `fst:179-185`, `fsc:918-940`, `env:31`.
5. **[page]** If neither `FSD_DB_URL` nor `DATABASE_URL` is set and `vercelPostgresStores()` is the active profile, the store throws: `vercelPostgresStores: no connection string. Set FSD_DB_URL / DATABASE_URL or pass { connectionString }.` `st:77-82`. It throws when the stores first resolve (first request), not at import (`st:142-145`).
6. **[page]** The migration script needs `FSD_DB_URL` at build time, so tick "Build" when adding the variable. Variables are scoped by environment (Production, Preview, Development) and by process (build, runtime). `old:219` (section 6 end, "Make `FSD_DB_URL` available to builds").
7. **[cut]** `BASH_PROVIDER`, `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `selectBashProvider()`, Vercel Sandbox pricing: kitchen-sink and `@flow-state-dev/tools/bash` specifics (`old` section 7). Not on this page.

## The adapter (step 1) and Next config (step 3)

1. **[page]** Install: `pnpm add @flow-state-dev/vercel`. `old:27`.
2. **[page]** Sub-exports: `.` (handlers), `./next`, `./store`, `./pg`, `./schedules`. `packages/vercel/package.json:30-51`. Only `.`, `./next`, `./store` are on the page.
3. **[page]** `transpilePackages` in `next.config.mjs` is needed only when the `@flow-state-dev/*` packages are local workspace dependencies in a monorepo; consuming published packages from npm needs none. The old list: core, client, react, engine, vercel. `old:76-95`. Symptom if missing: "Module not found" for `@flow-state-dev` packages. `old:339-341`.

## The store (kept short; the page is a deploy recipe)

1. **[page]** A Vercel function's disk does not last between invocations. In-memory store: works but loses everything at each cold start. Filesystem store: writes succeed and the data is gone on the next invocation. SQLite: only for short demos. Use an external Postgres. `old:101-107`, `h:33-41`.
2. **[page]** `vercelPostgresStores()` from `@flow-state-dev/vercel/store` returns a `StoreAdapter` for the `primary` and `bus` capability slots (`st:141`), with a `scheduleIndex` field (`st:43-52`). Defaults baked in: pool options `vercelPgPoolOptions` (`max: 1`, `idleTimeoutMillis: 10_000`, `connectionTimeoutMillis: 15_000`, `allowExitOnIdle: true`, `pg:38-50`), Neon's WebSocket client swapped in for `.neon.tech` URLs (`st:89-94`), schema init skipped (`st:119-123`), polling instead of LISTEN for live tail (`st:124-126`). Option `{ connectionString }` overrides env (`st:36-41`). [ref] pool numbers are Reference.
3. **[page]** `stores` takes named profiles, each a map of capability slots: `stores: { prod: { primary: vercelPostgresStores() }, dev: { primary: inMemoryStores() } }`, `defaultProfile: "dev"`. `fst:170-185`, `old:134-138`, `rd` Quick Start.
4. **[page]** `models` shorthand versus `modelResolver`: the old example passes a pre-built `modelResolver` (`createModelResolver` from `@flow-state-dev/core/models`, static `openai` import from `@ai-sdk/openai`, `createGateway` from `@ai-sdk/gateway`) because Next.js bundles server code and the resolver's dynamic `require()` path fails (`old:120-129,148`). **[verify]** `rd` Quick Start uses `models: { default: "openai/gpt-6-luna" }` on Vercel with no resolver. The two sources disagree on whether the shorthand works in bundled Next.js. `fst:157-163` documents `models` as auto-wiring AI Gateway via `AI_GATEWAY_API_KEY` and `modelResolver` as an escape hatch. Ruling (round 1): the page uses the `models` shorthand, as `rd` Quick Start does, and says nothing about the bundler or `modelResolver`. Unconfirmed against a real Next.js build.
5. **[page]** Run schema creation at build, not at runtime. `createPostgresStores` creates the schema (idempotent `CREATE TABLE/INDEX IF NOT EXISTS` statements under an advisory lock; the page states no count, `old:185`) every time it is called, i.e. once per cold start. Script `scripts/migrate.ts` calls `createPostgresStores({ connectionString })`, imported from `@flow-state-dev/store-postgres/host` (the package root exports `postgresStores`, not `createPostgresStores`; `packages/store-postgres/src/registry.ts:1-6`), inside an async `main` so it runs under `tsx` in either module mode then `stores.close()`; it exits 0 with a log line when no DB URL is set, so a preview deployment with no database does not fail; with a URL, a migration failure fails the build. `old:187-217`. Wired in `package.json` as `"vercel-build": "next build && tsx scripts/migrate.ts"` with `tsx` as a devDependency, because `@flow-state-dev/store-postgres` uses bundler module resolution and extensionless relative imports that raw Node ESM cannot resolve. `old:199-215`.
6. **[page]** Four stored-data questions, for the one stored part the page touches, the app's Postgres database: **owner** the app's operator (the database account in `FSD_DB_URL`), not the framework; **who can see it** anyone holding the connection string, plus the app's own users through the flow's actions and sessions (scoped per user by the framework, see Sessions and `reference/runtime`); **where stored** the external Postgres, never the function disk (`old:101-107`); **how many** one database per deployment profile, with `prod` and `dev` profiles choosing which; one `vercelPostgresStores()` instance per function instance, pool `max: 1` (`pg:45-47`). The old page does not state per-user visibility; keep that clause off the page unless `reference/runtime` is confirmed to say it.
7. **[ref]** Connections: with no listen tail the bus sends each change's notice but does not listen, so it reports that it does not cross processes; open session views re-read once a second across instances. `st:12-16`, `rd` `/store`.

## Deploy and verify (steps 5 and "deploy")

1. **[page]** CLI: `vercel --prod` (Vercel CLI, `npm i -g vercel`, optional). `old:19,281-285`. Git: push to the connected repository and Vercel builds and deploys. `old:286`.
2. **[page]** Monorepo: set the project's root directory to the app's subdirectory; set Build Command to install and build from the repo root, then run the migration from the app directory; Output Directory `.next`. `old:288-292`. The example command names `@flow-state-dev/example-hello-chat`; replace with a placeholder for the reader's own filter. `examples/hello-chat` exists (`ls examples`).
3. **[page]** Verify with curl, using paths from the old page: `GET /api/flows` returns the flow listing; `POST /api/flows/<flow>/actions/<action>` with JSON `{ "userId", "input" }` runs an action and returns a `requestId`; `GET /api/flows/<flow>/requests/<requestId>/stream` streams it, with `curl -N`. `old:294-306`. `userId` is a required caller input. **[verify]** the exact response field names (`requestId`) are from `old:306`; confirm in `packages/client` before quoting a response body. The page should name the flow from its own example, not `hello-chat`.
4. **[page]** Symptoms and fixes: stream arrives all at once means the route is missing `export const dynamic = "force-dynamic"` or is not using the adapter (`old:335-337`); "Module not found" means `transpilePackages` (`old:339-341`); function timeout on a short plan means the flow outran `maxDuration` or the plan limit (`old:343-345`); an env var that is "not found" means it is set only locally or only for another environment (`old:355-357`). Cold start latency is inherent to serverless (`old:347-349`, cut: experience claim).
5. **[cut]** CORS (`old:351-353`): the framework adds no CORS headers; handle in Next.js middleware. Keep off a deploy recipe unless the page has room; if kept, state it flat.

## What the page links to

- `reference/runtime` ([ref]): `createFlowState` options (`stores`, `defaultProfile`, `onBackgroundWork`, `detectInterruptedOnStartup`, `defaultSseHeartbeatMs`), profile resolution. Source `apps/docs/docs/configuration/runtime.md`.
- `reference/environment` ([ref]): `AI_GATEWAY_API_KEY`, `FSD_ENV`, `FSD_DB_URL`. Source `env:22,31,33`.
- Sibling recipes: Railway, Docker (`docs/contributing/docs-revamp/pages/build/deploy/`).
- Not documented here: the Next.js setup guide link in `old:11,17` points to `/guides/nextjs-setup`, which this page's plan does not replace; check its new slug at cutover.

## Limits the page should state flat

- `@flow-state-dev/vercel/next` requires Next.js 15 or later. `old:53`.
- Vercel and Next.js only; other platforms use the host adapters. `rd` top note.
- A function has a maximum duration; the plan's limit wins over `maxDuration`. `old:321`.
- Attachment uploads to a disk-backed blob store are refused on Vercel (Q1.12).
- `onBackgroundWork` is not a handler option.
- The adapter does not add CORS headers. `old:351-353`.

## Open items for the writer

- Resolve the `models` versus `modelResolver` disagreement (Q3 store item 4) before drafting the example file.
- Confirm the response fields in the curl verification step.
- Plan limits table: link to Vercel, do not reprint.

## Round 2 revisions

- Handle-versus-factory rule scoped to each route: `createVercelNextHandler(flowstate)` takes the handle; `createVercelBareHandler` takes a router factory (`h:140-175`, `nx:17-21`). Both resolve the router lazily, so the bare route's `() => flowstate.getRouter()` is correct. The async-store clause is off the page.
- Q1.12 on the page: 501 when the blob store writes to local disk; no blob store page exists to link.

## Round 1 revisions

- `createFlowState({ flows })` takes an array of flows (`fst:124`), so the page writes `flows: [myFlow]`. `rd` Quick Start shows an object and is wrong on this.
- `createVercelNextHandler` needs Next.js 15+ (`packages/vercel/package.json` peer `next >=15.0.0`); prerequisite says 15+.
- `vercelPostgresStores()` backs the `primary` and `bus` slots (`st:141`); the page says only that it backs `primary` in a profile.
- The adapter does not set `dynamic`; the route file must export it. The troubleshooting entry says so.
- Step 7 of the old page (bash tool, Sandbox, `BASH_PROVIDER`) is cut: kitchen-sink and `@flow-state-dev/tools/bash` specifics, not this task. Pricing, plan timeout table and cold-start essay are cut; the page links Vercel's function limits.
- The `skipSchemaInit` mention is cut. `vercelPostgresStores()` skips schema init itself (`st:119-123`).
- Monorepo build command with a repo-specific filter is cut; the page says set the Root Directory and uses the `vercel-build` script.
- Reference links used: `/reference/api/vercel`, `/reference/runtime`, `/reference/environment`. Slugs are planned, not confirmed.

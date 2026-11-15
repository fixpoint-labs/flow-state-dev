# Facts for Deploy to AWS Lambda (B-11, recipe)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`. Nothing here was run against a real Lambda function: `packages/node/test/aws-lambda.test.ts:5-8,32-33` says end-to-end streaming is not exercised in CI.

Paths are from the repo root. Abbreviations:

- `old` = `apps/docs/guides/deploying-to-aws-lambda.md` (the page this one replaces; kept, so its steps are the starting point)
- `lh` = `packages/node/src/aws-lambda.ts`
- `ap` = `packages/node/src/app.ts`
- `lt` = `packages/node/test/aws-lambda.test.ts`
- `at` = `packages/node/test/app.test.ts`
- `rd` = `packages/node/README.md`
- `pk` = `packages/node/package.json`
- `fst` = `packages/engine/src/flowstate/types.ts`
- `pgr` = `packages/store-postgres/src/registry.ts`
- `pgd` = `packages/store-postgres/README.md`
- `vs` = `packages/vercel/src/store.ts`
- `ha` = `apps/docs/docs/server/host-adapters.md`
- `dep` = `apps/docs/guides/deployment.md`
- `au` = `apps/docs/docs/server/authentication.md`
- `ov` = `apps/docs/docs/streaming/overview.md`
- `env` = `apps/docs/docs/configuration/environment.md`
- `po` = `apps/docs/docs/persistence/overview.md`
- `ex` = `examples/hello-chat/src/flows/hello-chat/flow.ts` (the flow the verify commands name; `kind: "hello-chat"`, action `chat`, input `{ message }`, lines 77-90)

Legend: **[page]** the page states it. **[ref]** belongs on a Reference page; the page links. **[test]** pinned by a test. **[verify]** cannot be confirmed from this repo (AWS behaviour, or unrun); keep off the page or soften. **[contradiction]** two sources disagree; ruling given. **[cut]** in `old`, stays off this one. **[answers Qn]** the sitemap question it answers (Q1 what limits a streamed reply on Lambda, Q2 which store).

## Contradictions and corrections

- **[contradiction] `flows` is an array.** `old:35`, `po:68` and `pgd:23` write `flows: { myFlow }`. The option's type is `readonly FlowInstance<any, any>[]` (`fst:124`), and `examples/hello-chat/fsdev.config.ts:25` passes `flows: [helloChatFlow]`. Ruling: the page writes `flows: [myFlow]`.
- **[contradiction] `old` imports `vercelPostgresStores` for a Lambda store.** `vercelPostgresStores()` is tuned for Vercel: `skipSchemaInit: true`, so migrations must run out of band, and `liveTailPool: null` (`vs:2-10`). On Lambda, with no Vercel migration step, schema would never be created unless the reader ran it elsewhere. Ruling: the page uses `postgresStores` from `@flow-state-dev/store-postgres` (`pgr:256`, `po:66-73`), which creates the schema on first call by default (`pgr:60-63`; `pgd` "Skipping runtime schema init"). The page may name the skip option as a cold-start cost (Q2.6).
- **[contradiction] `old` env var names.** `old:96` sets `DATABASE_URL`. `postgresStores` reads `connectionString`, falling back to `FSD_DB_URL` then `DATABASE_URL` when none is passed (`pgr:40-46`, `pgr:149`). Either name works if no `connectionString` is passed. Ruling: pass `process.env.DATABASE_URL` explicitly in the example so the name is visible in the code. `env:33` lists `FSD_DB_URL` as a framework variable.
- **[verify] "A client disconnecting does not stop the function"** (`old:72`). No code in `lh` or `ap` handles a client abort for Lambda, and nothing tests it. It is Lambda platform behaviour I cannot check from the repo. Keep off the page, or say only what is certain: the function bills until it returns or the timeout fires (`old:70` is also platform behaviour; **[verify]**).
- **[verify]** `old:131` "a 1-2s cold start is acceptable" is an experience claim. Cut or soften.
- **[verify]** `old:69` "memory also scales CPU, which shortens cold starts" and "256 MB is a reasonable floor". AWS facts, not in the repo. Cut or link AWS docs.

## Q1. What limits a streamed reply on Lambda? [answers Q1]

1. **[page]** `createLambdaHandler(app, options?)` is exported from `@flow-state-dev/node/aws-lambda`. `lh:28-33`, `pk:40-42,63-65` (the `./aws-lambda` subpath export), `ha:21`.
2. **[page]** `app` is a `FlowState` (what `createFlowState` returns) or a built `FlowApiRouter`. `lh:23-30`, `lt:34-43` (both accepted).
3. **[page]** It returns the function you export as the Lambda handler: `export const handler = createLambdaHandler(flowstate)`. `lh:10-16,23-27`. **[test]** `lt:34-37` (returns a function).
4. **[page]** It wraps the same portable Hono app `serve()` uses, with `hono/aws-lambda`'s `streamHandle`, which adapts the app to Lambda's response-streaming runtime. `lh:1-9,32`, `ap:1-14`, `ha:24,115`. `streamHandle` reads the `awslambda` global at construction time, which the Lambda runtime provides (`lt:5-8`). So importing the handler outside Lambda needs that global stubbed (only matters for a test; **[ref]** or cut).
5. **[page]** Because it is the same app: `GET /healthz` and the flow API under `/api/flows`. `ap:96-97,129-138,162-164`, `old:43`. `/healthz` answers 200 `{ status: "ok" }` once ready, 503 `{ status: "initializing" }` before, 500 `{ status: "error", message }` on a permanent init failure. `ap:129-138`, **[test]** `at:382-405`.
6. **[page]** Options (`ServerAppOptions`): `basePath` (default `"/api/flows"`), `healthPath` (default `"/healthz"`), `servesPush` (default `false`). `ap:27-44`. [ref] `basePath` is interpolated raw into a Hono route pattern, so avoid `:` and `*` (`ap:29-32`). The page may show `basePath` only if the example uses it; otherwise one clause and a link.
7. **[page]** `servesPush` defaults `false`, so on Lambda `GET /api/flows/capabilities` reports `push: null` and `POST /api/flows/users/:userId/stream` answers 404 `{ error: "This host serves no push" }`. A client reads on its timer instead. `ap:36-44,150-160`. [ref] The page may say Lambda serves no push, one clause.
8. **[page]** A cold start does not return 503 to the invoke that triggers it. The API waits for store init (500 if init failed), because a serverless host has no `/healthz` gate. `ap:140-148`, **[test]** `at:382-401` ("the API waits for init rather than returning a spurious 503"). A raw router is ready at once. `ap:118-125`.
9. **[page]** Streamed replies need two things: the handler (step 1) and the Function URL in `RESPONSE_STREAM` invoke mode. `lh:5-8,24-27`, `old:49-52`, `rd:109-110`, `dep:21`. The doc comment says SSE streams incrementally "rather than buffering to the 6 MB limit" (`lh:7`). So on a buffered invoke mode the response is held until the function finishes (`old:61`), and a buffered Lambda response has a 6 MB cap (`lh:7`; the 6 MB figure is the repo's own doc comment, **[verify]** against AWS). Page may state: without `RESPONSE_STREAM` the events arrive together, after the flow ends.
10. **[page]** The CLI to set it: `aws lambda create-function-url-config --function-name my-flow-app --auth-type NONE --invoke-mode RESPONSE_STREAM`. `old:54-59`. **[verify]** flag spelling against the AWS CLI; I did not run it. `lh:8` and `rd:110` spell the mode `RESPONSE_STREAM`; `lh:26` spells the property `invokeMode`.
11. **[page]** Heartbeats: the engine writes a `: ping` SSE comment frame on every live and GET-attach stream, default every 15 s. `ov:157-159`. Config: `createFlowState({ defaultSseHeartbeatMs })` (`fst:255`), per flow `defineFlow({ request: { sseHeartbeatMs } })` (`ov:159`). `0` disables (cited in `docs/contributing/docs-revamp/pages/build/deploy/vercel.facts.md` as `createFlowApiRouter.ts:163`; **[verify]** by reading that file before use). The adapter adds nothing. Whether a ping defeats a Lambda or proxy idle timeout is **[verify]**; do not claim it.
12. **[page]** The limits that bound a stream, all Lambda's: the function timeout, and what sits in front of the Function URL. When the timeout fires mid-reply the stream is cut. That is `old:137-139` (platform behaviour, **[verify]**). Say it as a limit: a reply that outlives the function's timeout is cut off, so a flow that streams for minutes belongs on a long-lived host (Railway, Docker). `old:10,139`, `dep:21,24`. The repo has no code that raises or reads the timeout; the number to set is the reader's.
13. **[page]** An API Gateway stage in front of the function can re-buffer the stream, so call the Function URL directly. `old:135`. **[verify]** AWS behaviour. Soften: "If events arrive together, check the invoke mode and that no gateway sits in front."
14. **[page]** Work that continues after the response (fire-and-forget action execution, scheduled dispatches) can be frozen once the function returns. The platform hook is `createFlowState({ onBackgroundWork })` (`fst:208-217`), written for Vercel's `after`. **[verify]** that Lambda has an equivalent; no Lambda-specific use exists in the repo (grep of `packages/*/src` finds Lambda only in `packages/node`). Keep off the page or a single line pointing to `docs/server/background-work.md`. [ref]
15. **[page]** `detectInterruptedOnStartup: false` skips the startup check for requests left interrupted; the type comment says to disable it on serverless because background queries on cold start can exhaust the pool. Default `true`. `fst:219-224`. [ref] Cost of turning it off, and the `POST /api/flows/users/:userId/check-interrupted` recovery route, are in the Vercel sheet Q2.8 (`vercel.facts.md`, same file in this folder). One sentence and a link if the page includes it.
16. **[cut]** Raw-CLI memory and timeout advice (`old:67-72`) is AWS guidance; keep one line each (set a timeout longer than your longest flow), or link AWS docs.
17. **[page]** Security: the flow API takes `userId` from the request, and the framework treats it as authoritative; verifying the caller is the app's job. `au:7-10,48-50`. So a Function URL with `--auth-type NONE` lets any caller act as any user and run billed model calls. `old:63`. Put IAM auth, an API Gateway authorizer or your own auth proxy in front, or give `createFlowState` a `resolvePrincipal` (`fst:252-256`, `au:25-31`). `NONE` is for a smoke test. **[page]**. Which AWS auth mode keeps SSE working is **[verify]**; do not claim.
18. **[ref]** `resolvePrincipal` detail, session binding refusals (`UserBindingMismatchError`), `DEFAULT_ORG_ID`: `au:33-60`. Link to the authentication page; do not explain.

## Q2. Which store? [answers Q2]

1. **[page]** The default store, `inMemoryStores()`, loses everything when the process exits. `dep:44`. On Lambda a process lives only as long as the execution environment, so nothing recorded survives. Page states: do not ship the default.
2. **[page]** The filesystem store writes to disk and "works on container platforms but not serverless"; SQLite is "No" for serverless and "single-writer". `dep:44,50-52`. Lambda's filesystem is per-invocation and discarded (`old:78`; **[verify]** AWS detail: `/tmp` is ephemeral and per execution environment). Page: use a database the function reaches over the network.
3. **[page]** `postgresStores({ connectionString })` from `@flow-state-dev/store-postgres`, passed as `stores: { default: { primary: postgresStores(...) } }`. `po:62-76`, `pgd:19-33`, `pgr:256-268`. Postgres is the documented option for multi-instance production (`docs/configuration/runtime.md:113`). `pgr:256-268` returns a `StoreAdapter` with capabilities `["primary", "bus"]`.
4. **[page]** The connection pool is created on first resolve and memoized, so open the store at module scope and warm invocations reuse it. `pgr:259-262` (`registry ??= await createPostgresStores(options)`), `old:78`. Router resolution is lazy: `flowState.getRouter()` is called when `createServerApp` runs, i.e. at import (`ap:105-109`), and a request that arrives before init settles waits for it (Q1.8).
5. **[page]** Connection options: `connectionString` (falls back to `FSD_DB_URL` then `DATABASE_URL`), `max` pool size (default 10). `pgr:38-46`, `pgd:26-29`. `pgr:143-152` throws "no connection string provided" if neither is set. [ref] full options: `packages/store-postgres/src/types.ts`.
6. **[page]** Schema creation runs about 30 idempotent DDL statements plus an advisory lock every time `createPostgresStores` is called, so once per Lambda cold start. To skip it, run the schema creation once as a deploy step and pass `skipSchemaInit: true`. `pgd:266-285`, `pgr:60-63`, `packages/store-postgres/src/types.ts:49`. The deploy-step snippet is in `pgd:271-276`.
7. **[page]** Live tail on Postgres. By default `postgresStores({ connectionString })` auto-creates a second pool for `LISTEN` (`max` 10, override `LIVE_TAIL_POOL_MAX`) `pgd:343`. Each concurrent Lambda execution environment holds its own pools, so concurrency multiplies database connections. This is arithmetic from `pgd:343` plus Lambda's one-process-per-environment model (**[verify]** the Lambda half). A transaction-mode pooler does not deliver `LISTEN` notifications; the store detects it and falls back to a once-a-second read. `pgd:387-391`. Pass `liveTailPool: null` to disable LISTEN and poll. `pgd:343,406`. State: on Lambda, pass `liveTailPool: null` if you connect through a pooler; one clause, link to the store-postgres README (`pgd` "Cross-process notices"). **[ref]**
8. **[page]** Stored parts the four questions apply to, the page stores nothing itself; the store holds what the app records:
   - **Sessions, requests, items, resource state** — owner: the flow that created them, by `userId` (and org); visible to: the principal that owns them, session binding refuses another `userId` (`au:33-37`); stored: the `primary` store (Postgres here); how many: one per session or request created. [ref] `docs/persistence/overview.md`.
   - **Function config and `DATABASE_URL`** — owner: the reader's AWS account; visible: anyone with IAM access to the function; stored: Lambda environment variables (`old:96`); one per function. Secret hygiene on Lambda env vars is AWS advice, **[verify]**; do not state beyond "set them on the function".
   - **The deployment zip** — owner: the reader; stored: Lambda; one per function version. Not a framework part; one clause at most.
9. **[contradiction resolved]** `po:68` (`flows: { myFlow }`) and `old:31` (`@flow-state-dev/vercel/store`) are corrected above; do not copy them.

## Steps the page may carry

1. **[page]** Prerequisites: Node.js 22+ (`pk:69-71` engines; `old:16`; **[verify]** the exact `engines` range before quoting), the AWS CLI configured, `@flow-state-dev/node` installed, an external Postgres, a model provider key. `old:14-20`. Note `createLambdaHandler`'s peer import `@flow-state-dev/engine` for `createFlowState` (`old:30`). `@hono/node-server` and `hono` are dependencies of `@flow-state-dev/node` (`pk:76-77`); a bundler pulls `hono/aws-lambda` from `hono`.
2. **[page]** The handler file, a complete example (every name imported or declared):
   ```ts
   import { createLambdaHandler } from "@flow-state-dev/node/aws-lambda";
   import { createFlowState } from "@flow-state-dev/engine";
   import { postgresStores } from "@flow-state-dev/store-postgres";
   import helloChat from "./flows/hello-chat/flow";
   // flows takes an array; postgresStores reads the URL you pass
   const flowstate = createFlowState({
     flows: [helloChat],
     models: { default: "openai/gpt-6-luna" },
     stores: { default: { primary: postgresStores({ connectionString: process.env.DATABASE_URL }) } },
   });
   export const handler = createLambdaHandler(flowstate);
   ```
   Placement per the layout: `src/handler.ts`, flow at `src/flows/hello-chat/flow.ts` exporting a default flow instance (`ex:77-96`, `kind: "hello-chat"`). `models: { default: ... }` is in `old:36`, and `createFlowState` auto-detects providers from env vars such as `OPENAI_API_KEY` (`examples/hello-chat/fsdev.config.ts:6-10`); **[verify]** the `models` option shape in `fst` before keeping it; dropping it is safe because of the auto-detect. **Type-check this example against the package source in pass 4.**
3. **[page]** Bundle and zip, then `aws lambda create-function` with `--runtime nodejs22.x --handler handler.handler --zip-file fileb://function.zip --role ... --timeout 60 --memory-size 256 --environment "Variables={...}"`. `old:84-97`. **[verify]** AWS CLI flags; the page should not reprint secrets, use a placeholder. `handler.handler` is file `handler`, export `handler`. Bundler is the reader's choice (`old:84`).
4. **[page]** Verify against the Function URL: `GET /healthz`; `GET /api/flows` lists flows; `POST /api/flows/hello-chat/actions/chat` with `{"userId": "test", "input": {"message": "Hello"}}`; stream with `curl -N .../api/flows/hello-chat/requests/REQUEST_ID/stream`. `old:103-121`. Routes exist: `packages/engine/src/routes/router.ts:130` (`POST /:flowKind/actions/:actionName`), `:199` (`GET /:flowKind/requests/:requestId/stream`). `GET /api/flows` flow listing: `old:112`, `vercel.facts.md` Q1.8 (**[verify]** the list route in `router.ts` before keeping). The `curl -N` check is the page's streaming test: events should arrive over time; if all at once, the function is buffering (Q1.9, Q1.13). `old:123`.
5. **[page]** For anything past a first deploy, use SAM, CDK or Terraform; the pieces are the same: a Node 22 function, a Function URL in `RESPONSE_STREAM`, environment variables. `old:99`. AWS tooling; one sentence.

## Links the page may use (Next)

- `./vercel.md` (Vercel recipe) and `./railway.md`, `./docker.md` for the long-lived alternative. `docs/contributing/docs-revamp/pages/build/deploy/`.
- Host adapters, for choosing between adapters: `ha`. Authentication: `au`. Streaming and heartbeats: `ov:157-159`. Connection resilience: `apps/docs/docs/server/connection-resilience.md`. Postgres store: `pgd`.
- `../reference/runtime.md` for `createFlowState` options (`defaultSseHeartbeatMs`, `onBackgroundWork`, `detectInterruptedOnStartup`).

## Cut from `old`

- The "SSE arrives all at once" and "times out mid-stream" troubleshooting sections repeat Q1.9, Q1.12 and Q1.13; fold them into steps, not a section.
- The "Cold starts" subsection (`old:129-131`): provisioned concurrency and a "1-2s" figure are AWS-side and unverified; keep at most one clause that the first request after idle pays store init (Q1.8, Q2.6).
- `vercelPostgresStores` import (see contradictions).

## Not observable, left off

- End-to-end streaming through a real Function URL: validated outside CI (`lt:5-8,32-33`).
- Whether a client disconnect stops the function (Q verify above).
- Cost and memory sizing.

## Revise round 1 (page state)

- The handler example uses `postgresStores` from `@flow-state-dev/store-postgres` with `connectionString: process.env.DATABASE_URL`, `flows: [helloChat]`, and imports `./flows/hello-chat/flow.js`; the verify curls name `hello-chat` and action `chat` to match. Closes the two contradictions above.
- The page no longer names Hono, `streamHandle`, `serve()` or "a built router" (Q1.2 and Q1.4 stay as facts for the Reference; the page says `app` is the `FlowState` `createFlowState` returns).
- The "1-2s cold start" figure and the client-disconnect claim are off the page's own prose. The page only links the runtime reference for what a disconnect does (Q1 verify item above).
- Endpoint table, auth resolver, request lifecycle and store-persistence detail live in the Reference (`/reference/runtime`, `/docs/server/authentication`, `/docs/persistence/overview`); the page keeps one sentence and a link each.

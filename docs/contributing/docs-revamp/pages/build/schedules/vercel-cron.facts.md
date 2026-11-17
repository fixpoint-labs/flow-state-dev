# Facts for Run on a schedule with Vercel Cron (B-15, recipe)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests and `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no changeset. Nothing here was run against a deployed Vercel project; behaviour is read from source and tests, marked **[source]** or **[test]**. This sheet replaces an earlier one written against `@flow-state-dev/vercel/schedules` (`createGetToPostCronShim`, `createScheduleTickHandler`), which no longer exists.

Paths from the repo root:

- `vs` = `packages/vercel/src/scheduler.ts` · `vt` = `packages/vercel/test/scheduler.test.ts` · `vo` = `packages/vercel/test/schedule-dispatch-org.test.ts`
- `vi` = `packages/vercel/src/index.ts` · `vp` = `packages/vercel/package.json`
- `ty` = `packages/engine/src/flowstate/types.ts` · `cf` = `packages/engine/src/flowstate/createFlowState.ts`
- `tk` = `packages/engine/src/execution/schedule-tick.ts` · `host` = `packages/engine/src/transports/host/createInboundTransportHost.ts`
- `bs` = `packages/engine/src/transports/auth/createBearerSecretPrincipalResolver.ts`
- `rt` = `packages/scheduled/src/routes.ts` · `fr` = `packages/scheduled/src/firedRecords.ts` · `st2` = `packages/scheduled/src/scheduledTime.ts`
- `sc` = `packages/core/src/types/schedules.ts` · `it` = `packages/integration-tests/src/scenarios/schedule-tick-across-processes.test.ts`
- `ks` = `apps/kitchen-sink` (the one example): `ksc` = `fsdev.config.ts`, `ksr` = `app/api/cron/schedules/route.ts`, `ksv` = `vercel.json`, `ksf` = `flows/weekly-digest/flow.ts`
- `sch` = `apps/docs/docs/server/scheduled.md` · `auth` = `apps/docs/docs/server/authentication.md` · `vr` = `packages/vercel/README.md`

Legend: **[page]** the page states it. **[ref]** belongs on `reference/schedules`; the page links, does not state it. **[verify]** not confirmable from the repo (a Vercel-side fact); keep it off the page or hedge it. **[stale]** an existing page says otherwise. **[Q1]** answers "Who is the user of a scheduled run?" **[Q2]** answers "What stops a stranger calling the endpoint?"

## Read this first: existing pages that now contradict the code

The reader of B-15 may arrive from these, so the page must not echo them, and the cutover reconciliation must fix them.

1. **`apps/docs/guides/scheduled-vercel-cron.md:19-52, 138-223`** (the page B-15 replaces) and **`vr:164-193`** document `createGetToPostCronShim` and `createScheduleTickHandler` from `@flow-state-dev/vercel/schedules`. That entry is not in the package's exports (`vp:30-47` lists `.`, `./pg`, `./store`, `./next`) and the file is not in `packages/vercel/src/`. The one surface is `vercelScheduler` (`vi:11`). **[stale; the code wins]**
2. **`sch:472-475`** says "No framework-side scheduler loop ... Wire up Cloud Scheduler, EventBridge, Vercel Cron, or a small `setInterval` yourself", and **`apps/docs/guides/keeping-a-flow-running.md:106`** says "FSD doesn't run a clock". With no `scheduler` option the app runs a local cron each minute (`ty:420-428`), and `vercelScheduler` is the adapter for hosts with no long-lived process (`vs:2-4`). **[stale]**
3. **`sch:320-323`** and **`sch:314-332`** pass `principal: { userId: "system" }` with no `orgId`. A configured resolver that returns no organization is refused with 401 (`host:260-266`, `auth:60-64`). The resolver in the page must name an `orgId`, as `ksf:124-127` and `vo:88-91` do. **[stale]**
4. **`ksf:123-128`** builds the bearer resolver inside the callback with `process.env.CRON_SECRET ?? ""`. The resolver throws a plain `Error` on an empty secret (`bs:57-61`). Not reachable on Vercel through the cron route, because the route answers 401 before any dispatch when the secret is empty (`vs:55-56`, `vt:64-72`), but a page example should build the resolver once at module top level so a missing secret fails at start-up. **[source; page: example builds it once, outside the callback]**

## The surface, in one picture

5. `vercelScheduler(options?)` returns an object with two parts: `start(ticker)`, which `createFlowState` calls, and `route(req: Request): Promise<Response>`, the handler one Vercel Cron entry calls (`vs:31-47`). Exported from the package root: `import { vercelScheduler } from "@flow-state-dev/vercel"` (`vi:11`, `vp:31-34`). Types `VercelScheduler`, `VercelSchedulerOptions` also exported (`vi:12`). **[page]**
6. `VercelSchedulerOptions` has one field, `secret?: string`. Default is `process.env.CRON_SECRET`, read on each call (`vs:22-29, 55`). **[page]** Reading it per call means the env var may be set after module load. **[ref]**
7. `route` is unbound: `export const GET = scheduler.route` is the intended use (`vs:37`, `vs:54` arrow property; `ksr:9`). **[page]**
8. Each call to `route` runs the app's schedule tick once. The tick fires every due schedule, static and dynamic, of every flow, not one schedule (`vs:7-8`, `tk:5-13`). So one cron entry serves every schedule of the app. **[page]**
9. The tick dispatches each fire as a network POST to the deployment the cron call reached: the base URL is `new URL(req.url).origin` (`vs:61`; `vt:37-46` asserts `baseUrl: "https://my-app.vercel.app"`). Each fire is its own function invocation, not a share of the tick's (`vs:9-11`; `vt:1-7`). **[page]**
10. The dispatch is `POST <origin>/api/flows/<flowKind>/schedules/<scheduleId>/dispatch` with body `{ "nominalFireTime": "<ISO time>" }` and `Authorization: Bearer <secret>` when a secret is set (`tk:165-185`). **[page: one sentence; the path is observable in logs]** The path assumes the scheduled transport is mounted under `/api/flows` (`tk:44`; `sch:46-56` mounts the Vercel handler at `app/api/flows/[...path]/route.ts`). **[page: the recipe says to keep the flows route where it is]**
11. The same secret goes on every fire: the route passes its own `secret` to `tick({ baseUrl, secret })` (`vs:61`; `ty:128-136`), so an app that sets `secret` in code, with no `CRON_SECRET` env var, still has its fires authenticated (`vo:139-148`). **[page]**

## Declare the schedule

12. A static schedule is an entry on `defineFlow({ schedules: { static: { "<id>": { cron, block } } } })`. `block` is the handler block that runs; `cron` is a 5-field POSIX cron (`sc:111-150`, `sc:316-322`, `sc:362`; `ksf:140-146`; `sch:34-56`). A cron with other than five fields is refused when the flow is registered (`sc:362-366`). **[page]**
13. `defineScheduleBinding({ cron, block, description })` is a compile-time convenience; a plain object works (`sc:452-455`; `sch:58-63`). Imported from `@flow-state-dev/core`. **[page: use the plain object or the helper, one of them]**
14. A scheduled handler is not listed in `actions` and has no HTTP or MCP surface (`ksf:137-139`; `sch:58-63`). **[page: one clause]**
15. `timezone` is an IANA name; default `"UTC"` (`sc:181-185`; `tk:103`; `rt:206`). An unknown zone is refused at registration (`sc:371-375`). `enabled: false` skips the schedule (`sc:207-212`; `tk:102`). `onOverlap` defaults to `"skip"`: a fire that finds the previous run of the same schedule still going answers 200 `{ status: "skipped", reason: "in_flight" }` (`rt:166-178`; `sch:352-358`). **[ref]**
16. Dynamic schedules (`schedules.resolve`, `schedules.index`) fire from the same tick (`tk:5-13`, `tk:106-109`). The page says so in one sentence and links to the dynamic-schedules page. **[page: one sentence; ref]**

## `scheduler: vercelScheduler()` and its one route

17. The app is told with `createFlowState({ scheduler })`; `scheduler?: SchedulerAdapter | false` (`ty:428`; `cf:431-432`; `vo:101-107`; `ksc:238`). `createFlowState` calls the adapter's `start(ticker)` once at construction, and `dispose()` calls its `stop` before the stores close (`ty:140-147`; `cf:421-433`, `cf:493-497`). **[page]**
18. `scheduler` omitted: the built-in local cron ticks each minute in a process that builds the router or starts a job queue's processing, when a registered flow declares static schedules or an index (`ty:420-428`). `false`: nothing fires the tick; an adapter fires it itself. **[page: why the recipe passes it only on Vercel; ref for the conditions]** The kitchen-sink passes the scheduler only when `process.env.VERCEL` is set, so `next dev` and `fsdev dev` keep the local cron (`ksc:114-118, 238`). **[page]**
19. The scheduled endpoint needs no line: the router mounts it on every app, under `/api/flows` (`packages/engine/src/transports/scheduled/createScheduledEndpointAdapter.ts`). **[page: nothing to add]** The Vercel handler mount is `createVercelNextHandler(flowstate)` at `app/api/flows/[...path]/route.ts` (`apps/kitchen-sink/app/api/flows/[...path]/route.ts:1-4`; `sch:50-56`). **[page]**
20. The cron route file: `export const GET = scheduler.route;` plus `export const dynamic = "force-dynamic"` and `export const runtime = "nodejs"` (`ksr:9-12`). `runtime = "nodejs"` matters because `scheduler.ts` imports `node:crypto` (`vs:18`). **[page]**
21. The route answers: **200** `{ "dispatched": <number> }` (`vs:62`); **401** `Unauthorized` for a missing, wrong or empty secret (`vs:56`); **500** `Server misconfigured: pass this scheduler to createFlowState({ scheduler })` when the scheduler was never passed in or has been stopped (`vs:57-59`; `vt:86-102`); **500** `Schedule tick failed` when the tick rejects (`vs:63-66`; `vt:74-84`). **[page: the check step; the 500 rows [ref]]**
22. `dispatched` counts fires attempted, not fires accepted: a fire the endpoint answered 404 or 400, or whose request threw (status `0`), is counted (`tk:143-155`; `vs:62`). The count is not a success count. **[page: one sentence in the check step]**
23. The tick rejects only when a schedule index's claim does, after it has fired everything else; the next cron beat retries those rows because they are still pending (`tk:84-88`, `tk:156`; `vs:15-17`; `vt:74`). **[ref]**
24. The tick fires at most 100 index entries per index per beat, and at most 10 dispatches in flight at once (`tk:75-78, 112, 144`). **[ref]**

## The one cron entry and its secret

25. `vercel.json` carries one entry: `{ "crons": [{ "path": "/api/cron/schedules", "schedule": "*/15 * * * *" }] }` (`ksv:1-5`). The path is the route file's URL. **[page]**
26. The cron entry's cadence is the floor on how soon a schedule can fire. A static schedule fires on the first beat after its scheduled time, for the scheduled time, not the beat's time: the tick finds, per schedule, its latest scheduled time that falls after the last tick and at or before now (`tk:7-9, 101-105`). A `0 9 * * 1` schedule behind a `*/15` beat fires at 09:00 to 09:15, with `nominalFireTime` 09:00. **[page]**
27. After an outage a schedule fires once, late, for the latest time it missed; earlier missed times are dropped (`tk:15-16`; `it:106-124` asserts 09:20 and not 09:05, 09:10, 09:15). **[page: one sentence]**
28. A first tick with no last-tick record looks back one interval (a minute): a schedule added today never fires a time long past on deploy (`tk:18-20, 34-35, 93`). **[ref]**
29. A schedule can fire only for a time the cron entry's beat reaches. A beat coarser than a schedule's own cadence (a daily beat, an every-minute schedule) fires that schedule once per beat for its latest time, not once per scheduled time (`tk:15-16, 101-105`). **[page: one sentence, inferred directly from 26 and 27]**
30. `CRON_SECRET` is the secret. Set it as an environment variable on the Vercel project, and Vercel Cron sends it as `Authorization: Bearer <value>` on each cron request (`apps/docs/guides/scheduled-vercel-cron.md:84-85`; `vs:24-25`). The Vercel half of that sentence is stated on the existing page; **[verify against Vercel's documentation]**.
31. The route compares the header to `Bearer <secret>` in constant time (`vs:68-95`, `vs:13-14`). An empty or unset secret refuses every call, so a missing `CRON_SECRET` never opens the route (`vs:72-76`; `vt:64-72`). **[page: Q2]**
32. A wrong secret, a prefix of the secret, and no `Authorization` header each answer 401 and fire nothing (`vt:48-62`). **[page: Q2]**
33. The cron route's secret protects the cron route only. The dispatch endpoint it calls is the framework's ordinary scheduled endpoint, and it is protected by whatever `authentication.resolvePrincipal` the flow (or the host) configures for the `scheduled` source, not by `vercelScheduler` (`rt:71-99`; `vs:24-26`: the fire "carries the same secret"). **[page: Q2. This is the load-bearing fact of the page: the recipe's second secret check lives in the flow]**
34. If no `resolvePrincipal` is configured anywhere, the app runs unauthenticated under the reserved development organization and warns once (`host:244-257`; `auth:66-68`). On that setup the dispatch endpoint accepts any caller. **[page: Q2, one sentence: configure a resolver before deploying]**
35. The flow checks the same secret with `createBearerSecretPrincipalResolver({ secret, principal })` from `@flow-state-dev/engine` (`bs:54-88`; `sch:306-332`; `ksf:123-128`). It reads `Authorization: Bearer ...` case-insensitively on the header name, compares in constant time, and returns `principal` on a match (`bs:72-87`). A wrong token throws `PrincipalResolutionError` with status 401 (`bs:80-84`). A missing or non-Bearer header returns `null` (`bs:76-77`; `packages/engine/test/transports/createBearerSecretPrincipalResolver.test.ts:50-65`), which a configured resolver cannot use to get in, because `null` is refused (`auth:63-64`). **[page: Q2]**
36. `secret` must be a non-empty string and `principal.userId` a non-empty string, or the factory throws at call time (`bs:57-69`). Build it at module top level so the app refuses to load without `CRON_SECRET`. **[page]**
37. Branch the resolver on `ctx.source === "scheduled"` so ordinary HTTP traffic keeps its own resolver: `resolvePrincipal: async (ctx) => ctx.source === "scheduled" ? scheduledResolver(ctx) : <your HTTP resolver>(ctx)` (`ksf:122-131`; `sch:334-345`; `rt:75-76` and `scheduled-transport` source `"scheduled"`: `SCHEDULED_TRANSPORT_SOURCE` from `@flow-state-dev/engine`). **[page]** Replacing the resolver outright breaks the flow's HTTP routes (`sch:347-348`). **[page: one clause]**
38. Rotating the secret: change `CRON_SECRET` on the Vercel project and redeploy. The route reads it per call (`vs:55`), and the flow's resolver reads it when its module loads (fact 36), so both sides change together on the new deployment. **[verify the redeploy requirement for Vercel env changes; keep the sentence as "change it and redeploy" or cut]**

56. A request to the dispatch endpoint with no `Authorization` header: the bearer resolver returns `null`, so no organization is resolved, and a configured resolver that names none is refused with 401, even when `authentication.defaultUserId` supplies a user (`host:289-340`, `auth:60-64`). So `defaultUserId` does not open a scheduled flow to header-less calls. **[page: one sentence in step 3]**
57. Rotation: the flow's resolver reads `CRON_SECRET` when its module loads (fact 36), so a changed value takes effect on a new deployment. The page says "change it and redeploy". **[verify the Vercel-side env behaviour]**

## Who is the user of a scheduled run? (Q1)

39. A scheduled run has a user, and it is not a person who clicked anything. It is the principal the flow's resolver returns for the `scheduled` source (the gateway principal), unless the schedule names its own `principal` (`rt:181-204`; `sc:156-178`; `sch:200-216`). **[page: Q1]**
40. For the page's setup, that principal is whatever `createBearerSecretPrincipalResolver` was given: `{ userId: "system", orgId: "..." }` (`ksf:124-127`). Inside the handler, `ctx.user.identity.userId` is that user id (`ksf:39`). **[page: Q1]**
41. The principal must carry an organization. A configured resolver that returns none, or the reserved `DEFAULT_ORG_ID`, is refused with 401 and the fire does not run (`host:260-272`; `auth:60-66`). **[page: Q1. The example's principal names an `orgId`; one clause on why]**
42. A static schedule may set `principal: { userId, orgId? }`; the run is then that user, and an omitted `orgId` falls back to the gateway's (`sc:156-178`; `rt:197-204`). A dynamic schedule's principal comes from the stored row, which names its own organization, and never falls back to the gateway's (`sc:168-176`; `rt:185-196`; `vo:164-170`, `vo:172-183`). **[page: one sentence on `principal`; dynamic detail [ref]]**
43. A flow with `requireUser: true` (the default) needs a `userId` on the run, which the system principal supplies. `requireUser: false` opts a flow out of user scope entirely and is refused when the flow declares user-scope state (`auth:134-137`). **[page: one clause or cut]**

## Check a run

44. The cron route itself can be called by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<deployment>/api/cron/schedules`. A good call answers 200 `{"dispatched":N}` (`vs:62`; `vt:37-46`). It runs a real tick, not a dry run: fires due since the last tick go out. Calling it again does not double-fire, because each scheduled time fires at most once (`rt:9-15`, `rt:225-230`; fact 45). **[page]**
45. Once per scheduled time: the dispatch endpoint records, per schedule, the latest scheduled time it fired, with a compare-and-set in the host's store, before the handler runs. A second fire of the same time answers 200 `{ status: "duplicate" }`; a time earlier than one already fired is also a duplicate (`rt:9-15, 205-230`; `st2:1-14`, `st2:157-165`; `sch:371-420`). So Vercel invoking the route late or twice does not run a schedule twice. **[page: one sentence; ref for the mechanism]**
46. A fire that is accepted answers 202 `{ status: "accepted", scheduleId, origin, requestId }` and the handler runs after the response (`rt:324-331`). The route's body does not carry these statuses, only the count (fact 22). **[page: the reader sees the run in the function logs and, for the handler's own output, wherever the handler writes; ref for the 202 body]**
47. On Vercel, a run that continues after the 202 needs the function kept alive. The kitchen-sink wires `onBackgroundWork: (promise) => after(() => promise)` from `next/server` when `NEXT_RUNTIME` is set (`ksc:208-216`); `vr:51` describes the option for scheduled dispatches. Without it the function can freeze after the response. **[page: a prerequisite line or a link to deploying-to-vercel; the setting itself belongs to that page]**
48. A non-2xx answer from a dispatch is not retried by the framework: the tick drops it (`tk:25-26`, `tk:146-153`). At-most-once is the contract (`sch:471-479`). **[page: one sentence in the limits]**
49. The handler can be checked in isolation by POSTing the dispatch endpoint with the bearer, `curl -X POST https://<host>/api/flows/<flowKind>/schedules/<scheduleId>/dispatch -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"nominalFireTime":"<a scheduled time>"}'` (`sch:299-304`). The body time must be a scheduled time of the cron within the current period, else 400 or a `duplicate` with `reason: "stale"` (`rt:206-222`; `sch:261-266, 393-400`). **[ref; the page may link]**

## Stored data: the four questions

The page's setup stores nothing of the reader's own. Two records exist because it runs; the page names the first and links to Reference for the second.

| Part | Who owns it | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| The schedule itself (static) | The flow's author: it is code in `defineFlow`, not stored | Anyone reading the source or the scheduled listing endpoint (`sch:480-482`) | Not stored | One per entry in `schedules.static` |
| The last-tick record | The engine: the tick is its only writer (`tk:18-19`, `tk:199-202`) | Not a user: it is in an organization cell no organization is given, id `__fsd_system__`, key `schedule-tick/last`, holding `{ at: <ms> }` (`tk:38-42`, `tk:193-202`) | The app's resource-state store (`stores`), written before the fires go out so a tick that dies part way does not owe those times twice (`tk:135-141`) | One per app and store |
| Each schedule's fired record | The scheduled transport's dispatch endpoint (`rt:9-15`) | The user cell of the principal the schedule runs as, beside any row of that user's own; it is a resource under `scheduled-fires/<flowKind>/<scheduleId>` (`fr:1-14`; `st2:148-155`). **[verify whether a user's own resource listing shows it; `FIRED_RECORDS_PATTERN` is exported so a flow can delete it with its schedule, `fr:5-6`]** | The app's resource-state store (`st2:15-19`) | One per schedule per principal. Cross-process safety needs a store with cross-process compare-and-set (SQLite, Postgres); memory and filesystem stores hold per process only (`st2:15-22`) |

50. **[page]**: the reader is told once that the engine keeps a record of when it last ticked and the endpoint keeps one of what it last fired, and that on a memory or filesystem store the once-per-time guarantee holds per process only. The row-level detail is **[ref]**.

## Limits a reader would assume otherwise

51. One cron entry, one route, every schedule. The recipe never adds a `vercel.json` entry per schedule (fact 8). **[page]**
52. The framework does not retry a failed dispatch and does not backfill missed times (facts 27, 48). **[page: one sentence]** The old page's "Vercel Cron fires once per slot, no retries" is a Vercel claim **[verify; keep off the page]**.
53. Vercel plan limits (how many cron entries, how often a Hobby project may fire) are Vercel's, not in the repo. The old page states "Pro: 40 per project ... lower on Hobby" "at time of writing" (`apps/docs/guides/scheduled-vercel-cron.md:123-125`). **[verify; page: one sentence pointing at Vercel's cron documentation, no numbers]** What the repo supports: the beat sets the floor on lateness (fact 26), and `*/15 * * * *` is what the kitchen-sink ships (`ksv:3`).
54. Vercel Cron does not run locally, so locally the app's own cron fires the schedules each minute and the route is not used (`ksr:3-5`; `ty:420-428`; `ksc:114-118`). **[page: one sentence; the "Vercel Cron does not run in vercel dev" claim is Vercel's, **[verify]**]**
55. Vercel Cron's own schedule is read in UTC; a flow schedule's `timezone` applies to when the flow's cron is due, independent of the beat (`tk:103`; `rt:206`). The first half is a Vercel fact **[verify]**.

## The one example

The page's example is the kitchen-sink's `weekly-digest` flow, trimmed to the recipe, in the layout of `user-docs.md` → "Code examples" (`fsdev.config.ts`, `src/flows/<flow>/flow.ts`, `src/app/...`). Files the recipe shows, and what each imports:

- `src/flows/billing/flow.ts`: `defineFlow`, `handler` (or `defineScheduleBinding`) from `@flow-state-dev/core`; `createBearerSecretPrincipalResolver` from `@flow-state-dev/engine`; a `schedules.static` entry with `cron` and `block`; `authentication.resolvePrincipal` branching on `ctx.source === "scheduled"`, principal `{ userId: "system", orgId: <the app's org> }`, `requireUser: true` (`ksf:117-146`).
- `fsdev.config.ts`: `createFlowState` with `scheduler`, and no `adapters` line for schedules, and `export const scheduler = vercelScheduler()` (`ksc:118`).
- `src/app/api/cron/schedules/route.ts`: `export const GET = scheduler.route;` + `runtime`, `dynamic` (`ksr:7-12`). The kitchen-sink imports `scheduler` through `@/lib/flowstate`, which re-exports it from `fsdev.config.ts` (`apps/kitchen-sink/lib/flowstate.ts:7`); the page imports from the config, one hop.
- `vercel.json` (`ksv:1-5`).

Name the handler block in its own file under `src/flows/billing/blocks/`, one export named after the file (`user-docs.md` → "Code examples"). All examples type-check against `vs`, `ty:428`, `bs:28-56`, `sc:140-150`.

## Revise round 2 additions

58. `dispatched` is the number of fires the tick sent this beat, so `{ "dispatched": 0 }` is the normal answer when no schedule is due (`vs:62`; `tk:143-155`). **[page: step 4]**
59. The tick posts to each due schedule's dispatch endpoint, `/api/flows/<flow>/schedules/<name>/dispatch` (fact 10). The page names it in the opening. **[page]**
60. The example flow file ends `const supportFlow = defineFlow({...}); export default supportFlow();`: `defineFlow` returns a factory and `createFlowState({ flows })` takes the called instance (`ksf:117, 165-167`). **[page]**
61. A header-less call gets 401 whether or not `defaultUserId` is set (fact 56); step 3 states the behaviour only. The organization requirement (fact 41) is stated in step 1. **[page]**

## Revise round 3 additions

62. The page no longer says Vercel Cron does not run under `vercel dev`; whether `vercel dev` sets `VERCEL` is a Vercel fact not confirmable from the repo. The page states only what the code shows: with `VERCEL` unset (as under `fsdev dev` and `next dev`) the config passes no scheduler and the local cron runs each minute (`ksc:114-118, 238`; `ty:420-428`). Supersedes the Vercel-side half of fact 54. **[page]**
63. Step 3 says a wrong or missing secret gets 401 (facts 32, 56). The `defaultUserId` sentence is cut from the page; it belongs in the authentication reference. **[ref]**

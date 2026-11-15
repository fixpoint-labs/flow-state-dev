# Facts: Run on a schedule with Cloud Scheduler (B-16, recipe, 500 words)

Pass 1 fact sheet. Cites only: the existing guide (`apps/docs/guides/scheduled-cloud-scheduler.md`,
the page this one keeps), the existing reference (`apps/docs/docs/server/scheduled.md`,
`.../authentication.md`), exported surface and doc comments, and tests. Paths are from the repo
root. `scheduled` = `packages/scheduled`, `core` = `packages/core`, `engine` = `packages/engine`.
"guide" = the cloud-scheduler guide, "ref" = `apps/docs/docs/server/scheduled.md`.

Where an existing page and the code disagree, the code wins and the row says so; every such row is
repeated under "Corrections to the existing page" at the end and must be fixed in the recipe, not
carried.

Cloud Scheduler's own behaviour (gcloud flags, what it counts as success, how it signs OIDC tokens)
is not in this repository. Rows about it are marked **[external]**: they are carried from the
existing guide and cannot be verified from code. Pass 5 should check them against Google's
documentation or the writer should keep them to what the guide already says.

## Task and outcome

1. The task: have Google Cloud Scheduler call a flow's schedule on a cron, so a static schedule
   (`monthly-invoices` on the `billing` flow) runs its block on the 1st of each month. The framework
   does not run the schedule; the host's scheduler does, by POSTing the dispatch endpoint.
   [ref:94-98; core/src/types/schedules.ts:142-146 ("Display-only — the framework does not run the
   schedule"); scheduled/src/createScheduledTransportAdapter.ts:1-8]
2. Precondition: the scheduled adapter is mounted: `adapters: [createScheduledTransportAdapter()]`
   on `createFlowState`, with the platform route handler on `app/api/flows/[...path]/route.ts`.
   Install is `pnpm add @flow-state-dev/scheduled`. The guide only links to "Scheduled actions";
   it does not show this. [guide:13-14; ref:26-55; scheduled/src/createScheduledTransportAdapter.ts:26-30]
3. Cloud Scheduler is "an HTTP target on a cron" that maps to the transport as POST + bearer
   header + JSON body. **[external]** [guide:8-11]

## Step: declare the schedule on the flow

4. A static schedule is an entry on `flow.schedules.static`, keyed by its id. The entry carries its
   handler inline as `block`, plus `cron`. It needs no entry in `flow.actions`. [ref:61-92;
   core/src/types/schedules.ts:124-146, 221-223; core/src/types/schedules.ts:346-351 (throws if
   `block` is not an object)]
5. A static schedule id: lowercase alphanumerics and dashes, max 64; validated when the flow is
   registered (a bad id, cron, zone, or an `input` that fails the block's schema throws at boot).
   [core/src/types/schedules.ts:313-318, 320-364, 394-403; ref:61-69]
6. `defineFlow` still takes an `actions` map; the tests declare `actions: {}` on a schedule-only
   flow. [scheduled/test/once-per-time.test.ts:38-50]
7. `defineScheduleBinding({ cron, block, description })` is an optional typed wrapper; a plain
   object works too. [core/src/types/schedules.ts:405-415; ref:70-92]
8. Optional fields the recipe may need: `timezone` (IANA, default `"UTC"`), `onOverlap`
   (`"skip"` default, or `"allow"`), `input` (a value or a function), `principal`, `enabled`,
   `description`. [core/src/types/schedules.ts:148-211]
9. The cron must be exactly five fields; a sixth is refused. A `timezone` that is not an IANA zone is
   refused. Static: error at registration. Dynamic: `400 invalid_schedule` at dispatch.
   [core/src/types/schedules.ts:279-281, 320-334; scheduled/src/routes.ts:149-161; ref:411-415]
10. The dispatch endpoint URL is `POST {basePath}/:flowKind/schedules/:scheduleId/dispatch`, with
    `basePath` defaulting to `/api/flows`. So the job's `--uri` for flow `billing`, schedule
    `monthly-invoices` is `https://app.example.com/api/flows/billing/schedules/monthly-invoices/dispatch`.
    [scheduled/src/createScheduledTransportAdapter.ts:14-20, 41-44; ref:247-252, 289-293]
11. Verified example of a static schedule on a flow with a bearer resolver (the shape the page
    should print): `defineFlow({ kind: "billing", authentication: { resolvePrincipal:
    createBearerSecretPrincipalResolver({ secret, principal: { userId: "system", orgId: "org_sys" } }),
    requireUser: true }, schedules: { static: { "monthly-invoices": { cron: "0 0 1 * *", block:
    invoices, onOverlap: "allow" } } }, actions: {} })`. Note `defineFlow(...)` returns a function; the
    test calls it (`defineFlow({...})()`) to get the flow instance. [scheduled/test/once-per-time.test.ts:38-50]

## Step: authenticate the call (shared bearer secret)

12. Every dispatch goes through the flow's `authentication.resolvePrincipal` before anything else
    reads the schedule's record, so an unauthenticated caller can't probe dispatch history.
    [scheduled/src/routes.ts:71-99; ref:306-312]
13. `createBearerSecretPrincipalResolver({ secret, principal, headerName? })`, exported from
    `@flow-state-dev/engine`. It reads `Authorization: Bearer <secret>` (header name configurable,
    default `authorization`), compares in constant time, and returns the fixed `principal` on a match.
    [engine/src/transports/auth/createBearerSecretPrincipalResolver.ts:28-45, 47-88; engine/src/index.ts export]
14. A mismatched token throws `PrincipalResolutionError` with status 401; the endpoint answers
    `401 { error: "unauthorized", message: "Invalid scheduler secret." }`.
    [engine createBearerSecretPrincipalResolver.ts:80-84; scheduled/src/routes.ts:91-98]
15. A missing header, or a scheme that is not Bearer, returns `null` (not a 401): the flow then falls
    back to `defaultUserId` if set, and otherwise `requireUser: true` refuses it with 401.
    [engine createBearerSecretPrincipalResolver.ts:15-16, 49-52, 76-77; ref authentication.md:177-178, 204-213]
16. `secret` must be a non-empty string and `principal.userId` a non-empty string, or the factory
    throws at build time. [engine createBearerSecretPrincipalResolver.ts:57-69]
17. The principal needs an `orgId`. `ResolvedPrincipal` is `{ userId: string; orgId: string }`, and a
    configured resolver that returns no organization, a blank one, or the reserved default org is
    refused with 401. Use a real org id such as `"org_sys"`. [core/src/types/auth.ts:89-92, 126-131;
    ref authentication.md:60-64, 73-75; scheduled/test/once-per-time.test.ts:44]
18. If the flow already has a `resolvePrincipal` for user traffic, branch on `ctx.source ===
    "scheduled"` rather than replacing it, or HTTP routes break. [ref:334-350]
19. The secret lives in an environment variable on both sides (`FSDEV_SCHEDULER_SECRET` in the
    guide); the job sends it as a header. [guide:18-19, 27, 47]

## Step: create the Cloud Scheduler job

20. **[external]** The guide's job: `gcloud scheduler jobs create http monthly-invoices
    --schedule="0 0 1 * *" --time-zone="UTC" --uri=<dispatch URL> --http-method=POST
    --headers="Authorization=Bearer ${FSDEV_SCHEDULER_SECRET},Content-Type=application/json"
    --max-retry-attempts=3 --min-backoff=30s --max-backoff=600s`. [guide:21-31]
21. The job sends no body. A body is optional on the endpoint; with none, the fire counts against
    the latest scheduled time already due. [guide:33-35; scheduled/src/routes.ts:407-409;
    scheduled/src/scheduledTime.ts:151-157; ref:253-263]
22. Why no body: a body carries one field, `nominalFireTime`. Cloud Scheduler sends the same body on
    every run **[external]**, so a fixed `nominalFireTime` is accepted once and, once it is more than
    one period behind the latest due time, answers `200 { status: "duplicate", reason: "stale" }`,
    runs nothing, and logs a warning on the app's server. The way out is to send no body.
    [scheduled/src/scheduledTime.ts:121-132, 187-193; scheduled/src/routes.ts:212-222;
    scheduled/test/once-per-time.test.ts:172-189; ref:397-401]
23. A body that is not valid JSON is read as no body, not an error. [scheduled/src/routes.ts:407-423]
24. A body that carries `idempotencyKey` is refused `400 idempotency_key_removed`; the scheduled time
    is the key. [scheduled/src/routes.ts:101-110; scheduled/test/once-per-time.test.ts:191-200; ref:426-429]
25. A fire counts against the latest scheduled time already due, or one due within the next five
    seconds, never a later one. So a job a second early loses no run and an early or manual POST
    cannot take a time before it arrives. [scheduled/src/scheduledTime.ts:114-118, 135-157; ref:386-390]
26. `--schedule` on the job and `cron` on the schedule are the same expression, held in two places.
    The endpoint reads only the flow's `cron`, to decide which scheduled time a fire is for.
    [scheduled/src/routes.ts:206-207; scheduled/src/scheduledTime.ts:150-157]

## What comes back

27. `202 { status: "accepted", scheduleId, origin: "static", requestId }`: the action was dispatched.
    A 202 means it started, not that it finished. [scheduled/src/routes.ts:325-330; ref:268-284]
28. `200 { status: "duplicate", scheduleId, nominalFireTime }`: that scheduled time (or a later one)
    already fired; nothing ran. [scheduled/src/routes.ts:228-230; ref:391-395]
29. `200 { status: "skipped", reason: "in_flight", requestId }`: the schedule's previous run is
    still in flight and `onOverlap` is the default `"skip"`. With `onOverlap: "allow"` it dispatches
    alongside. The skip claims no time. [scheduled/src/routes.ts:163-179; core/src/types/schedules.ts:186-197;
    ref:352-369]
30. `400` for an invalid schedule id, an invalid schedule, `not_a_scheduled_time`, `not_yet_due`,
    `idempotency_key_removed`; `401` for failed auth; `404` for an unknown flow or schedule (also a
    disabled one); `500` when a resolver or `input` function throws; `503` when the flow is
    unregistered or dispatch fails. [scheduled/src/routes.ts:59-66, 138-161, 209, 252-256, 301-304,
    319-322; ref:268-277]
31. A non-2xx answer to Cloud Scheduler means a retry **[external: Cloud Scheduler retries non-2xx]**.
    [guide:82-83]

## Retries

32. Cloud Scheduler retries per `--max-retry-attempts` and the backoff flags on the job. **[external]**
    [guide:82-84]
33. A retry of a run that already dispatched answers `200 { status: "duplicate" }`; the action does
    not run twice. Each scheduled time fires at most once, however many times it is POSTed: a retry,
    a second host, a restart. [scheduled/src/routes.ts:223-230; scheduled/test/once-per-time.test.ts:90-110;
    ref:371-377]
34. A retry that lands after the next scheduled time has come counts against that next time instead
    (for a body-less fire it is the latest due time). A late retry of a missed time, after the next
    time has fired, is a `duplicate`. [scheduled/src/scheduledTime.ts:151-157;
    scheduled/test/once-per-time.test.ts:113-122, 160-170; ref:391-395]
35. A fire that is not admitted (an overlap skip, a concurrency refusal, a `503`) leaves its time
    unfired, so the retry still runs, unless a later time fired meanwhile. [scheduled/src/routes.ts:231-236,
    295-304, 313-322; ref:403-405]
36. If the action fails after the dispatch returned 202, the dispatch response is unchanged. The error
    lands on the request's `RequestRecord` and shows in DevTool. [ref:279-284] Cloud Scheduler does
    not retry because the call returned 2xx **[external]**. [guide:89-92]
37. The flow-level `onErrored` hook runs on a failed request: it is a field of the flow's `request`
    config (`request: { onErrored }`), and a schedule entry can also carry its own `onErrored` block,
    since a schedule is an `ActionCore`. No scheduled-transport test exercises it; pass 5 should
    check it before the page states it. [core/src/types/flow.ts:205-212, 415-420;
    core/src/types/schedules.ts:140]
38. No backfill and no catch-up: if the scheduler misses a tick, the framework does not run it; a
    retry only runs while no later scheduled time has fired. [ref:476-479]
39. Dead-letter handling and alerting are Cloud Scheduler features, not the framework's. The
    framework's own failure signal is `RequestRecord.status === "errored"`. **[external]** for the
    first half; second half [guide:108-110; ref:282-284]
40. Guarantee scope: the once-per-time guarantee holds across processes on a store with
    compare-and-set across processes (SQLite, Postgres). On the memory store and the filesystem store
    it holds within one process only. Two app instances over a memory store can each run a retry.
    [scheduled/src/scheduledTime.ts:76-82; ref:422-424]

## Stored data: the fired record (four questions)

The one thing this page's setup stores is the schedule's fired record. Nothing else is stored by the
recipe (the schedule itself is code on the flow, the secret is an environment variable, the job and
its retry state live in Cloud Scheduler).

41. **What it is.** One record per schedule: `{ lastFiredAt }`, the latest scheduled time it fired
    (epoch ms). Older records also carry `cron` and `timezone`, read past, never compared.
    [scheduled/src/scheduledTime.ts:195-208]
42. **Who owns it.** The framework's dispatch endpoint writes and reads it; the app's code does not.
    A flow that deletes a schedule can delete the record through a collection over
    `FIRED_RECORDS_PATTERN` (`"scheduled-fires/**"`, user scope). [scheduled/src/firedRecords.ts:1-10;
    scheduled/src/routes.ts:9-15]
43. **Who can see it.** It sits in the user cell of the principal the schedule runs as: the
    schedule's `principal` if it names one, otherwise the gateway principal (the one the bearer
    resolver returns, `system` in the example). Flow code reads it only as a user-scoped resource
    under that principal. [scheduled/src/scheduledTime.ts:210-231; scheduled/src/routes.ts:181-203]
44. **Where it is stored.** In the host's resource-state store (`host.stores.resourceState`), key
    `scheduled-fires/<flowKind>/<scheduleId>`, written with compare-and-set. [scheduled/src/firedRecords.ts:9-26;
    scheduled/src/scheduledTime.ts:245-282; scheduled/src/routes.ts:223-227]
45. **How many exist.** One per (flow kind, schedule id), not one per run: each fire overwrites it
    with a later time. Changing a schedule's cron or zone keeps the record, so a time at or before the
    last one still answers `duplicate`. [scheduled/src/scheduledTime.ts:245-262; ref:407-409]

## Time zones

46. `--time-zone` on the job is the zone Cloud Scheduler evaluates its cron in. **[external]** [guide:96]
47. The flow's `schedule.timezone` (default `"UTC"`) is NOT just metadata: the endpoint evaluates the
    schedule's `cron` in that zone to name the scheduled time a fire counts against, and for the
    five-second tolerance and the stale check. A zone that is not IANA is refused.
    [scheduled/src/routes.ts:205-211; scheduled/src/scheduledTime.ts:89-111, 150-185;
    core/src/types/schedules.ts:329-334]
48. So set `timezone` on the schedule to the same zone as the job's `--time-zone`, and write the same
    cron in both. The code does not compare the two; a mismatch changes which scheduled time each
    fire is counted against. [scheduled/src/routes.ts:206-211]
49. The resolved zone is recorded on the request as `metadata.schedule.timezone`, alongside
    `scheduleId`, `origin`, `cron`, `nominalFireTime`, `dispatchedAt`. [scheduled/src/routes.ts:267-276;
    scheduled/test/adapter.test.ts:48 (reads the namespaced `metadata.schedule` slot)]

## Per-fire input

50. The job's body is fixed when the job is created **[external]**; the action's input is not taken
    from it. Input is `schedule.input`: a static value, or a function
    `({ scheduleId, cron, nominalFireTime, principal, flowKind, origin }) => unknown`, called at
    dispatch. [core/src/types/schedules.ts:101-122, 148-154; scheduled/src/routes.ts:238-256]
51. `ctx.nominalFireTime` in that function is the ISO time of the scheduled time this fire counts
    against (the claimed one), also for a body-less fire. A function that throws gives `500
    dispatch_failed` and gives the time back. [scheduled/src/routes.ts:211, 238-256]
52. With no `input`, the block receives `{}`. [scheduled/src/routes.ts:250]

## OIDC alternative (what the repo does and does not offer)

53. **[external]** Cloud Scheduler can attach an OIDC token with `--oidc-service-account-email` and
    `--oidc-token-audience` instead of a header secret, and signs a fresh token per fire. [guide:61-78]
54. The framework verifies nothing for you here. The repo ships `createHs256JwtVerifier` (HS256 with a
    shared secret) and `extractBearerToken`; asymmetric algorithms (RS256/ES256) are "out of scope",
    and hosts plug in a JWKS verifier of their choice. The bearer-secret helper's own doc comment
    names OIDC verification as something a host writes in `resolvePrincipal` directly. There is no
    OIDC verifier to show, so the page can state the option and the limit but cannot give working
    verification code from this repo. [engine/src/transports/auth/createBearerTokenVerifier.ts:1-14;
    engine createBearerSecretPrincipalResolver.ts:10-11]
55. A `resolvePrincipal` that verifies a token returns a principal with `userId` and `orgId`, throws
    `PrincipalResolutionError({ status: 401 })` to refuse. [core/src/types/auth.ts:126-145;
    engine createBearerSecretPrincipalResolver.ts:80-84; ref authentication.md:24-28]

## Limits the page may state

56. One dispatch runs one action; no fan-out. A scheduler that wants 1000 reminders makes 1000 calls
    with 1000 schedule ids. [ref:468-471]
57. The framework runs no scheduler loop of its own. [ref:472-475]
58. `GET /api/flows/:flowKind/schedules` lists static schedules (`id`, `cron`, `action` = block name,
    `timezone`, `description`, `enabled`) and `dynamic: { provided }`; it uses the same principal
    resolver as dispatch, so the job's bearer header works for it. Useful to confirm the flow
    registered the schedule. [scheduled/src/routes.ts:333-405; ref:431-462]
59. The dispatch endpoint is POST only. [ref:274 (405 row)]

## Corrections to the existing page

C1. **Unquoted schedule key.** The guide's flow example writes `monthly-invoices: { ... }` as an
    object key; that is not valid TypeScript (hyphen). It must be `"monthly-invoices": { ... }`.
    [guide:54; ref's own example quotes it, ref:327; scheduled/test/once-per-time.test.ts:48]
C2. **Wrong field name.** The guide's schedule uses `action: "generateMonthlyInvoices"`. A schedule
    has no `action` field; the handler is `block`, a block value, and registration throws without it.
    [guide:54; core/src/types/schedules.ts:140, 346-351; ref:328]
C3. **Missing `orgId`.** The guide's `principal: { userId: "system" }` does not satisfy
    `ResolvedPrincipal` (`orgId` required) and a configured resolver with no org is refused with 401.
    Add `orgId` (not the reserved default). [guide:48; core/src/types/auth.ts:89-92, 126-131;
    ref authentication.md:60-64, 73-75]. The same snippet is in ref:314-331; flag to whoever owns it.
C4. **Time zones.** The guide says the framework "treats `schedule.timezone` as opaque metadata ...
    doesn't drive evaluation". The endpoint does evaluate the cron in `schedule.timezone` (default
    UTC) to name the scheduled time a fire counts against (fact 47). The JSDoc on
    `ScheduleConfig.timezone` ("Opaque metadata — the host's scheduler does the time-zone math") says
    the same wrong thing; code wins. [guide:96-99; scheduled/src/routes.ts:206-207;
    core/src/types/schedules.ts:179-184]
C5. **Metadata path.** The guide says the zone "surfaces in `metadata.timezone` on the request". It is
    `metadata.schedule.timezone`. [guide:97-98; scheduled/src/routes.ts:267-276]
C6. **`nominalFireTime` on the input context.** The guide ties it to a body the job can't send, and
    the JSDoc on `ScheduleInputContext.nominalFireTime` says "or now() if absent". The value is the
    scheduled time the fire counts against, never `now()`. [core/src/types/schedules.ts:111;
    scheduled/src/routes.ts:211, 238-250]
C7. **`onErrored` wording.** The guide says "the flow's `onErrored` lifecycle hook runs". The flow
    hook is `request.onErrored`; a schedule can also carry its own `onErrored`. Untested for the
    scheduled path (fact 37). [guide:91-92; core/src/types/flow.ts:205-212, 415-420]
C8. **OIDC section is not runnable.** It tells the reader to "verify the resulting JWT in
    `resolvePrincipal`" and shows no verification; the repo has no OIDC verifier and the HS256 helper
    cannot verify Google's tokens (facts 53-54). Either cut the section to a one-sentence option with
    its limit, or keep it as an **[external]** command with that limit stated.
C9. **The guide never shows the mount** (adapter on `createFlowState`, the route file); a reader who
    arrives from a search result cannot reach the dispatch URL without it (fact 2). Neighbour
    pages in the revamp (`vercel-cron.md`, `eventbridge.md`) carry the same "assumes it is mounted"
    line; keep the three consistent.
C10. **Neighbour copies to fix with the page** (same claims, same files): the `Time zones`, retry
    and `action:` / unquoted-key snippets are copied in
    `docs/contributing/docs-revamp/pages/build/schedules/cloud-scheduler.md` (the cut copy of the
    guide) and the guide `apps/docs/guides/scheduled-cloud-scheduler.md`; the `timezone` sentence is
    also in `apps/docs/guides/scheduled-eventbridge.md` and the revamp copy `eventbridge.md` (grep `opaque metadata`).

## Not verifiable from the repo (carry or drop, do not assert as fact)

- Every `gcloud` flag and its semantics, the `--headers` syntax, `--oidc-*` flags.
- That Cloud Scheduler retries on non-2xx and stops on 2xx, its backoff behaviour, and that it sends
  one fixed body per job.
- That Cloud Scheduler signs a fresh OIDC token per fire.
- That Cloud Scheduler has dead-letter and alerting features.

## Page state after revise round 1

The page states, from this sheet: 1-2 (task, mounted adapter, named `createScheduledTransportAdapter`),
4, 8 (`timezone`, `block`), 10 (dispatch URL), 11 (the flow example: quoted key, `block`, `orgId`),
13 and 17 (bearer resolver, `orgId`), 20 (job, with no `Content-Type` header since there is no body),
21 (no body: each fire runs for the most recent scheduled time due), 27 (the 202 shape), 33 (retry
answers `duplicate`), 36 (no retry after a 202; error on the request record), 47-48 (set `timezone`
to the job's `--time-zone` and the same cron in both; the framework evaluates the cron in
`timezone`, so a mismatch can refuse a fire or count it against the wrong time), 50 (input comes
from `schedule.input`), 54-55 (OIDC: the framework verifies nothing; the host writes
`resolvePrincipal`), 58 (list endpoint as the check), 39 (dead-letter and alerting in Cloud Scheduler).

Moved to Reference, linked and not stated on the page:

- To `reference/schedules` (R-33): facts 22 (why no body, stale `nominalFireTime`), 25, 34 (a retry
  after the next scheduled time counts against that next time), 47 and 49 (`timezone` evaluation and
  `metadata.schedule.timezone`), 50-52 (`input` context, `nominalFireTime`; the input function gets
  no scope state, the action reads state itself), 23-24, 28-30, 35, 38, 40-45.
- To `reference/errors` (R-22): fact 36-37 (action failure after a 202 is recorded on the
  `RequestRecord` with status `errored`; hook wording per fact 37).
- To `reference/authentication` (R-20): facts 12, 14-16, 18, 55.

Removed from the page as untrue or unsupported: "opaque metadata" for `timezone` (C4), `metadata.timezone`
(C5), `nominalFireTime` tied to the input function's scope state (C6, and the scope-state claim), the
`onErrored` hook sentence (C7, fact 37 untested on the scheduled path), "JSON body" and the
`Content-Type` header (no body is sent).

## Page state after revise round 2

- The page now shows the block file `src/flows/billing/blocks/generate-monthly-invoices.ts` (a
  `handler` with `inputSchema: z.object({})`, which is what a schedule with no `input` passes, fact 52),
  so the flow example type-checks. [scheduled/test/once-per-time.test.ts:29-36]
- The page says "block" for what a schedule runs, never "action".
- Reading the run: `GET /api/flows/<flowKind>/requests/<requestId>/status` returns a snapshot with
  `status`; `?include_result_output=true` adds the stored result (output, error). The principal the
  schedule runs as owns the request, so the dispatch bearer header reaches it. [engine/src/routes/request-status-routes.ts:29-92;
  core/src/types/request.ts:17-55; apps/docs/docs/server/connection-resilience.md:30]
- Links checked: `/docs/server/scheduled` is an existing page and the one the sibling recipes use;
  `../reference/{schedules,errors,authentication}.md` are the plan slugs R-33, R-22, R-20.
- The 202 body fields match scheduled/src/routes.ts:325-330.

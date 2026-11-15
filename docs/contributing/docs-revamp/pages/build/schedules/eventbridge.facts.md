# Facts for Run on a schedule with EventBridge (B-17, recipe, 500 words)

Pass 1 fact sheet. Cites only what a fact sheet may cite: existing user docs, the exported surface and
its doc comments, tests, one example. No spec, no `docs/internal/`, no `CLAUDE.md`. Paths are from the
repo root. Nothing here was run against AWS; behaviour is read from source and pinned tests.

Abbreviations:

- `eb` = `apps/docs/guides/scheduled-eventbridge.md` (the kept page; the revamp copy
  `docs/contributing/docs-revamp/pages/build/schedules/eventbridge.md` is the same text)
- `ref` = `apps/docs/docs/server/scheduled.md`
- `auth` = `apps/docs/docs/server/authentication.md`
- `rt` = `packages/scheduled/src/routes.ts`
- `stm` = `packages/scheduled/src/scheduledTime.ts`
- `ad` = `packages/scheduled/src/createScheduledTransportAdapter.ts`
- `fr` = `packages/scheduled/src/firedRecords.ts`
- `st` = `packages/core/src/types/schedules.ts`
- `bs` = `packages/engine/src/transports/auth/createBearerSecretPrincipalResolver.ts`
- `opt` = `packages/scheduled/test/once-per-time.test.ts`

Legend: **[page]** the page states it. **[ref]** belongs on `reference/schedules`; link, do not state.
**[external]** AWS behaviour, not in this repo, carried from `eb`; pass 5 cannot check it from code and
the writer keeps it to what `eb` already says or checks it against AWS documentation. **[verify]**
suspect even as AWS behaviour. **[correction]** the existing page is wrong; the code wins.

This page is the sibling of Cloud Scheduler (B-16, `cloud-scheduler.facts.md`) and Vercel Cron
(B-15, `vercel-cron.facts.md`). Rows that are the same endpoint behaviour carry the same file and line;
the three recipes must agree on them.

## Task and outcome

1. **[superseded by A1-A12, review edit: an EventBridge rule and API destination make the POST, not Scheduler]** Task: have EventBridge Scheduler POST a flow's dispatch endpoint on a cron, so the static schedule
   `monthly-invoices` on the `billing` flow runs its block on the 1st of each month. The framework does
   not run the schedule; the host's scheduler POSTs the endpoint. **[page]**
   [st:142-146 ("the framework does not run the schedule; the host's scheduler does"); ad:1-8;
   ref:472-475]
2. Precondition: the scheduled adapter is mounted (`adapters: [createScheduledTransportAdapter()]` on
   `createFlowState`, platform route handler on `app/api/flows/[...path]/route.ts`; install
   `pnpm add @flow-state-dev/scheduled`). `eb:14-15` only links to "Scheduled actions"; the recipe says
   so in one line and links, as B-15 and B-16 do. [ref:26-60; ad:26-30; eb:14-15]
3. The flow declares the schedule and the bearer resolver exactly as in B-16 facts 4-11, 13-17. Do not
   restate there; the recipe prints the one `defineFlow` and links. Verified shape:
   `defineFlow({ kind: "billing", authentication: { resolvePrincipal:
   createBearerSecretPrincipalResolver({ secret, principal: { userId: "system", orgId: "org_sys" } }),
   requireUser: true }, schedules: { static: { "monthly-invoices": { cron: "0 0 1 * *", block: invoices,
   onOverlap: "allow" } } }, actions: {} })`. `defineFlow(...)` returns a function; the test calls it.
   [opt:38-51; bs:28-45, 54-88]
4. Static schedule id: lowercase alphanumerics and dashes, max 64, checked at registration. A bad id,
   cron, zone or `input` throws at boot. [st:271, 313-318, 320-334]

## The two cron expressions (the page's one real hazard)

5. **[correction]** `eb:32-34` says the framework `cron` is "display-only metadata ... does not drive
   evaluation. Treat the AWS expression as the source of truth". Wrong. The endpoint evaluates the
   schedule's `cron`, in `schedule.timezone` (default `"UTC"`), to decide which scheduled time a fire
   is for. [rt:206-207; stm:86-121]
6. The JSDoc on `ScheduleConfig.cron` ("Display-only") and `ScheduleConfig.timezone` ("Opaque
   metadata") carries the same wrong claim; code wins. [st:142-146, 179-184]
7. Consequence the reader can see: a body `nominalFireTime` that is not within five seconds of a
   scheduled time of the framework's cron answers `400 { error: "not_a_scheduled_time" }`; one that is
   a scheduled time not yet due answers `400 not_yet_due`; one that is not an ISO-8601 time answers
   `400 invalid_nominal_fire_time`. So the framework cron and the EventBridge expression must name the
   same instants. A mismatch is a 400 on every fire. [stm:86-121; rt:207-210; opt:138-158 (the first two)]
   - `invalid_nominal_fire_time` is returned by the code but the existing endpoint table (`ref:272`) does
     not name it; **[ref]**, say "an invalid schedule or time" only if the page needs it.
8. The framework accepts exactly five fields, `minute hour day-of-month month day-of-week`. A sixth is
   refused, because a sixth would be read as seconds. An EventBridge `cron(...)` expression has six
   fields and a `?`; it cannot be pasted into the framework's `cron`. Static: error at registration.
   Dynamic: `400 invalid_schedule` at dispatch. [st:274-281, 320-325; rt:149-161; ref:411-415]
9. Both ends are write-twice: the job's `--schedule-expression` and the flow's `cron` are the same
   schedule written in two dialects, held in two places. The endpoint reads only the flow's `cron`.
   [rt:206-207; stm:150-157 as cited in B-16 fact 26]
10. Conversion table in `eb:26-30` (framework -> EventBridge). The framework column is checkable:
    `0 0 1 * *`, `0 9 * * MON` and `*/15 * * * *` all parse as five-field expressions and resolve to
    the stated instants under `cron-parser` (run: `0 0 1 * *` -> 1st 00:00 UTC; `0 9 * * MON` ->
    Monday 09:00; `*/15 * * * *` -> every 15 minutes). The EventBridge column is **[external]**:
    `cron(0 0 1 * ? *)`, `cron(0 9 ? * MON *)`, `cron(0/15 * * * ? *)`. The framework also accepts
    `0/15 * * * *` as every 15 minutes (run), so the step form is not the difference. The `?` and the
    trailing year field are. [st:279-281; cron-parser run in `packages/core`]
11. A six-field EventBridge expression such as `0 9 ? * MON *` is read by `cron-parser` as seconds-first
    and means a different time (run: next fire `2027-01-01T00:09`), which is why registration refuses it
    rather than parse it. [st:274-281, 320-325]

## Step: create the schedule in EventBridge

12. **[superseded by A1-A12, review edit]** The kept page's `aws scheduler create-schedule` command
    cannot work: `create-schedule` has no `--target-uri` flag, and a Scheduler target has no
    `HttpParameters` and no `arn:aws:scheduler:::http-invoke` target that POSTs a URL. The page uses an
    EventBridge rule with an API destination target instead (A1-A12 below).
13. What the repo owns in that command, whatever the AWS wrapper is:
    - **URL**: `POST {basePath}/:flowKind/schedules/:scheduleId/dispatch`, `basePath` default
      `/api/flows`; for flow `billing`, schedule `monthly-invoices`:
      `https://app.example.com/api/flows/billing/schedules/monthly-invoices/dispatch`. POST only.
      [ad:14-20, 41-44; ref:247-252, 289-293]
    - **Header**: `Authorization: Bearer <FSDEV_SCHEDULER_SECRET value>`; `Content-Type: application/json`.
      [bs:28-45; ref:289-292, 306-312]
    - **Body**: `{"nominalFireTime": "<event time>"}`, built by the target's input transformer from
      `$.time` (A7). The endpoint reads one field
      from the body, `nominalFireTime` (a string), and `idempotencyKey` only to refuse it. Any other
      field is ignored. [rt:407-423; ref:253-259]
14. **[superseded by A7, A8]** The body is built from the scheduled event's `time` by an input
    transformer, not from `<aws.scheduler.scheduled-time>`. The endpoint accepts it if it parses as
    ISO-8601 (`Date.parse`) and lands within five seconds of a scheduled time of the cron.
    [stm:54, 94-112; ref:253-259; opt:131-136]
15. **[superseded]** A rule has no flexible time window; the page drops the `Mode: OFF` sentence.
16. The body is substituted per run, so unlike a fixed body it is not stale. A scheduler that sent a
    fixed `nominalFireTime` would get `200 { status: "duplicate", reason: "stale" }` once the time is more
    than one period behind, run nothing and log a warning; the recipe's placeholder avoids this and the
    alternative is to send no body (B-16 fact 22). [stm:123-129; rt:212-222; opt:172-189; ref:397-401]
17. **[superseded by A7: the page sends a body through an input transformer; omitting `Input` no longer applies]** Without a body the endpoint counts a fire against the latest scheduled time already due (or one
    due within five seconds). EventBridge could omit `Input`; the recipe keeps it so a retry carries the
    time it is for. [stm:86-93; rt:407-409; ref:261-262, 386-389]

## Step: authenticate

18. Every dispatch goes through the flow's `authentication.resolvePrincipal` before the fired record
    is read. [rt:71-99; ref:306-312]
19. `createBearerSecretPrincipalResolver({ secret, principal })` from `@flow-state-dev/engine`: reads
    `Authorization: Bearer <secret>` (header name configurable), compares in constant time, returns the
    fixed `principal`. Mismatched token: `401 { error: "unauthorized", message: "Invalid scheduler
    secret." }`. A missing header or non-Bearer scheme returns `null`; `requireUser: true` then refuses
    with 401. `secret` and `principal.userId` must be non-empty or the factory throws. The principal
    needs an `orgId` (a configured resolver that returns none is refused 401); the example uses
    `"org_sys"`. [bs:47-88, 57-69; rt:91-98; auth:60-64, 73-75; opt:44]
20. The secret is an environment variable on the app side. In EventBridge its value is stored on the
    **connection** as `ApiKeyValue: "Bearer <secret>"` under `ApiKeyName: "Authorization"` (A2), so rotating
    it means `aws events update-connection` (A3). The page no longer mentions fronting with API Gateway (unverifiable, left open a question). The framework has no secret
    rotation of its own; to accept two secrets during a rotation a host writes `resolvePrincipal`
    directly. The existing page does not say the latter; the bearer helper's comment says richer auth
    is a hand-written resolver. [bs:10-13]
21. If the flow already has a `resolvePrincipal` for user traffic, branch on `ctx.source ===
    "scheduled"` rather than replace it. [ref:334-350]
22. EventBridge has no OIDC attach as Cloud Scheduler does; the page need not mention OIDC.
    **[external]** The repo has no OIDC verifier either (HS256 helper only). [bs:10-11]

## What comes back and what EventBridge does with it

23. `202 { status: "accepted", scheduleId, origin: "static", requestId }`. A 202 means the action
    started, not that it finished. [rt:325-330; ref:268-284]
24. `200 { status: "duplicate", scheduleId, nominalFireTime }`: that scheduled time (or a later one)
    already fired; nothing ran. [rt:228-230; ref:391-395]
25. `200 { status: "skipped", reason: "in_flight", requestId }` when the previous run is still going
    and `onOverlap` is the default `"skip"`. The example sets `onOverlap: "allow"`. [rt:163-179;
    st:186-197; ref:352-369]
26. `400` invalid id or schedule, `not_a_scheduled_time`, `not_yet_due`, `idempotency_key_removed`;
    `401` failed auth; `404` unknown flow or schedule (also a disabled one); `500` a resolver or `input`
    function threw; `503` flow unregistered or dispatch failed. [rt:59-66, 138-161, 209, 252-256,
    301-304, 319-322; ref:268-277]
27. **[superseded by A9]** An API destination retries only `401`, `407`, `409`, `429`, `5xx` and
    timeouts. The `400`s from a cron mismatch (fact 7) and a `404` are not retried; they go to the
    dead-letter queue (A10). The `401` (fact 19) and the `500`/`503` rows are retried.
28. A retry of a run that already dispatched answers `200 { status: "duplicate" }`; the action does not
    run twice. That holds for any number of POSTs of one scheduled time: a retry, a second host, a
    restart. A retry that arrives after the next scheduled time has fired is a duplicate too.
    [rt:223-230; opt:90-122; ref:371-377, 391-395]
29. A fire that is not admitted (an overlap skip, a concurrency refusal, a `503`) gives its time back,
    so the retry still runs unless a later time fired meanwhile. A `500` from an `input` function gives
    it back too. [rt:231-236, 251-256, 295-304, 313-322; ref:403-405]
30. A carried time older than one period behind the latest due time is `200 { status: "duplicate",
    reason: "stale" }` and runs nothing. For a retry that means a retry delayed past one period is
    quietly not run (relevant to a frequent cron such as every 15 minutes with
    `MaximumEventAgeInSeconds: 3600`). [stm:123-129; rt:212-222]
31. **[correction]** `eb:82-84`: "If the action itself errors after the dispatch returned 202, AWS does
    not retry ... error lands on the `RequestRecord` and surfaces in DevTool." The framework half is
    true: the dispatch response is unchanged, and the error is on the request's `RequestRecord`.
    [ref:279-284]. AWS not retrying a 2xx is **[external]**. A failed action is therefore never
    redriven by EventBridge, and never reaches the dead-letter queue.
32. **[superseded by A10: what a DLQ message holds under an input transformer is not documented; the page makes no payload claim]** Dead-letter queue: failures past the retry budget land in the configured SQS queue "with the
    original event payload" so the host can alert or replay. **[external]** [eb:78-80]. The framework
    does not read the queue. Replaying a queued event POSTs the same `nominalFireTime`, so it runs only
    if that time has not fired and no later time has (fact 28, 30). [stm:190-198 (`claimScheduledTime`:
    record `lastFiredAt >= at` is a duplicate)]
33. No backfill and no catch-up: if the scheduler misses a tick, the framework does not run it; a retry
    only runs while no later scheduled time has fired. [ref:476-479]
34. Guarantee scope: once-per-time holds across processes on a store with compare-and-set across
    processes (SQLite, Postgres). On the memory store and the filesystem store it holds within one
    process only. [stm:181-189; ref:422-424]

## Stored data: the fired record (four questions)

The one thing this setup stores in the app is the schedule's fired record. The schedule is code on the
flow, the secret is an environment variable, and the AWS schedule, its retry state and the dead-letter
queue live in AWS.

35. **What it is.** One record per schedule: `{ lastFiredAt }`, the latest scheduled time it fired
    (epoch ms). Older records also carry `cron` and `timezone`; they are read past, never compared.
    [stm:131-144]
36. **Who owns it.** The framework's dispatch endpoint writes and reads it; the app's code does not. A
    flow that deletes a schedule can delete the record through a collection over `FIRED_RECORDS_PATTERN`
    (`"scheduled-fires/**"`, user scope). [fr:1-10; rt:223-227]
37. **Who can see it.** It sits in the user cell of the principal the schedule runs as: the schedule's
    `principal` if it names one, otherwise the gateway principal (the one the bearer resolver returns,
    `system` / `org_sys` in the example). [stm:152-167; rt:181-203]
38. **Where it is stored.** In the host's resource-state store, key `scheduled-fires/<flowKind>/<scheduleId>`
    (so `scheduled-fires/billing/monthly-invoices`), written with compare-and-set. [fr:19-26;
    stm:181-218; rt:223-227]
39. **How many exist.** One per (flow kind, schedule id), not one per run: each fire overwrites it with
    a later time. Changing a schedule's cron or zone keeps the record, so a time at or before the last
    one still answers `duplicate`. [stm:195-201; ref:407-409]

## Time zones

40. **[superseded by A11]** A rule has no `--schedule-expression-timezone`; its cron runs in UTC.
41. **[correction]** `eb:90-92` says the framework treats `schedule.timezone` as opaque metadata. The
    endpoint evaluates the framework `cron` in `schedule.timezone` (default `"UTC"`) to name the scheduled
    time, for the five-second tolerance and for the stale check. Set `timezone` on the schedule to the
    same IANA zone as `--schedule-expression-timezone`, and write the same cron in both. A non-IANA
    zone is refused at registration. The code does not compare the two. [rt:206-211; stm:86-121;
    st:329-334]
42. The resolved zone is recorded on the request as `metadata.schedule.timezone` (with `scheduleId`,
    `origin`, `cron`, `nominalFireTime`, `dispatchedAt`). [rt:267-276; packages/scheduled/test/adapter.test.ts:48]

## Per-fire input and limits

43. **[correction]** `eb:98-100`: "Per-fire dynamic input must come from the action computing it from
    `nominalFireTime` or scope state, not from the EventBridge config." The action never sees the body.
    Its input is `schedule.input`: a static value, or a function
    `({ scheduleId, cron, nominalFireTime, principal, flowKind, origin }) => unknown` called at dispatch.
    `ctx.nominalFireTime` there is the ISO time of the scheduled time this fire counts against (the
    claimed one), also when no body was sent. No `input` means the block receives `{}`. Extra fields
    in EventBridge's `Input` are ignored. [st:101-122, 148-154; rt:211, 238-256, 413-418]
44. **[correction]** The JSDoc on `ScheduleInputContext.nominalFireTime` ("or now() if absent") is wrong:
    it is the scheduled time, never `now()`. [st:111; rt:211, 238-250]
45. `eb:95-97`: IAM role setup is more than Vercel Cron or Cloud Scheduler ask for; choose it for the
    dead-letter queue. Not "for retries": Cloud Scheduler retries failed calls too (B-16). **[external]**, an opinion about AWS; keep to one clause or cut.
46. Changing the schedule's cron means updating both AWS and the flow's `cron` (fact 9); the page states this
    once, in the cron section, and no longer says the expression is "fixed at create time". [eb:98]
47. One dispatch runs one action; no fan-out. [ref:468-471]
48. `GET /api/flows/:flowKind/schedules` lists static schedules (`id`, `cron`, `action`, `timezone`,
    `description`, `enabled`) and `dynamic: { provided }`, with the same resolver, so the bearer header
    works. Useful to confirm the schedule registered. [rt:333-405; ref:431-462]

## Corrections to the existing page (repeat of the [correction] rows)

C1. Cron "display-only ... does not drive evaluation" (facts 5, 6). It does; a mismatch is a 400.
C2. Time zone "opaque metadata" (fact 41). It is evaluated.
C3. "Per-fire input ... from `nominalFireTime`" (fact 43). The action's input is `schedule.input`.
C4. The create command: unverified wrapper (fact 12). Check `Arn`, `HttpParameters`, `--target-uri`.
C5. The page tells the reader nothing about mounting (fact 2) or the flow (fact 3); B-16 does.
C6. A cron mismatch is retried and dead-lettered (fact 27); the existing page promises only
    "failures past the retry budget land in the DLQ" and never names a cause.
C7. `defineFlow` example (if the page prints one) must use `"monthly-invoices"` quoted, `block` (not
    `action`), and `orgId` in the principal. [st:140, 346-351; opt:44, 48; auth:60-64]
C8. Neighbour copies: same `Time zones` claim in `apps/docs/guides/scheduled-cloud-scheduler.md`,
    `apps/docs/guides/scheduled-vercel-cron.md`, their revamp copies, and the `cron` / `timezone` JSDoc
    in `packages/core/src/types/schedules.ts:142-146, 179-184`; flag to whoever owns them. The
    `nominalFireTime` JSDoc `st:111` too.

## Not verifiable from the repo (carry or drop; do not assert as fact)

- From the repo alone: every `aws events` flag and field (checked against AWS docs instead, A1-A12).
- Open after the AWS check: that a scheduled event's `time` lands within five seconds of the
  scheduled minute (A8), and what body a DLQ message carries when the target has an input transformer.
  The page claims neither.

## What the page keeps out (Reference or nowhere)

Response-code table (fact 26, the full list); once-per-time mechanism and store scope (28, 34); the
fired record's four answers beyond one sentence (35-39); `onOverlap` options (25); the listing endpoint
(48); dynamic schedules; OIDC; the IAM role. Link to `reference/schedules` for the rows.

## AWS facts for the review edit (rule + API destination)

Checked against AWS documentation on 2026-11-15. Not run against AWS.

A1. Approach: an EventBridge rule with a schedule expression whose target is an API destination. An API
    destination is an HTTPS endpoint invoked as a rule target; it uses a connection for authorization.
    EventBridge Scheduler's targets are AWS API operations (templated or universal), not an HTTPS URL.
    [https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html;
    https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets.html]
A2. `aws events create-connection --name --authorization-type API_KEY --auth-parameters
    '{"ApiKeyAuthParameters":{"ApiKeyName":...,"ApiKeyValue":...}}'`. `ApiKeyName`/`ApiKeyValue` pattern
    `^[ \t]*[^\x00-\x1F:\x7F]+([ \t]+[^\x00-\x1F:\x7F]+)*[ \t]*$`: inner spaces allowed (so
    `Bearer <secret>` is valid), a colon is not. Output `ConnectionArn`.
    [https://docs.aws.amazon.com/cli/latest/reference/events/create-connection.html]
A3. `aws events update-connection --name ... --auth-parameters ...` updates the same fields.
    [https://docs.aws.amazon.com/cli/latest/reference/events/update-connection.html]
A4. `aws events create-api-destination --name --connection-arn --invocation-endpoint --http-method POST`
    (all four required). Output `ApiDestinationArn`.
    [https://docs.aws.amazon.com/cli/latest/reference/events/create-api-destination.html]
A5. `aws events put-rule --name --schedule-expression "cron(...)"`; rules are enabled by default.
    Scheduled rules are labelled legacy, AWS recommends EventBridge Scheduler, and scheduled rules can
    only be created on the default event bus.
    [https://docs.aws.amazon.com/cli/latest/reference/events/put-rule.html;
    https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html]
A6. `aws events put-targets --rule --targets '[{Id, Arn, RoleArn, InputTransformer{InputPathsMap,
    InputTemplate}, RetryPolicy{MaximumRetryAttempts 0-185, MaximumEventAgeInSeconds 60-86400},
    DeadLetterConfig{Arn}}]'`. [https://docs.aws.amazon.com/cli/latest/reference/events/put-targets.html]
A7. Input transformer: `InputPathsMap {"time": "$.time"}` and template `{"nominalFireTime": <time>}`;
    EventBridge adds quotes to string variables in a JSON template.
    [https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-transform-target-input.html]
A8. An event's `time` is the time the event occurred (ISO-8601 UTC); for a scheduled event, when the rule
    fired. Schedule precision is one minute. **[unverified]** that `time` always lands on the scheduled
    minute within the endpoint's five-second tolerance; AWS does not document it.
    [https://docs.aws.amazon.com/eventbridge/latest/ref/overiew-event-structure.html;
    https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html]
A9. API destinations retry `401`, `407`, `409`, `429` and `5xx`; not `1xx`, `2xx`, `3xx` or other `4xx`.
    A request has a 5-second timeout and timed-out requests are retried. EventBridge sets
    `Content-Type: application/json; charset=utf-8` when none is given (the endpoint does not check the
    header; it parses the body: rt:407-423). After the last retry the event goes to the DLQ, otherwise it
    is dropped. [https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html]
A10. A DLQ receives all failed events, some without retries; messages carry `ERROR_CODE`,
    `ERROR_MESSAGE`, `EXHAUSTED_RETRY_CONDITION`, `RETRY_ATTEMPTS`. A DLQ set through `PutTargets` needs a
    queue policy granting `events.amazonaws.com` `sqs:SendMessage`. Standard queues only, same Region.
    [https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html;
    https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html]
A11. All scheduled events use UTC+0; a rule has no time-zone option.
    [https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html;
    https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-scheduled-rule-pattern.html]
A12. The target's `RoleArn` role needs `events:InvokeApiDestination` on `arn:aws:events:*:*:api-destination/*`.
    [https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-events-iam-roles.html]

# Facts for Background work (C-16, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no `docs/architecture/`. The page plan's own "Sources" line (`guides/background-work`, `guides/keeping-a-flow-running`, `server/background-work`) names three existing pages; all three are citable here as existing docs.

Paths are from the repo root. Abbreviations:

- `bg` = `apps/docs/guides/background-work.md` (to be promoted)
- `kfr` = `apps/docs/guides/keeping-a-flow-running.md` (to be merged)
- `srv` = `apps/docs/docs/server/background-work.md` (to Reference)
- `sc` = `apps/docs/docs/advanced/sequencer-side-chains.md`
- `bgq` = `apps/docs/guides/background-jobs-bullmq.md`
- `sched` = `apps/docs/docs/server/scheduled.md`
- `tb` = `docs/contributing/docs-revamp/pilot/tasks-and-boards.md` (the Tasks and boards pilot page)
- `dsp` = `packages/core/src/blocks/dispatcher.ts`
- `sm` = `packages/core/src/blocks/sequencer-methods.ts`
- `eng` = `packages/engine/src/flowstate/types.ts`
- `bmq` = `packages/bullmq/src/flowstate-adapter.ts`
- `rty` = `packages/bullmq/src/retry.ts`
- `td` = `packages/engine/test/terminal-drain.test.ts`
- `ab` = `packages/engine/test/abort.test.ts`
- `reb` = `packages/engine/test/request-end-background-failures.test.ts`

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/background-work`; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[contradiction]** two sources disagree; the ruling is given. **[answers Qn]** the sitemap question it answers.

The page's one scenario is not yet fixed by the page plan. Candidate that fits all three examples and the support-desk app used by C-02 and C-04 (`handleTicket`, `cleanMessage`, `draftReply`): after `draftReply` answers, a `summarizeTicket` block runs beside the reply (side chain); a long `buildReport` action runs on a job queue (queued run); an `investigate` entry runs in a session of its own (dispatch); a `dailyDigest` fires with nobody there (schedule). Names are the page's own choice; each is an app name, not a framework fact.

## Read this first: things the page cannot say, and corrections

1. **There is no per-action "background setting".** The sitemap's example line, "A queued action run: the action's background setting", and its "Unsettled" note assume one. No such option exists on an action entry. `ActionConfig` in `packages/core/src/types/flow.ts` has `durable`, `concurrency`, `taskOf`, `tokenBudget` and no queue or background field (`flow.ts:225-250`; a search for a `background` / `queue` / `detach` field on the action type finds none). Queued runs are a **host** setting: the `jobQueue` option of `createFlowState`, set to an adapter such as `bullmqJobQueue({ connection })`. `eng:375-383` ("Job queue adapter ... Mutually exclusive with `runner`"); `bg:51-62`; `bmq:76`. Every action on that host then goes through the queue; the flow's author does not mark individual actions. **[contradiction: the code wins. The page's queued-run example is `createFlowState({ ..., jobQueue: bullmqJobQueue(...) })`, not an action field. Flag to the page plan at the caller's review.]**
2. **`durable: true` on an action is not "run in the background".** It clears the action's suspension records and lease at completion. `flow.ts:236-243`. Do not use it as the queued-run setting. [page: nothing]
3. **Does a closed tab cancel a side chain?** `bg:43` says closing the tab does not cancel it ("background tasks don't listen to the transport signal") and an explicit abort does. `sc:78-80` says the request still waits for the tasks when the user stops or the client disconnects. These agree once read together: the task is told to stop on an explicit abort, and the request still waits for it to settle before it is recorded. Tests: disconnect leaves the request pending until the parked task settles (`td:172-217`); an explicit stop does the same and the request ends `aborted` (`td:219-267`, status at `td:266`); a task that holds the drain open is rejected by an explicit abort and not by a transport teardown (`ab:2200-2290`, comment at `ab:2215-2216`: "`.sideChain()` tasks run on the background signal, which fires only on an explicit cancel"). **Ruling: a closed tab does not cancel it. A stop does. Either way the request waits for it to settle.** [page, one sentence; detail ref]
4. **A side chain that fails does not fail the request.** The failure is logged and the failed `block_trace` reaches the DevTool. Nothing reaches the user's stream. `sc:13`, `sc:64`; test `reb:67-97` (request stays `completed`, hooks get `backgroundFailures`). One exception: in a request that works a dispatched task, a throwing background step fails the task's attempt. `sc:68`, `sc:120`. [page: the first; the exception is ref]
5. **`bg:43`'s "a process that shuts down first can still drop it" is about a process stopping with the request still open.** The request holds itself open until the tasks settle (`sc:72`, `sc:78`), so the real exposure is a process that dies or a serverless function that freezes. [page, one clause with "a crash"]
6. **The board's "background queue" sentence.** `tb:81`: "The drain has no lifetime of its own ... So a board on its own is not a background queue." A board in delegation mode returns as soon as its tasks are handed out and each session settles its task later; "That is how work outlives the request that asked for it." `tb:85`; `bg:136`. **[answers Q3: no. A board is a stored list that something has to drain. Delegation hands rows to dispatch runs, and those are the background work.]**

## The one question

7. Three mechanisms, one question: "what still has to be alive when this finishes". `bg:25` ("If you can answer 'what still has to be alive when this finishes', you've picked one."). [page]
8. What each outlives, from the comparison table (`bg:18-23`):
   - side chain: runs in the request that dispatched it; outlives the sequencer, not the request. [page]
   - queued action run: runs in a process consuming the job queue; outlives the web process that accepted it; no session of its own, same request id. [page]
   - dispatch: runs in a session of its own; outlives the request that started it. [page]
   The figure's three rows (the reply, the request, the process) map to these.
9. All three are observed the same way: the thing you watch is a request with an id, a status and an item log. A side chain's is the request it runs inside; the other two get their own. `bg:215-220`. [page: one clause; links to `reference/background-work` and Streaming]

## If you know job queues

10. Starting point, what is the same: you hand work off and it runs later, elsewhere, with retries. A queued run is exactly that: `jobQueue: bullmqJobQueue({ connection })`, a Redis queue, processes that pick jobs up, retries on failure. `bg:51-64`; `bmq:1-15`. [page]
11. The one difference: a job queue's job is a function call with a payload and a result nobody sees. Here the unit is a request on the same flow: the client gets a request id and attaches to the same stream it would for an in-process run (`GET /requests/:id/stream`), same session, same item log. `bg:64`; `bgq:104-108` (Live streaming). [page]
12. The other difference: the framework has more than one place for work to go and a queue is only one. The other two are not queues: a side chain is beside the reply, and a dispatch is a request into another session, which may itself go through a queue if the host has one. `bg:7-11`. [page]
13. A task board is not a queue either (see 6). The sitemap lists "the board against a job queue" under "Background work" in the *If you know ...* candidates, `user-docs.md` "Say where we differ". [page, in "If you know job queues"; **answers Q3**]

## Alongside the reply: side chains

14. `.sideChain(block)` queues a block to run next to the chain instead of in it. The chain moves on at once. Signature: `sideChain(block, options?: { name?: string })` and `sideChain(connector, block, options?)`. `sm:290-296`. [page]
15. Smallest example (`bg:31-41`): `sequencer({ name, inputSchema }).step(respondToUser).sideChain(captureMemory)`. Needs `import { sequencer } from "@flow-state-dev/core"` and `zod`. `respondToUser` and `captureMemory` are blocks the page declares or names. [page]
16. Input to the side-chain block is the current value; with a connector (`.sideChain(connector, block)`) the connector reshapes it first, and the connector runs in the main chain; only the block is backgrounded. `sc:45-60`; `sm:291-296`. The next step still receives the value the earlier step produced: "`nextStep` receives the same output as `mainBlock` produced." `sc:41`. [page: the "next step still receives it" clause; connector is ref]
17. The request waits, the chain does not. Every queued task settles before the stream closes ("The request executor drains the pool before the request's final event"). `sc:72`; `bg:43`; tests `td:325` (success path), `request-side-chain-pool.test.ts:190-226` (a task queued by a task is waited on too). [page]
18. A side chain outlives the sequencer, not the request. `sc:15`; `bg:21`. For work that has to outlive the request or the process, use another mechanism. [page; **answers Q1 by the negative: a side chain is what you pick when losing it on a crash is fine**]
19. Crash behaviour: if the process dies mid-request, the request is recoverable and a continue replays finished side-chain work instead of re-running it; the unfinished work runs again. Goal: `goals/continue-interrupted-run/continues-not-restarts/goal.md:6` (Signal b: a completed `.sideChain()` block's run-counter stays at 1 across continues); test `packages/engine/test/background-work-recovery.test.ts:85` ("replays a completed `.sideChain()` background block instead of re-running it on crash recovery"). [ref: a recovery detail; the page says only "a crash drops what had not finished"]
20. Failure is logged, not surfaced. A failure inside a side chain produces no public item. `sc:13`; `docs/contributing/docs-revamp/pages/concepts/sessions-items-and-streaming.facts.md:83`. [page: "A failure is logged, not shown to the user"; this is the trade for not blocking]
21. `.waitForSideChain()` is the barrier a later step uses to read what a side chain wrote. `failOnError: true` makes a failure throw into the sequencer; `timeoutMs` bounds the wait. `sm:323-326` (`waitForSideChain(options?: { failOnError?: boolean; timeoutMs?: number })`); `sc:97-128`. [ref; page links]
22. Other side-chain forms: `.sideChainIf(condition, block)` (condition is a boolean or a function of the value and context; a no-op when false), `.forEachSideChain()`. `sm:244-256`, `sm:298-322`; `sc:7-11`. [ref; page links to Composition]
23. When you would reach for it: cheap, best-effort work that belongs to the turn that produced it: analytics, cache warming, memory writes, auto-titling. `bg:45`. [page; **answers Q1**: "Summarise the conversation after replying; losing it on a crash is fine" is a side chain.]
24. Request-end failures list: the request-end hooks receive every background step that failed (`backgroundFailures: [{ step, message }]`), and the request stays `completed`. `reb:67-97`. [ref]
25. Timing detail: work queued from `onFinished` or `onErrored` is waited on, but the client's stream may already be closed. `sc:84`. [ref]
26. A suspended request does not wait for its background work. `sc:86`. [ref]

## The same request, somewhere else: queued runs

27. Hand `createFlowState` a job queue and actions stop running inline: a POST to an action returns a request id, a processing process picks the job up, runs it against the same stores, and the client attaches to the stream as for an in-process run. `bg:51-64`. Surface: `createFlowState({ flows, stores, jobQueue: bullmqJobQueue({ connection }) })`, `import { bullmqJobQueue } from "@flow-state-dev/bullmq"`. `eng:375-383`; `bmq:76`; `packages/bullmq/src/index.ts:9`. [page]
28. Why that answers "the user closes the tab": the work is a job in Redis and runs against the shared stores. The browser's connection is not holding it. The client can attach later (stream resumes from a sequence number). `bg:64`; `bgq:104-108`. [page; **answers Q2**: a ten-minute report whose user closes the tab is a queued run.]
29. A processing process that dies mid-action: the job is retried. Default 3 attempts including the first, exponential backoff starting at 1000 ms. `rty:9-16`; `bgq:248-273` (the retry table). Validation errors, unknown flows and unknown actions are never retried. `bgq:273`; `packages/bullmq/src/job-processor.ts:311`, `:329`. [page: "retried"; numbers and the table are ref]
30. `mode` decides what a process does: `"colocated"` (the default) both accepts and runs jobs; `"enqueue-only"` only enqueues (the web process); `"process-only"` only processes (a dedicated processing container, which calls `flowstate.ready()`). `eng:53-64`; `packages/engine/src/flowstate/createFlowState.ts:1124-1132`; `bmq:39-45`; test `packages/bullmq/test/flowstate-adapter.test.ts:81-86` (default), `:149-156` (explicit). [page: default and one alternative; the third mode is ref]
31. The default mode needs no new deployment: one process does both, so the queue's durability and retries come without a second container. `bg:66`. [page]
32. A `process-only` process installs no runner, so an action that reaches a router there runs inline rather than becoming a job. `bg:66`; `eng:60-62`. [ref]
33. Both processes must share stores: a store both the web process and the processing processes reach (Postgres in production). `bgq:173`. The framework hands both sides one resolved runtime so they cannot disagree. `eng:72-80`; `bmq:68-75`. [ref; page: "against the same stores"]
34. Reach for it when the run is long or heavy enough that you do not want it on the web tier, or when you want to scale job processing separately. `bg:68`. [page]
35. Where `bullmqJobQueue` is documented: the BullMQ setup guide `apps/docs/guides/background-jobs-bullmq.md` (`B-19` in the plan). The page shows one line of config and links. [page: link only]
36. On serverless, a queue adapter alone does not lift the function's time limit in `colocated` mode (the same invocation both enqueues and consumes); a separate consumer does. `bg:193`. [ref]
37. `onBackgroundWork: (p) => after(() => p)` (with `after` from `next/server`) keeps post-response work alive on a host that freezes the function after the response. It applies to webhook runs, schedule ticks and dispatched work. `eng:206-217`; `kfr:78-82`. [ref]
38. Queue settings stored in Redis: queue name default `"fsd-flows"`, key prefix default `"fsd"`, `concurrency` default 2 jobs per processing process, `lockDuration` default 300000 ms. `bmq:29-36`; `bgq:244` (prefix). [ref]

## In a session of its own: dispatch

39. A dispatch sends one unit of work to an entry the flow declares, and it runs in a session of its own. Its requests do not appear in the starting session's request list. `bg:74`. [page]
40. The entry is declared under `internal.actions` beside `actions`. An internal entry has an action's shape; no client can call it. The only way in is a `dispatcher()` block in the same flow. `srv:27-29`; `bg:103`; `kfr:168-169`. [page]
41. Surface: `dispatcher({ name, action, inputSchema, session: { key: (input) => string } })` returned from `@flow-state-dev/core`. Config fields: `name`, `description?`, `type?`, `action`, `flowKind?`, `inputSchema?`, `session`, `payload?`, `transient?`, `wait?`. `dsp:182-234`. [page: `name`, `action`, `inputSchema`, `session`; the rest ref]
42. Smallest example: `bg:109-127`. A generator `investigate` under `internal.actions.investigate`; a `dispatcher({ name: "investigate-in-background", action: "investigate", inputSchema: z.object({ company: z.string() }), session: { key: (input) => input.company } })` as the root block of a flow action `start`. `defineFlow({ kind, actions: { start: { block } }, internal: { actions: { investigate: { block } } } })()`. Needs `defineFlow`, `dispatcher`, `generator` from `@flow-state-dev/core` and `zod`. [page: the dispatch example; rename to the page's scenario]
43. What a dispatcher returns, as soon as the runtime accepts the request, without waiting for the work: `{ sessionId, requestId, adopted }`. `dsp:126-135`; `srv:81-93`; `packages/core/test/dispatcher.test.ts:178-200`. `adopted` is true when the session already existed. [page]
44. `session` decides where the work runs: `{ key }` a session derived from the key, created on first use; the same key from the same conversation adopts it again. `{ id }` an existing session, refused if it does not exist (nothing is created). `{ from: true }` the session that dispatched this run, as a reply. `dsp:171-180`; `srv:95-107`; `kfr:201-207`. [page: `key` and one clause for `id`; the table and `{ from: true }` are ref]
45. A `key` is scoped to the conversation: the same key from a different conversation is a different run. `srv:105`. [ref]
46. Cost of a session of its own: the run keeps its own state, its own history and its own session-scoped resources, none of which belong to the conversation that started it. What they share without asking is the user: user- and org-scoped data is the same data on both sides. `bg:95`. Narrower sharing: hand it over as input and report it back; or mark a session-scoped resource `sharedToLineage` and the conversation and every session under it resolve one copy. Session state has no such route. `bg:97`; `docs/contributing/docs-revamp/pages/concepts/resources.facts.md:46`. [page: one sentence; `sharedToLineage` is a link to Resources]
47. A dispatch run is a session of its flow like any other. Read it with the client: `fsd.sessions.list({ flowKind, include: "dispatch-runs" })` (every dispatch run on the flow beside the conversations people started), `fsd.sessions.children(sessionId)` (the runs started from one conversation, one row each), `fsd.sessions.requests(runSessionId)` (one run's history). `bg:76-93`; `srv:233-280`; test `packages/engine/test/session-listing-dispatch-runs.test.ts:97-123`. [page: the client snippet is optional; the routes, row fields, paging and status values are ref]
48. A `ChildSessionSummary` row has eight fields: `id`, `parentSessionId`, `topic`, `coordinate`, `status`, `flowId`, `createdAt`, `updatedAt`. `srv:306`. [ref]
49. `status` on a dispatch row: `active` (waiting in a queue, running, or paused for approval; not distinguished), then `completed`, `failed`, `aborted`, `incomplete`. `srv:324-336`. A task-board job that fails inside a board left on the default `onError` still reads `completed`; the board's task carries the failure. `srv:339-358`. [ref]
50. `wait: true` on a dispatcher: the block's output is how the dispatched request ended, `{ status: "completed", output, requestId }`, `{ status: "failed", error, requestId }` or `{ status: "running", requestId }` at the deadline (five minutes by default; nothing is stopped). It needs durable execution, the durability sweeper and a store that keeps wakes; waits nest five deep. `srv:203-229`; `dsp:92-99`, `dsp:226-233`; tests `packages/core/test/dispatcher-wait.test.ts:69-146`. [ref; page one sentence "a dispatch can wait for the answer, and then it is not background work" is **[verify]**: `wait: true` still runs in a session of its own and the block parks; keep to "it can wait", link to ref]
51. Refusals: a runtime refusal throws `DispatchRefusedError` with `code: "dispatch-refused"` and a `refused` field (`no-entry`, `flow-not-found`, `session-not-found`, `session-not-addressable`, `key-occupied`, `create-refused`, `no-dispatch-operation`, `dispatch-rejected`, `external-dispatcher`). Every refusal is decided before anything starts. `srv:114-135`. [ref]
52. `defineFlow` throws at definition time when `action` names an entry the flow does not declare (`internal.actions.<action>`). `srv:109-112`. [ref]
53. `flowKind` on the dispatcher sends the work to another flow registered on the same server; the other flow replies with a `{ from: true }` dispatcher. Both flows must be on the same server; it is another flow, not another service. `srv:145-201`; `dsp:197-215`. [ref; page: one clause "or into another flow on the same server" is allowed]
54. Dispatch from a task board: `taskBoard({ mode: "delegation", workers: { name: dispatcher({ action, session: "per-task" }) } })` hands each claimed row to a dispatch run; the worker is declared under `task.actions`. `bg:136-181`. The drain returns once rows are handed over; the run settles its row later. `tb:85`. [page: one sentence linking to Tasks and boards (C-21); the code is not shown]
55. **Does a dispatch survive a crash?** It depends on the host. In process with no queue: the run is part of the process, and if the process stops the work is cancelled and its records stay `active`/in-progress until the sweep marks them `interrupted`; nothing restarts it on its own. `srv:377-402`. With `bullmqJobQueue` in `colocated` or `enqueue-only`: a delivery is enqueued and runs in whichever process picks it up, retried. `kfr:209-219`. `bg:193`: on serverless, a dispatched run executes inside the invocation that started it, so the function's duration is the ceiling unless a separate consumer exists. **[page, stated flat: a session of its own is not a separate process; with no queue a dispatch stops when the web process stops; with a queue it runs as a job. Detail ref]**
56. `dispose()` cancels background work rather than marking it finished. The host's `dispatchDrainTimeoutMs` (default 30000 ms) is how long shutdown waits for in-process dispatched work, and queue-backed work is never waited for. `srv:411-418`; `eng:228-247`. [ref]
57. The heartbeat: a flow with `request: { heartbeatIntervalMs: 0 }` can have a long-running request marked `interrupted` while it still runs. `srv:404-409`. [ref]
58. A run started by a dispatcher has `source: "internal"` (or `"task"` for a board worker's dispatch) and `metadata.dispatch`; it cannot be retried, continued or resumed from outside (`404`). `srv:441-477`. [ref]
59. Retrieving the answer without `wait`: have the dispatched work write what it found somewhere both sides can read (a user- or org-scoped resource, a task board) and read it from the conversation. `kfr:228-234`. [page: one sentence in "What it gets you" or in this section; the page's dispatch example may end by naming where the result goes]
60. Delivery without queue: access rules. Listing is scoped to the caller before `include=dispatch-runs` is read: another principal's, another organization's or another tenant's run is absent. `srv:252-259`; test `packages/engine/test/session-listing-dispatch-runs.test.ts:155`. [ref]

## Starting without a person

61. A flow cannot start itself. Something outside has to call the server, and the host turns the call into a run, a wake. Two common sources are a webhook and a scheduler. `kfr:14-18`. [page]
62. **A schedule.** The app fires its own schedules. A schedule is a named entry on the flow with a cron string; one tick in the engine fires every static and stored schedule of every flow through that entry's dispatch endpoint, once per scheduled time. By default a local cron runs the tick each minute in a process that serves the app or works its job queue, one process across servers that share a store (a lease elects it); on Vercel, `scheduler: vercelScheduler()` and one cron route run it instead. `packages/engine/src/execution/schedule-tick.ts`, `packages/engine/src/execution/local-scheduler.ts`, `packages/vercel/src/scheduler.ts`. `kfr:106-109`; `sched:61-96`; `packages/engine/src/transports/scheduled/createScheduledEndpointAdapter.ts` (route: `POST /api/flows/:flowKind/schedules/*scheduleId/dispatch`, mounted by the router on every app). **[answers Q4: the app's own tick calls its dispatch endpoint; a serverless host adds one cron route.]** [page]
63. Surface: `defineFlow({ schedules: { static: { "<id>": defineScheduleBinding({ cron, block }) } } })`; `defineScheduleBinding` from `@flow-state-dev/core` (`packages/core/src/types/schedules.ts:413`); on the host, nothing: the router mounts the scheduled endpoint itself. `kfr:114-145`; `sched:61-96`. Cron strings are POSIX 5-field (`minute hour day-of-month month day-of-week`), validated when the flow is registered. `sched:94`. [page: the two names; the code is optional, one short example is allowed]
64. The dispatch call is checked like any request: the flow's `authentication.resolvePrincipal`, usually a shared bearer secret (`createBearerSecretPrincipalResolver` from `@flow-state-dev/engine`). Without a resolver a flow runs as the development default. `kfr:106-110`, `:147-150`; `packages/engine/src/transports/auth/createBearerSecretPrincipalResolver.ts:54`. [ref; page one clause "checked like any other request"]
65. The dispatch endpoint answers `202` and the run continues after it. `kfr:144-145`. [ref]
66. Stored schedules: a schedule created while the app runs (a reminder a user sets) comes from `schedules.resolve` instead of `schedules.static`; to run something later, store a schedule for the time you want. A `dispatcher()` block has no delay option. `kfr:152-154`; `sched:99-125`. [page: one sentence, since it answers "can a dispatch run later": no]
67. **A webhook.** An event from another service starts a run. The flow names the event and the block: `webhooks: { stripe: { on: { "invoice.paid": defineWebhookBinding({ block, input, sessionId? }) } } }`; the host verifies the signature with `createWebhookTransportAdapter({ providers })`. A bad signature is refused before any block runs; a good one gets `202` at once and the run carries on after the response. `kfr:20-76`; `packages/core/src/types/webhooks.ts:154`; `packages/engine/src/transports/webhook/createWebhookTransportAdapter.ts:66`. [page: one paragraph; code is ref or Webhooks recipe]
68. BullMQ has no schedule path of its own: the engine's local cron ticks in its processes too, elected by the shared store's lease, and a static fire it claims is enqueued like any action; a dynamic one runs in the process that ticked. `packages/engine/src/flowstate/createFlowState.ts` (`#armLocalScheduler`, `#tickRunner`). [page: no sentence needed; B-19 has no schedule wiring]
69. A scheduled run is a fresh run with no caller, not the continuation of an earlier one. It uses the same streaming and recovery machinery as any run. `bg:209`. [page]
70. A webhook run or a scheduled run outlives the call that started it; handing a piece of work off from inside a run is a `dispatcher()`. `kfr:164-169`. [page: this is the join between the two halves of the page]
71. Real-world proof for a scheduled run: a clock routine's POST files exactly one task on the board it names, once per scheduled time across restarts and hosts (two processes posting at once, a restarted one, and a late one still file one task). `goals/scheduled-work/recurring-work-files-a-task/goal.md:7` (Outcome), Signal leg b. [ref]

## What the page must not claim

72. It is **not** true that a side chain's work survives the request: it outlives the sequencer, not the request. `bg:21`; `sc:15`. [page]
73. It is **not** true that a queued run gets its own session. Same request id and same session; it only runs elsewhere. `bg:22`, `bg:64`. [page]
74. It is **not** true that a task board runs anything on its own. Tasks wait (at their status) until a request works through (drains) the board. `bg:207`; `tb:81`. [page]
75. It is **not** true that a dispatch returns a result. It returns `{ sessionId, requestId, adopted }`. `wait: true` is the exception. `dsp:126-135`, `dsp:226-233`. [page]
76. `durable: true` does not move an action to the background (see 2). [do not state]

## Who owns it, who sees it, where it is stored, how many

Answered for each part that stores something. Parts with no stored record say so.

77. **Side chain.** Owner: the request that dispatched it. Stored: nothing of its own. Its block trace goes to the DevTool trace channel; a failure is logged; request-end hooks receive the failed steps. Who sees it: the developer, in the DevTool; nothing reaches the user's stream. How many: as many as the sequencer queues, all on one per-request pool. `sc:13`, `sc:64`, `sc:72`; `reb:67-97`. [page: one clause "nothing is stored"]
78. **Queued run (a job).** Owner: the request it carries (same id, same session, same user). Where stored: a BullMQ queue in Redis (queue name default `"fsd-flows"`, key prefix default `"fsd"`), and the request's own record and item log in the shared stores. A finished job is removed after an hour or 1,000 jobs, a failed one after a day, unless the host changes `retry`; with `deadLetter: true` jobs that exhaust retries go to `<queue>-dlq`. Who sees it: the user sees the request through its stream; the operator sees the queue (the adapter exposes `queue` for Bull Board). How many: one job per action run; a retry is the same job, same request id. `bmq:29-36`, `bmq:60-66`; `rty:9-16`; `bgq:244`, `bgq:248-273`. [ref: retention numbers and DLQ; page: "kept in Redis and the shared stores"]
79. **Dispatch run.** Owner: the user who ran the dispatching request, in the same organization and tenant, on the same flow (or the flow named by `flowKind`). The run records the conversation it was started from (`parentSessionId`). Where stored: the session store, as an ordinary session; its requests, state, resources and history belong to that session. Who sees it: the caller who owns it, through `fsd.sessions.list({ include: "dispatch-runs" })`, `fsd.sessions.children(parent)`, and every session endpoint on its id; another principal, organization or tenant does not. How many: one per key per conversation (the same key from the same conversation adopts the existing run); with `{ id }`, none created. `srv:103-107`, `srv:233-266`, `srv:306-310`; `session-listing-dispatch-runs.test.ts:97-165`. [page: owner and "one per key" in a sentence; the rest ref]
80. **Schedule.** Owner: the flow that declares it (static) or the host's store (dynamic). Where stored: static, in the flow's source (`schedules.static`), nowhere else; dynamic, in an app-owned store (a resource collection, a table or an external service) mirrored into a schedule index (SQLite or Postgres) the tick claims from. Who sees it: the host and the flow; `GET /api/flows/:flowKind/schedules` lists a flow's schedules. How many: one entry per name per flow. `sched:7-18`; `packages/scheduled/src/scheduleIndex.ts`; `packages/engine/src/transports/scheduled/createScheduledEndpointAdapter.ts`. [ref]
81. **Task board rows** are not stored by background work. They are Tasks and boards' (C-21) and a board is not a queue (6). [do not state beyond the link]

## What it gets you

Each point tied to the page's example and observable.

82. **A side chain costs the user no wait.** The reply streams and the chain moves on; `captureMemory` finishes while the request is still open. `bg:43`. [page]
83. **A queued run survives the browser.** The tab can close; the job is in Redis and the processing process continues against the shared stores. A job whose processing process dies is retried. `bg:64`. [page; **Q2**]
84. **A dispatch has a record you can read afterwards.** It is a session: list the runs on the flow, ask a conversation which runs it started, read each run's requests. `bg:74-93`. [page]
85. **One way to watch all three.** Every run has an id, a lifecycle status and an item log; the same tools read all three (`stream()`, `fsd.sessions.requests`, resume from a sequence number, DevTool). `bg:215-220`. [page]
86. **A schedule or a webhook needs no user.** The run exists with no caller on the page; it is a fresh run with its own principal (`system` for a webhook with no resolver). `kfr:89-94`. [page, one sentence]

## How it fits with the others

87. A board is not a queue; it needs a drain, and delegation is how a board hands rows to dispatch runs. `tb:81`, `tb:85`. [page: one sentence, link C-21]
88. Side chains are a sequencer feature, covered on Composition (C-04); this page links, not repeats. `docs/contributing/docs-revamp/pages/concepts/composition.facts.md:120`, `:133`. [page: link]
89. Where a flow starts from outside (webhooks, schedules) is also covered by Serving flows (C-xx, `serving-flows.facts.md:165`): "a flow that hands work on does so with `dispatcher()`, not through a door". The page keeps the distinction: a door starts a flow; a dispatch hands work from inside one. [page, one sentence]
90. Heartbeat is not a wake: the signals that keep a live stream open never start a run. `kfr:264-266`. [ref]

## Cold-read questions this sheet answers

- **Q1** Summarise after replying, losing it on a crash is fine: side chain (14-18, 23).
- **Q2** A ten-minute report, the user closes the tab: queued run (27-29, 83). A dispatch also outlives the request but is a session of its own and, with no queue, still lives in the server process (55).
- **Q3** A task board is not a background queue (6, 13, 74, 87).
- **Q4** Something runs every morning with no user: the app's own tick calls the schedule's dispatch endpoint; on a serverless host one cron route runs the tick (62-68).

## Edge cases the page may test

- A side chain throws after the reply: the user sees nothing, the request stays `completed`, the failure is in the DevTool trace (4, 24).
- The user hits Stop while a side chain runs: the task is told to stop; the request waits for it and ends `aborted` (3).
- The same dispatch key twice from one conversation: one session, `adopted: true` the second time (43, 44).
- The same key from a different conversation: a different run (45).
- A processing process dies mid-job: retried, same request id (29).
- A `process-only` process: no runner installed; an action there runs inline (32).

## Open for the caller

- The sitemap's "action's background setting" does not exist (1). The example line becomes the `jobQueue` option on `createFlowState`.
- Q2 has two defensible answers on a host with no queue. The cold-read key should say "queued run", which is the one that keeps going when the web process is the thing that is lost; both mechanisms outlive the request.
- The sitemap's stated limit "dispatch ... outlives the request" holds; whether it outlives the process depends on the host (55). The figure's third row ("the process") should be drawn so a dispatch run on a host with no queue does not appear to outlive it.

## Revise round 1 notes

- Corrected: schedule ids are lowercase letters, digits and dashes (`packages/core/src/types/schedules.ts:271`, `:313-318`), so the example is `daily-digest`. A long-lived host also ticks stored schedules each minute (`schedules.ts:238-246`; `packages/scheduled/src/tick.ts:3`), so the page no longer says the framework runs no clock. Static entries are fired by an external scheduler.
- Corrected: a session resource declared `sharedToLineage` is shared with the dispatched session as well as user-scoped data (`docs/architecture/state-and-scopes.md:648-669` read for behaviour only).
- Default `bullmqJobQueue` mode is colocated: one process takes and runs jobs (rows 30-31). The page no longer says actions leave the web process.
- Moved to Reference (R-19 `../reference/background-work.md`, R-05 flows, R-33 schedules): side chain lifetime and failure detail (rows 3, 4, 19, 24-26), queued run retry rule and `mode` options (29-33), dispatch return shape and `session` options (43-45), what a dispatch outlives (55), no delay option (66), how each kind is watched (85), schedule firing rules and principal (62-66, 86), `internal.actions` rule (40).
- Cut: "principal" and "no caller" (a schedule firing is "a fresh run that no user started"); the schedule point from What it gets you (four points now).

## Revise round 3 notes

- Page wording only; no fact changed. BullMQ's repeating jobs POST to the same dispatch endpoint an outside scheduler calls (row 68), so the page names Vercel Cron and BullMQ separately. The request waits for side chains before its stream closes (row 17), so "finishes while the request is open" holds. The three TS examples' only type errors were the page's own unshown sibling blocks, which the prose says live in their own files; declined as a change.

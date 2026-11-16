# Fact sheet: Concurrency policies (R-18, reference, `reference/concurrency`)

Pass 1. Cites only: the existing page (`apps/docs/docs/advanced/concurrency-policies.md`, "OLD" below,
and its revamp copy `docs/contributing/docs-revamp/pages/reference/concurrency.md`, which differs
only in frontmatter), exported surface and doc comments, tests, and the `@flow-state-dev/bullmq`
README. No spec was read. Source files are abbreviated: `core/types/concurrency.ts` is
`packages/core/src/types/concurrency.ts`, `arbiter.ts` is
`packages/engine/src/transports/concurrency/arbiter.ts`, `lease-backend.ts` (engine) is
`packages/engine/src/transports/concurrency/lease-backend.ts`, `errors.ts` is
`packages/engine/src/transports/errors.ts`.

Page shape from the sitemap: tables, each policy with what a second request on one session does;
lookups "What is the default?" and "Which policy queues?". No narrative. Kept from OLD, trimmed.

## 1. The setting

| # | Fact | Source |
|---|------|--------|
| 1.1 | A policy is declared on an action as `concurrency`, or flow-wide as `request.concurrency`. | `packages/core/src/types/flow.ts:253`, `:477` |
| 1.2 | Resolution: `action.concurrency ?? flow.request.concurrency ?? "allow"`. Unset everywhere, the action runs as `allow`. | `flow.ts:247-253` (doc comment), `arbiter.test.ts:36-58` (`packages/engine/test/transports/concurrency/arbiter.test.ts`) |
| 1.3 | Shape: a policy name string, or `{ policy, key? }`. The string form uses the `"session"` key. | `core/types/concurrency.ts:92-94`, `:85-91` |
| 1.4 | Implemented names: `allow`, `queue`, `reject`, `hold`, `defer`. | `core/types/concurrency.ts:97`, `:16` |
| 1.5 | `debounce` and `restart` are reserved names. Declaring either throws at definition time (the flow fails to build) with a message saying it is "reserved but not implemented". An unknown name throws too. | `core/types/concurrency.ts:121-142`; called from `packages/core/src/flow/defineFlow.ts:1582-1589` |
| 1.6 | An unsupported `key` value throws at definition time. Valid: `"session"`, `"user"`, `"none"`, a function. | `core/types/concurrency.ts:144-154` |
| 1.7 | The same declaration governs every arrival path: HTTP, webhooks, schedules, MCP, dispatches from other flows. Enforced once at a shared seam. | `core/types/concurrency.ts:1-14`; OLD:60 |
| 1.8 | Task entries and internal entries declare `concurrency` the same way as caller actions. A task entry that reaches a board and a shared child session, or one with `from`, defaults to `queue` when it sets no policy. (Candidate row for the page; the observable default for task entries differs from the `allow` default. Pass 5 should confirm with a run.) | `flow.ts:247-253`; `defineFlow.ts:1074-1088` |

### Key (what two requests contend on)

| Key | Resolves to | Source |
|-----|-------------|--------|
| `"session"` (default) | tenant-namespaced session id. No session: no key, so no arbitration, runs as `allow`. | `arbiter.ts:175-198`; `core/types/concurrency.ts:55-57` |
| `"user"` | tenant-namespaced user id; one policy line per user across all their sessions. | `arbiter.ts:199-200`; `arbiter.test.ts:86` |
| `"none"` | no arbitration. | `core/types/concurrency.ts:58`; `arbiter.test.ts:96` |
| function `(ctx) => string \| undefined` | custom key. `undefined` opts the request out (runs as `allow`). | `core/types/concurrency.ts:59-60`; `arbiter.test.ts:146` |

- 1.9 Namespacing is `tenantId:id`, or the bare id when there is no tenant. `arbiter.ts:177-178`.
- 1.10 Key function context (`ConcurrencyKeyContext`): `flowKind`, `actionName`, `sessionId?`, `userId`, `tenantId?`, `orgId?`, `source?`, `metadata?`. Exported from core. `core/types/concurrency.ts:74-83`.
- 1.11 MCP calls carry no session, so under the default key they run unarbitrated. OLD:83; `arbiter.test.ts:140` ("resolves an undefined session (MCP / ephemeral) to undefined").
- 1.12 Webhook key example: the delivery id is at `ctx.metadata.webhook.deliveryId` (OLD:75-80; sample code on OLD, to be re-checked against `packages/engine/src/transports/webhook/` by pass 5).
- 1.13 A caller cannot choose the policy: a request body or metadata naming another policy is ignored; the flow's declaration holds. `host-concurrency-hold-defer.test.ts:293-347` (`packages/engine/test/transports/`), `arbiter.test.ts:106-138`.

## 2. The policy table (what a second request on one session does)

| Policy | A second request on the key while one is running | Source |
|--------|--------------------------------------------------|--------|
| `allow` (default) | Runs at once, beside it. Takes no place. | `core/types/concurrency.ts:26-27`; `arbiter.ts:20-22` |
| `queue` | Waits its turn; runs after the one ahead finishes. Arrival order (FIFO), one at a time. Fails `ConcurrencyQueueTimeoutError` (status 503) after waiting 30 s. | `core/types/concurrency.ts:28-29`; `lease-backend.ts:186`; `errors.ts:103-116`; `arbiter.test.ts:210-234` |
| `reject` | Dropped. The caller gets a refusal naming the in-flight request id. Nothing is created for the dropped request (no request record, no stream). | `core/types/concurrency.ts:30-31`; `arbiter.ts:15-18`; `errors.ts:62-76`; `arbiter.test.ts:171-195` |
| `hold` | Runs at once, like `allow`, and marks the key busy while it runs. Never waits, never refused. | `core/types/concurrency.ts:32-35`; `hold-defer.test.ts:112` (`packages/engine/test/transports/concurrency/`) |
| `defer` | Waits until nothing on the key is running or waiting, then runs and occupies the key. Several deferred requests run one at a time. | `core/types/concurrency.ts:36-40`; `host-concurrency-hold-defer.test.ts:127-195` |

Lookups the sitemap asks for:

- **What is the default?** `allow`. Both levels unset. `flow.ts:253` ("Default when unset: `"allow"`"), `:477`; `arbiter.test.ts:36`.
- **Which policy queues?** `queue` queues in arrival order. `defer` also waits, but for the key to empty, not for its turn in line (see 2.3). `hold` and `allow` never wait.

### How the policies see each other on one key

| Running or waiting on the key | `hold` request | `defer` request | `queue` request | `reject` request | `allow` |
|---|---|---|---|---|---|
| nothing | runs | runs | runs | runs | runs |
| a `hold` | runs at once, beside it | waits until every running `hold` ends | waits behind it | refused | runs |
| a `defer` | runs at once, beside it | waits its turn (deferred requests run one at a time) | not stated in OLD; pass 5 to run | not stated in OLD; pass 5 to run | runs |

- 2.1 `queue` and `reject` see a running `hold`: a `queue` request waits for it, a `reject` request is refused while it runs. Tests: `hold-defer.test.ts:133` (reject sees a running hold as the holder), `:146` (queue waits behind a running hold). OLD:129.
- 2.2 A `hold` never waits, even behind another `hold`. `hold-defer.test.ts:112`.
- 2.3 A waiting `defer` waits for every running `hold`, including one that started after it began waiting. `host-concurrency-hold-defer.test.ts:149`. This yielding to newer `hold` runs lasts 30 s at most (`DEFER_PATIENCE_MS = QUEUE_WAIT_TIMEOUT_MS`, `lease-backend.ts:241`; `arbiter.ts:362-369` doc on `deferPatienceMs`; `hold-defer.test.ts:280`). After it, the `defer` waits only for the runs on the key at that moment, then runs, with no further time limit (`lease-backend.ts:268-279`, `planDeferWait`).
- 2.4 The `defer` wait has no time limit (it ends when the requests ahead end, however they end: finish, throw, cancel). `core/types/concurrency.ts:36-40`; `host-concurrency-hold-defer.test.ts:260-291` (hold aborted or thrown still lets the deferred run).
- 2.5 A cancelled waiting `defer` never runs. OLD:125 (pass 5: find a test; `hold-defer.test.ts:259` covers a withdrawn `defer` freeing its cap slot).
- 2.6 A `defer` request's request id and stream are available at once; the stream stays open while it waits. OLD:125. Not found in tests; pass 5 to confirm or cut.
- 2.7 Once a deferred request starts, it waits for nothing else; a message sent while it runs starts at once, beside it. OLD:138; `host-concurrency-hold-defer.test.ts:217-258` (hold behaves as allow).
- 2.8 Another session's key never contends: a `defer` does not wait on a `hold` in another session. `host-concurrency-hold-defer.test.ts:204`.
- 2.9 A caller who does not own the session cannot use up the defer cap or mark the session held. `host-concurrency-hold-defer.test.ts:374-420`; bullmq README:76.

## 3. Limits and numbers

| Number | Meaning | Source |
|--------|---------|--------|
| 30 s (30,000 ms) | `queue` wait before `ConcurrencyQueueTimeoutError` | `lease-backend.ts:186` |
| 30 s | how long a waiting `defer` yields to `hold` requests that start after it | `lease-backend.ts:241`; `arbiter.ts` `deferPatienceMs` doc |
| 32 | most `defer` requests waiting on one key, per server process | `arbiter.ts:373` (`MAX_DEFERRED_PER_KEY`), `:359` |
| 2 s | longest gap between a waiting run's turn checks (backoff cap) | `lease-backend.ts:191` (`QUEUE_WAIT_CAP_MS = 2_000`) |
| 10 s (10,000 ms) | default lease of a place in line with `bullmqJobQueue` | `packages/bullmq/src/lease-backend.ts:43,169`; option `leaseMs` at `packages/bullmq/src/flowstate-adapter.ts:46-52`, passed through at `:91` |
| 10 min (600,000 ms) | default sweeper cadence (`sweepIntervalMs`) | `packages/engine/src/durability/durability-sweeper.ts:96`, `:162` |

- 3.1 The cap of 32 is per key, per process. On a queue, a request counts from acceptance until its job ends, including while it runs. bullmq README:76; `arbiter.ts` doc on `maxDeferredPerKey` and the `release/jobEnded` doc.
- 3.2 Past the cap the request is refused as `reject` refuses (409 over HTTP, skipped 200 for webhooks and schedules, server-busy for MCP), with nothing created. Error class `ConcurrencyDeferLimitError` extends `ConcurrencyRejectedError`, carries `limit`. `errors.ts:85-96`; `host-concurrency-hold-defer.test.ts:350`; `hold-defer.test.ts:230` (admitted again once the line drains).
- 3.3 A `defer` that was withdrawn (cancelled) while waiting does not use up the cap. `hold-defer.test.ts:259`.
- 3.4 `QUEUE_WAIT_TIMEOUT_MS` counts only time waiting for the key, not time queued behind unrelated work. `lease-backend.ts:219-232` (`planQueueWait` doc).

## 4. What a refused or timed-out caller gets, by transport

| Transport | `reject` (and `defer` past the cap) | `queue` timeout | Source |
|-----------|--------------------------------------|-----------------|--------|
| HTTP action | `409`, body `{ error: "ConcurrencyRejected", message, requestId }`, `requestId` = the in-flight request | `ConcurrencyQueueTimeoutError`, status 503 (`status` property; the HTTP body shape is not shown in code read: pass 5) | `packages/engine/src/routes/concurrency-refusal.ts:23-40`; `errors.ts:103-116` |
| Webhook | `200 { status: "skipped", reason: "in_flight", requestId }` | not stated | `concurrency-refusal.ts:28-34`; `packages/engine/src/transports/webhook/routes.ts:236-264` |
| Schedule | `200 { status: "skipped", reason: "in_flight", requestId }` | not stated | `packages/scheduled/src/routes.ts:292-317` |
| MCP | JSON-RPC server-busy error, `retryable: true` | same server-busy error, `retryable: true` | `packages/mcp/src/createMcpTransportAdapter.ts:427-434`, `:453-465` |

- 4.1 Reason for the webhook/schedule `200`: the provider stops retrying. OLD:157. Keep as one clause at most.
- 4.2 A `queue` timeout is safe to retry with backoff (error doc: "Retryable with backoff"). `errors.ts:98-102`.
- 4.3 `reject` catches a duplicate only while the first is running. A redelivery after the first finished needs an idempotency key. OLD:162. Link to `reference/idempotency`.
- 4.4 Error classes exported: `ConcurrencyRejectedError` (status 409, `key`, `inFlightRequestId?`), `ConcurrencyDeferLimitError` (adds `limit`), `ConcurrencyQueueTimeoutError` (status 503, `key`, `timeoutMs`), `ConcurrencyLeaseLostError` (`key`). `errors.ts:62-135`. (Pass 5: confirm which of these are exported from a public package path before the page names them as importable.)

## 5. Requests that pause and resume

- 5.1 A request that suspends to wait for a user gives up its place on the key. When it resumes it takes a new place like a fresh request. OLD:166. Supporting code: `arbiter.ts:210-226` (`continuationDecision`: "the request was already admitted").
- 5.2 On resume, `queue`, `reject` and `defer` all wait as `queue` does (same 30 s budget, no refusal, not dropped); `allow` and `hold` run at once (`hold` marks the key busy). `arbiter.ts:222-226` (`continuationDecision`).
- 5.3 If the session is still busy after 30 s, the resumed request stays paused with the answer saved and the sweeper continues it on a later pass (default every 10 min). OLD:168; sweeper cadence at `durability-sweeper.ts:96`. Behavior of "stays paused" is from OLD only: pass 5 to confirm.
- 5.4 The resume call itself does not wait for the turn: it replies at once, `202` with `{ requestId }`, or an event stream if asked. `packages/engine/src/routes/resume-routes.ts:262-270`. A resumed request that runs out of time does not fail with a 503. OLD:172 (not tested in what was read).
- 5.5 `session.abortRequest()` while a resumed request waits for its turn fails with `409`, error text: `Request "<id>" was resumed before the stop reached it; stop it again to stop the running turn`. The request status reads `suspended` until it runs, then `in_progress`. `packages/engine/src/routes/abort-routes.ts:66-70`; status transitions from OLD:174 (pass 5 to confirm).
- 5.6 "Stream closes with no events and the request stays `suspended` until the sweeper continues it" (OLD:172): no code or test cited here. Pass 5 to confirm or cut.

## 6. Across processes

| Deployment | Where the policy holds | Source |
|------------|------------------------|--------|
| One server, no queue | in memory, in the process that runs the request | OLD:180; `arbiter.ts:30-41` |
| Queue-backed (`bullmqJobQueue`) | across every process: the web process and each one processing jobs, over the same Redis as the queue | `packages/bullmq/README.md:66-68`; `packages/bullmq/src/flowstate-adapter.ts:11-14,87-98`; `packages/engine/src/flowstate/types.ts:96-113`; OLD:181 |
| Several web servers, each running requests in process, no queue between | each server keeps its own keys; two requests on one session can run at once if they land on different servers | OLD:182; `arbiter.ts:35-40` ("`arbitratesAcrossProcesses` is false") |
| A runner passed straight to `createFlowState`, not via a `jobQueue` adapter | applies no policy to the work it dispatches; a delivery into an existing session is refused with `external-dispatcher` | OLD:183; `arbiter.ts:35-40` |

On a queue (bullmq README:66-78, OLD:185-197, `lease-backend.ts` engine `planQueueWait`):

- 6.1 A run takes its place on the key when accepted; runs start in accepted order.
- 6.2 A waiting job never holds a job slot: it goes back on the queue as a delayed job for at most 2 s between checks (not counted as a BullMQ attempt). bullmq README:68; `lease-backend.ts:191`.
- 6.3 A retried job keeps its place; the next job in line starts as soon as a run finishes. bullmq README:68.
- 6.4 `hold` and `defer` work the same on a queue. A `hold` key reads busy from acceptance until the run ends. A waiting `defer` holds no key for its first 30 s of waiting, so `queue` requests do not wait behind it and `reject` requests are not refused because of it; once it lines up behind the running replies, or starts, it holds the key. bullmq README:72; OLD:189.
- 6.5 Lease: a place has a lease (`leaseMs`, default 10 s) the process running the job keeps renewing. That process dies: key frees when the lease runs out. Alive but cannot reach Redis to renew: it aborts the run's signal at half the lease, and the request ends `interrupted`. A run that honours `ctx.signal` has stopped before another run can take the key; one that ignores it can overlap the next. bullmq README:78; `errors.ts:118-135` (`ConcurrencyLeaseLostError`).
- 6.6 A deferred request waiting on another server starts once a crashed server's lease runs out. bullmq README:74; `hold-defer.test.ts:169-200` ("runs once the crashed process's place expires, and not before"; live process that renews keeps the key held, `:202`).
- 6.7 Redis unreachable when a run needs a place: the run is not started and the caller is told why. It never goes ahead without the policy. `arbiter.ts:34-35` ("An unreachable backend refuses the dispatch; nothing runs unarbitrated"). OLD:195.
- 6.8 Delivery into an existing session (`dispatcher()` with `session: { id }`) runs under the recipient's policy. Declare `concurrency: "allow"` on an entry that should run in parallel. bullmq README:70.
- 6.9 Lease length, rollout order, sizing: bullmq README section "Concurrency across workers" (link target kept from OLD:197).

## 7. Other facts the old page states (decide in pass 6 whether each is a row or goes)

- 7.1 `allow` leaves to you: a state update computed from current state is refused and retried if another run moved the record first; an increment or append is applied to whatever the store holds; two runs can still overwrite one field, and two replies to one session can interleave. OLD:26. State-layer behavior; point at `fundamentals/state-operations` CAS section (OLD:202).
- 7.2 `autoResume: false` on an action: its request does not become the session's reattach target (`latestRequestId`). The request is still recorded and listed. Default `true`. A client reattaching (`useSession` with `autoResume`) finds the previous request instead. `packages/core/src/types/flow.ts:254-261`; `packages/engine/src/execution/runAction.ts:1590-1608`. Example use: a `steer` control beside a `queue` turn (OLD:33-37).
- 7.3 Scheduled `onOverlap`: `"skip"` is `reject` keyed on the schedule id; `"allow"` is `allow`. `packages/core/src/types/schedules.ts:197` (type); mapping from OLD:201 and `core/types/concurrency.ts:6-8`. Pass 5 to confirm "keyed on the schedule id" from `packages/scheduled`.
- 7.4 `debounce` will collapse a burst; `restart` will cancel in flight. Both are reserved names that throw now. OLD:206-207. A Reference row needs only the throw (1.5); "coming next" prose is not behavior and is cut.

## 8. Stored data: the four questions

A concurrency policy stores no user-owned data. The parts it touches:

| Part | Who owns it | Who can see it | Where it is stored | How many |
|------|-------------|----------------|--------------------|----------|
| The policy declaration | the flow author, on the action or `request` | anyone reading the flow definition | in the flow definition (code); no store | one per action, plus one flow default |
| A place on a key (the line) | the process running the request (web or job processing) | nobody through the API; its holder shows up as `requestId` in a `reject` refusal | in memory of the running process by default; in Redis when `bullmqJobQueue` supplies the backend (`packages/bullmq/src/lease-backend.ts`) | one line per key; one place per queued, held or deferred request; at most 32 waiting `defer` per key per process |
| The refused request | nobody: nothing is created for a `reject`, or for a `defer` past the cap | n/a | not stored | none |
| A request waiting for its turn | the session's user (a normal request record) | the owner through request status | the request store | one per request |

- 8.1 Nothing is created for a refused `reject`/over-cap `defer` request: no request record and no live stream. `arbiter.ts:15-18`, `:357-358` ("before anything is written for it").
- 8.2 Keys are tenant-namespaced, so identical ids in two tenants never collide. `arbiter.ts:175-178`.
- 8.3 The in-memory arbiter state is lost when the process dies; with Redis, a dead processing process's places expire with the lease. `lease-backend.ts` (bullmq) and bullmq README:78. Pass 5: confirm the "lost on process death" for the in-memory default (in-memory places "do not expire", `arbiter.ts:~106`).

## 9. Left out, for lack of an observable surface or because it is not Reference

- Design-history phrases in the doc comments ("generalization of the scheduled-action `onOverlap` idiom", "fast-follow", "v1"). Not quotable.
- Backoff constants other than the 2 s cap (50 ms base, 10 ms floor, jitter). Mechanism, not observable behavior.
- "Coming next" section (OLD:204-207).
- The "split append from respond" chat pattern and the `reportResult`/`respond` hold-and-defer worked example (OLD:85-115): examples for a concept page, not Reference rows.

## 10. Contradictions and doubts for pass 5

1. `ConcurrencyDeferLimitError` is a subclass of `ConcurrencyRejectedError`, so the HTTP body for an over-cap `defer` carries `error: "ConcurrencyRejected"` (`concurrency-refusal.ts:36`), not a defer-specific code. OLD says "409 over HTTP" only. Consistent.
2. OLD:17 says the `queue` timeout is "status 503". The error's `status` is 503 (`errors.ts:104`); no route that maps it to an HTTP response was read. Pass 5 should find the HTTP mapping (or state it as the error's `status`).
3. OLD:20 says `defer` "waits until nothing on the key is running or waiting", while the shipped doc comment says "no request holds or waits on the key" (`core/types/concurrency.ts:36-37`). Same meaning.
4. OLD:127 gives a ten-second lease default for the BullMQ adapter, `bullmqJobQueue` (`packages/bullmq/src/index.ts:9`). Default confirmed: `packages/bullmq/src/lease-backend.ts:43,169`.
5. The in-process (no-backend) arbiter is described in OLD as "enforced in memory". Confirmed by `arbiter.ts:30-41`.

## 11. Revise round 1 (pass 8): changes to what the page states

- 11.1 The page was restructured into tables. Sections the page no longer carries, each owned by another Reference page, whose facts stay in sections 5, 6, 7 above for that page's own fact sheet: pause and resume behavior (5.1 to 5.6, R-17 `reference/durable-execution`), queue-backed behavior and lease (6.1 to 6.7, R-19 `reference/background-work` and the bullmq README), `autoResume` (7.2, R-05 `reference/flows`), `onOverlap` (7.3, R-33 `reference/schedules`), concurrent state writes (R-07 `reference/state-operations`). The page links to each.
- 11.2 The cap of 32 is per key and counted in the process that accepted the request, not across a queue-backed deployment (bullmq README:76; `arbiter.ts` doc on `maxDeferredPerKey`). Resolves doubt 1 of pass 7: one scope, per accepting process.
- 11.3 An MCP call has a session only when its action sets `mcp.session`: a string template mints an id per call, `{ fromInput }` reads the id from the call's input. Otherwise no session, so no arbitration under the default key. `packages/mcp/src/createMcpTransportAdapter.ts:408`, `:482-504` (`deriveSessionId`).
- 11.4 A waiting run on a queue is rechecked at most 2 s apart (6.2), so the page says it starts within about two seconds of its turn coming; the bullmq README adds that the next job in line starts straight away when a run finishes (6.3). That sentence now lives in R-19, not on this page.
- 11.5 The "Coming next" roadmap, the debounce sentence and the rollback rationale for `restart` are cut. The page states only that both reserved names throw at definition time (1.5).
- 11.6 The chat "split append from respond" example is replaced by one flow example (`src/flows/support/flow.ts`) that shows the flow default, `allow`, `hold`, `defer` and an inherited action; its block imports are app files.

## 12. Revise round 2 (pass 8)

- 12.1 `allow` is the default and runs beside the first request; page no longer calls parallel runs non-corrupting, it points at the `allow` table (7.1).
- 12.2 A `hold` request is never refused, including while a `reject` request holds the key: `hold` takes a place without the `ifEmpty` check, so it runs at once. Only `reject` (and `defer` past the cap) throws `ConcurrencyRejectedError`. `arbiter.ts:575-579`, `lease-backend.ts:353-360`.
- 12.3 The state-update retry in the `allow` table is the framework's: an updater can run again on a conflict (core README, `updateStateWith`).
- 12.4 `external-dispatcher` is a value of `refused` on `DispatchRefusedError`, thrown by `dispatcher()`. `packages/core/README.md:765-776`.
- 12.5 The 32-request cap is stated once in the cap row (per key, per server process) and once under "On a queue" (counted in the accepting process, from acceptance until the job ends). Same rule (11.2).

- 11.7 Examples import their blocks from `./blocks/<name>` (app files, one per file). The page names each in a clause after the example and does not print them; the pass-4 type-check passes once those modules exist.

# Fact sheet: Pause, resume and replay (R-17, reference, `reference/durable-execution`)

Pass 1. Cites only: existing user docs (`apps/docs/docs/advanced/durable-execution.md` = DE,
`block-memoization-and-replay.md` = BM, `idempotency.md` = ID, `generator-and-router-suspend-resume.md` = GR,
`apps/docs/docs/api/cli.md` = CLI, `apps/docs/docs/advanced/concurrency-policies.md` = CP), exported surface and
doc comments, tests, `goals/`. No spec, issue, PR or commit was read. The moved-row list came from the
`*.record.md` grep in the brief; those are page records, not specs.

Path abbreviations (all under `packages/`): `core/` = `core/src`, `eng/` = `engine/src`, `engT/` = `engine/test`,
`cli/` = `client/src`, `con/` = `contracts/src`, `fsdev/` = `fsdev/src`.

Page shape from the sitemap: tables, no narrative. Tables: what `suspend` returns · what runs again on resume ·
idempotency keys · several pauses in one run · pausing in generators and routers · retention and cleanup · errors.
Figure: *A request's states* (state figure). Lookups: Which blocks are skipped on resume? · How long is a paused run
kept? · What happens to a pause nobody resolves?

**Code evidence used:** `[T]` a test or goal asserts it. `[C]` read from code, no test found. `[D]` only an existing
page states it (pass 5 to settle or cut).

## 0. Conflicts found: the old pages are wrong or stale on these (the code wins)

| # | Old page says | Code says | Source |
|---|---|---|---|
| 0.1 | ID:80 "Crash recovery starts fresh. ... the recovered request has a new `requestId` and therefore an empty `runOnce` namespace." | True of `retry` only. `continue` and `resume` keep the request id, so `ctx.idempotencyKey` and `runOnce` records are the same on a continued run. | `eng/execution/request-continuation.ts:78-95` (same id), `eng/execution/executeBlock.ts:217` (key = `${requestId}:${blockPath}`), `engT/suspension-resume.test.ts:886` `[T]` ("runOnce dedups ... across resume"), `engT/idempotency-runonce.test.ts:226` `[T]` (a fresh request id starts empty) |
| 0.2 | DE:332 "A suspension that allows no `reject` (an input form) is only marked `expired`." and DE:260 "Any other gate is marked `expired`, and the resume endpoint refuses it from then on." | A user's input or review (`user_input`, or `ctx.suspendForUser` of kind `input` or `review`) also continues at its deadline: the block gets `SuspensionTimeoutError`. Only a custom or `external_event` gate that allows no `reject` is merely marked `expired`. | `core/types/wait-gate.ts:77-84` (`continuesAtExpiry`), `eng/context/createExecutionContext.ts:260-277` (`rejectionOf`), `engT/suspend-for-user.test.ts:170` `[T]` |
| 0.3 | GR "A suspending tool shouldn't rely on a resume timeout ... surfaced as a run failure". | An approval gate that expires inside a tool becomes a denial result for the model ("no longer valid"); the run goes on. Only an input or review timeout in a tool (`SuspensionTimeoutError`) fails the run. | `core/blocks/generator.ts:1768-1790` (denial, `expired: true`), `:1805-1812` (timeout rethrown) `[C]` |
| 0.4 | DE: `SuspensionTimeoutError` is not mentioned among "Two errors". | There are three: `SuspensionError`, `SuspensionRejectedError`, `SuspensionTimeoutError`. Plus `RouteUnavailableError`, `GeneratorToolUnavailableError`, `RecordedValueOmittedError` on resume. | `core/errors/suspension-error.ts:76,131,180`; sections 8 |
| 0.5 | DE "`durable` on a sequencer ... An action doesn't need `durable: true`"; the example sets `sequencer({ durable: true })`. | Sequencer `durable` defaults to `true`; the example's `true` is redundant. The action-level `durable` flag only decides whether a completed request's suspension records and lease are cleaned up. It does not gate suspending or checkpointing. | `core/blocks/sequencer.ts:1221`; `core/types/flow.ts:236-243`; `eng/execution/runAction.ts:2917` |
| 0.6 | BM/ID "`runOnce` is a handler primitive. Generators and the composition layer don't get it." | `runOnce` is declared on `BlockContext` for every block kind, built once per request. Only a handler tool is tested. Not verified for generator or DSL-callback contexts. `[D]` | `core/types/block.ts:597`, `eng/context/createExecutionContext.ts:3989`, `engT/generator-suspension-resume.test.ts:878` (handler tool) |
| 0.7 | DE frames retention as "Retention is opt-in ... Omitting `durabilityRetention` leaves records in place — nothing is deleted without you asking." | Mostly right, but a request that **completes** removes its own suspension records and lease with no config. Only the pruning of old rows needs `durabilityRetention`. | `eng/execution/runAction.ts:2917-2927`, `engT/durable-completion-cleanup.test.ts:42` `[T]` |
| 0.8 | Old pages never state it. | Resume, retry and continue refuse (answer as not found) a request whose source is `webhook`, `task` or `internal`; allowed: `http`, `mcp`, `scheduled`, plus a host's `publicReentrySources`. The `answer` route is open to every source but takes user stops only. | `eng/routes/public-reentry.ts:58-62`; `eng/routes/resume-routes.ts:118`; `eng/routes/answer-routes.ts:4-22` |
| 0.9 | Old sentence shape "resolved suspensions kept 7 days" | Measured from `resolvedAt`; a request that completes deletes them at once (0.7), so the 7 days applies to the gates of requests that did not complete (failed, aborted, stopped) and to a resolved gate whose request is still running. | `eng/durability/durability-sweeper.ts:155` `[T]` `engT/durability-sweeper.test.ts:154,169` |

Words the page must not use (retired-terms check): the two old `human_*` reason names. The code refuses a new
suspension that uses them with a message naming the `user_*` rename. State only `user_approval` and `user_input`.
`eng/context/createExecutionContext.ts:4449-4452`, `core/types/suspension.ts` (via contracts `con/types/suspension.ts:55-60`).

## 1. What `ctx.suspend` takes and returns

`ctx.suspend?(options): Promise<unknown>` is optional on the context type (`core/types/block.ts:607`), so TypeScript
code writes `ctx.suspend!(...)`. `ctx.suspendForUser` is not optional (`:619`).

### 1.1 `SuspendOptions` (`core/errors/suspension-error.ts:21-60`)

| Field | Type | Fact | Source |
|---|---|---|---|
| `reason` | `"user_approval" \| "user_input" \| "external_event" \| string` | Required. Any string allowed. The two `user_*` names and `ctx.suspendForUser` make it a user's stop (`isUserSuspension`). | `con/types/suspension.ts:43-47`, `:79-92` |
| `kind` | `"approval" \| "review" \| "input"` | Set by `suspendForUser`. A raw `ctx.suspend` leaves it unset; it then reads off the reason (`user_approval` is approval, any other user reason is input). | `con/types/suspension.ts:61-70`, `:96-105` |
| `title` | `string` | Short heading; `message` becomes the body (may be markdown). | `suspension-error.ts:31-37` |
| `message` | `string` | Optional. When omitted the error text is `Flow suspended: <reason>` and that is what the item carries. | `:103-104` |
| `data` | `Record<string, unknown>` | Stored on the record and on the `suspension` item; client-visible. | `eng/execution/runAction.ts:2483-2545` |
| `resumeSchema` | Zod schema or JSON Schema object | Normalized to a plain JSON Schema for storage; the resume and answer routes validate `submit` (and an `approve` that carries data) against it. | `suspension-error.ts:62-77`, `eng/routes/resume-routes.ts:198-213` |
| `timeoutMs` | `number` | Deadline: `expiresAt = now + timeoutMs`. Omitted (or 0): no deadline. | `runAction.ts:2471` |
| `render` | `{ component, props? }` | Hint for a client screen. | `suspension-error.ts:43` |
| `allow` | `ResumeAction[]` | Defaults by reason: `user_input` gives `["submit"]`; everything else including `user_approval`, `external_event` and custom reasons gives `["approve", "reject"]`. Add `"skip"` for an optional step. | `core/errors/resolve-allowed-actions.ts:16-21` `[T]` `engT/suspension-resume-generalized.test.ts:305` |
| `suspensionId` | `string` | Optional caller-chosen id, unique within the request and identical on every replay of the call; else minted. | `suspension-error.ts:53-58`, `createExecutionContext.ts:4469` |

### 1.2 What `ctx.suspend` returns

| Situation | Result | Source |
|---|---|---|
| First reach, durable host | Throws `SuspensionError`, a control-flow signal. Rescue handlers do not fire for it, and it is not a block failure. The request pauses. | `core/blocks/sequencer.ts:1040-1046` `[C]`; `eng/execution/runAction.ts:2454` |
| On the resolving resume, action `approve` or `submit` | Returns the payload (`resumeData`), `undefined` when none was sent. | `createExecutionContext.ts:4443` `[T]` `engT/suspension-resume.test.ts:203` |
| action `skip` | Returns the `SUSPENSION_SKIPPED` symbol (import from `@flow-state-dev/core`). It never crosses the wire; only `resolution: "skipped"` is stored; the symbol is rebuilt on live continuation and on replay. | `core/types/suspension.ts:42`, `createExecutionContext.ts:4442`, `engT/suspension-resume-generalized.test.ts:126,164` `[T]` |
| action `reject` | Throws `SuspensionRejectedError` (fields `suspensionId`, `rejectedBy`, `rejectionData`, `expired`, `cancelled`). | `suspension-error.ts:131-165`; `engT/suspension-resume.test.ts:293` `[T]` |
| A gate that allows `reject` past its deadline (an approval, or a custom gate whose `allow` includes `reject`) | Throws `SuspensionRejectedError` with `expired: true`, message "Suspension <id> expired and is no longer valid". | `suspension-error.ts:155-160`, `createExecutionContext.ts:260-278` |
| Gate (user's) cancelled with its task | Throws `SuspensionRejectedError` with `cancelled: true`. | `createExecutionContext.ts:4458-4463`; `engT/suspend-for-user.test.ts:198` `[T]` |
| A review, an input, or a raw `user_input` gate (allows no `reject`) at its deadline | Throws `SuspensionTimeoutError` (`rejectionOf`, `createExecutionContext.ts:253-278`). | `createExecutionContext.ts:260-277` |
| Host with no durable execution | Throws an `Error`; the request ends `failed`; nothing is held. Message: "stopping for a person needs durable execution, which is on by default wherever stores persist. This host has none: it sets `durable: false`, runs on in-memory stores, or is a router given no durability provider. Remove `durable: false`, or set `durable: true` to hold stops in memory (tests only: they are lost when the process ends). Nothing was held." | `createExecutionContext.ts:225-229,4466`; `engT/durable-by-default.test.ts:97` `[T]`; `engT/suspension-resume.test.ts:358` `[T]` |
| A gate already resolved on an earlier pass | Returns or throws its recorded outcome, in the order recorded, instead of pausing again (see 4). | `createExecutionContext.ts:4367-4399` |

- 1.3 A user's stop that was stopped (`stopped` resolution) never returns an answer on replay: the run ends
  `aborted` at that call. `createExecutionContext.ts:4376-4379,4425-4428`; `engT/suspend-for-user.test.ts:336` `[T]`.
- 1.4 An unanswered gate keeps the request `suspended`; the `suspension` item carries `suspensionId`,
  `suspensionStatus: "pending"`, `reason`, `kind?`, `title?`, `message`, `data?`, `resumeSchema?`, `render?`,
  `allow`, `expiresAt?`, `blockInstanceId`. `con/items/types.ts:726-766`; built at `runAction.ts:2540-2563`.

### 1.5 `ctx.suspendForUser`

`ctx.suspendForUser({ kind, prompt, title?, deadline?, resumeSchema?, data?, render? })` (`core/types/suspend-for-user.ts:50-71`).

| Kind | Maps to | Returns | At the deadline | Source |
|---|---|---|---|---|
| `approval` | reason `user_approval`, `allow: ["approve","reject"]` | `{ cancelled: false, approved: true, answer? }`, or `{ cancelled: false, approved: false, deadline: boolean, answer? }` for a rejection or an expired one (`deadline: true`); never throws for a no | reads as a no with `deadline: true` | `suspend-for-user.ts:77-89,129-134` |
| `review` | reason `user_input`, `allow: ["submit"]` | `{ cancelled: false, answer }` | throws `SuspensionTimeoutError` | `:138` `[T]` `engT/suspend-for-user.test.ts:170` |
| `input` | reason `user_input`, `allow: ["submit"]` | `{ cancelled: false, answer }` | throws `SuspensionTimeoutError` | same |
| any, task cancelled while it waited | | `{ cancelled: true }`; the block runs to its end and nothing it writes to the task is kept; any later wait for a user in the run is cancelled at once | | `suspend-for-user.ts:30-33,129-131`; `engT/suspend-for-user.test.ts:198-216` `[T]` |

- 1.6 So `suspendForUser` returns a rejection as a value only for an approval. A review or an input has no "no".
  This corrects the moved-row wording "returns the answer as a value, rejection included, instead of throwing".
- 1.7 Deadline: the call's `deadline` (ms), else the host's `userDeadlineMs` option, else none. `deadline` must be
  a positive finite number or the call throws `TypeError`. Host `userDeadlineMs` must be a whole number of ms from
  1,000 to 365 days (31,536,000,000) or the host refuses to build. `suspend-for-user.ts:108-116`, `eng/runtime-config.ts:196-209,285-290`.
  A raw `ctx.suspend` never reads `userDeadlineMs`; its own `timeoutMs` is its only deadline. `eng/runtime-config.ts:149`.
- 1.8 Needs durable execution as `ctx.suspend` does. `suspend-for-user.ts:127`.

## 2. How a request is paused: states and items (feeds the figure "A request's states")

Request statuses: `in_progress`, `completed`, `incomplete`, `failed`, `interrupted`, `aborted`, `suspended`.
`con/types/request-status.ts:11-18`.

| Transition | Cause | Source |
|---|---|---|
| `in_progress` to `suspended` | `ctx.suspend` throws `SuspensionError`. The runtime writes the `SuspensionRecord` (status `pending`), emits the `suspension` item and a `request.suspended` status event, flushes, then sets the request `suspended`. The SSE stream ends. | `runAction.ts:2467-2625` `[T]` `engT/suspension-resume.test.ts:32,86` |
| `suspended` to `in_progress` | A resume, answer, or sweeper re-drive reaches the point of no return: written only if the status is still `suspended` or `interrupted`. If a stop got there first the run stops before any block executes. | `runAction.ts:2296-2320` |
| `in_progress` to a final status | `completed`, `failed`, `aborted`, `incomplete`. A second pause goes back to `suspended`. | `runAction.ts:2613` |
| `in_progress` to `interrupted` | The stale-request sweeper finds a request whose heartbeat is older than the threshold. | section 9 |
| `interrupted` to `in_progress` | Continue (same id) or the sweeper's re-drive. | `recovery-routes.ts:192-302`; `request-continuation.ts` |
| `suspended`/`interrupted` to `aborted` | A stop (`RequestHandle.abort()`, the abort route) resolves the gate `stopped`, or ends an interrupted request that no gate holds. | section 10 |

Item order on one request across one pause (one id, one log, monotonic `sequence_number` and `itemIndex`; the log is
never reset) `[T]` `engT/suspension-resume.test.ts:436,1640`:

1. items made before the pause; 2. `suspension` item (`status: "completed"`, `suspensionStatus: "pending"`);
3. `suspension_resume` item: `suspensionId`, `resolution` (a `SuspensionStatus`), `resolvedBy?`, `resumeData?`,
`resolvedAt`; positioned immediately after the `suspension` it resolves; 4. items made after the block resumed.
`con/items/types.ts:783-795`, `runAction.ts:2322-2342`. `resolution` = `resumeContext.resolution ?? RESUME_ACTION_STATUS[action]`
(`approve` to `approved`, `reject` to `rejected`, `submit` to `submitted`, `skip` to `skipped`;
`core/types/suspension.ts:137-142`). A crash-recovery continuation (no resolution) writes a `continuation` item
instead: `trigger: "recovery"`, `priorItemCount`, `resumedAtPath?`, `continuedAt`. `runAction.ts:2351-2362`;
`con/items/types.ts:807-` `[T]` goal `goals/continue-interrupted-run/continues-not-restarts`.
Both audit items are client-visible, persisted, not in model history (`history=false`).

- 2.1 A client at sequence N when the request paused reconnects with `Last-Event-ID: N` or `?starting_after=N` once the
  request is `in_progress` again and gets N+1 onward. The re-entry emitter is seeded from the prior log's last
  sequence number (and item index), and skips the slot a synthetic terminal event could have taken. DE:186;
  `request-continuation.ts:107-136` `[T]` `engT/suspension-resume.test.ts:1640`.
- 2.2 The token budget counts both runs: a suspended request saves what it spent, and the resume restores it.
  `runAction.ts:2615-2617,3587` `[C]`.
- 2.3 A pause does not close the request record: `GET` returns the whole pause-and-continue history on one record
  (`items` accumulate). DE:150; `engT/suspension-resume.test.ts:436` `[T]`.
- 2.4 While paused the request holds: status `suspended`, its items so far, the pending `SuspensionRecord`, the
  recorded `block_trace` outputs, and the sequencer checkpoint (see section 11).

## 3. What runs again on resume

Resume re-invokes the action under the **same request id** in replay mode (`replayMode: true`), restores sequencer
state from the checkpoint, and injects recorded outputs for finished blocks. `eng/execution/request-continuation.ts:78-199`.

| Piece | On resume | Source |
|---|---|---|
| A block that finished before the pause | Skipped: its recorded output is injected, no `execute`, no model call, no emit, no state write, no duplicate trace. Downstream blocks see the same value. | `core/blocks/sequencer.ts:491-525` `[T]` `engT/suspension-resume.test.ts:600` |
| The block that paused | Runs again from the top. `ctx.suspend` returns the answer (or throws, per section 1). Anything it did before the `suspend` call happens again. | `createExecutionContext.ts:4411-4443` `[T]` `engT/suspension-resume.test.ts:886` |
| The key | A block's logical id `${requestId}:${path}`, attempt-independent, so the match survives retries and a restart. The path is the key (`step[N]`), so adding, removing or reordering steps between pause and resume changes which block a recorded output belongs to. The earlier "survives a code edit" wording is dropped: the key is positional. | `con/block-instance-id.ts` (core `blocks/internal/block-instance-id.ts`), `core/blocks/internal/replay-log.ts:19-24` |
| What counts as finished | The block has a `completed` `block_trace` in the request's item log. | `replay-log.ts:206-213` |
| A block marked `transient: true` | Leaves no record (and a failed or suspended block leaves none), so it runs again. | `createExecutionContext.ts:3846-3848` `[C]`; BM `transient` section |
| Background blocks (`.sideChain()`, `.sideChainIf()`, `.forEachSideChain()`) | Same index: one that finished and recorded is injected; one in flight at the crash, or `transient`, runs again. `[T]` goal `goals/continue-interrupted-run/continues-not-restarts` (a finished side chain ran once across two continues). In-flight background side effects are at-least-once. | `replay-log.ts`; BM |
| A step's `onSettled` hook | Does not fire for a replayed (skipped) step. | `core/blocks/sequencer.ts:795-810` `[C]` |
| A finished block whose recorded output was over the record limit | Cannot be injected and is never run again: the request fails with `RecordedValueOmittedError` naming the block ("cannot resume: its recorded output (N bytes) was over the record limit (maxRecordedValueBytes) ..."); `retryable: false`, code `recorded_value_omitted`. Limit is `maxRecordedValueBytes`, default 262,144 bytes. Fix: return less, or pass bulk data between steps with `.map`. | `core/errors/recorded-value-omitted-error.ts:30-46`; `sequencer.ts:497`; `eng/streaming/recorded-value.ts:21` `[C]` |
| Sequencer state (`ctx.sequencer`) | Restored from the checkpoint taken at the pause (written even if nothing changed, tagged with the `suspensionId`). The re-run starts with the paused block's earlier state writes already in place; each write before the pause counts once, including `incState` and `pushState`. Code that reads sequencer state before the pause can see such a write counted twice on the re-run. Writes after the pause apply as usual. Session, user and org state and resource writes are not covered: they re-run with the block. A transient field written before the wait is written again. | `sequencer.ts:1054-1075`; `engT/suspend-for-user.test.ts:430-715` `[T]` (esp. 515, 564, 666) |
| The generator whose tool paused | The generator is called once more. Earlier model turns and finished sibling tools are rebuilt from the item log, not re-asked or re-run; only the paused tool re-enters. See section 7. | `core/blocks/generator.ts`; `engT/generator-suspension-resume.test.ts:134,679` `[T]` |
| Composition callbacks (`.map`, `.stepIf`, `.sideChainIf`, connectors) | Run again to rebuild control flow. Nondeterministic calls in them (`Date.now()`, `Math.random()`, ids) can steer a different branch on resume. Move them into a block whose output is recorded, or `runOnce`. `[D]` BM; consistent with `replay-log.ts` keying by path. |  |
| Router `execute` selector | Runs again; checked against the recorded decision (section 7). | `core/blocks/router.ts:297-316` |
| Request user message | Not emitted again on resume or on crash continuation. | `engT/suspension-resume.test.ts:1010,1069` `[T]` |
| Items replayed blocks emitted | The canonical view shows a re-run block's emit once. | `engT/suspension-resume.test.ts:1120,1509` `[T]` |
| Traces off (`FSDEV_TRACE_OBSERVABILITY=0`, production default) | Resume still skips finished blocks: lean records are written at completion for exactly this. | `createExecutionContext.ts:3838-3848`; `engT/resume-replay-traces-off.test.ts`; goal `goals/durable-by-default/a-local-stop-is-held-and-answered` (legs a, b run with traces off) `[T]` |

**Lookup: Which blocks are skipped on resume?** Every block with a `completed` recorded output at its logical path,
foreground or background, except `transient` ones. The block that paused is never skipped.

Skipped blocks are not memory of the process: the record lives in the request's item log in the store, so this holds
across a restart on any store that persists (3.1).

- 3.1 On the in-memory stores nothing survives the process, so a crashed run cannot be continued; with
  `durable: true` over memory a pause works inside one process only. `eng/durability/default-durability.ts:8-13`;
  `eng/stores/memory/checkpoint-store.ts:15`, `.../suspension-store.ts:26` (`persists = false`).

## 4. Several pauses in one run

| Case | Behavior | Source |
|---|---|---|
| Pause, resume, pause again, resume | One request id, one log: `suspension`, `suspension_resume`, items, `suspension`, `suspension_resume`, ... Sequence numbers continue. | `engT/suspension-resume.test.ts:662,1182,1256` `[T]` |
| Resuming a later gate re-reaches earlier ones | Earlier gates were resolved on the log and return their recorded outcome in original order (answer, rejection, skip sentinel); they do not pause again. Works across a restart. | `createExecutionContext.ts:3975-3987,4367-4399`; `engT/suspension-resume-generalized.test.ts:164` (skip replays as sentinel) `[T]`; goal `goals/suspension/resumes-after-a-cold-restart` |
| Only the resolving gate takes the answer | Matched by logical block path plus position, and by `suspensionId` when the call names one; other gates reached in the same replay suspend normally. | `createExecutionContext.ts:4411-4417` `[T]` `engT/suspension-resume.test.ts:662,729,771` |
| One block waits twice | Each unnamed `ctx.suspend` in one block answers with its own resolution, in order. | `suspension-resume.test.ts:771` `[T]` |
| A gate resolved `stopped` | The run ends `aborted` there, never read as an answer. | 1.3 |
| Releasing the resume lease between gates | The lease is released when a request re-suspends so the next gate is resumable (otherwise 409 until the 60 s lease lapses). | `runAction.ts` (after 2625); `engT/suspension-resume.test.ts:1182` `[T]` |
| Two gates open at once in one request | The record lookup is per `(requestId, suspensionId)`; within one generator turn first-wins (section 7). Parallel gates in a sequencer were not tested here. `[D]` | |

## 5. Idempotency keys and `runOnce`

| Item | Fact | Source |
|---|---|---|
| `ctx.idempotencyKey` | String `${requestId}:${blockPath}`, set per block run. It excludes the attempt number, so every retry of a step sees the same key. It also stays the same on a resume or continue (same request id), though not on a `retry` (new request id). Pass it to the provider's idempotency header. | `eng/execution/executeBlock.ts:217-218,306-307`; `core/types/block.ts:566-581`; `engT/idempotency-runonce.test.ts:182` `[T]` |
| `ctx.runOnce(key, fn)` | First call per `(requestId, key)` runs `fn` and stores the result; later calls return the stored value. | `createExecutionContext.ts:3989-4045` |
| In-process layer | Concurrent calls with the same key share one in-flight promise; the memo is set the instant `fn` resolves, before the store write. Different keys are independent. Empty or non-string key rejects. | `createExecutionContext.ts:3989-4045` `[T]` `engT/idempotency-runonce.test.ts:131,346` |
| Durable layer | Stored via `request.setRunOnceResult(requestId, key, value)` and read with `getRunOnceResult`, in the request store of all four adapters (SQLite table `request_runonce`). A resume or continue keeps the id, so the re-run finds the first run's value and does not call `fn`. | `createExecutionContext.ts:4007-4012`; `store-sqlite/src/schema.ts:502`; `engT/suspension-resume.test.ts:886` `[T]`, `engT/generator-suspension-resume.test.ts:878` `[T]` |
| The remaining gap | The durable write happens after `fn` resolves. A crash between `fn` finishing and the write landing leaves neither memo nor record, so a crash continuation can run `fn` again. A failed store write logs a warning and the in-process memo still dedups for the rest of the process. Close the gap by passing `ctx.idempotencyKey` to the provider. | `createExecutionContext.ts:4018-4030` `[T]` `engT/idempotency-runonce.test.ts:287` |
| Values | Must be JSON-serializable. | `core/types/block.ts:593` |
| Scope | Per request. `retry` (new request id) starts empty; `continue` and `resume` do not. Not a cross-request or cross-instance cache. | 0.1 |
| Where it is available | Declared on every block's context; documented and tested for handlers (and a handler used as a generator tool). `[D]` for generators and DSL callbacks (0.6). | |
| Who needs it | The paused block (re-runs from its top) and any in-flight block at a crash. Put the side effect after the `suspend` call, or guard it. A side effect before the call in a generator's gated tool fires twice unless guarded. | `engT/generator-suspension-resume.test.ts:878` `[T]` |
| A concurrency policy is not idempotency | `reject` only catches overlap with a request that is running; a redelivery after the first finished needs an idempotency key. | CP:163 (also R-18) |

## 6. Answering a pause: the routes, the refusals and the clients

All routes under the flow API (`POST /api/flows/:flowKind/...`; the flow segment is the flow instance's address).
`eng/routes/router.ts:205-250`.

| Surface | Call | Takes | Notes | Source |
|---|---|---|---|---|
| `POST /:flowKind/requests/:requestId/resume` | body `{ suspensionId, action, data? }` | `action` one of `approve`, `reject`, `submit`, `skip`, in the gate's `allow` set | Refuses a wait gate (answered as not found) and a request whose source is not re-enterable (0.8). 200 + SSE if `Accept: text/event-stream`, else 202 `{ requestId }`. | `resume-routes.ts:91-268` |
| `POST /:flowKind/requests/:requestId/answer` | same body | user stops only (`isUserSuspension`) | Open to every source, task runs included. Checks owner before reading the stop. Waits up to 2 s (50 ms polls) when another resume holds the request, then 409 `refused: "busy"`. | `answer-routes.ts:68-215` |
| `client.flow(addr).request(id).resume(body)` / `.answer(body)` | `ResumeSuspensionBody` / `AnswerSuspensionBody`: `{ suspensionId, action, data? }`; no `resumedBy` | | Resolve to a `RequestHandle`; with `{ stream: true }` resolve to the SSE `Response`. `answer` errors: `ClientHttpError` 404 not the caller's or not a user's stop, 409 already resolved, 410 past its deadline, 400 fails the schema. | `cli/client.ts:228-262,376-415` |
| `RequestHandle.continue()` / `.retry({ input? })` / `.abort()` / `.status()` / `.wait()` / `.result()` | | | See 9, 10. A request that settles at `suspended` resolves `wait()`/`result()` with that status and no `output`. | `cli/client.ts:326-388` |
| `client.requests.interrupted({ staleThresholdMs? })` | | | Section 9. | `cli/client.ts:551-557` |
| React `session.answerSuspension`, `useSuspensions(session)` (`approve`, `reject`, `resolve`), `<ApprovalRenderer>` | | | Streaming: the continuation streams into `session.items`. `<SuspensionResolverProvider resolve={session.answerSuspension}>` makes the inline card use it; without a provider the card falls back to a non-streaming client: the answer lands and the rest of the run appears on the next read. | `react/src/context/SuspensionResolver.ts:1-14`, `react/src/hooks/useApproval.ts:12,149-172`, `react/src/hooks/useSuspensions.ts` |
| DevTool Suspensions tab | Approve or reject with optional JSON resume data, a stop that is a user's goes through `answer`, a custom reason through `resume` | | Read-only once resolved. Needs the debug endpoints and a durable host. DE:379-387; `debug-a-run.facts.md` 64-76 (DevTool detail belongs to the DevTool page). | |

### 6.1 Refusals table (resume route, in the order the code checks them)

| Status | When | Message | Source |
|---|---|---|---|
| 404 | Unknown flow | `Unknown flow "<kind>"` | `resume-routes.ts:92-95` |
| 404 | Unknown request, another flow instance owns it, another user's or tenant's request, or a source that is not re-enterable | `Request "<id>" not found` (one body for all four; the caller cannot tell them apart; the pause stays open) | `resume-routes.ts:97-118`; `route-utils.ts:152`; `callerReachesRequest` `route-utils.ts:206-213` |
| 400 | No durability provider | `No DurabilityProvider configured. Resume requires durable execution.` | `resume-routes.ts:125` |
| 400 | Missing `suspensionId`; missing `action`; `action` not one of the four | `Missing required field: suspensionId` / `... action` / `Field "action" must be one of approve, reject, submit, skip` | `:134-148` |
| 409 | Request is not `suspended` | `Request is "<status>", not "suspended"` | `:152` |
| 404 | Suspension missing, or a wait gate | `Suspension "<id>" not found` | `:158-166` |
| 409 | Gate already resolved | `Suspension "<id>" has already been resolved (status: "<status>")` | `:168` |
| 410 | Past `expiresAt` (checked before the action and payload guards; the gate is marked `expired`) | `Suspension "<id>" expired at <ms>` | `:184-188` `[T]` `engT/resume-expiry.test.ts:112`, `engT/suspension-resume-generalized.test.ts:394` |
| 409 | `action` not in the gate's `allow` set (records saved before `allow` existed read as approve/reject) | `Action "<a>" not permitted for this suspension (allowed: ...)` | `:195` `[T]` `engT/suspension-resume-generalized.test.ts:305` |
| 400 | `submit`, or an `approve` that carries data, fails the stored `resumeSchema` | `Resume payload failed validation against the suspension's resumeSchema` plus `validationErrors` keyed by field path (first error per field); a `submit` with no data against a schema is 400, not 500; a bare approve against a schema with optional fields passes. The gate stays pending. | `:198-213`; `engT/suspension-resume-generalized.test.ts:322,347,368` `[T]` |
| 409 | Another resume or continue holds the request's lease (60 s) | `Concurrent resume in progress. Try again later.` | `:240`; `resume-under-lease.ts:55` |
| 202 | Accepted | `{ requestId }` (same id) | `:262-268` |

Moved-row item: "non-JSON resume data": the route reads the body with `parseJsonBody`; a body that is not JSON is
refused by that helper (`route-utils.ts`). Not separately tested for the resume route. `[D]` DevTool message
"Resume data is not valid JSON." is a client-side check (`debug-a-run.facts.md` 68). Do not carry a status code for it
without pass 5 reading `parseJsonBody`.

Differences for the answer route: refusal for a stop that is not a user's, another tenant or user, or no such
suspension is 404 `Suspension "<id>" not found` (same text for all, "before it reads the stop"
`engT/suspend-for-user.test.ts:1008` `[T]`); an already resolved stop is 409 with `refused: "already-resolved"`;
410 past deadline; 400 `Answer failed validation against the suspension's resumeSchema` with `validationErrors`.
`answer-routes.ts:68-170`.

- 6.2 Who may answer: the signed-in caller who reaches the request: same user and organization when the app
  authenticates, else only the tenant check applies (nothing in the app authenticates so there is no user to compare).
  `route-utils.ts:186-213`. `resumedBy` is the caller's user id, or the request's owner when the app does not
  authenticate. A `resumedBy` or `resumeContext` field in the body is ignored. `resume-routes.ts:219`; `engT/resume-metadata-ingress.test.ts` `[T]`.
  The answer is recorded on the suspension record (`resolvedBy`, `resolvedAt`, `resumeData`, status) and on the `suspension_resume` item.
- 6.3 Resume names the owning instance. `:flowKind` in the path must address the instance recorded as the request's
  owner; a path naming another copy of the same definition gets the same 404 on resume. Retry and continue instead
  answer `400` "Flow mismatch: request belongs to flow instance ...". `resume-routes.ts:97-104`, `recovery-routes.ts:81-87,205-210`. DE:154.
- 6.4 A resume re-enters the action as the record's owner (identity from the stored request), not as the caller. `request-continuation.ts:200-215`.
- 6.5 Resume with `Accept: text/event-stream` returns the live stream of the continuation; with anything else the
  stream is closed and the caller reads the request through `GET .../stream` or `.../status`. `resume-routes.ts:250-268`.
- 6.6 Retry is a different operation: a new request id, from `interrupted` or `failed` only, `inputOverride` allowed.
  `recovery-routes.ts:67-190`.

### 6.7 Suspension record (what a store holds per gate)

`SuspensionRecord` (`core/types/suspension.ts:50-110`): `suspensionId`, `requestId`, `flowKind`, `flowId?`, `actionName`,
`sessionId?`, `userId`, `reason`, `kind?`, `title?`, `message`, `data?`, `resumeSchema?`, `render?`, `allow?`, `status`,
`blockInstanceId` (the nearest durable sequencer's checkpoint key, not the paused leaf block), `stepIndex`,
`stepInput?`, `createdAt`, `expiresAt?`, `resolvedAt?`, `resolvedBy?`, `resumeData?`.

Status values (`SuspensionStatus`, `con/types/suspension.ts:10-34`): `pending` (the only non-terminal), `approved`,
`rejected`, `submitted`, `skipped`, `timed_out`, `expired`, `stopped`, `cancelled`. `TERMINAL_SUSPENSION_STATUSES` lists the
eight non-pending ones (`core/types/suspension.ts:116-125`). `timed_out` is in the type and in the prune list, but no code in `core`, `contracts` or `engine` writes it (the sweeper writes `expired`). `[C]` List it as a possible value; do not explain it.
The DevTool's filter lists All, Pending, Approved, Rejected, Timed out, Expired, Stopped, Cancelled; it has no
Submitted or Skipped option (`packages/devtool/src/react/components/workspace/suspensions-view.tsx:36-45`).
`provider.listSuspended(filter)` takes `flowKind`, `userId`, `sessionId`, `status`, `limit`, `createdBefore`, `resolvedBefore`
(`SuspensionFilter`, `suspension.ts:178-190`); the old page lists five of the seven.

## 7. Pausing in generators and routers

### 7.1 Generator (tool loop)

| Fact | Source |
|---|---|
| The gate lives in a tool: `ctx.suspend()` in the tool block's `execute`. The request pauses, a `suspension` item goes out; a client resolves it through the same resume or answer route. Nothing client-side is generator-specific. | `engT/generator-suspension-resume.test.ts:134` `[T]`; GR |
| On approval the tool runs its real body after `suspend` returns and the model receives the tool's real return value, not the resume payload. The approved tool runs once; the model is not called again for turns before the approval. | `:134` `[T]`; goal `goals/suspension/generator-resumes-after-tool-approval` |
| Conversation is rebuilt from the item log (`generator_step` artifact per tool-calling step carrying the assistant text and the tool-call array; step 0 also carries the compiled prelude so prompt and context are not re-resolved; recorded `tool_output` items). The model is not re-called for recorded turns. | `core/blocks/generator.ts:1650-1670`; `internal/generator-resume.ts` |
| Completed sibling tools in the same turn are injected from the log; only the gated tool re-enters. | `engT/...:679` `[T]` |
| Rejection: `ctx.suspend()` throws `SuspensionRejectedError` inside the tool; the generator records a completed `tool_output` carrying `{ denied: true, reason: <error message> }` and tells the model; the generator does not fail. An expired approval carries `{ denied: true, expired: true, reason: "The approval for this tool call expired and is no longer valid. The tool was not run." }`. | `generator.ts:1768-1790` `[T]` `:199`; expired `[C]` |
| An ordinary error after the gate is a failed tool call the model is told about; a cancel inside the re-entered tool stops the run (not a tool failure). | `generator.ts:1796-1820` `[T]` `:257,332` |
| A `mapModelOutput` that throws after an approved gate fails the run. | `:394,456` `[T]` |
| The pause survives a restart (same machinery). Multi-gate: two sequential suspending tools suspend and resume twice in order. A rejected gate is not re-entered when a later gate suspends. | `:560,619` `[T]` |
| `history: false` generators resume with prior turns rebuilt; a denial inherits the generator's visibility. | `:505,821` `[T]` |
| Pre-gate side effects in the tool run again unless guarded by `runOnce`. | `:878` `[T]` |
| One approval gate per model turn: if two tools in the same turn both call `ctx.suspend()`, the first to suspend surfaces; the other re-reaches its gate on the next resume cycle, never as a model failure. | `:747` `[T]` |
| A gated tool must not set `cacheable`: tool-result caching answers before the tool body runs, so a hit would skip the gate. | `core/blocks/internal/tool-executor.ts:280-285` `[C]` + GR `[D]` |
| Provider-native tools (`providerTools`, search) from an earlier turn are not reconstructable (they record no framework `tool_output`). | GR `[D]`, `generator.ts:1470` comment `[C]` |
| A dynamic `tools` resolver must keep the pending tool available and unchanged: otherwise resume fails with `GeneratorToolUnavailableError`, code `generator_tool_unavailable`, `retryable: false`, "cannot resume: the suspended tool "<name>" is no longer present in the resolved tool set". | `core/blocks/internal/generator-resume.ts:52-70` `[C]` |
| Streaming generators suspend and resume; recorded turns are rebuilt for the model but not re-streamed to the client. | GR `[D]` |
| An input or review gate that times out inside a tool fails the run (`SuspensionTimeoutError` rethrown). An approval timeout is a denial result (0.3). | `generator.ts:1805-1812` `[C]` |
| The paused step's tool input and prior output are kept in the log: do not put secrets in `data` or the resume payload; both are client-visible and persisted. | `con/items/types.ts:775-782` `[C]` |

### 7.2 Router

| Fact | Source |
|---|---|
| A router records its decision (`router_decision`). On resume the selector (`execute`) runs again and its result is checked against the recorded route. Same pick: the branch continues; completed work inside it is injected, not re-run. | `core/blocks/router.ts:297-316` `[T]` `engT/router-resume.test.ts:110` |
| A different pick, or the recorded route no longer declared, fails the resume with `RouteUnavailableError`, code `route_unavailable`, `retryable: false`. Message: `Router "<name>" cannot resume: the recorded decision selected route "<a>" but its `execute` re-selected "<b>" on resume — the selector must be deterministic (pure over input) for a router whose branch can suspend.` (or `route "<a>" is no longer declared in the route table`). `details`: `routerName`, `recordedRoute`, `reselectedRoute`, `recordedRouteDeclared`. | `core/errors/route-unavailable-error.ts:29-46`; `engT/router-resume.test.ts:287,335` `[T]` |
| Works when the router is the root action block. | `:335` `[T]` |
| A branch that suspends right after selection (decision-write race) still resumes: the `router_decision` write is awaited before the branch is dispatched. | `:169` `[T]`; `router.ts:331-334` |
| A per-call `connectInput` wrapper's mapping the selector returns is preserved across the pause. | `:229` `[T]` |
| Two different blocks may not share one route name in a router (build-time throw), because the decision stores the bare name. | `router.ts:196-215` `[C]` |
| A router's routes all share the router's input and output types (`routes: BlockDefinition<TInputSchema, TOutputSchema>[]`). | `router.ts:133` |
| Keep selectors pure over their input, and mapping closures too. | message above |

## 8. Errors

| Error | Where it comes from | Catchable | Fields | Source |
|---|---|---|---|---|
| `SuspensionError` | `ctx.suspend()` first reach | No: rescue handlers do not fire; not a block failure; do not catch it in a block | `suspensionId`, `reason`, `kind?`, `title?`, `data?`, `resumeSchema?`, `render?`, `timeoutMs?`, `allow` | `suspension-error.ts:76-125` |
| `SuspensionRejectedError` | `reject`; an approval past its deadline (`expired: true`); a cancel (`cancelled: true`) | Yes, `.rescue([{ when: [SuspensionRejectedError], block }])` (the `when` form is in the `.rescue` JSDoc `core/blocks/sequencer-methods.ts:424-427`; no test of rescuing this class found `[D]`). Uncaught, the request ends `failed` with the message `Suspension <id> was rejected`. A block's retry policy does not retry it. | `suspensionId`, `rejectedBy?`, `rejectionData?`, `expired`, `cancelled` | `suspension-error.ts:131-165`; `engT/suspension-resume.test.ts:293` `[T]`; `core/test/tool-executor-suspension.test.ts:29` `[T]` |
| `SuspensionTimeoutError` | A user's review or input at its deadline; a raw `ctx.suspend` that allows no `reject` is **not** among them unless it waits for a user (0.2) | Yes. Left uncaught it fails the request. The waiting block re-runs from its top, so its own work before the call happens again; finished earlier steps are not run again `[T]` (the test's "work" is an earlier step) | `suspensionId`; message `Suspension <id> timed out` | `suspension-error.ts:180-189`; `engT/suspend-for-user.test.ts:170` |
| `RouteUnavailableError` | Router resume (7.2) | No, fatal | see 7.2 | |
| `GeneratorToolUnavailableError` | Generator resume (7.1) | No, fatal | `details.toolName` | |
| `RecordedValueOmittedError` | Resume of a finished block whose output was over the record limit (3) | No, fatal | `details.blockName`, `details.bytes` | |
| `Error` (no durable host) | `ctx.suspend()` with durability off | the request fails | message in 1.2 | |
| `Error` (renamed reason) | `ctx.suspend` with a retired `human_*` reason | the request fails | message names the `user_*` replacement | `createExecutionContext.ts:4449-4452` |

- 8.1 A resume that fails **before** the request goes `in_progress` (record unreadable, flow unregistered, checkpoint or
  replay build throws) leaves the request `suspended`, the gate back to `pending`, and the lease released, so the same
  resume can be sent again. A failure after the point of no return is a durable `failed`. `request-continuation.ts:70-77`,
  `resume-under-lease.ts:162-170` `[T]` `engT/suspension-resume.test.ts:1317,1370,1437,1694`.

## 9. Interrupted requests, crash recovery and continue

| Fact | Source |
|---|---|
| A run keeps a heartbeat in the **active request registry** while it works (default every 10 s). A request whose heartbeat is older than the threshold is marked `interrupted` by the stale-request sweeper: interval 30,000 ms, threshold 60,000 ms by default; `staleSweepIntervalMs` and `staleSweepThresholdMs` set them (interval `0` or less turns it off; the threshold should be at least twice the heartbeat interval). The mark is written only while the record is still `in_progress`, so a finished request is never overwritten. | `eng/runtime-config.ts:278-280,376-379`; `eng/execution/stale-request-sweeper.ts:1-60`; `engT/stale-request-sweeper.test.ts:47,84` `[T]` |
| So after a restart the in-flight request shows `interrupted` once its last heartbeat is more than 60 s old and a sweep ran: up to about 90 s on defaults. The registry has an implementation on filesystem, SQLite and Postgres; on the in-memory stores the registry and the record die with the process, so nothing is left to mark. A request that was **suspended** is not touched: it stays `suspended`. | `eng/stores/{filesystem,memory}/active-request-registry.ts`, `store-sqlite/src/active-request-registry.ts`, `store-postgres/src/active-request-registry.ts` `[C]` (the 90 s figure is derived) |
| The client's `client.requests.interrupted({ staleThresholdMs? })` first asks the server to sweep (`POST /users/:userId/check-interrupted`) and then lists every interrupted record of the user (`GET .../interrupted-requests`): an earlier sweep's results appear on every call until continued or removed. `staleThresholdMs` can only raise the host's threshold. Entries: `{ id, flow, sessionId?, flowKind, actionName, interruptedAt }` and the `RequestHandle` methods. | `cli/client.ts:422-429,551-557,765-790`; `recovery-routes.ts:461-512` |
| The sweep never reaps a request queued with an external runner and not yet claimed, until `queuedGraceMs` (default 600,000 ms) passes. | `stale-request-sweeper.ts:50-58`; `runtime-config.ts` |
| **Continue**: `POST /:flowKind/sessions/:sessionId/requests/:requestId/continue` / `RequestHandle.continue()`. Only for status `interrupted` (`409` otherwise, saying use `/resume` for suspended, `/retry` for a fresh run); the path's session must be the request's (`400` session mismatch); the flow instance must own it (`400` flow mismatch); source must be re-enterable (404-shaped); a dynamic scheduled dispatch cannot be continued (`409`). Takes the 60 s lease (`409` "Concurrent continuation in progress"). | `recovery-routes.ts:192-302` |
| A continue keeps the request id, replays the item log, injects every finished block, and runs the in-flight step again; a side effect inside that step can fire a second time (guard it, section 5). It writes one `continuation` item (`trigger: "recovery"`), no `suspension_resume` item. If the step is a gate nobody resolved, the request pauses again. | `runAction.ts:2343-2362`; goal `goals/continue-interrupted-run/continues-not-restarts` `[T]` (counters stay 1, one continuation item, same id, `completed`); `engT/suspension-resume.test.ts:813` `[T]` |
| **Discard** is `RequestHandle.abort()` (the abort route; `useSession().abortRequest()` in React) on the interrupted request: with no gate holding it, the request ends `aborted` and leaves the interrupted list for good (HTTP 204). A stop of an interrupted request that owes a re-drive and is already being continued reports "resumed before the stop reached it" (409). | `eng/execution/record-request-stop.ts:30-45`; `abort-routes.ts:50-71`; `engT/abort.test.ts:280-320` `[T]` |
| **Retry** is not a continue: a new request id, from `interrupted` or `failed`, not `in_progress`, optional `inputOverride`. | `recovery-routes.ts:67-190` |
| Which stores keep a paused or interrupted run across a restart: filesystem, SQLite and Postgres each implement the request, checkpoint, suspension, lease, wake and active-request stores; the in-memory set keeps none past the process (`persists = false` on its checkpoint and suspension stores). Filesystem is single-process. | DE:288-299; `eng/stores/memory/*.ts:15,26`; `store-postgres/src` and `store-sqlite/src` file lists `[C]` |
| A **cold restart** keeps a pending gate: the gate is read as `pending` by a fresh runtime over the same store and the approve completes the same request. | goal `goals/suspension/resumes-after-a-cold-restart` `[T]`; goal `goals/durable-by-default/a-local-stop-is-held-and-answered` (b) `[T]` |
| What a split task does when a piece ends as the server stops: on a host with durable execution and a wake store, a notice that did not go out is delivered once the server runs again; on a host without, the split task stays `in_progress` with nothing to wake it. Host logs once at start: `[flow-state] this host keeps no wakes: debts are paid on their fast paths only`. | `eng/durability/request-wakes.ts:90-114`; `apps/docs/docs/workforce/delegating-work.md:234` `[C]+[D]` |

## 10. Stopping a paused or interrupted request

| Fact | Source |
|---|---|
| `RequestHandle.abort()` on a request paused at a gate resolves the gate `stopped` (under its lease) and continues the request with the stop recorded; it ends `aborted` before any block runs; the record keeps the gate's status `stopped`; a later approve is 409 `has already been resolved`. Needs durable execution; without it a parked request answers as a finished one (409 `Request "<id>" is already in terminal state "<status>"`). | `eng/durability/stop-suspended.ts:1-48`; `abort-routes.ts:57-70`; `engT/stop-suspended.test.ts` `[T]` |
| A stop that loses a race to an answer answers 409 `Request "<id>" was resumed before the stop reached it; stop it again to stop the running turn`; the turn runs on. | `abort-routes.ts:66-70` `[T]` `engT/abort.test.ts:300` |
| A stop wins over a person's resolution the turn never ran past (process died after the resolution, before the turn continued): the gate is re-recorded `stopped`, and the request ends `aborted`; the approved step never runs. | `stop-suspended.ts:25-35` |
| If the process dies after the stop is recorded and before the request is written `aborted`, the sweeper finishes it. | `stop-suspended.ts:41-43`, `durability-sweeper.ts:20-30` |
| A turn parked on a wait cancels the task it waits on; a run already started on it goes on and its result is discarded. | `stop-suspended.ts:7-13`; DE:303 |
| Aborting a request waiting for its turn on a concurrency key (after an answer): 409 as above; status `suspended` until it starts, then `in_progress`. | CP:166-168; `abort-routes.ts:66-70` |
| `RequestHandle.abort()` on a request running in a separate process with no browser stops within one `heartbeatIntervalMs` tick (default 10 s, if non-zero) and needs a request store shared across processes. | DE:305 `[D]` |

## 11. Retention and cleanup (feeds "How long is a paused run kept?" and "What happens to a pause nobody resolves?")

**Parts that store data (four questions each).** "Owns" is the owner of the data. "Sees" is who can read it. "How many" is the count.

| Part | Owns | Sees | Stored where | How many |
|---|---|---|---|---|
| Suspension record | The request's user (`userId`) in the flow instance (`flowId`) that paused | The caller who reaches the request (user and organization when the app authenticates; tenant only otherwise); a user's pending stops are listed to that user by the pending-read (`PendingUserSuspension`: no `stepInput`, `resumeData` or `data`); the DevTool Suspensions tab reads debug endpoints (off unless enabled, loopback only) | The `suspensions` store of the app's stores (SQLite `suspension_records`; Postgres the same; filesystem files; memory) | One per `ctx.suspend()` call (per gate). Deleted when the request completes. Otherwise kept (pending forever, or resolved) until pruned |
| Sequencer checkpoint | The request | Nothing public: no route reads it | `checkpoints` store (SQLite `sequencer_checkpoints`) | Latest only: one per `(requestId, sequencer blockInstanceId)`, overwritten at each step boundary and at each pause; constant per sequencer however many steps. Default (`durable: true` on each sequencer) |
| Request item log (recorded block outputs, `suspension`, `suspension_resume`, `block_trace`, `router_decision`, `generator_step`, `tool_output`) | The request | Per request visibility (history and client flags); the owner's `GET` | `request` store (SQLite `requests`, `request_items`, `request_events`) | One log per request; grows across all pauses |
| `runOnce` results | The request | Nothing public | `request` store (SQLite `request_runonce`); removed when the request record is deleted | One per distinct key per request |
| Resume lease | The request (key = request id), held by a resume, answer, continue, expiry write or sweeper | None | `leases` store | At most one per request; 60 s (`RESUME_LEASE_MS`); released when the run ends or re-parks; expired leases are pruned each sweep (with retention on) |
| Wake | The session's owner (user, org, tenant) | None | `wakes` store | One per owed time; fires an internal entry |

Sources: `core/types/suspension.ts`, `eng/durability/checkpoint-durability-provider.ts:14-37`, `store-sqlite/src/schema.ts:469,502,551,569,583`,
`eng/stores/types.ts:1693-1722`, `eng/routes/debug-routes.ts`, goal `durable-by-default` ("Checkpoints have no public route").

### 11.1 What keeps a paused run and when it goes

| Fact | Source |
|---|---|
| A pause with no `timeoutMs` (and, for `suspendForUser`, no `deadline` and no host `userDeadlineMs`) has no deadline. It stays `pending` and the request stays `suspended` until someone answers, stops or cancels it. Nothing ages it out: age-based pruning never touches the checkpoints of `in_progress` or `suspended` requests (a week-old gate is safe), and a pending suspension is not a terminal status so pruning skips it. | `durability-sweeper.ts:1-60,76-83`; `engT/durability-sweeper.test.ts:245,262,368` `[T]`; `engT/durability-sweeper-person-deadline.test.ts:126` `[T]` ("an approval with no deadline stays pending"); `engT/durability-sweeper.test.ts:131` `[T]` |
| A paused run survives a restart on SQLite, Postgres and the filesystem store; on in-memory stores it does not exist at all by default (no pause is allowed). | 9; `durable-by-default` goal `[T]` |
| `fsdev dev` and `fsdev run` with no config use the SQLite file `.fsdev/data/fsdev.db`; `--store filesystem` keeps JSON files under `.fsdev/data` instead (single-process). | CLI:99-103 `[D]`; `fsdev/commands/run.ts:312-335` `[C]` |
| A request that completes deletes its own suspension records and lease (no config needed). Checkpoints are kept after completion unless `flow.request.cleanupCheckpointsOnTerminal: true` (default `false`), in which case each sequencer's terminal frame deletes its own checkpoint. Failed and aborted requests keep their suspension records. | `runAction.ts:1636-1710,2917-2927`; `core/types/flow.ts:436-453`; `engT/sequencer-checkpoint.test.ts:34-132`, `engT/durable-completion-cleanup.test.ts:42` `[T]` |
| `durabilityRetention` (option on `createFlowState`; `runtimeConfig.durabilityRetention` on the low-level router) turns pruning on; passing `{}` is enough; omitted, nothing is pruned. | `createFlowApiRouter.ts:576-577` |

`DurabilityRetentionConfig` (all optional) `eng/durability/durability-sweeper.ts:100-120,160-166`:

| Field | Default | Meaning |
|---|---|---|
| `sweepIntervalMs` | 600,000 (10 min) | Cadence; `0` or less turns the sweeper off. The next tick is brought forward to the earliest suspension deadline or due wake, never sooner than 1 s apart |
| `checkpointMaxAgeMs` | 86,400,000 (24 h) | Backstop age for checkpoints of `completed`, `failed`, `aborted` requests |
| `suspensionTerminalMaxAgeMs` | 604,800,000 (7 d) | Resolved suspensions are pruned this long after `resolvedAt` |
| `orphanCheckpointThresholdMs` | 86,400,000 (24 h) | An `interrupted` request's checkpoints go after this |
| `batchLimit` | 1,000 | Records deleted per store per tick |

`[T]` `engT/durability-sweeper.test.ts:118-300`. The sweeper also takes one lease per tick (`__durability_sweeper__`),
so only one host sweeps at a time on a shared store; deletes are idempotent either way. `:316` `[T]`.

### 11.2 What each sweeper tick does (always; pruning steps only with `durabilityRetention`)

| Step | Behavior | Source |
|---|---|---|
| Enforce expiry | A `pending` suspension past `expiresAt` becomes `expired`. For an approval, a custom gate whose `allow` includes `reject`, and a user's review or input (`continuesAtExpiry`, `core/types/wait-gate.ts:77-84`), the sweeper continues the request in the same tick (a gate that allows no `reject` and is not a user's review or input is only marked `expired`, and the resume route answers 410): an approval as a rejection marked `expired` (a gated tool does not run and the model is told the approval is no longer valid); a review or input as `SuspensionTimeoutError`. The `suspension_resume` item records `expired`. Any other gate is only marked `expired` and the resume route answers 410. | `durability-sweeper.ts` step 2/2b; `wait-gate.ts:77-84`; `engT/durability-sweeper.test.ts:118` `[T]`, `engT/resume-expiry.test.ts` `[T]` |
| Enforcement at the route | The resume and answer routes also check `expiresAt` and mark the gate `expired` (410), so an expired gate is not approvable between ticks or when retention is off. | `resume-routes.ts:184` `[T]` |
| Deadline timing | A server reads pending deadlines when it starts, so a gate that `fsdev run` left behind expires on time once a server runs; a gate another process writes while the server runs is seen on the next tick. A one-shot `fsdev run` sweeps nothing. A server that starts after a deadline passed expires it as soon as it is up. Within about a second of the deadline on a long-lived host. | `durability-sweeper.ts:262-300`; `engT/durability-sweeper-person-deadline.test.ts:48,66` `[T]` goal `durable-by-default` leg c: expired 0.14 s after its deadline |
| Finish what a crash interrupted | A request still `suspended` or `interrupted` behind a gate already resolved (answered, expired, stopped, cancelled) is continued with the recorded outcome, under the request's lease, so it never races a live resume. | `stop-suspended.ts` `redriveResolvedGate`; sweeper 2b |
| Finish a stop | A stop recorded while the request still ran (`abortRequested`) on a request that then parked is ended. | sweeper header |
| Fire due wakes | Section 12. | |
| Prune (retention on) | Resolved suspensions older than `suspensionTerminalMaxAgeMs`; expired leases; checkpoints of terminal requests older than `checkpointMaxAgeMs`; an interrupted request's checkpoints after `orphanCheckpointThresholdMs`. Never the checkpoints of an `in_progress` or `suspended` request. | `durability-sweeper.ts:1-60`, tests above |

- 11.3 Which hosts sweep: a process that serves the routes (`fsdev dev`, `fsdev serve`, a self-hosted server,
  `createFlowApiRouter`), not a one-shot `fsdev run`. A router built with `createFlowApiRouter` runs the sweeper only
  when given a `durabilityProvider` (otherwise a no-op handle). `createFlowApiRouter.ts:570-590`.
- 11.4 **Host setting `durable`** (`createFlowState({ durable })`):

| `durable` | Persisting stores (filesystem, SQLite, Postgres) | In-memory stores |
|---|---|---|
| not set | on | off |
| `false` | off | off |
| `true` | on | on |

`resolveDurabilityProvider({ stores, durable })`: `durable ?? storesPersist(stores)`; "persist" is read off
`stores.checkpoints.persists` and `stores.suspensions.persists` (only the memory stores say `false`). The no-config
`fsdev dev` and `fsdev run` apply the same rule. `createFlowApiRouter` and `runAction` are durable only when handed a
provider (`runtimeConfig.durabilityProvider`); `createCheckpointDurabilityProvider(stores)` builds one for any stores.
Given `runtimeConfig`, the router takes its runtime options from it alone. `eng/durability/default-durability.ts:1-31`;
`engT/durable-by-default.test.ts:54-104` `[T]`; DE:11-43.
- 11.5 `DurabilityProvider` has ten methods (the old page says eight): `saveCheckpoint`, `loadCheckpoint`, `suspend`,
  `loadSuspension`, `listSuspended`, `acquireLease`, `releaseLease`, `cleanup`, `cleanupCheckpoints`, `pruneSuspensions`.
  `eng/durability/types.ts:15-61`. Implement your own and delegate to `createCheckpointDurabilityProvider`. `LeaseOptions { holder, durationMs }`.
- 11.6 A sequencer can set `durable: false` (default `true`) to skip its checkpoint; the old page suggests this for
  ephemeral sequencers inside patterns. Whether a pause still resumes under a non-durable sequencer is not tested
  here; do not claim it. `core/blocks/sequencer-methods.ts:473-484`. `[D]`

## 12. Waits and wakes (carry as one table, or hand to the task-board reference; the moved row from "delegating work" keeps one clause here)

| Fact | Source |
|---|---|
| A wake is a time by which some work must run in a session, kept in the `wakes` store so it survives a crash. When due, the sweeper runs the internal entry the wake names, as the session's owner, as a dispatched request. A wake that fell due while the server was down fires once it runs again. | DE:346; `durability-sweeper.ts:2c`; `eng/durability/request-wakes.ts:60-80` |
| A host keeps wakes only with durable execution and a store that has a `wakes` store (all four adapters). Otherwise it logs once at start `this host keeps no wakes: debts are paid on their fast paths only`; nothing can wait, `getTask` is not offered `wait`, a waiting dispatcher is refused. | `request-wakes.ts:90-114`, `:130-140` (unreadable wake store: same, with a hint to rerun the schema migration) |
| A wait's deadline defaults to 5 min; `waitDeadlines: { defaultMs, minMs, maxMs }`; min 1 s, max 24 h; a deadline outside is refused, not clamped. | `eng/durability/wait-chain.ts:67-90`; `flowstate/types.ts:371-379` |
| If the run a wake starts dies, the wake fires again 30 s later (`WAKE_RETRY_MS`), until a run clears it. Work owed past `maxDebtAgeMs` (default 24 h from due time) is given up, recorded undeliverable on its task and logged. | `durability-sweeper.ts:369`; `request-wakes.ts:79` |
| A request that owes a park (a wait started its work before its gate was written) and died is continued by the sweeper within about `staleSweepThresholdMs` (that is `interrupted` first); one still owing its park 10 minutes after it first owed it (`PARK_OWED_GIVE_UP_MS`) is left `interrupted` for a client to continue. | `eng/durability/park-owed.ts:28`; DE:334 |
| `dispose()` waits up to 10 s (`shutdownDrainMs`, `disposeFlowApiRouter(router, { drainMs })`) for requests a wake started and tasks being worked to record an outcome, then aborts the remaining and logs how many; each aborted request's wake stays and fires on the next host. | `createFlowApiRouter.ts:392,736-745,550-570` |
| The depth of a chain of waits is at most 5 (`MAX_WAIT_DEPTH`). | `core/types/wait-gate.ts:60` |

## 13. Moved rows: each checked, each carried or dropped

Source rows are the lines the brief's grep returns (31). "C" = carried (section noted); "C*" = carried with a correction; "D" = dropped.

| # | Row (short) | Verdict | Where |
|---|---|---|---|
| 1 | Split task, piece ends as server stops, no durable host: stays in progress with no wake | C | 9, 12 |
| 2 | Turn cut off by a crash listed as interrupted; what a restart keeps | C | 9 |
| 3 | Request states: status `suspended`, stream closes, `suspension` item with the message; no deadline waits until answered | C | 2, 11.1 |
| 4 | Refusals when answering: who may answer; other signed-in user gets "not found"; pause stays open | C | 6.1, 6.2 |
| 5 | What runs again: the block that paused re-runs, `ctx.suspend` returns the answer, generator called once more; finished blocks and answered model turns skipped | C | 3, 7.1 |
| 6 | Interrupted requests: status, which stores detect, detection delay after restart, continue-or-discard (`requests.interrupted()`) | C* (detection works on every store with an active-request registry; the delay is the stale threshold plus up to one sweep; "stores that detect" is really "stores that persist") | 9 |
| 7 | Continue after a crash: id kept, finished outputs reused, in-flight step re-runs, side effect can fire twice, idempotency keys guard it | C | 9, 5 |
| 8 | Pause without a persistent store: `ctx.suspend` fails naming `durable` | C* (the message names the `durable: false` / `durable: true` setting and in-memory stores; quoted in 1.2) | 1.2 |
| 9 | Crash recovery on SQLite and Postgres: interrupted turn on next start; Continue resumes same request, Discard ends it; both persistent stores do this and hold a paused run; in-memory keeps neither | C (also true of the filesystem store) | 9 |
| 10 | Resume behaviour by store: finished block output recorded; continued run skips; in-memory nothing checkpointed so a crashed run cannot be continued | C (as 3.1) | 3 |
| 11 | Pause and resume row (wait survives a restart only on a persisting store) | C | 9, 11.4 |
| 12 | Block instance id `requestId:path:attempt`; retry takes next attempt number; resumed request rebuilds same id for same attempt | C. The id is opaque to callers; the page states the format only because the replay key is its attempt-free prefix `requestId:path`. Path segments are `root`, `step[N]`, `iter[N]`, `branch[...]`, `tool[...]`, with `% / [ ] :` percent-escaped. | 3 (`con/block-instance-id.ts:1-95`) |
| 13 | Durable action: checkpoint per step; what runs again on resume | C* (the action flag does not gate durability; sequencer `durable` defaults on; 0.5) | 3, 11.6 |
| 14 | Reject limit: only catches overlap with a running request | C (one line in 5; the concurrency page owns it) | 5 |
| 15 | Policy behaviour on resume: per policy; 30 s then stays paused for the sweeper; sweeper 10 min | C | 14 |
| 16 | Resume reply: 202 or stream; no 503; stream closes empty; status stays `suspended` | C | 14 |
| 17 | Aborting a resumed request waiting for its turn: 409; `suspended` until it starts | C | 10, 14 |
| 18 | Suspension record fields and filter status values | C* (the filter has no Submitted or Skipped option; `SuspensionStatus` has nine values) | 6.7 |
| 19 | Resolving a pause: resumes under its own id, emits `suspension_resume`; refusals for already resolved and non-JSON data | C for the first two; **non-JSON data: held back** (no status code verified; the 400s verified are missing fields and schema failure). | 6.1, 2 |
| 20 | Retention of a pause across restarts on SQLite; which stop states can no longer be resumed | C. After resolution or deadline, the gate is not `pending`: the resume route answers 409 (resolved) or 410 (expired); `timed_out`, `expired`, `cancelled`, `stopped` are not resumable. | 6.1, 6.7 |
| 21 | Paused chat turn: one line `Waiting for a person: <what> (suspension <id>). <where>`; discovery says answer in `fsdev dev`; app config says `Answer it in a server on these stores.` | C* (with an app config the message is either `Answer it in a server on this app's stores, such as fsdev dev with <config path>.` when the config is found, or `Answer it in a server on these stores.` when stores are passed in; the second wins when `options.stores` is set) | 15 |
| 22 | `ctx.suspend` takes `reason`, `message`; what each reason allows an approver; return value first pass vs resume; `suspendForUser` returns the answer as value, rejection included; optional typing | C* (`allow` default by reason; rejection-as-value is true for an approval only, 1.6) | 1 |
| 23 | What a suspended request holds; `fsdev run` exit code, printed lines, default store | C | 2.4, 15 |
| 24 | How an answer reaches the run: resolver provider streams live; without it the answer lands and the rest appears on next read; four ways to answer | C. Count the ways from section 6 (HTTP resume, HTTP answer, client, React/DevTool) and let the page name them as a list, not "four". | 6 |
| 25 | Who may answer, non-owner refused as not found, the answer records the caller; refusals table | C | 6 |
| 26 | Item order across pause and resume; status transitions | C | 2 |
| 27 | Idempotency guard for work before the suspend call | C | 5 |
| 28 | Rejection outcome: `SuspensionRejectedError` at the suspend call; request ends in an error if uncaught; resume item records `rejected`; `.rescue` catches it | C (the `.rescue` claim is untested, 8) | 8 |
| 29 | Pause with no deadline kept until answered; deadlines, retention, cleanup | C | 11 |
| 30 | Generator tool pause: tool continues after approval, no model replay, rejection becomes a denied tool call and the run continues | C | 7.1 |
| 31 | Router pause: selector re-run and checked; different pick fails; error; branches share one output shape | C | 7.2 |

Nothing was dropped outright. Held back: the non-JSON resume
body status (row 19), and anything that is DevTool UI detail (row 18's filter labels are included only as a pointer).

## 14. Pause and resume under a concurrency policy

A resume re-enters the action as a continuation, so its place on the session's key is taken fresh after the answer is
accepted. `continuationDecision` (`eng/transports/concurrency/arbiter.ts:218-226`).

| Policy of the action | A resumed request |
|---|---|
| `allow`, `hold` | Runs at once (`hold` marks the key busy). |
| `queue`, `reject`, `defer` | Waits as `queue` does, with the queue's 30 s wait limit; never refused or dropped. |
| key resolves to none (no session, `"none"`, function returns `undefined`) | Runs at once. |

- 14.1 A request that pauses gives up its place on the key, so other requests on the session run while it waits.
  `engT/...` CP:164 `[D]`; `createInboundTransportHost.ts:1469-1473` `[C]`.
- 14.2 The resume call does not wait for the turn: the answer is recorded and the call replies at once, 202 `{ requestId }` or the event stream, whichever it asked for. The wait runs inside the continuation after the handle is returned. `createInboundTransportHost.ts:1451-1516`, `resume-under-lease.ts:21-31`.
- 14.3 If the wait for a turn fails (the 30 s limit passes, or the backend fails), the answer **stays recorded** on the gate, the request stays `suspended`, the caller's lease is released, the host logs `a continued request did not get its turn in its session; it stays parked with its resolution recorded, and the durability sweep continues it`, the stream closes with no events, and the durability sweeper continues it on a later tick (every 10 minutes by default, or as soon as a deadline or wake falls due). No 503 is returned: the 503 `ConcurrencyQueueTimeoutError` is for a new `queue` request. `createInboundTransportHost.ts:1498-1516` `[C]` (no test found); CP:164-170 `[D]`.
- 14.4 While it waits for its turn, `RequestHandle.abort()` fails 409 `Request "<id>" was resumed before the stop reached it; stop it again to stop the running turn`: its gate is already resolved, and it is not running to signal. Status reads `suspended` until it starts, `in_progress` once it runs. `abort-routes.ts:66-70`; `record-request-stop.ts` `already-resolved` `[T]` `engT/abort.test.ts:300`. The "reads `suspended` until it starts" half is `[C]`: the `in_progress` write happens inside `runAction`, which starts after admission (`request-continuation.ts:160-190`).

## 15. `fsdev` surfaces (CLI page owns detail; carry the exit code and lines)

| Fact | Source |
|---|---|
| `fsdev run` on a request that ends `suspended`: exit code 0, a `suspended` NDJSON event (`requestId`, `sessionId`, `suspensionId`, `reason`, `title?`, `message?`, `answer`), the same in `--capture` as `result.suspended`; with `--quiet` off, a report on stderr. | `fsdev/commands/run.ts:566-575,641-668`; CLI:60-76 `[D]`; goal `durable-by-default` leg a `[T]` |
| Stderr text: `[fsdev] waiting for a person: <message, else title, else reason>`, then `[fsdev]   suspension <id> · request <id> · session <id>`, then the answer line, then `[fsdev]   Its deadline fires only while a server runs on this store.` | `run.ts:683-691` |
| Answer line, no config: `Answer it in fsdev dev, which reads this store: <data line>.` (SQLite `.fsdev/data/fsdev.db`); with `--store filesystem`: `Answer it in fsdev dev --store filesystem, started after this run exits: the filesystem store is single-process. Its state is under <path>.`; with an app config: `Answer it in a server on this app's stores, such as fsdev dev with <config path>.` | `run.ts:297-335` |
| `fsdev chat` on a paused turn prints one line: `Waiting for a person: <message, else title, else reason> (suspension <id>). <answer line>`. | `fsdev/chat/turn.ts:161` |
| `fsdev dev` on a loopback bind turns on the debug endpoints the DevTool tab needs; a non-loopback `--host` turns them off. | `debug-a-run.facts.md` 8 (DevTool page owns it) `[D]` |

## 16. Lookups the page carries

| Lookup | Answer | Where |
|---|---|---|
| Which blocks are skipped on resume? | Every block with a completed recorded output in the request's item log, foreground and background; not `transient` blocks; never the block that paused; a finished block whose output was over `maxRecordedValueBytes` fails the resume instead. | 3 |
| How long is a paused run kept? | Until answered, stopped or cancelled when it has no deadline. Its checkpoints are never age-pruned. After resolution a suspension record is deleted when the request completes, else pruned `suspensionTerminalMaxAgeMs` (7 d) after `resolvedAt`, only with `durabilityRetention`. | 11.1 |
| What happens to a pause nobody resolves? | With no deadline, nothing: it waits. With a deadline (`timeoutMs`, `deadline`, or the host's `userDeadlineMs`): at the deadline a running server's sweeper expires it; an approval continues as a rejection marked `expired`, a review or input continues with `SuspensionTimeoutError`, a gate of any other kind is only marked `expired` and the resume route answers 410. One-shot `fsdev run` sweeps nothing; the next server on the store does. | 11.2 |
| What is the default for `durable`? | On wherever the stores persist; off over in-memory stores. | 11.4 |

## 17. Left out on purpose (not observable, not a user's to depend on, or another page's)

- Lease holder strings, the sweeper sentinel key `__durability_sweeper__`, lease acquisition mechanics other than the 60 s resume lease and "409 on concurrent resume".
- Checkpoint field layout (`SequencerCheckpoint`) beyond "latest only, one per sequencer instance".
- Internal ReplayLog API (`getCompletedOutput`, `resolvedResumes`), `_replayLog`, `_resumeState`: not user-reachable.
- DevTool panel layout, labels and keyboard behavior (`debug-a-run` page).
- React hook signatures beyond naming (`useSuspensions`, `useApproval`): the client reference owns them.
- The stale `requestRuntime.status` and active-request heartbeat bookkeeping.

## 18. Open items for pass 5 (things this sheet could not settle from tests)

1. 0.6: is `ctx.runOnce` really usable from generator and DSL contexts, or only handlers? Run it.
2. 6.1 non-JSON body: read `parseJsonBody` for the status and message before the page states one.
3. 8: does `.rescue([{ when: [SuspensionRejectedError] }])` catch the rejection and let the sequencer continue? Run it.
4. 14.3: a resumed `queue` request that waits past 30 s: assert the 202, the empty stream and the `suspended` status in a run.
5. 11.6: does a pause under a sequencer with `durable: false` resume? If not, the page should say a sequencer that pauses must not set it.
6. 9: the "about 90 s" detection delay is derived (60 s threshold + 30 s sweep interval); confirm by a run, or state the two numbers and not the sum.
7. 4: two gates open in parallel inside one sequencer step (not generator): untested here.
8. The `timed_out` suspension status: nothing found that writes it. List it as a possible value only.

## 19. Pass 3 (draft): what the page carried, dropped and softened

All 31 moved rows were checked against section 13 and the code. Every true one is on the page. Dropped or held back, with the reason:

| Row or fact | Verdict | Why |
|---|---|---|
| Row 19, refusal for non-JSON resume data | Dropped | `parseJsonBody` (`route-utils.ts:690-709`) throws `JsonMediaTypeError` for a non-JSON content type and a raw `JSON.parse` error for a bad body. No status for the resume route is tested, so the page names none. |
| Retired `human_*` reason names and their refusal (section 0, 8) | Dropped | A reader arriving today has never seen the old names, and the retired-terms check bans them. |
| `timed_out` suspension status | Carried as a possible value only | Nothing writes it (section 6.7). |
| 11.6, a sequencer with `durable: false` and whether a pause still resumes | Dropped | Untested; the page states only that the option defaults to `true`. |
| 4, parallel gates in one sequencer step | Dropped | Untested here. |
| 12, wake rows: park-owed give-up (`PARK_OWED_GIVE_UP_MS`), `dispose()` drain, wait-chain depth 5 | Dropped | Task-board and host behavior, not what a pause reader depends on. The wait deadline, wake retry and no-wake host rows are carried. |
| Section 9, the derived "about 90 seconds" detection delay | Dropped | Derived, not observed. The page states the 60-second threshold and the 30-second sweep interval. |
| Section 6.1, DevTool filter labels | Dropped | DevTool page owns them. |
| Section 17 items | Dropped | Internals. |
| Row 28, `.rescue` with `when: [SuspensionRejectedError]` | Carried | Read from code: `core/blocks/sequencer.ts:614-621` skips rescue only for `SuspensionError`. Untested (open item 3). |
| Section 14.3, the 30 s wait failure | Carried `[C]` | No test (open item 4). |
| Row 24, "four ways to answer" | Carried as a table of six surfaces, no count | Per the sheet. |
| Row 15, "sweeper interval 10 min default" | Carried | `sweepIntervalMs` row. |


## 20. Pass 8, revise round 1

- Corrected: the expiry rule. A custom `ctx.suspend` gate whose `allow` includes `reject` (the default for any reason other than `user_input`) continues at its deadline as `SuspensionRejectedError` with `expired: true`. Only a gate that allows no `reject`, and is not a user's review or input, is merely marked `expired` and answered `410`. `core/types/wait-gate.ts:77-84`, `eng/context/createExecutionContext.ts:253-278`.
- Corrected: the replay key is the path (`step[N]`, `iter[N]`, ...), so it does not survive an edit that adds, removes or reorders steps between pause and resume. It survives retries and a restart.
- `runOnce`: the page states only that it is declared on every block's context (0.6 stays open for pass 5). "Tested in handlers" is dropped.
- `timed_out`: the page says it is never written.
- Dropped as not a reader's to depend on: "lean records", the `requestId:path:attempt` instance id, the lease phrase on the crash-recovery sweep step (the page says it never runs at the same time as a resume of that request), the "No 503" aside.
- Moved off the page to other Reference pages (the page links them; the rows below are carried to the destination by the record's Reference rows): item order, `resolution` values and `continuation` fields, and stream resume after a pause (R-06, `items.md`, rows added there); resume and answer routes, clients, status codes, check order, validation and answer-route differences (R-13); `userDeadlineMs`, `durabilityRetention`, sweeper lease, durable defaults per command, router and runner providers (R-12); `FSDEV_TRACE_OBSERVABILITY` (R-15); suspension record fields and the ownership table, in-memory stores, `DurabilityProvider` methods (R-16); a resumed request under each policy, wait failure, abort while waiting, `reject` redelivery limit (R-18, `concurrency.md`, rows added there); waits and wakes (R-19); `SuspensionRejectedError` row (R-22); router selector rules and the sequencer `durable` option (R-01); `fsdev run` and `fsdev chat` on a paused request (R-35, already on `cli.md`). Facts 6.x, 7.2 (selector purity), 9 (CLI), 11.1 (`durabilityRetention` table), 11.2 (sweeper lease), 11.4, 11.5, 12, 14 and the `SuspensionRejectedError` row of 8 are therefore carried by those pages, not by this one.
- Kept on this page as table rows instead of paragraphs: signatures, the `stopped` result, the no-durable-host message, `suspendForUser`'s rejection rule, replay mode, `runOnce` availability and who needs it, generator and router rows, the heartbeat, suspension status values and `listSuspended`'s filter, and the failed-resume rows.

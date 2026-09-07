# Layer 1 leverage audit

Where the codebase works outside the framework when Layer 1 already covers the job.
Scanned on 2026-09-07 against `main` as of that date. Read-only; nothing here is
fixed. Findings cite `path:line` as of the scan.

**Layer 1**, per the roadmap and workforce atlases, is the substrate: the four block
kinds, the sequencer DSL, flows and actions, scopes, resources and collections, items
and streaming, capabilities, the task board and `dispatcher()`, skills, memory,
transports, hosts, stores, the client and React layers, and the testing harness.
Layer 2 is Workforce's conventions on top. Conductor is a product on top of both. The
atlases' rule for anything above the substrate is one sentence: *compose, or file a
Layer 1 gap.* This audit sorts what it found into exactly those two piles.

## The short version

Ten areas were scanned in parallel (every package tier, both labs, the reference
app, the examples, and the goal runners). About 120 findings survived verification.
They collapse into **ten themes** and **fifteen Layer 1 gaps**.

The headline is not "people are ignoring the framework." The block and composition
tiers are the best-behaved code in the repo: patterns are sequencers over the board,
memory is resources plus one capability, the harness manager is a real sequencer with
CAS-guarded collections, and the trading-desk analysis pipeline is pure DSL. Model
calls are centralised (one resolver; no raw `generateText` anywhere in app code). No
app or lab hand-parses SSE.

The hand-rolling sits at the **seams**, and most of it traces back to a small set of
gaps in the substrate rather than to authors routing around it for convenience:

| Theme | What it looks like | Biggest instance | What closes it |
| --- | --- | --- | --- |
| 1. The action boundary drops the answer | A whole CRUD domain left flows for REST routes | trading-desk portfolio: 13 routes, hand-rolled data hook, client-asserted `userId` | Gap 1 (action return value over HTTP) |
| 2. Dispatch doors exist but aren't reachable or aren't used | Hosts `fetch` their own server; transports skip the host's auth steps | scheduled dispatch is HTTP-only, so bullmq and vercel loop back with a bearer secret | Gap 2, plus three one-line `validateDispatch` fixes |
| 3. Conductor opinions have leaked into framework packages | "A session belongs to the task row" shipped as framework law | `assertHandOffBlockSupported` refuses session state for every hand-off policy | Narrow three checks; the roadmap atlas already forbids this |
| 4. Two implementations of one L1 job inside the framework | A second reducer, a second door, a second guard set | `useSession` re-implements the client's SSE reducer; two harness emitters have already drifted | Delete the second seam (tenet 3) or file the gap |
| 5. Process-local state where a scope or resource is the owner | Module `Map`s, `globalThis`, in-memory ledgers | chat-sdk thread registry is empty under an external dispatcher; tool cache advertises a session scope it can't honour | Gaps 4 and 7; the rest are straight moves to scope state |
| 6. Sequencer DSL not used where it fits | Handlers doing what a `.stepIf` stage does | trading-desk critical-financials recovery: 820 lines of single-flight, supersession, and a bare model call inside tool handlers | Move the decision up to the sequencer |
| 7. Capabilities and context presets bypassed | `resources:` spread by hand; frame baked into `prompt` | memory's own blocks don't use memory's own tier capabilities | Use `uses:` |
| 8. Consumers re-derive what client, react, and contracts own | Hand SSE, mirrored types, sniffed pattern names | kitchen-sink artifact dialog parses SSE; two apps mirror the Task wire types | Gaps 9 and 10 |
| 9. Verification off the harness | Goals and evals drive engine internals | goals write suspensions straight into the durability store; trading-desk eval re-implements testing's cost, limiter, and report layers with a diverging cost policy | Gap 11 |
| 10. Duplicated helpers | Five `generateId`s, three terminal-status sets, a stale `TRACE_TYPES` | react's `TRACE_TYPES` is missing `generator_step` and classifies items differently from the resolver | Export once from contracts |

**Where to start.** Three moves buy the most: close Gap 1 (an action can return a
result), split scheduled dispatch into a function plus a route (Gap 2), and give the
framework one adapter emitter and one ephemeral per-execution slot (Gaps 3 and 4).
Those four unblock roughly a third of the individual findings below. Everything in
theme 3 should be narrowed now regardless, because it is the one thing the atlases
say must not happen.

---

## Part 1 · The ten themes

Severity is per finding: **High** = a subsystem hand-rolls something L1 owns,
**Medium** = a module or repeated pattern, **Low** = a local instance. **GAP** marks a
place where L1 genuinely lacks the primitive; those are collected again in Part 2.

### Theme 1 · The action boundary drops the answer

`sendAction` over HTTP resolves to a request envelope with no handler output
(`packages/client/src/types/index.ts:90-102`), and it resolves at stream-attach,
before the write commits. Everything in this theme is downstream of that.

- **[High] Portfolio CRUD subsystem bypasses the flow/action boundary.**
  `labs/trading-desk/app/api/portfolio/*/route.ts` (13 route files), `lib/use-api-query.ts`,
  seven `components/portfolio/use-*.ts` hooks, and `portfolio-pane.tsx:396-575` with ten
  `apiMutate` calls each followed by a hand-picked `refetch*()` fan-out. Every route takes
  `userId` from the query string with a "dev-only, otherwise IDOR" banner
  (`accounts/route.ts:16-20`); `income/route.ts` hard-codes `devuser`. BP-031 is
  violated lab-wide because routes have no trusted identity source. The same domain
  already runs on resources for theses and the portfolio mandate, so it sits on two
  substrates. `use-etf-profiles.ts:60-215` invents a 150-line FNV-hashed "eligibility
  signature" to approximate what a `resource_change` subscription gives for free.
- **[Medium] Provider budget on `globalThis`.** `labs/trading-desk/lib/providers/alpha-vantage.ts:79-105,198-240`
  keeps a 25/day budget and a per-minute window as process-global counters. Wrong on a
  multi-instance deploy. Inside an action it is one `ctx.org.incState`; the callers
  are REST routes with no `ctx`.
- **[Low] Retry loops in plain provider functions.** `lib/portfolio-market-data.ts:41-62`,
  `lib/providers/alpha-vantage.ts:160-185`. Would be `.rescue` and a retry policy if
  the fetch lived in a block.
- **[GAP, observed three times in flow code]** `flows/portfolio/portfolio-mandate-actions.ts:16-21`,
  `extract-holdings-action.ts:16-19`, `orchestration/run-summary-action.ts:18-22` each
  document writing a natural return value to a resource because the transport drops it.

### Theme 2 · Dispatch doors exist but aren't reachable, or aren't used

- **[High / GAP] Scheduled dispatch is reachable only as an HTTP route.**
  `packages/scheduled/src/routes.ts:36-238` fuses the whole pipeline (idempotency,
  gateway auth, resolve, validate, overlap, principal, `host.dispatch`) to
  `Request`/`Response`. So `packages/bullmq/src/schedules.ts:127-150` and
  `packages/vercel/src/schedules.ts:46-60,127-160` build a URL to their own server and
  `fetch` it with a bearer secret, even in bullmq's `colocated` mode where the worker
  already holds the runtime. Two hosts carry duplicate `bearerEquals` / `resolveSecret` /
  `CRON_SECRET` plumbing for a hop that shouldn't exist.
- **[Medium] Three of five inbound doors skip `host.validateDispatch`.**
  Only `routes/action-routes.ts:158` and `transports/webhook/routes.ts:184` call it.
  `packages/mcp/src/createMcpTransportAdapter.ts:349`, `packages/scheduled/src/routes.ts:218`,
  and `packages/chat-sdk/src/event-handlers.ts:389` go straight to `host.dispatch`, so
  `requiresOrg` is never enforced on MCP, scheduled, or chat. Chat also bypasses
  `host.resolvePrincipal` with its own parallel resolver (`event-handlers.ts:350-353`,
  `principal-resolver.ts`), so a flow's `authentication.resolvePrincipal`, `requireUser`,
  and `defaultUserId` don't apply to chat traffic. The architecture doc says adapters
  "must" call both.
- **[Medium] `announce` is a hand-rolled pub-sub seam in a framework package.**
  `packages/harness-manager/src/manager.ts:279-288,865,1492-1514`: after parking a row
  the manager calls a host-supplied callback that defaults to a no-op, so the feature is
  silently absent. The L1 door is `dispatcher({ type: "internal", session: { from: true } })`;
  the manager runs as a `task` dispatch from the coordinator's seat, so `from` is the
  coordinator. Partly a GAP (Gap 8): the run does not know an arbitrary watcher's session
  id, and `resource_change` stays on the emitting request's stream
  (`createExecutionContext.ts:2046-2114`). When a watch primitive lands, delete
  `announce` rather than adapt it.
- **[Medium] bullmq's Redis stream bridge duplicates the store-driven live tail and abort.**
  `packages/bullmq/src/stream-bridge.ts:1-178`: two ioredis clients per subscriber, an
  `events()` iterator nobody consumes (grep: only the bridge and the type), and an abort
  channel the worker never listens to (the real cross-process abort is
  `abort-routes.ts:44-49` + `runAction.ts:816`). Engine routes read
  `RequestStore.subscribeToEvents` since FIX-569; the bridge predates it.
- **[Low] bullmq worker calls `runAction` directly** (`worker.ts:60-95`) instead of
  `createInProcessDispatcher.dispatchLocal`. Mild GAP: `dispatchLocal` doesn't expose
  `startSequenceNumber`/`onItem`.
- **[Low] vercel declares a `waitUntil` option that is never read** (`types.ts:38-45`;
  the real path is `RuntimeConfig.onBackgroundWork`) and duplicates engine's
  `FlowApiRouter` type. `packages/next/src/index.ts:6-7` still advertises the dead option.

### Theme 3 · Conductor opinions have leaked into framework packages

The roadmap atlas: *"Do not lift session-owned-by-workflow into Layer 1. That sentence
is a Conductor opinion."* Three places where it already has:

- **[Medium] `assertHandOffBlockSupported` refuses `sessionStateSchema` on every handed-off block**
  (`packages/orchestration/src/task-board/hand-off.ts:392-397`). The stated hazard, two
  rows sharing a child with different schemas, is real for `per-worker` / `{ key }`
  policies and not for `per-task`. The refusal is broader than its reason.
- **[Medium] `detached: true` on the claude-code agent** (`packages/claude-code/src/sdk/agent.ts:140-172`)
  suppresses the harness's own session-state declaration and SDK `resume`. The Conductor
  atlas calls it "a construction shim… not a decision that every run starts fresh," but
  it ships as an option whose doc reads like law.
- **[Medium] The harness's confirmed `sessionId` lives on a board-owned `runs/**` row**
  (`packages/harness-manager/src/run-record.ts:49-70,127`), so continuity of the coding
  conversation is the board's, not the session's. This is also Gap 12 (no typed run
  handle on a task).

Conductor's own lab code adds:

- **[High] `answer` hand-rolls `board.unparkAndDrain`.** `labs/conductor/src/answer.ts`
  (394 lines): guard, bare `unpark` without reading its verdict, a 120-line recovery rule
  keyed on the collection's clock, then drain. The framework verb at
  `packages/orchestration/src/task-board/index.ts:1219-1260` is a fenced re-queue that
  closes both race windows the file names. The file's own header calls the collapse a
  follow-up.
- **[Medium] `status` (a read) withdraws question rows** and does an N+1 join
  (`flow.ts:892-990`, repeated in `answer.ts:282`) because the board's `cancel` writes only
  the task row and task collections have no `reactTo` (Gap 12). A read action that writes
  is a BP-035 second-path hazard every future reader will copy.
- **[Medium] A second lease under the board's lease.** `packages/harness-manager/src/workspace.ts:1453-1569`:
  an `O_EXCL` lock file with stale-steal, a `for(;;)` poll loop, three tunables, and
  ~120 lines of drain-budget arithmetic in `manager.ts:681-803`, because the board's
  claim lease can overlap for one renewal interval. A claim-generation check the worker
  asserts before provisioning would remove all of it. Also Gap 5.
- **[Medium] `run-record.ts` mirrors the board's ownership rule** (`ATTEMPT_OWNED_STATUSES`,
  lease-lapse, legacy status at `:277-324`) and documents CAS as unavailable at `:365-371`,
  while `inbox.ts:379-402` in the same package uses `updateStateWith`. Orchestration
  already exports `leaseLapsed`, `claimDisposition`, `withMigratedStatus`.
- **[Low] `seed` smuggles the task id through sequencer state** plus a `returnTaskId`
  handler (`flow.ts:1050-1066,765-780`) because `.tap` was applied to the wrong step;
  `.step(seedTask).tap(board.drain)` carries it for free, as `answer` already does at `:1115`.
- **[Low] Three private copies of the terminal-status set** (`flow.ts:282,832`,
  `answer.ts:120`); `isTerminalStatus` is exported from orchestration.

### Theme 4 · Two implementations of one L1 job inside the framework

Tenet 3's "second seam for a capability already served." Each of these is a place
where a fix to one copy does not reach the other.

- **[High] `useSession` hand-rolls the SSE→store reducer beside `bindStoreToCallbacks`.**
  `packages/react/src/hooks/useSession.ts:794-1048`: its own `onItemAdded`/`onContentDelta`/
  RAF flush scheduler/filter seam; the comment at `:484` admits "mirrors the filter seam
  in `bindStoreToCallbacks`." It never calls `store.recordSequence`, so the resume cursor
  is not populated on this path. `useRequestStream` and the devtool compose over the
  binder correctly.
- **[High] Inline-SSE vs 202-JSON handshake re-derived in three consumers.**
  `useSession.ts:1449,1634`, devtool `use-continue-request.ts:138`, and the literal
  `/api/flows/${flowKind}/requests/${id}/stream` in three files, because `client` returns
  a raw `Response` and has no `streamRequest()`. A route rename breaks three packages
  (Gap 9).
- **[High / GAP] Both coding harnesses hand-build the item lifecycle.**
  `packages/claude-code/src/sdk/emit.ts` (635 lines) and `packages/codex/src/emit.ts`
  (334) each declare provenance, `mintId`, `buildBase`, tool-call/result/error/finalize
  emitters, and raw `item.added`…`item.done` events over `ctx.response.emit` using the
  `@internal` `_blockIdentity`. They have already drifted: codex stamps `taskId`/`ownedBy`
  on every item; claude-code does not, so a manager cannot attribute claude-code items to
  the task it dispatched. A third harness will copy this a third time (Gap 3).
- **[High] Store adapters disagree on the engine boundary and copy helpers both ways.**
  `scripts/validate-package-boundaries.mjs:5` lists `store-sqlite` (engine type-only) and
  not `store-postgres`. sqlite restates ~10 engine runtime helpers citing that rule
  (`request-store.ts:38-72`, `live-tail.ts:44-79`); postgres value-imports 8 of them and
  still restates 6. Both copy `assertVersionNumber`/`assertSetExpectedVersion`/
  `assertDeleteExpectedVersion`/`conflictFrom` verbatim with a comment claiming the SQL
  adapters cannot import the engine reference, which is only true for sqlite. Pick one rule.
- **[Medium] `createBashTool` is a second, block-less bash implementation with zero in-repo callers.**
  `packages/tools/src/bash/create-bash-tool.ts` (246 lines) builds raw AI-SDK `tool()`
  objects, re-implements mount discovery/hydrate/flush, cannot honour `scope` (no `ctx`),
  and is the *only* door that persists `sandboxId` to session state. `projection-setup.ts:1-16`
  documents bugs fixed once per door. Public API, so a deprecation rather than a delete.
- **[Medium] Testing re-implements the seven scope-state ops** for target refs
  (`packages/testing/src/runtime/createTestContext.ts:269-425`); engine's
  `createScopeStateOps` (`stores/state-container.ts:311`) is not exported. Unit tests and
  production can disagree on `incState` on non-numbers or `pushState` on non-arrays.
- **[Medium] Testing hand-builds session/user/org/request records twice**
  (`createTestContext.ts:144-236`, `testFlow.ts:33-136`) and the CLI a third way
  (`commands/run.ts:282-292`); `ensureSessionRecord` is the one creation path
  (FIX-1068) and mints the lineage id the copies silently omit (BP-030).
- **[Medium] `fsdev block` runs outside `executeBlock`** (`packages/cli/src/commands/block.ts:115-152`):
  `asRuntime(block).run` plus its own schema validation and timing, so it can report a
  different pass/fail than the engine for the same block. Third `--model` override
  mechanism beside `model-override.ts` and the copy in `testing/benchmark/runBenchmark.ts:50-60`.
- **[Medium] `fsdev run` invents a second NDJSON event vocabulary** (`commands/run.ts:29-37,417-475`):
  `resource.changed` is emitted as `state_change`; status transitions and `content.done`
  are dropped. `fsdev chat` consumes the wire events directly. Changing it is a BP-030
  dual-emit job since the shape is a CLI contract.
- **[Medium] `dispatchAndExecute` calls `asRuntime(worker).run` inside a handler**
  (`packages/orchestration/src/tasks/helpers/dispatch-and-execute.ts:295-309`), citing a
  "dynamic assignee can't be a static sibling step" constraint the board itself solved
  with `utility.keyedRouter` (`task-board/blocks/worker-step.ts`). The lease/renewal/
  settlement invariants are now maintained in two shapes.
- **[Medium] `utility.memoryExtractor` has no consumer; memory ships two observe generators**
  (`core/src/utility/memoryExtractor.ts`; `memory/src/working-memory-blocks.ts:76`,
  `memory-system-blocks.ts:601`). Three "extract memories" generators with three schemas.
  Memory's is richer; retire core's from the utility roster and the docs page.
- **[Medium] Exponential backoff hand-rolled five times** over one `RetryPolicy` type:
  `core/blocks/internal/tool-executor.ts:399-441`, `core/models/fallbackModel.ts:138-160`,
  `engine/execution/executeBlock.ts:453`, `engine/stores/cas.ts:178`,
  `engine/stores/resource-cas.ts:317,363`. One `retryWithPolicy` beside `withTimeout`.
- **[Medium] Three canonical-JSON serialisers inside core** (`combiner.ts:27-43`,
  `cache-tool-call.ts:107-140`, `message-assembly.ts:254-265`) with different edge
  behaviour; combiner's conflict check is literally `!deepEqual`.
- **[Medium] Scheduled `onOverlap: "skip"` re-implements the arbiter's `reject`** as
  `activeRequests.listAll()` then filter (`findScheduledRequest.ts:14-32`, BP-033) while
  `ScheduleConfig` already carries `concurrency`. Caveat: the arbiter is in-process only,
  so the store scan is the only cross-process guard today (Gap 7).
- **[Medium] `scoped` chat and webhook transports pre-create sessions only to stamp metadata**
  (`chat-sdk/src/session-resolver.ts:41`, `engine/transports/webhook/session-resolver.ts:35`)
  because the envelope has no `sessionMetadata` field.
- **[Low] sqlite's 310-line multi-subscriber live-tail pump** (`store-sqlite/src/live-tail.ts`)
  is a real improvement over engine's one-loop-per-subscriber `pollEvents` and exists for
  one backend only.
- **[Low] Persistence rules differ across stores:** postgres uses `createInMemoryTraceStore()`
  (no durable traces); sqlite persists them (atlas lens 8).
- **[Low] `evalFlow` / `evalBlock` are copy-paste twins** (`testing/src/eval/`).
- **[Low] Byte-identical `makePartialFs` and three Liquid hardening blocks** in
  `core/prompt/prompt-file.ts` and `core/resource-template/resource-template.ts`; the
  security limits already differ on `lenientIf`.
- **[Low] `schema/action-schema.ts` re-implements Zod `_def` unwrapping** beside
  `helpers/zod-introspect.ts`.
- **[Low] Stream route hand-rolls a 6×500 ms poll** (`engine/routes/stream-routes.ts:99-110`)
  where `abortableSleep` / `subscribeToEvents` siblings exist.

### Theme 5 · Process-local state where a scope or resource is the owner

- **[High] Tool cache `scope: "session"` is documented as cross-request but the only store is per-request memory.**
  `core/src/types/block.ts:865-867` promises "persists across requests within a session";
  `tool-cache.ts:206-222` hangs an LRU off a hidden bag on `ctx.request`, and the only
  `ToolCacheStore` implementation (`orchestration/task-board/flow-policy-wiring.ts:206-211`)
  is rebuilt per board run. The scope only changes the key prefix. Either drop `"session"`
  from the enum or back it with scope state (Gap 4).
- **[High / GAP] Board run-state and worker identity ride `AsyncLocalStorage` plus three hidden `Object.defineProperty` bags on `ctx.request`**
  (`flow-policy-wiring.ts:23,74-90,129`, `lease-renewal-scope.ts:35`,
  `flow-policy/index.ts:223-240`, `core/blocks/tool-cache.ts:228`), with slot-name strings
  duplicated core↔orchestration "rather than reaching across package internals." The
  code's reasons are sound (scope state is Zod-validated and structured-cloned; a closure
  would be shared across `concurrency` workers). L1 has no per-execution ephemeral slot and
  no per-iteration identity handle, so the substrate reimplements them with a documented
  silent-failure mode (`enterWith` after an `await` publishes to nobody). Gap 4.
- **[Medium / GAP] chat-sdk keeps live `Thread` objects in a module-level `Map`**
  (`thread-registry.ts:19-55`) keyed by `requestId`, with its own 60 s sweep. Under
  `bullmqWorker({ mode: "dispatch-only" })` the worker's map is empty, `chatPost` throws,
  and nothing refuses at startup. Nothing in chat-sdk consults `host.usesExternalDispatcher`.
  The serialisable coordinates already travel on `metadata.chat`. Gap 4.
- **[Medium] Bash keeps cloud-sandbox identity only in a process-local `Map`**
  (`tools/src/bash/blocks.ts:208,541-545,679-716`). `BashSessionState` is typed for
  exactly this (`types.ts:308-314`) but only the unused tool door writes it, so
  Vercel/Upstash sandboxes leak across restarts. The live handle belongs in-process; its
  *identity* belongs to the session.
- **[Medium / GAP] Scheduled idempotency is a per-process LRU `Map`** (`scheduled/src/idempotency.ts`);
  two web instances both accept the same beat. bullmq has an unrelated `jobId` dedupe;
  vercel's tick has none. `RequestStore.set(id, record, "absent")` exists on the store
  contract but the host offers no "dispatch iff absent" (Gap 7).
- **[Medium] eventActors appends to the shared workspace with read-then-`patchState` under four concurrent workers**
  (`patterns/src/eventActors/index.ts:399-410`, `blocks/append-entry.ts:44-54`). Two
  workers re-emitting at once lose each other's entries and the `entry-${length}` key
  collides. `pushState` / `updateState` exist; memory's helpers use them correctly.
- **[Medium / GAP] The observation ledger (`priorWork`) is an in-memory array**
  (`orchestration/tasks/flow-policy/index.ts:97-190`), so a worker handed off to a child
  session gets no `priorWork` from siblings and a parked board resumes with an empty ledger.
- **[Medium] `seedSession` hand-resets ten resources and every memo** because one report
  reuses one session (`trading-desk/flows/analysis/orchestration/guards.ts:97-136`), with
  two more defensive resets for the same hazard in `lenses/writer.ts:168-186` and
  `compute-reward-to-risk.ts:43-49`. Per-run artifacts stored at session scope. Partly Gap 12
  (no "reset session resources" op, no per-run scope). Separately `seedSession` is a
  `.step` that returns its input (BP-014); it is a tap.
- **[Low] Read-modify-write counters where `incState`/`pushState` exist:**
  `kitchen-sink/flows/chat-agent/run/steps.ts:65-78`, `examples/hello-chat/src/flows/hello-chat/flow.ts:58-66`
  (the first flow a newcomer reads, framed as the "state" lesson), `background-work.ts:403-408`.
- **[Low / GAP] Workforce's agent registry is an in-memory `Map`** (`agent-registry.ts:8-23`)
  while skills and personas live in resources; `createWorkforceCapability` is an empty
  stub with a TODO on the public API.
- **[Low] Module-level caches in consumer packages:** react `useResourceManifest.ts:16-17`
  (keyed by `flowKind` only, so two providers with different `baseUrl`s share one manifest);
  claude-code `sdk/workspace.ts:137` `openWorkspaces`; trading-desk `analysts.ts:119`
  `WeakMap` keyed on `ctx` across two context slots (relies on an undocumented same-ctx property).

### Theme 6 · Sequencer DSL not used where it fits

- **[High] Critical-financials recovery re-implements single-flight, supersession, and a model call outside the block model.**
  `labs/trading-desk/flows/analysis/tools/runtime/critical-financials-recovery.ts:114-208,335-373`,
  `recover-financials-extract.ts:6-12`, `statement-recovery.ts:186-209`: three module-level
  `Map`s, a generation counter `seedSession` bumps, insertion-order eviction, a bespoke
  `RecoveryCtx` type so tests can hand-build a context, and a structured call on a bare
  `ctx.resolveModel` model. The docblock says the only reason it is not a `generator` is
  BP-011 (it was wedged inside tool handlers). `getOrPatchState` already single-flights per
  key, and a `.stepIf(isCriticallySparse, extractGenerator)` stage before the analyst
  fan-out removes the whole apparatus (~820 lines plus a 400-line spec). The header of
  `statement-recovery.ts:27-33` asks for "a deterministic barrier and two-phase
  re-resolution", which is what a sequencer stage is.
- **[Medium] Builtin crawl hides N page fetches inside one handler**
  (`tools/src/crawl/providers/builtin.ts:14-83`): hand-rolled BFS, `delay(1000)`, the
  builtin `fetch` body re-implemented without its error shaping, `catch { continue }`
  swallowing everything. A sequencer over the `fetch` handler gives each page a trace
  node and the retry policy. Small GAP: the DSL has no rate-limit op (Gap 14).
- **[Medium] claude-code `sdk/workspace.ts` uses `onErrored` plus a module `Map` where `.rescue` / `onSettled` fit**
  (`:114-147,349-360,463-480`); the manager in the same stack uses `.rescue`. Also
  `console.warn` in `discoverMounts` instead of `ctx.emit.status`.
- **[Low] `biasAnalyzer` doc says `.stepIf`, code uses `.branch` plus a passthrough handler**
  (`thought-fabric-core/src/metacognition/bias-detection-blocks.ts`; BP-036 / BP-014).
- **[Low] `resolveSubjectEntity` calls a tool's loader function** rather than
  `.tapIf(isFull, get_company_profile)` (`trading-desk/flows/analysis/resolve-subject-entity.ts:51-75`).
- **[Low] Four stop guards each repeat `patchState(stopped…) + setMetadata(reportStatus)`**
  (`guards.ts:453-601`); one `stopRun(reason)` tap.

### Theme 7 · Capabilities and context presets bypassed

- **[Medium] Memory's block factories hand-spread `resources:`** at ~10 sites
  (`memory-system-blocks.ts:644,802,883,1110,1374,1477`, `janitor-blocks.ts:70-78`) with
  `as any` casts, threading `_semanticResource` through config for identity, while the
  package's own `createWorkingMemoryCapability` etc. with typed `fns` go unused by them.
- **[Medium] thought-fabric `perspectiveAnalyze` bakes `formatPerspective()` into `prompt`**
  while `createPerspectiveCapability` exposes the same string as the `static` context
  preset (`identity/perspective-blocks.ts`, `perspective-capability.ts`). A consumer with
  `uses: [sec.capability]` plus the auditor gets the frame twice. `system().recall` and
  `contextFormatter` duplicate the capability's `fns.format` / `accumulated` too.
- **[Medium] The resource tool trio ships as raw `tools` arrays with no capability wrapper and zero first-party consumers**
  (`core/src/tools/resource-tools.ts:89`, `resource-search-tools.ts:109`,
  `resource-content-tools.ts:25,56`; ~690 lines). `apps/docs/docs/resources/overview.md:258`
  teaches spreading them into `tools`, the shape CLAUDE.md says to avoid.
- **[Low] Kitchen-sink threads memory via `context:` on patterns but `uses:` on the assistant**
  (`run/thinking-styles/index.ts:26` vs `run/assistant/assistant.ts:31`).
- **[Low / GAP] Pattern workspaces have no context formatter,** so specialists
  `JSON.stringify(ctx.resources.workspace.state)` into prompts
  (`routed-specialists.ts:111-114`, `evented-actors.ts:43-59,135-160`). One preset per
  pattern, as `mem.contextFormatter` and the artifacts `inventory` preset already do.
- **[Low] Two teaching shapes for reaching the board's collection:** the guides and
  `task-queue-demo.ts` use `getOrCreateTaskCollection({ ctx, backing, collectionId })`;
  `background-work.ts` uses `uses: [board.capability]`. Pick the capability form for the guides.

### Theme 8 · Consumers re-derive what client, react, and contracts own

- **[High] Kitchen-sink's artifact dialog parses SSE by hand**
  (`components/artifact-dialog.tsx:61-66,376-425`): builds a raw client, opens the POST
  stream, accumulates `content.delta` into local state, re-implements terminal status.
  `useRequestStream({ source: { response } })` exists. The reference app crossing the
  react↔client boundary teaches consumers to do the same.
- **[Medium / GAP] Custom `suspension` renderers get only `{ item }`,** so the app built
  a `SessionItemsProvider`, a resolution scanner, and the same loop duplicated inline in
  `approval.tsx:25-37`, threaded into five cards. `ItemRenderer.ts:257-260` passes
  `isResolved`/`resolution` only to the default path. `useApproval`'s own doc says the
  app has to invent this context. Gap 10.
- **[Medium / GAP] `state_change` items carry raw op deltas,** so react re-implements
  scope-op semantics in `mergeStateChangeIntoSnapshot.ts:60-215` with documented holes
  (an exposed key whose initial value was `undefined` never lands mid-stream). The live
  `resource_change` path already carries the projected `clientData`. Gap 9.
- **[Medium] `resource_change` invalidation has three parallel paths in react**
  (`useResourceCollection.ts:170-213`: a notice array, a count-diff heuristic, and a
  snapshot merge) plus a per-hook page cache; the comments narrate each path being added
  when the previous one missed a case.
- **[Medium] Two apps mirror the Task/board wire types.** `kitchen-sink/components/flow-state/task-plan-state.ts:30-140`
  ("keep in sync with that schema", with a stale rationale about `@flow-state-dev/ui`)
  and `devtool/src/react/lib/task-collection-state.ts:1-115` ("update in lockstep", with
  its own `awaiting_review → parked` migration). Partial GAP: contracts has no task wire
  types and react has no board reducer (Gap 10).
- **[Medium] Client sniffs pattern internals to infer the thinking style the flow already publishes**
  (`kitchen-sink/lib/item-inference.ts:31-70` matches `container === "routedSpecialists"`,
  `collectionId.startsWith("eventActors:")`, `blockName.includes("supervisor")`), preferred
  over `modeStatus.thinkingStyle` from `useClientData` at `page.tsx:368`.
- **[Medium / GAP] `BackgroundWorkRefresh` page effect stands in for a `useSession` child-session refresh opt-in**
  (`background-work-panel.tsx:112-147`, self-labelled "demo debt… FIX-1109"). Server-side
  half: the parent flow cannot observe the child's lineage-shared ledger write in-turn
  (`background-work.ts:25-30`), so it keeps ~50 lines of acknowledgement bookkeeping.
- **[Medium / GAP] Message-text extraction re-implemented seven times**, including react's
  own fallback (`ItemRenderer.ts:82-86`), with three different joiners; MCP's copy
  (`result-formatting.ts:63-75`) reads `item.text` on a `message` item, which has
  `content: Content[]`, so it never matches. Gap 10.
- **[Medium] hello-chat hand-writes both Next route files** (`app/api/flows/[...path]/route.ts:10-28`,
  `route.ts:7-15`) where `@flow-state-dev/next` exports `createNextHandler`; the
  catch-all copy omits PATCH. Small GAP: `next` has no bare-route helper (only `vercel` does).
- **[Low] Trading-desk transcript pane hand-routes items** (`components/transcript/transcript-rows.ts:97-215`)
  instead of `ItemsRenderer` / renderer registry. Arguable: bespoke desk UI.
- **[Low] `useFlow.createSession` has no `title`,** so `trading-desk/app/page.tsx:152-154,270-281`
  builds a second `createSessionClient` and re-derives create→refresh→select.
- **[Low] `agent-response-card.tsx` unwraps `BlockValue` by hand** via
  `@flow-state-dev/core/items/internal`; `resolveBlockValueInternal` is in contracts.
- **[Low] Page-level `fetchContent` effect** (`page.tsx:191-220`) vs `useResourceContent`.
- **[Low] Dead second `createBashBlocks` instantiation** in `kitchen-sink/.../shared/capabilities/bash.ts:120-126`;
  nothing imports it, and it constructs a second sandbox adapter at module init.

### Theme 9 · Verification off the harness

- **[High / GAP] Goals drive durable and multi-session checks through engine internals.**
  `goals/lib/durable.mts:345-395` assembles stores, durability provider, and registry by
  hand and writes suspensions straight into the provider ("exactly what the resume
  endpoint persists"); four suspension harnesses call `runAction` twice with hand-built
  `resumeContext`; 19 engine imports across goals vs 1 testing import. Mostly a gap:
  `fsdev run` has no way to resolve a suspension and `testFlow` has no
  `durable`/`resumeContext`/`runtimeConfig` option (Gap 11).
- **[High] Trading-desk eval suite re-implements testing's judge, cost, limiter, budget, stats, and report layers.**
  `eval/judge.ts:107-146,184-424`, `eval/stats.ts`, `scripts/eval-runs.ts:219-240`,
  `eval/scoreboard.ts` (~3,000 lines, of which `invariants.ts` is legitimate domain).
  Already diverging: the lab prices unknown models at the *most expensive* entry, the
  framework at 0. GAP components: `evalFlow` cannot score a stored session; `analyzerScorer`
  collapses findings into a string and has no k-repeats or blinding.
- **[Medium / GAP] `testFlow` cannot pass `runtimeConfig`**, so 18 of 29 integration
  scenarios drop to raw `runAction` + `createInMemoryStores` (`testing/src/test-utilities/types.ts:134-163`;
  e.g. `task-board-hand-off-handoff.test.ts:298-320`).
- **[Medium] `fsdev chat` abort path polls a raw store field in 25 ms retry loops**
  (`cli/src/chat/turn.ts:96-119`), the only non-engine caller of `setFieldsIfStatus`,
  encoding the engine's "flag first, then signal" protocol by hand.
- **[Low / GAP] E2E mock hand-rolls a `MockGeneratorInstance`** because `mockGenerator`
  can't script per-scenario sequences (`kitchen-sink/lib/e2e-mock-script.ts:10-15,72-94`).
- **[Low / GAP] knowledge-hub's goal check reads engine stores and hand-builds the MCP `tools/call` wire call**
  (`scripts/goal-check-fix-897.mts:55-72`, `test/mcp-http.ts`); testing has no MCP helper.
- **[Low] `visualize-smoke.ts` builds an execution context from engine internals**
  (`examples/knowledge-base/scripts/visualize-smoke.ts:16-27`) where `createTestContext` exists.
- **[Low] `eval/runtime.ts` reads `stores.session` directly** to recover the owning
  `userId` and masks env vars around a config import (`trading-desk/eval/runtime.ts:44-76`).
- **[Low] `snapshotTrace` guesses `blockKind` from name substrings** while
  `BlockTraceItem.blockKind` is on the item; `testSequencer` emits `durationMs: 0`.
- **[Low] `readCapture` re-implements the client's item-snapshot reducer** (`goals/lib/capture.mts:249-257`).

### Theme 10 · Duplicated helpers

Each of these is one export away from gone. Together they are the tell that
`@flow-state-dev/contracts/helpers` is not yet the reflex home for shared code.

- **`generateId(prefix)`** ×3 definitions (`engine/utils/generate-id.ts`,
  `orchestration/tasks/generate-id.ts`, `testing/internal/json-helpers.ts`) plus ~20 inline
  `${prefix}_${Date.now()}_${Math.random()}` copies in engine, ~8 in core, five in
  react/cli/testing, one in MCP. Item ids are the join key for resume, history, and trace.
- **`TRACE_TYPES` in react is stale.** `react/src/components/ItemsRenderer.ts:146` lacks
  `generator_step`; contracts' `resolve-visibility.ts:29-34` has it. The renderer and the
  resolver classify a `generator_step` item differently today. The comment says "may only
  import types from core", yet contracts exists for exactly this value-import.
- **`mapLimit`** copied in `trading-desk/lib/concurrency.ts:25-42` (four importers) and as
  `runWithConcurrency` in `vercel/src/schedules.ts:230-252`.
- **`getPatternPrefix`** re-derived in `tools/src/bash/capability.ts:191-196` with a false
  "import cycle" justification (sibling files import the real one); the copies already differ.
- **Bare-key stripping** ×5 (`artifacts/context.ts:27`, `weekly-digest/flow.ts:104-110`,
  `knowledge-base/concepts.ts:62-70`, `knowledge-hub/inbox.ts:118-124`, `scheduled`'s
  `stripPrefix`); `extractBareTopic` exists. CLAUDE.md's own note is honoured five private ways.
- **`ATTEMPT_OWNED_STATUSES`** mirrored in `harness-manager/run-record.ts:277`; orchestration
  exports it from `internal.ts:167` but not from the package index.
- **`camelToKebab`** re-implemented in `orchestration/skills/skill-md.ts:817` with a different regex.
- **`bearerEquals`** in `vercel/src/schedules.ts:212-224` ≈ engine's unexported `constant-time.ts`.
- **`isPlainObject`** ×3 (contracts, orchestration `json-safe.ts`, core `combiner.ts`);
  `safeStringify`/`truncate` private in `flow-policy/index.ts`; `warnedAgents` Sets in
  round-robin and debate where `warnOnceDev` exists.
- **`console.warn` as the diagnostic channel from inside blocks that hold `ctx`:**
  19 sites in tools, 21 in memory, 7 orchestration, 5 patterns, 4 workforce. Stray stdout
  corrupts `fsdev` NDJSON, and none of it reaches the trace or devtool. Small GAP: no
  `log`/`diagnostic` item kind.
- **`extractItemText`** in `memory/src/memory-system.ts:623` reads `item.payload`/`item.content` by hand.
- **`perplexity-sonar` search adapter POSTs to an LLM chat-completions endpoint directly**
  (`tools/src/search/providers/perplexity-sonar.ts:22-36`): unmetered, untraced. If the
  "it's a data source" framing is deliberate, say so in the header.
- **Provider secrets read from `process.env` inside two tool handlers**
  (`get_macro_indicators.ts:61`, `get_cross_asset_flow.ts:84`) where every other provider
  hides key handling in `lib/providers/*` (BP-026).

---

## Part 2 · The Layer 1 gaps

Consolidated from the `GAP` labels above. Each entry names what is missing, what
hand-rolling it currently forces, and the shape of the fix. Ordered by how much of
Part 1 each one removes.

1. **An action can return a result to the caller.** `ExecuteActionResponse` has no
   `output`, and `sendAction` resolves at stream-attach. Forces: the entire trading-desk
   REST subsystem, client-asserted `userId`, `globalThis` budgets, three flow files writing
   results to resources for read-back. Shape: a request/response action mode, or `output`
   on the completed request record plus a client method that awaits completion.
2. **Scheduled dispatch as an in-process function.** `handleDispatch` is fused to
   `Request`/`Response`. Forces: bullmq and vercel loopback `fetch` with duplicated bearer
   plumbing. Shape: `dispatchSchedule(host, flowKind, scheduleId, opts): DispatchOutcome`
   plus a thin HTTP wrapper.
3. **A public adapter item emitter and invocation identity.** `ctx.emit` offers
   `message`/`component`/`status` only; the streamed message, reasoning, tool open/settle,
   container, and provenance helpers are internal. Forces: two ~500-line drifting `emit.ts`
   files. Shape: `createAdapterEmitter(ctx, blockName)` in core plus a public `ctx.invocationId`.
4. **A per-execution ephemeral slot and a per-scope live-handle lifecycle.** Scope state is
   validated and cloned; there is nowhere to keep a function, an `AbortController`, a
   sandbox, an MCP client, a `Thread`. Forces: three hidden bags plus two `AsyncLocalStorage`s
   in the board, the tool cache's false `"session"` scope, bash's registry, engine's abort
   registry, the MCP manager's cache, chat-sdk's thread map. Shape: `ctx.ephemeral` on
   `BlockContext` (non-persisted, non-cloned, GC'd with the execution) and
   `ctx.scope.handle(key, create, dispose)` tied to scope lifecycle; a per-iteration
   identity handle from `forEach`/`loopBack`.
5. **A block-reachable lease.** Engine's `LeaseStore` is `requestId`-keyed and unreachable
   from a block. Forces: the checkout lock file plus poll loop and workspace's
   `sharedClaimRegistry`, both one-host. Shape: `ctx.lease(key, { ttl })` or a lease-keyed resource.
6. **A sequencer op that runs a block and keeps the input beside the output.** Forces:
   `intentRouter`'s signed BP-011 deviation, `sessionTitleGenerator`'s `.tap`,
   `upsertResource` returning nothing, memory's recall tool reading `ctx.parent!.input`.
   Shape: `.assign(key, block)`; and a `ctx.sequencer.input` carrier that mocks populate.
7. **Idempotent dispatch and idempotent writes.** No "dispatch iff this `requestId` is
   absent" on the host (though `RequestStore.set(…, "absent")` exists); no `addTask` with
   an `ifAbsent` outcome; no source-filtered prefix `list` on collections; no
   cross-process concurrency key. Forces: scheduled's LRU, bullmq's `jobId`, Conductor's
   read-then-create seed race, the inbox loading a user's whole inbox to discard most of it.
8. **A watch / address for "tell me when this row settles."** `dispatcher({ id })` needs a
   session id the run doesn't have; `resource_change` stays on the emitting request's
   stream; dispatch carries a flow *kind* but no *instance* id (one conductor per epic
   collides under one host); user scope is keyed on the bare user id (tenant isolation
   re-done per collection id). Forces: `announce`, polling `status`, Conductor folding the
   tenant into collection ids.
9. **Client stream layer:** no reconnect/liveness policy in `createSSEClient` (the wire
   supports `startingAfter` and the store tracks the cursor, nothing uses them); no
   `streamRequest()`; `sendActionStream` returns a raw `Response`; `state_change` carries
   raw op deltas instead of the projected `clientData` slice. Forces: `useSession`'s
   watchdog, the devtool's polling fallback, three handshake copies, `mergeStateChangeIntoSnapshot`.
10. **Contracts and react surface:** `messageText()`/`reasoningText()`; Task wire types in
    contracts and a `deriveTaskPlan(items)` reducer in react; registry renderers for
    `suspension` receiving `{ item, isResolved, resolution }`; an exported items context;
    `useSession` child-session refresh opt-in (FIX-1109); `useFlow.createSession` accepting
    `title`; a bare-route helper in `@flow-state-dev/next`.
11. **Verification surface:** `fsdev run --resume <id> --action …`; `testFlow({ runtimeConfig,
    requestId, durable })` plus `resumeSuspension()` on its result; `evalFlow` over a stored
    session; `analyzerScorer` raw findings and k-repeats; an MCP `tools/call` helper in
    testing; `mockGenerator` with `when → steps[]`; a tool-payload record/replay runtime
    (trading-desk's fixture/live/record corpus is the candidate for promotion).
12. **Task and collection surface:** a typed, non-model-patchable `run` slot on `Task`
    (harness session id, cost, usage, workspace path) so `runs/**` stops shadowing the row;
    `reactTo` on task collections or a board-level settle/cancel hook; a "reset session
    resources" op or a per-run scope between request and session; batched `upsert`;
    cross-item query/index on collections (the reason the portfolio moved to `app.*` tables,
    and legitimately so).
13. **A harness tool bridge.** A capability's `tools` never reach the model inside a coding
    harness, so the question channel is a `.fsdev/ask/<attempt>.md` file marker. Shape:
    bridge capability tools into the harness as MCP tools.
14. **Memory and generator composition:** a durable, collection-shaped, non-LLM capture tier
    (both labs build their own "inbox" because working memory is session-scoped and
    episodic memory is one rewritten array); `repairOutput` that composes with the default
    repair legs instead of replacing them; a rate-limit op in the DSL; a streaming-delta tap
    seam so the next stream-reactive feature doesn't clone `tts-pipeline.ts`.
15. **Schedule index bound by the runtime.** `defineScheduleCollection` takes a concrete
    `index` while the `stores.scheduler` slot is a no-op in `resolve-slots.ts:17-27`, so
    kitchen-sink needs a late-binding singleton proxy and a `ready()` pre-warm.

---

## Part 3 · What was checked and found clean

Worth recording so the next audit doesn't re-scan it.

- **Model calls** are centralised in `core/models/createAiSdkModelResolver.ts`. No
  `generateText`/`streamText` in any lab, app, or composition package. The one exception
  is the perplexity-sonar search adapter (Theme 10).
- **Patterns** are sequencers over `board.drain` or `goalSeekLoop`; the board drain is
  `forEach` + `waitForCondition` + `loopBack` + `rescue`; dispatch by assignee goes through
  `utility.keyedRouter`. Zero `Promise.all` over blocks, zero `setInterval`, one
  `asRuntime` in ~38k lines (Theme 4).
- **Skills runtime** keeps no private store: catalog is a resource collection, activations
  live in generator state, delegation board is on the generator's own state, task tools
  are handlers under one capability.
- **Memory tiers** are five `defineResource`s and one `defineCapability` with five
  orthogonal presets; consolidation and prune are `stepIf` sequencers mounted as side chains.
- **Harness manager** is `.tap(openRun).step(prepare).step(harness, { abortSignal, onSettled }).step(decide).rescue([...])`;
  inbox and run record are collections; parking is the substrate's `awaitReview`.
- **Both coding harnesses** are `handler`s on core's neutral harness contract with
  conformance type-tests; `claude-code/shared` is only deprecated aliases over it.
- **Workspace** projects only through `ResourceCollectionRef` APIs; `tools/bash` consumes
  it rather than re-implementing it.
- **Trading-desk analysis pipeline** (`orchestration/analyze.ts`, `stages.ts`) is pure DSL;
  Phase 2 is the `roundRobin` pattern; one capability with ~20 presets; every prompt goes
  through `createPromptLoader`; 60 spec files sit on `@flow-state-dev/testing`.
- **Trading-desk React** uses `FlowProvider`/`useFlow`/`useSession`/`useResource`/
  `useResourceCollectionList`/`useClientData` throughout; `app/api/flows/*` is a pure
  pass-through to `flowstate.getRouter()`; the DB is plugged in via `StoreAdapter`.
- **Conductor** board/hand-off wiring: `defineTaskCollection`, `taskBoard({ concurrency: 1, onReview: "exit" })`,
  `dispatcher({ type: "task", session: "per-task" })`, tenant gate from the request
  principal (BP-031), `seedMayReuse` delegating admission to `isClaimable`.
- **knowledge-hub** flow: collections, session state as conversation record, MCP transport
  with fail-closed bearer resolver. Its refusal of `@flow-state-dev/memory` holds up (Gap 14).
- **Kitchen-sink flows**: `approval-gate`, `human-input`, `task-queue-demo`, the run
  pipeline, supervisor and background-work pipelines, the artifacts capability with
  `reactTo`, weekly-digest bindings. React hook usage overall.
- **Package boundaries**: no engine import in react or client; one SSE parser and one
  cursor dedupe in client; devtool builds on client factories; `fsdev benchmark` wraps
  testing's runner; `createMockModelResolver` substitutes at the `GeneratorModel` seam so
  core's tool loop still runs; no fake `ctx` objects anywhere in testing.
- **Transports**: node host, next handler, vercel SSE header shim, MCP dispatch path,
  `defineScheduleCollection` (collection is source of truth), chat stream bridge via
  `addEventObserver`, voice-openai, bullmq `WorkerAdapter` wiring, store CAS/tombstone logic.
- **Core**: all 11 utilities are compositions; `dispatcher()`, the harness contract, and
  the `Agent` contract all have real consumers; one prompt/context assembly path; `graph/`
  is a resource edge model, not a second trace; core helpers are re-export shims to contracts.
- **Engine**: one `resolveItemVisibility`; durability sweepers and the side-chain pool are
  substrate; transports hold no scope-shaped private state; the concurrency arbiter is
  in-process by documented design.

## Disposition after review (2026-09-07)

Jake's review on the PR (drafted with ChatGPT) reranked the audit around Workforce:
dispatch admission, instance addressing, and collaboration paths first; trading-desk
work deferred except where it demonstrates a reusable L1 need. Every code claim in
that review was re-verified against `main`; every Linear issue it cited was read. This
section records the outcome. Part 1 and Part 2 above are the scan record and are left
as written; where this section disagrees with them, this section wins.

### Revised top three

1. **Dispatch admission enforced once per inbound door.** Confirmed defect, bounded,
   independent of the scheduled-dispatch refactor. MCP and scheduled are each one line
   (`await host.validateDispatch(envelope)` after the principal is resolved and before
   `host.dispatch`); nothing downstream re-checks `requiresOrg`, so today an
   org-required flow runs org-less through those doors. Chat is *not* one line: it
   cannot route through `host.resolvePrincipal` because the host's default resolver
   reads an HTTP body and the only override slot is per-flow
   (`pickPrincipalResolver`), so the missing contract is an adapter-supplied identity
   mapping on `PrincipalResolutionContext`. Once that exists chat's `platform:userId`
   mapping becomes the fallback and the host applies `authentication.resolvePrincipal`,
   `requireUser`, and `defaultUserId` once. Scheduled already separates the gateway
   principal (caller) from `schedule.principal ?? gateway` (execution target) and
   builds the envelope from the target, which is the right input for `validateDispatch`.
   **Gate:** the transport conformance harness in
   `packages/testing/src/transports/conformance.ts` stubs `validateDispatch` as a no-op
   today, which is how three doors drifted. Make it table-driven: a `requiresOrg` flow ×
   {org on principal, org absent, org via bound session} × each adapter → admitted or
   refused by name; a `requireUser` flow × a chat event with no author → refused.
   **Related:** FIX-1328 is the same omission at the cross-flow seam and is the same fix
   class; FIX-722 (done) moved the check into the host, and this is its residue.
2. **A per-execution ephemeral slot, split from the scope-lived live handle.** Missing
   L1 contract. FIX-1289 already asks for exactly this in its smallest form (a
   request-scoped side-channel so `onSettled` has somewhere to read from); the three
   hidden `__fsd_*` bags and the worker `AsyncLocalStorage` in the board are its
   in-tree consumers and should widen that issue's scope, not spawn a second one.
   FIX-1250 (workers get no claim identity) is the per-iteration identity half.
   The scope-lived live handle (bash sandbox, MCP client, chat `Thread`) has different
   lifetime and cross-process guarantees and stays a separate, later gap.
   **Gate for FIX-1289:** a board drain at concurrency 4 where each worker reads its
   own claim, cache store, and ledger through the slot; `ctx.request` carries no
   `__fsd_` property; the duplicated slot-name strings are gone from orchestration.
3. **One adapter item emitter in core.** Missing L1 contract, and the drift it causes
   is already in production: LAB-160 (codex rebuilds a settled tool item with the
   current item count, claude-code does not) is this class. Smallest slice:
   `createAdapterEmitter(ctx, { blockName })` over the internal envelope helpers,
   stamping provenance plus `taskId`/`ownedBy`; both harness packages consume it and
   delete their `emit.ts`. **Gate:** a golden test feeds one translated event sequence
   through both harnesses and asserts identical item envelopes (ids aside), `taskId`/
   `ownedBy` present when dispatched from a board seat, and stable item indices.
   This is what Workforce harness seats need for attribution.

### Where the rest of the gaps land

| Audit item | Disposition |
| --- | --- |
| Gap 8, instance addressing (kind-only dispatch, first-wins registry) | Already active work: FIX-1320 epic. INST-1 (FIX-1321) kills first-wins `get(kind)`; INST-2 (FIX-1322) puts `flow.id` on the envelope. FIX-1315 is superseded by them. Not a new gap. |
| Gap 8, user scope keyed on the bare user id across tenants | Open question on FIX-1320: INST-3 keys isolation on instance id, and FIX-1022 is about the session key's principal. Neither states the tenant-qualified user-scope key. Hold as a question there rather than file. |
| Gap 8, the `announce` callback and "watch" | Three different asks, only one of which needs a seam. Reply to the sender → FIX-1312 (in development); the manager runs as a task dispatch from the coordinator's seat, so `announce` is exactly `dispatcher({ session: { from: true } })` and should be deleted when 1312 lands. Notify declared subscribers → FIX-1311, an L2 composition over collections, `reactTo`, and dispatch. Observe arbitrary task settlement → the one new seam: a board-level settle/cancel hook or `reactTo` on task collections, which Conductor's `status` read-that-writes also needs. Keep it off Workforce's path. Delivery into an existing session refuses under an external queue (`dispatch-operation.ts:190`); recorded as a limit, not bypassed. |
| Theme 3, the blanket `sessionStateSchema` refusal | Keep until proven. It is blanket because it runs at `defineFlow` (`task-entry.ts:184`), where the seat's session policy is not yet known. Narrowing means moving the refusal to `taskBoard()`, where the policy is, and keeping a warning at `defineFlow`. Proof before removal: two rows → two `per-task` children each holding session state with no cross-talk; a retried row lands in the same child with state intact; a composed capability schema is walked (`nestedSessionStateSchema` already does); a `per-worker` seat with a session-state entry is still refused. |
| Theme 3, harness session id on a board-owned `runs/**` row | FIX-1246 (resume the same external session from a second request) and FIX-1250 (claim identity). Workforce must not equate restart with resume or add a second task store. |
| Theme 4, delegation board `backing: "sequencer"` and the in-memory observation ledger | FIX-957 owns durable board backing and turn-scoped settlement; the ledger is a note on it. |
| Theme 4, `dispatchAndExecuteBlock` vs the keyed-router path | Downgraded to Low. No production callers (tests only); its header's claim that patterns compose it is doc drift. Consolidation or deprecation candidate. |
| Theme 7, `materializeAgent` | Confirmed: worker shape requires `skillName` (`:119`), worker output is forced to `z.string()` (`:140`), string capabilities are skipped silently without a catalog (`:39`). Split the legacy skill-adapter policy from general worker materialization before teams (FIX-1310). FIX-796 (persona template treated as a path) is already filed. |
| Gap 14, `repairOutput` composition | Already filed as FIX-1326. Dropped here. |
| Gap 2, scheduled dispatch as a function | Still L1 work, kept fourth. The function must *be* the pipeline (idempotency, overlap, admission inside it) so a colocated host cannot skip steps; the HTTP route stays for external schedulers. FIX-1219 is adjacent. |
| Gap 1, action return value over HTTP | Still a gap, deprioritized: trading-desk CRUD volume no longer sets priority, and Workforce collaboration ("A dispatches to B, B replies") is dispatch, not action output. |

### Corrections to the scan record

- Theme 8 cites FIX-1109 for the `BackgroundWorkRefresh` effect; that issue is
  canceled, and the kitchen-sink comment naming it is stale. FIX-1079 (done) addressed
  the parent's read mirror never refreshing, so the `background-work.ts` comment saying
  the parent cannot observe the child's write in-turn should be re-verified before it
  is relied on.
- Theme 2 quotes harness-manager's "Relay (FIX-1230) is not in tree"; FIX-1230 is
  canceled, the send half shipped as `dispatcher()`, and the reply half is FIX-1312.
  The comment should point there.
- "Three one-line `validateDispatch` fixes" overstated it: two are, chat is a seam.

## Method

Ten parallel read-only scans, one per area (trading-desk flows; trading-desk app side;
Conductor and knowledge-hub; kitchen-sink, examples, and goals; harness packages;
orchestration, patterns, workforce, memory; tools, thought-fabric, ui, engine
subsystems; transports, hosts, stores; core and contracts; client, react, cli, devtool,
testing, integration-tests, plugin). Each scan worked from one brief that defined L1
from the atlases and listed thirteen smells to hunt, and was told to label a finding
`GAP` when the hand-rolled path exists because L1 lacks the primitive. Every High
finding and every Gap named here was re-verified against the source by the
coordinator before inclusion. Findings already on the framework atlas's removal
ledger (the 23 `@deprecated` marks, the package extraction proposals) were excluded
unless a new angle appeared.

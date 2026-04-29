# Changelog

All notable implementation-repo changes are recorded here as concise, wave-level summaries.

## 2026-04-29

### `taskBoard` re-entry via request-scoped collection (FIX-471)

- **Re-enterable boards.** `taskBoard({ collection: { backing: "request", collectionId } })` puts the `tasks` record on `ctx.request` instead of on the board's own sequencer state. Multiple `board.block` invocations within the same request now share a single collection, which unblocks the FIX-447 P&E migration's replan loop and any other "wrap a board inside a higher-level loop" pattern. Sequencer-backed remains the default — single-invocation boards keep their per-call state model and existing tests stay green.
- **Why a third backing instead of lifting state into a parent slot.** `ctx.getTarget(name)` resolves by sequencer name and throws on multiple matches; the board sequencer is itself named `boardName`, so a parent slot also keyed by `boardName` would either collide or require renaming the board. `targetStateSchemas` is type-only — there's no runtime mechanism that auto-installs a slot in a parent. Request scope already exposes the same `ScopeStateOps` surface (`atomicState`, `patchState`, …) as a sequencer state ref, so the request-backed mode reuses the existing `createSequencerBackedTaskCollection` mutation engine without duplicating the CAS retry / emit path.
- **Substrate.** `getOrCreateTaskCollection` gains a `backing: "request"` option (`@flow-state-dev/tasks`). The factory adapts `ctx.request` to a `StateRef`-shaped wrapper with a live `state` getter and bound mutators, then delegates to the same sequencer-backed implementation. `stateKey` defaults to `collectionId` so multiple request-scoped boards in one request stay namespaced without manual setup. `RequestBackingSpec` exported from the package's main barrel.
- **Pattern.** `TaskBoardConfig.collection` adds the `TaskBoardRequestCollectionSpec` union member. `buildCollectionFactory` short-circuits to request scope when `backing === "request"` and skips the `ctx.getTarget(boardName)` resolution — the storage isn't on a parent sequencer. The capability built for request-backed boards drops `targetStateSchemas` (no slot to declare) and reaches the collection through `ctx.request` from any block in the request, not just blocks in the board's subtree.
- **Tests.** Three new `taskBoard - re-entry (request-scoped collection)` tests in `packages/patterns/test/task-board.test.ts`: mid-loop addition between two invocations is observed by the second drain; three sequential drains separated by enqueues sum across rounds with each task processed exactly once; and a concurrency=4 stress (16 tasks across two rounds) shows CAS still serializes claims through the request-scope adapter and round-1 tasks are never re-claimed by round-2 workers. The deferred test note in the seed-idempotency block is updated to point at the new describe.
- **Docs.** `packages/tasks/README.md` documents the new request-state backing alongside sequencer-state and resource-collection. `packages/patterns/README.md` adds a "Re-entry across an outer loop" subsection under Task Board with the opt-in config shape and the CAS semantics.

### `taskBoard` capability + framework-idiom revision (FIX-446 follow-up)

- **`task_change` custom item type retired.** Lifecycle mutations now emit a `task-change` *component item* via `ctx.emitComponent` (per `items.md`'s "use component items for new UI types") instead of a custom `OutputItem` defined outside core's union. Each emission is keyed by `${collectionId}/${taskId}` so the client UI gets latest-wins replacement per task automatically. Subscribers filter on `item.type === "component" && item.component === "task-change"`. Drops the entire `packages/tasks/src/items/` subdir (`buildEmissionFrame`, `buildEmitter`, `buildTaskChangeItem`) and the `_blockIdentity` structural cast the substrate previously needed to construct provenance frames itself.
  - **Persistence shift.** Component items are persistent by default per `items.md`'s registry table; the retired `task_change` items were transient. The `key` does NOT prune the items log — every emission is persisted; clients merely render the latest per key. This is fine for typical board lifecycles (a few hundred transitions per session) but consumers running long-lived boards with high mutation churn should mark their pattern's emitting blocks `transient: true` to keep the items log lean.
- **Substrate now exposes `onChange` instead of `emit/frame`.** `createSequencerBackedTaskCollection` and `createResourceBackedTaskCollection` accept an optional `onChange: (event: TaskChangeEvent) => void` callback. `getOrCreateTaskCollection` wires it to `ctx.emitComponent` automatically. Tests and advanced consumers can pass their own callback for a typed event stream without going through item emission.
- **`TaskBoardHandle.capability`.** `taskBoard({...}).capability` now returns a `DefinedCapability<"taskBoard.<name>", { tasks: () => TaskCollectionRef }>`. Blocks across the flow opt in via `uses: [board.capability]` and read or mutate the board through `ctx.cap["taskBoard.<name>"].tasks()`. Multiple boards in one flow get distinct namespaces (`taskBoard.research`, `taskBoard.financials`). The capability is **backing-aware**: sequencer-spec boards get a capability that auto-resolves the collection via the parent sequencer's state ref AND declares the board's `tasks` slot via `targetStateSchemas: { [boardName]: taskBoardStateSchema }` so consumers no longer extend their flow-level state schema by hand. Caller-supplied factory boards (resource-collection-backed, custom backings) get a capability that defers entirely to the user's `(ctx) => TaskCollectionRef` factory, with no state schema declaration since the storage is the caller's responsibility. Either way `.capability` is always defined.
- **Schema depth-instantiation guards.** `taskBoardStateSchema` and `claimResultSchema` are typed as `ZodTypeAny` (with hand-declared `TaskBoardState` / `ClaimResult` TS types) to dodge tsc OOMs from deep `z.record(z.string(), taskSchema)` inference. The framework consumes these as `ZodTypeAny` at runtime — wider TS types lose no behavior. Same workaround applied to `BlockDefinition<typeof taskSchema, ...>` references in `worker-step.ts` and the worker-body sequencer's input typing in `index.ts`.
- **Tests.** Five new `taskBoard - capability` tests in `task-board.test.ts` cover capability presence, name encoding, `targetStateSchemas` declaration, factory-mode opt-out, multi-board namespacing, and a smoke test that the board's drain still emits `task-change` component items keyed correctly. All 121 tasks tests + 186 patterns tests green.
- **README updates.** `packages/tasks/README.md` documents the component-item shape, the `onChange` substrate hook, and how `<Plan />` / DevTool subscribers consume the stream.

### `taskBoard` pattern (FIX-446)

- **New pattern `taskBoard`** ships in `@flow-state-dev/patterns` (subpath: `@flow-state-dev/patterns/task-board`). Concurrent drain over a `TaskCollection` with dependency gating, per-task worker routing by `task.assignee`, and CAS-safe claim semantics inherited directly from `@flow-state-dev/tasks`. The validation case for the unified Plan/Task primitive: dispatcher × worker × loop is enough; no new framework primitives, no per-task storage, no custom status vocabulary.
- **Pipeline shape.** `[seedCollection?] → forEach(workerId, makeWorker)`; `makeWorker` is `[claimAndExecute] → [checkBoard] → loopBack(claimAndExecute, when=shouldContinue)`. The inner `claimAndExecute` step uses the substrate's `dispatchAndExecute` for atomicity. `claimAndExecute` swallows registry-miss errors as a `collection.fail`, honoring the configured `onError` policy so a single mis-routed task can't crash the loop.
- **Dispatcher resolution.** Accepts a `TaskDispatcher` instance OR a string name (`"fifo"`, `"topological"`, `"priority"`). Default is `"topological"` — the canonical case for dependency chains. Unknown names throw at factory-call time.
- **Termination semantics.** `onIdle: "complete"` (default) exits when no `pending`, `in_progress`, or `awaiting_review` tasks remain; awaiting_review keeps the loop alive (per FIX-443 §10.1) so workers idle-poll until an external actor flips the status back. `onIdle: "wait"` defers to the user-supplied `shouldExit(collection)` predicate for long-running session-scoped boards. `idlePollMs` (default 50ms) bounds the busy-wait cost when the dispatcher returns null.
- **Collection access from inside workers.** Workers running under `forEach` see their nested `ctx.sequencer` (the per-worker scratch state). To address the shared task record, the pattern resolves the board's `StateRef` via `ctx.getTarget(boardName)` internally; consumer workers that need to mutate the collection mid-drain follow the same convention (`getOrCreateTaskCollection({ sequencer: ctx.getTarget(boardName) })`). Resource-backed and caller-supplied factories work identically.
- **Individually-exported remix blocks.** Per BP-001: `createSelectNextReadyTask` (read-only peek), `createClaimTask` (CAS claim via dispatcher), `createRunWorker` (worker resolution + execution), `createRecordResult` (write back complete/fail), `createCheckBoard` (termination + idle-sleep), `createSeedCollection` (initial-task seeding). Each is a thin handler factory; consumers compose them differently when the default inner pipeline doesn't fit.
- **HITL forward-compat.** v1 ships the `awaiting_review` *status* fully working: standard dispatchers skip it, the loop counts it as in-flight in `complete` mode, resume-from-review wakes the loop on the next idle poll. Out of scope: `reviewPolicy` config field, worker-explicit `awaiting_review` returns, inline `<Plan />` review affordances, `tasks.review.requested` topic — all Wave 2 per FIX-443 §10.8.
- **Tests.** 20 tests across block structure validation, basic drain (concurrency 1 / 4), topological dispatch, registry routing, missing-worker error path, CAS contention (8 workers × 100 tasks, no double-dispatch), mid-drain enqueue, error-skip vs error-fail, deps-failed-cancel-to-drain, awaiting_review skip + resume-on-transition, both `onIdle` modes, individual remix-block composition, and the research-board demo (3 worker types, dependency chain, end-to-end).
- **Pattern source.** ~920 LOC across 9 files (factory + 6 remix blocks + schemas/shared, dominated by JSDoc on every exported API per BP-007) — implementation surface stays compact: the factory itself is a sequencer composition over substrate primitives.
### Inbound transport adapter contract (FIX-438)

- **`InboundTransportAdapter` contract** ships in `@flow-state-dev/server`. Every entry point into the runtime — native HTTP, MCP, webhooks, scheduled actions, custom transports — implements the same shape: a `source` identifier plus a single pure `createBindings(host)` function returning routes/dispatchers. Adapters are immutable factory objects; they do not retain references to the host and have no post-construction lifecycle outside the optional `start`/`stop` hooks in their bindings.
- **`InboundRequestEnvelope` is the single shape every adapter constructs before invoking the runtime.** Carries `source`, `flowKind`, `action`, `input`, `principal`, `metadata`, `signal`, optional `rawBody` for adapters that need pre-parse access (webhook signature verification), and an optional `responseEmitter`. The runtime below the adapter is identical regardless of `source`.
- **`createFlowApiRouter` is the first reference implementation.** Public API and behavior unchanged — every existing test in `packages/server/test/`, `apps/devtool/`, and `packages/vercel/test/` passes without modification. Internally the router constructs an `InboundTransportHost`, mounts the built-in `HttpTransportAdapter`, and exposes the canonical `{ GET, POST, PATCH, DELETE }` dispatcher. Action execution flows through `host.dispatch`; session/state/resource/stream/abort/recovery routes use `host.registry` and `host.stores` directly.
- **`adapters?: InboundTransportAdapter[]` is the new public option** on `createFlowApiRouter`. Routes from every adapter merge into the returned dispatcher; path collisions among non-HTTP adapters throw `TransportRouteCollisionError` at construction time so dispatch is unambiguous at runtime.
- **`source` is a first-class field** on `RequestRecord` and `ActiveRequestEntry`. CloudEvents-aligned, queryable, surfaces in DevTool's request list as a small badge for non-`http` sources. Open string with a documented known-set: `http` | `mcp` | `webhook` | `scheduled` | `notification`. SQLite `active_requests` migration adds the column with `NOT NULL DEFAULT 'http'`; record-store reads default to `"http"` for pre-existing JSON-blob records.
- **Auth boundary preserved** as a soft dependency on FIX-23. `host.resolvePrincipal` is the single integration point; Phase 1 ships `defaultBodyUserIdPrincipalResolver` (reads `body.userId` exactly as today). When FIX-23 lands the resolver becomes configurable on `createFlowApiRouter`; adapter code does not change because adapters always call `host.resolvePrincipal`.
- **Vercel adapter unchanged.** `createVercelHandler(flowRouter)` continues to wrap a `FlowApiRouter` value as today. The transport adapter operates at the request layer; the Vercel adapter operates at the response layer; they compose without edits.
- **Conformance suite** ships in `@flow-state-dev/testing`: `createInboundTransportConformanceTests({ name, factory, helpers })`. Modeled on `store-cas-contract.test.ts`. The HTTP adapter is the first conformer; future MCP/webhook/scheduled/notification adapters plug into the same harness.
- **Tests.** `packages/server/test/transports/{types,host,http-adapter}.test.ts` exercise the contract directly; `packages/testing/test/transport-conformance.test.ts` runs the conformance suite against the HTTP adapter; `apps/devtool/test/components.test.tsx` covers the source-badge rendering.
- **Internal seam preserved.** `InternalRouteSeams` is kept as the internal hot-path mechanism (currently used only by tests). The new public `InboundTransportAdapter` is the documented external API; the seam neither promotes nor deprecates it.
- **Out of scope (per spec).** The MCP, webhook, scheduled, and cross-flow notification adapters themselves; the FIX-23 auth hook implementation; outbound transport adapters (Ably AI Transport).

### `@flow-state-dev/tasks` substrate (FIX-444)

- **New package `@flow-state-dev/tasks`** ships the unified Plan/Task primitive substrate locked in FIX-443. Layering: `core` → `tasks` → `patterns`. Patterns will migrate onto this substrate in FIX-446–FIX-450; this wave only ships the primitives.
- **Task schema + state machine.** Canonical `Task` shape (FIX-443 §2) with status enum `pending | in_progress | blocked | awaiting_review | completed | errored | cancelled`. State transitions enforced by `assertTransitionAllowed`. Terminal states (`completed`, `errored`, `cancelled`) reject further transitions; `cancel()` on a terminal status is a no-op with no item emitted.
- **`TaskCollectionRef` API across two backings.** Same uniform interface from `getOrCreateTaskCollection({ backing, ... })`. `backing: "sequencer"` (default) puts tasks on the outer sequencer's state and rides `atomicState`'s CAS retry — durable as soon as FIX-401's checkpoint write fires. `backing: "resource"` puts tasks on a parameterized resource collection (`tasks/{id}` style) for collections that outlive a single request, with re-eligibility re-check inside `updateState` so concurrent claims serialize correctly.
- **Five standard dispatchers.** `fifoDispatcher`, `topologicalDispatcher`, `priorityDispatcher`, `classifierDispatcher({ classify })`, and `eventDispatcher({ topicFor, topic })`. Each delegates to `collection.claim(workerId, { eligibility, order })` so the substrate's CAS retry runs uniformly. All standard dispatchers skip `awaiting_review` (FIX-443 §10.1) — a shared `isReady` predicate enforces it without dispatcher authors having to think about it.
- **Worker contract.** `TaskWorkerInput<TIn>` is the input shape; workers are plain `BlockDefinition<TaskWorkerInput<TIn>, TOut>`. Patterns accept either a uniform worker or a registry keyed by `task.assignee` (the user-set routing key — `claim`'s `workerId` is for trace/lease, not registry routing).
- **`task_change` items.** Every lifecycle mutation emits one `task_change` item (kind: `added | claimed | completed | errored | blocked | unblocked | review_requested | resumed | cancelled | label_changed | metadata_changed | priority_changed | assignee_changed`), transient by default with `persistTaskEvents: true` opting in. `kind: "resumed"` covers both `resumeFromReview` and stale-lease `reclaim`; consumers disambiguate via `prevStatus`.
- **Helpers.** `taskLoopBack({ until?, maxIterations? })` packages the canonical drain-until-empty termination predicate (treats `awaiting_review` as in-flight). `dispatchAndExecute({ collection, dispatcher, workers, onError })` runs one claim → execute → record-result cycle with rescue-on-throw via `collection.fail`; routing discriminates uniform-vs-registry via `typeof workers.run === "function"` (not key presence).
- **Tests.** 120 tests across schema, both backings parameterized, every dispatcher (including HITL-skip per dispatcher), helpers, sequencer integration via `testBlock` (state_snapshot durable + terminal frame + tasks-map persistence per the FIX-401 checkpoint contract), and type tests.
- **Out of scope (per FIX-443 §11 / FIX-444 spec).** No `<Plan />` rendering (FIX-445), no `taskBoard` pattern (FIX-446), no migrations of existing patterns (FIX-447, FIX-448), no Plan Mode reshape (FIX-449), no skill-pattern frontmatter binding (FIX-450), no `reviewPolicy` config field, no inline review affordances on `<Plan />`, no `tasks.review.requested` cross-flow event topic — all Wave 2 follow-ons. The v1 substrate is HITL-ready (`awaiting_review` lifecycle, `awaitReview` / `resumeFromReview` on the ref, `metadata.review.history` documented as the audit-trail convention) so Wave 2's HITL push is config + UI work, not a primitives revision.

## 2026-04-28

### Interrupted-request recovery: client-driven sweep + resume

- **New `POST /api/flows/users/:userId/check-interrupted` endpoint.** Sweeps stale `active_requests` entries owned by the given user and transitions any matching `in_progress` request records to `interrupted`. Long-running dev servers and serverless deployments — which often disable startup detection (`detectInterruptedOnStartup: false`) for pool-safety reasons — now have an on-demand path to reconcile orphaned requests instead of needing a full server restart. Response returns only the requests this call transitioned: `{ interrupted: [{ requestId, sessionId, flowKind, actionName, interruptedAt }] }`. `detectInterruptedRequests` accepts an optional `userId` filter to support this surface.
- **`createRecoveryClient` (new in `@flow-state-dev/client`).** Two methods: `checkInterrupted({ userId, staleThresholdMs? })` calls the sweep endpoint; `retry({ flowKind, sessionId, requestId, inputOverride? })` re-dispatches a previously interrupted or failed request through the existing retry endpoint and returns the new request id. The server creates a fresh request that re-runs the original action with the same input — items from the interrupted run stay in the session log; the new request appends alongside them.
- **`useSession` exposes recovery surface.** Two new fields on `SessionView`: `latestRequest: SessionRequestSummary | null` (refreshed on mount and on every terminal SSE event) and `resumeLatestRequest()` (re-dispatches the latest request when its status is `interrupted` or `failed`, attaching to the new stream automatically). No-op for any other status.
- **DevTool: sweep on mount + session-list refresh, Resume button.** The DevTool calls `checkInterrupted` on mount and inside `useSessions.refresh` so the user always sees current truth without a manual refresh. A Resume button appears next to the Live badge when the latest request is `interrupted` and no user-dispatched stream is in flight; click re-dispatches via the recovery client and locks the Live toggle ON.
- **Kitchen-sink: amber Resume notice above prompt input.** When `session.latestRequest?.status === "interrupted"` and no stream is active, an inline notice surfaces above the prompt with a Resume button that calls `session.resumeLatestRequest()`.
- **Tests.** 1 new test in `packages/server/test/request-recovery.test.ts` for the userId filter; 2 new tests in `packages/server/test/recovery-routes.test.ts` for the new route shape; 6 new tests in `packages/client/test/recovery.test.ts` covering both client methods (URL shape, query forwarding, body serialization, empty-input guards).

### Generator debug capture extended with `user` and `history`

- **`BlockDebugPayload` gains optional `user?: unknown[]` and `history?: unknown[]` fields.** Generators now record the user-slot messages (post-`asUserMessage` wrapping, in the form sent to the model) and the resolved conversation history alongside the existing `prompt`, `model`, and `tools`. Both fields are omitted when the generator had no corresponding slot, so the persisted item stays compact.
- **`BlockDebugCapturePayload` (the runtime hook payload) now requires `user` and `history`.** Affects only callers that construct the payload directly — the standard `onBlockDebugCapture` consumer in `createExecutionContext` forwards the capture unchanged, so middleware authors using the hook see the new data automatically.
- **DevTool block detail panel renders two new sections.** "User Message(s)" sits right below Prompt and opens by default; "History (N)" sits below it and stays collapsed by default. Each renders role-tagged bubbles (sky/emerald/amber/purple for user/assistant/system/tool) for string content, falling back to a JSON viewer for multi-part content, tool calls, or any non-string `content`.
- **Gating is unchanged.** Capture still only fires when `isTraceObservabilityEnabled()` returns true (`FSDEV_TRACE_OBSERVABILITY=true`, dev default). No new env vars, no new emission paths.
- **Tests.** `packages/server/test/debug-items.test.ts` extended to cover the new fields and the empty-array omission semantics.

### Durable sequencer checkpoint schema (FIX-401)

- **`SequencerCheckpoint` type + `CheckpointStore` interface** ship the persistence seam Phase 2 durable execution (FIX-141) will plug into without schema migration. Identity is `(requestId, blockInstanceId)`; `write` overwrites the latest record per sequencer instance, `latest` reads it, `delete` removes it at terminal completion.
- **Latest-only persistence.** Storage is constant per sequencer regardless of step count. The original FIX-401 spec proposed append-and-prune with a `pruneBefore` API; revising to overwrite-latest collapses the store interface from four methods to three and makes always-on durability cheap.
- **`durable: true` is now the sequencer default.** Explicit `durable: false` is the opt-out, intended for tests and ephemeral fanouts. `state_snapshot` items now carry `durable`, `version`, `key: blockInstanceId`, and an optional `terminal` flag.
- **Stream emission realigned to keyed-update.** Sequencers emit one logical `state_snapshot` per instance — same `key` on every step boundary — so consumers (DevTool, durability middleware) treat each new emit as an in-place update rather than a new entry. Net: 1 stream item per sequencer per turn that updates N times instead of N items per sequencer per turn.
- **DevTool snapshot timeline collapsed to one row per sequencer instance.** The trace tree retains only the latest `state_snapshot` per block; the panel renders the current state of each sequencer rather than a step-by-step list. The legacy append-per-step rendering is dropped — historical streams replay as one row showing their final state.
- **Implementations.** Memory, filesystem (atomic temp-write + rename), SQLite (`INSERT ... ON CONFLICT DO UPDATE` on `(request_id, block_instance_id)` PK), and Postgres (`ON CONFLICT DO UPDATE`, JSONB `data`) all ship.
- **Server middleware.** `runAction` watches `state_snapshot` items in `onItemDone`: durable + non-terminal frames write to `stores.checkpoints`. Terminal frames optionally trigger a delete based on `flow.request.cleanupCheckpointsOnTerminal` — default is **retain** (final state stays in the store for post-mortem inspection). Operators that want eager GC opt in. When enabled, each sequencer cleans up after itself — no enumeration pass at request termination, root or nested.
- **Tests.** `packages/server/test/sequencer-checkpoint.test.ts` covers write/read round-trip, overwrite semantics, default-durable, opt-out, nested checkpoints with parent pointers, schema validation at write, and the keyed-stream observability contract. SQLite checkpoint store has its own contract tests in `packages/store-sqlite/test/stores.test.ts`. DevTool trace-tree dedup has parallel tests in `apps/devtool/test/trace-tree.test.ts`.
- **Out of scope (per spec).** Resume-from-checkpoint runtime (FIX-141), HITL suspend/approve (Wave 3), and append-and-prune step-history retention.

## 2026-04-26

### Org scope — rename + immutable session binding + `requireOrg` opt-in (FIX-428)

- **Renamed `project` scope to `org` scope** across core, server, client, react, devtool, stores, tools, patterns, skills, thought-fabric, and tests. `ScopeType` is now `'request' | 'session' | 'user' | 'org'`. `ScopeIdentity.projectId` → `orgId`. `ProjectScopeHandle` → `OrgScopeHandle`. Block configs use `orgResources` / `orgStateSchema` / `orgClientData`. `FlowDefinition.org`, `isolateOrgState`, `ctx.org` everywhere. SQLite/Postgres tables renamed (`projects` → `orgs`, `project_id` → `org_id`).
- **Session orgId is now immutable.** `createExecutionContext` enforces it: a request that supplies an `orgId` different from the session's stored value (or that tries to late-bind an unbound session) throws `OrgBindingMismatchError` and surfaces as 400. The previous code (`optionsProjectId ?? sessionRecord.projectId`) silently let any caller-supplied id override the stored value, vacating the immutability claim. Apps that need to "move" a session create a new one.
- **userId mismatch is also caught now.** Same enforcement site, parallel guard: if the loaded session's `userId` differs from `options.userId`, throws `UserBindingMismatchError`. Closes a long-standing gap where a caller could pass `userId=alice` for a session created with `userId=bob` and silently route bob's data into alice's response. The userId check fires before the orgId check.
- **`requireOrg: true` block flag.** Opt-in per block; bubbles through sequencers/routers so a flow's `requiresOrg` is true when any block in any action declares it. The HTTP action route consults `flow.requiresOrg` and rejects requests against unbound sessions with `400 OrgRequired`. `list_flows` exposes `requiresOrg` alongside the existing `requireUser`.
- **Dynamic resource routing is deferred to FIX-435** per its explicit supersession statement. This wave ships rename + binding + `requireOrg` only — `scope: (bind) => ...` and `ctx.dynamic.resources.*` come later. The projects-as-org-scoped-collection pattern (for app-level project structures) works without dynamic routing.
- **Surfaces:**
  - `useSession` accepts `orgId` and exposes it on the returned `SessionView`.
  - DevTool session-context panel labels org state/clientData/resources as "Org" (not "Project").
  - Server exports `OrgBindingMismatchError`, `UserBindingMismatchError`, `OrgRecord`, `OrgStore`, `OrgListOptions`, `resolveOrgStorageKey`.
- **Tests:** 6 new tests in `packages/core/test/require-org.test.ts` covering `requiresOrg` bubbling through handlers, sequencers, multi-action flows. 7 new tests in `packages/server/test/binding-immutability.test.ts` covering both userId and orgId mismatch, late-bind rejection, and check ordering.
- **Migration:** No data migration. Pre-1.0 dev/test data on disk under `project-store/` is no longer read; document and recreate. The Linear `blockedBy: FIX-427` relation was removed (verified the lazy-collections surface is not touched by this issue).

## 2026-04-25

### Up-front skill activation router (FIX-421)

- New `createIntentSelector()` factory in `@flow-state-dev/skills` — a three-tier sequencer that decides which skills (if any) apply to a user message before the main generator runs. Tiers: (1) literal `/<skill-name>` slash match, (2) local keyword scan over per-skill `keywords` frontmatter, (3) structured-output LLM classifier (`agentType: "trace"`) that runs only when tiers 1–2 are inconclusive. Skill-only — thinking-style classification stays in its existing kitchen-sink pipeline.
- `createSkillsCapability` now ships three named presets — `tools` (catalog tool schemas), `context` (the active-skill body formatter), and `runSkill` (the `runSkill` tool plus the skill-catalog context listing) — all on by default. Flows using up-front activation drop the tool-call path with the standard preset override: `cap.presets({ runSkill: false })`. The `tools`/`context` presets stay on so the active-skill body formatter still injects matched skills under the FIX-434 keyed `<skills>` context tag.
- New `keywords` frontmatter field on `SKILL.md` (parsed + serialized round-trip in `parseSkillMd` / `serializeSkillMd`, surfaced in the `skills` collection's client-data projection). Lowercase tokens that the tier-2 keyword scan matches against the user message.
- `buildRunSkillDescription` no longer emits the slash-command instruction — slash routing is handled deterministically by `intentSelector`'s tier 1 instead of by the model.
- New core types: `MatchedSkill` and `IntentSource` exported from `@flow-state-dev/core` and `@flow-state-dev/core/types`.
- `ActiveSkillEntry` (the records in `session.state.activeSkills`) gains an optional `source` field. `intentSelector` stamps it with the matching tier; mid-flow `runSkill` calls leave it undefined. Consumers that want a tier badge in their UI project from `activeSkills` directly via clientData.
- Apply-intent replaces (not appends) `activeSkills` for the turn. Mid-flow `runSkill` calls within the same turn still append on top via the existing `pushActiveSkill` path.
- Chat-agent flow wiring is intentionally NOT changed in this PR — that's a follow-up. This PR ships the primitive plus the capability option so they can land independently.

## 2026-04-24

### Cross-flow schema registry + per-flow isolation (FIX-431)

- Added `isolateUserState` and `isolateProjectState` flags to `defineFlow`. When set, the flow's user- or project-scope storage key is namespaced by `flowKind` (`${userId}:${flowKind}` / `${projectId}:${flowKind}`), and the flow skips cross-flow schema checks for that scope.
- `FlowRegistry.register` now collects every non-isolated flow's `user.stateSchema`, `project.stateSchema`, and user/project resource schemas. Incompatible declarations throw `CrossFlowSchemaConflictError` at registration time — no silent data loss when a second flow's write would clobber the first flow's fields.
- Structural compatibility check is conservative and Zod-aware: same-reference merges; compatible object extensions merge with a `console.warn`; type mismatches on a shared field throw.
- New storage-key helpers `resolveUserStorageKey` / `resolveProjectStorageKey` exported from `@flow-state-dev/server`; `createExecutionContext` uses them for every user/project read, write, and content operation.
- New `FlowRegistry.describeSharedSchemas()` for diagnostics.
- Docs: new `docs/fundamentals/flow-isolation.md` guide and extended `docs/architecture/state-and-scopes.md` with a cross-flow section.

### Prompt caching: audit and default-enable (FIX-423)

- Added a `caching` field to the `generator()` block config. Default: `{ enabled: true, breakpoints: 'auto', ttl: '5m' }`. Accepts a static object or a `(input, ctx)` resolver.
- New `packages/core/src/models/caching.ts` applies provider-specific cache markers in `buildAiSdkRequest` right before AI SDK dispatch:
  - Anthropic / OpenRouter — stamps `providerOptions.anthropic.cacheControl` on the last system message when the cacheable system+tools prefix is large enough to activate (~1024 tokens).
  - Vercel AI Gateway — sets `providerOptions.gateway.caching: 'auto'` and lets the gateway decide placement.
  - OpenAI / Google / DeepSeek / unknown — no-op (those providers cache implicitly).
  - Caller-supplied `cacheControl` markers are never overwritten (auto mode) and are left entirely untouched in `manual` mode.
- Extended `GeneratorModelUsage` with optional `cacheReadInputTokens` and `cacheCreationInputTokens`. The AI SDK adapter normalises them from either Anthropic `providerMetadata` or the AI SDK v6 `usage.cachedInputTokens` aggregate. Sequencer and server cache-token extractors now prefer the adapter-normalised fields and fall back to provider metadata so older call paths keep working.
- Exported `CachingConfig`, `CachingBreakpointMode`, `CachingTtl`, `applyCaching`, and `DEFAULT_CACHING_CONFIG` from `@flow-state-dev/core`.
- Added 17 unit tests (`packages/core/test/models/caching.test.ts`) covering provider detection, threshold check, user-marker preservation, gateway delegation, manual-mode passthrough, and disabled mode; 4 integration tests in the AI SDK resolver suite verifying cache markers land on the outbound request and cache tokens round-trip into normalized usage; 2 generator-level tests verifying static + dynamic `caching` config forwarding.
- New audit & design doc at `docs/PROMPT_CACHING.md`. User-facing prompt-caching section added to `apps/docs/docs/fundamentals/models.md`. Core package README updated.

## 2026-04-11

### DevTool: View Sequencer State (FIX-348)

- Added `SequencerStateSnapshotItem` to `@flow-state-dev/core` — a new trace-only item type that captures the full state of a sequencer at each step boundary.
- Sequencers now emit state snapshots automatically: an initial snapshot before execution begins and one after each step completes. This includes loopBack iterations.
- DevTool trace tree collects snapshots per sequencer block and displays a state indicator badge ("S") on blocks with state.
- Clicking a sequencer block in the trace view shows a new **Sequencer State** inspector panel in the detail sidebar. The panel provides a step timeline for navigating state evolution, a diff mode for comparing adjacent steps, and full JSON rendering of each snapshot.
- Nested sequencers each maintain their own snapshot timeline, navigable independently.
- Works for both live-streaming runs and completed runs loaded from trace history.

### defineCapability() — Reusable Capability Bundles (FIX-351)

- Added `defineCapability()` to `@flow-state-dev/core` — packages resources, state schemas, targets, helper functions, and presets under a single name.
- All four block kinds (`handler`, `generator`, `sequencer`, `router`) accept `uses: [capability]` to install capabilities.
- Capabilities compose transitively (`uses` on capabilities) with cycle detection and diamond deduplication.
- Presets: named opt-in/opt-out bundles of any block config surface (resources, state schemas, targets, generator context, generator tools).
- `.presets()` builder with boolean toggles and function-form overrides.
- Block-kind compatibility enforced at factory time with clear error messages.
- `ctx.cap.{name}.{fn}` provides memoized helper functions at runtime.
- 89 new tests (unit + integration + type inference).

### DevTool: `fsdev dev` command + `@flow-state-dev/devtool` package (FIX-261)

- Added `fsdev dev` command to `@flow-state-dev/cli` — starts an HTTP dev server that serves both the flow API routes and the DevTool UI from a single port.
- Auto-discovers flows from conventional directories, registers them in an in-memory `FlowRegistry`, and creates filesystem stores at `.fsdev/data/`.
- Bridges Node.js `http` to the Web API `Request`/`Response` interface used by `createFlowApiRouter`, with SSE streaming support for live execution traces.
- Options: `--port` (default 4200), `--flow-dir` (repeatable), `--model` (override all generators), `--no-open`.
- Static file server with SPA fallback handles the DevTool single-page app routing.
- Created `@flow-state-dev/devtool` package (`packages/devtool/`) that exports `getAssetPath()` to locate pre-built static assets.
- Includes `build:assets` script that builds the DevTool Vite app (`apps/devtool`) and copies the output.
- CLI lists `@flow-state-dev/devtool` as an optional peer dependency.
- Renamed `apps/devtool` package from `@flow-state-dev/devtool` to `@flow-state-dev/devtool-app` (remains private).
- Updated docs site: DevTool overview rewritten, setup guide added, CLI API reference and quick-start updated, sidebar entry added.
- Updated `CLAUDE.md`, `README.md`, `development-setup.md`, and CLI `README.md`.

## 2026-03-20

### Resource Namespaces — Dynamic + Parameterized Resources (FIX-98)

- Added `defineResourceNamespace()` to `@flow-state-dev/core` for declaring typed dynamic resource collections with glob patterns (`files/*`, `files/**`) and parameterized patterns (`[topic]/observations`).
- Added `ResourceNamespaceRef` runtime interface with `create()`, `get()`, `getOptional()`, `getOrCreate()`, `list(prefix?)`, `delete()`, and `count()` methods.
- Added pattern utilities in `namespace-patterns.ts`: `validatePattern`, `matchesPattern`, `resolveNamespaceKey`, `normalizeResourcePath`, `extractPatternParams`, `getPatternPrefix`, `isParameterizedPattern`, `isDeepWildcard`, `isSingleWildcard`.
- Added `maxInstances` cap with configurable eviction policies: `"none"` (throws), `"lru"` (least-recently-accessed), `"oldest"` (first-created).
- Added per-instance lifecycle hooks (`onInstanceCreated`, `onInstanceUpdated`, `onInstanceDeleted`) with typed `NamespaceHookContext` providing `log` and `scopeType`.
- Extended `DeclaredResources` and block-level resource declarations (`sessionResources`, `userResources`, `projectResources`) to accept namespace definitions alongside static resources.
- Added conditional type mapping in `InferResourcesFromDefinitions`: `DefinedResourceNamespace<S>` → `ResourceNamespaceRef<S>`, `DefinedResource<S>` → `ResourceRef<S>`.
- Implemented full server runtime for namespaces in `createExecutionContext.ts`: flat storage model (instances coexist with static resources), schema validation on create, eviction persistence, and hook context wiring.
- Added `resourceTools()` with 5 generic CRUD handler blocks for LLM tool surface.
- Added 51 core tests and 30 server tests covering patterns, CRUD, eviction, lifecycle hooks, and block integration.
- Updated architecture docs, site docs (resources overview, storage guide, core API), and core README.

## 2026-03-09

### CLI: `fsdev run` command with streaming NDJSON (FIX-212)

- Added `fsdev run <flowKind> <action>` command to `@flow-state-dev/cli` for executing flow actions from the terminal with real-time NDJSON streaming to stdout.
- Added `resolve-flow.ts` with `discoverFlows()` for automatic flow discovery from conventional directories (`src/flows/`, `flows/`) and `resolveFlow()` for explicit file-path loading.
- NDJSON event types: `item_added`, `content_delta`, `state_change`, `flow_complete`, `error`.
- Supports session reuse (`--session`), model override (`--model`), state seeding (`--seed-session`, `--seed-user`, `--seed-project`), and input from inline JSON or file.
- Added 3 test fixture flows (echo, stateful, throwing) and 9 integration tests.
- Added `packages/cli/README.md` with full command reference and programmatic API documentation.

## 2026-03-03

### Core utility block: contextReducer (FIX-73)

- Added `utility.contextReducer(config)` to `@flow-state-dev/core` as a generator factory with three modes: `distill`, `denoise`, and `compress`.
- Added mode-specific default output schemas with caller override support:
  - `contextReducerDistillOutputSchema` → `{ distilled, keyPoints }`
  - `contextReducerDenoiseOutputSchema` → `{ cleaned, removedCategories? }`
  - `contextReducerCompressOutputSchema` → `{ compressed, compressionRatio?, dropped? }`
- Added unit coverage for all three modes, schema override behavior, and sequencer composition.
- Updated `packages/core/README.md` exports documentation for utility block factories.

## 2026-03-01

### Sequencer container item emission groundwork (FIX-8)

- Added optional `container` metadata to the shared block config surface so sequencer/router container settings remain attached to built block definitions.
- Extended execution parent metadata with `parentInstanceId` and resolved container metadata, enabling runtime scope frames to carry parent-child block-instance relationships.
- Updated server execution/context wiring to emit `container` stream items whenever a scoped sequencer/router frame with container config is entered.
- Added server execution coverage asserting sequencer container emission with resolved component/label/metadata payload.

### Block resource declarations and automatic collection (FIX-92)

- Added `DeclaredResources` type and `declaredResources` field on `BlockDefinition` in `@flow-state-dev/core`.
- Blocks (`handler`, `generator`, `router`) now accept `sessionResources`, `userResources`, `projectResources` config properties using `defineResource()` values, surfaced as `BlockDefinition.declaredResources`.
- Added `extractDeclaredResources()` and `mergeDeclaredResources()` utilities in core block internals.
- Sequencers automatically collect `declaredResources` from all child blocks across the DSL chain (`then`, `thenIf`, `parallel`, `forEach`, `doUntil`, `doWhile`, `work`, `tap`, `tapIf`, `rescue`, `branch`), with build-time conflict detection for same-name/different-reference resources.
- `defineFlow` collects `declaredResources` from all action blocks and merges them into flow scope configs (`session`, `user`, `project`). Flow-level declarations take priority over block-declared ones.
- Added compile-time type tests for block resource declarations.
- Added 49 new unit tests covering resource extraction, merge, sequencer collection, and flow-level merge.
- Updated architecture docs, contributing reference, core README, and user-facing docs to document the feature.

## 2026-02-27

### Server runtime logging improvements

- Added structured action/block execution logging in `@flow-state-dev/server` with default console output, bounded payload summaries, retry visibility, and terminal error logs.
- Added `RuntimeLogger` hooks (`logger` option on `runAction`/`executeBlock`) plus reusable helpers (`DEFAULT_RUNTIME_LOGGER`, `summarizeForLog`, `createExecutionLogContext`).
- Added execution-focused tests for retry/failure log coverage and log summarization helpers.
- Updated execution architecture and server package docs to describe runtime log behavior and customization.

## 2026-02-15

### Planning foundation

- Added Wave 1.a execution plan at `docs/waves/wave-1/wave-1.a.md` aligned to canonical Wave A.
- Added Wave 1.b execution plan at `docs/waves/wave-1/wave-1.b.md` aligned to canonical Wave B.
- Added reusable wave template at `docs/waves/WAVE_TEMPLATE.md`.
- Added living best-practices log at `docs/BEST_PRACTICES.md`.
- Added compact architecture cheat sheet at `docs/ARCHITECTURE_CHEAT_SHEET.compact.md`.
- Added implementation repo process guidance at `README.md`.
- Established dual changelog policy: per-wave journal/changelog plus root `changelog.md` summaries.
- Standardized wave naming to Phase 1-prefixed identifiers (`Wave 1.a`, `Wave 1.b`, ...) and renamed wave files accordingly.
- Grouped all Phase 1 wave artifacts under `docs/waves/wave-1/` (for example `docs/waves/wave-1/wave-1.a-changelog.md`).

### Wave 1.a implementation

- Initialized workspace root tooling with `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, and root `tsconfig.json` references.
- Scaffolded required Phase 1 package/app targets under `packages/*` and `apps/devtool` with manifests and TypeScript configs.
- Added minimal `src/index.ts` entrypoints for all six required packages plus `apps/devtool/src/index.ts`.
- Established canonical `@flow-state-dev/core` subpath exports for `.`, `./types`, and `./items` with corresponding source modules.
- Added React compile-time smoke import proof from `@flow-state-dev/core/types` and `@flow-state-dev/core/items`.
- Added offline Wave 1.a typecheck verifier at `scripts/typecheck.mjs` due registry unavailability in this environment.
- Added Wave 1.a execution artifacts: `docs/waves/wave-1/wave-1.a-journal.md` and `docs/waves/wave-1/wave-1.a-changelog.md`.

### Wave 1.b implementation

- Implemented canonical core type contracts in `packages/core/src/types/*` for blocks, flows, state/scopes, and resources/projections.
- Implemented canonical item/content/stream event contracts in `packages/core/src/items/*` aligned to item-first streaming architecture.
- Added shared schema typing helpers in `packages/core/src/schema/*` and wired type/item exports through core entrypoints.
- Added compile-only type smoke checks at `packages/core/src/types/tests/sequencer-connectors.type-test.ts` and `packages/core/src/types/tests/flow-state-inference.type-test.ts`.
- Added `zod` dependency to `packages/core/package.json` for canonical schema typing.
- Updated React smoke import proof to consume real core type/item exports via `packages/react/src/_wave-1a-import-smoke.ts`.
- Added Wave 1.b execution artifacts: `docs/waves/wave-1/wave-1.b-journal.md` and `docs/waves/wave-1/wave-1.b-changelog.md`.
- Synced Wave 1.b stream event typings to updated canonical docs by adding request/user stream event base unions and `scope.state.changed` user-stream event types in `packages/core/src/items/events.ts`.

### Wave 1.c implementation

- Added Wave 1.c execution plan at `docs/waves/wave-1/wave-1.c.md` aligned to canonical Wave C.
- Implemented shared block runtime helper in `packages/core/src/blocks/internal/build-block.ts` with metadata wiring, schema validation, retry handling, and `connectInput`/`connectOutput` rebinding.
- Implemented canonical runtime builders in `packages/core/src/blocks/*`:
  - `handler` in `packages/core/src/blocks/handler.ts`
  - loop-capable `generator` with repair support in `packages/core/src/blocks/generator.ts`
  - sequencer runtime + DSL signatures in `packages/core/src/blocks/sequencer.ts` and `packages/core/src/blocks/sequencer-methods.ts`
  - `router` with route-candidate validation in `packages/core/src/blocks/router.ts`
- Added blocks barrel exports in `packages/core/src/blocks/index.ts` and wired runtime builder exports at `packages/core/src/index.ts`.
- Added sequencer DSL type smoke coverage at `packages/core/src/types/tests/sequencer-dsl.type-test.ts`.
- Added Wave 1.c execution artifacts: `docs/waves/wave-1/wave-1.c-journal.md` and `docs/waves/wave-1/wave-1.c-changelog.md`.

### Wave 1.d implementation

- Added Wave 1.d execution plan at `docs/waves/wave-1/wave-1.d.md` aligned to canonical Wave D.
- Implemented `defineFlow` runtime with callable `FlowType`, shallow merge-based instance overrides, and Phase 1 `requireUser=true` enforcement in `packages/core/src/flow/defineFlow.ts`.
- Added flow runtime barrel export at `packages/core/src/flow/index.ts` and wired root exports in `packages/core/src/index.ts`.
- Wired flow-level tools defaults/hooks into generator action execution by merging flow + instance tools and binding to generator blocks.
- Added Wave 1.d unit tests in `packages/core/test/flow.test.ts` and extended export smoke coverage in `packages/core/test/blocks.test.ts`.
- Added Wave 1.d execution artifacts: `docs/waves/wave-1/wave-1.d-journal.md` and `docs/waves/wave-1/wave-1.d-changelog.md`.

### Unit test infrastructure

- Added workspace Vitest baseline config at `vitest.config.ts`.
- Added `vitest` dev dependency and root `test:watch` script in `package.json`.
- Replaced placeholder `test` scripts with Vitest commands in all packages and `apps/devtool`.
- Added initial package-level unit test files under `packages/*/test/*.test.ts` and `apps/devtool/test/index.test.ts` to verify each workspace target has runnable test coverage.

## 2026-02-16

### Process updates

- Added BP-006 to `docs/BEST_PRACTICES.md`: keep wave labels out of runtime code/tests and reserve them for planning/docs artifacts.
- Added BP-007 to `docs/BEST_PRACTICES.md`: require concise file-level/API documentation for exported methods and important internal runtime helpers.
- Added BP-008 to `docs/BEST_PRACTICES.md`: keep `README.md` onboarding-first and update it whenever onboarding-relevant facts change.
- Reworked `README.md` into a developer onboarding entrypoint (project overview, objectives, key concepts, setup, package responsibilities, command references, and docs map).
- Refined `README.md` to be evaluator-friendly for new users by adding stronger value framing (`why this exists`, `why this repo may be worth your time`), clear maturity status, and a concrete `start here` onboarding path.
- Added `AGENTS.md` to hold agent collaboration protocol and moved wave execution guidance out of `README.md`.

### Wave 1.e implementation

- Added Wave 1.e execution plan at `docs/waves/wave-1/wave-1.e.md` aligned to canonical Wave E.
- Implemented server context runtime and context types in `packages/server/src/context/createExecutionContext.ts` and `packages/server/src/context/types.ts`, including require-user/session enforcement and composed scope handles.
- Implemented CAS primitives and versioned state container/state-op helpers in `packages/server/src/stores/cas.ts` and `packages/server/src/stores/state-container.ts`.
- Implemented filesystem and in-memory store adapters for `session`, `request`, `user`, and `project` scopes under `packages/server/src/stores/filesystem/*` and `packages/server/src/stores/memory/*`.
- Added server store barrel exports in `packages/server/src/stores/index.ts` and wired server root exports in `packages/server/src/index.ts`.
- Added Wave 1.e unit tests in `packages/server/test/context.test.ts`, `packages/server/test/state-container.test.ts`, and `packages/server/test/stores.test.ts`.
- Added Wave 1.e execution artifacts: `docs/waves/wave-1/wave-1.e-journal.md` and `docs/waves/wave-1/wave-1.e-changelog.md`.

### Wave 1.f implementation

- Added Wave 1.f execution plan at `docs/waves/wave-1/wave-1.f.md` aligned to canonical Wave F.
- Implemented streaming runtime modules in `packages/server/src/streaming/response-emitter.ts`, `packages/server/src/streaming/sse.ts`, `packages/server/src/streaming/encode-event.ts`, and `packages/server/src/streaming/resume.ts`.
- Added Wave 1.f middleware-readiness seam support in streaming internals via `packages/server/src/streaming/types.ts` and `packages/server/src/streaming/internal/seams.ts`, with no-op-safe interception points in emitter/encoder paths.
- Added streaming barrel exports at `packages/server/src/streaming/index.ts` and wired streaming exports through `packages/server/src/index.ts`.
- Added streaming unit tests in `packages/server/test/streaming.test.ts` (including no-op seam parity) and expanded server export smoke tests in `packages/server/test/index.test.ts`.
- Consolidated shared store pagination helper into `packages/server/src/stores/shared.ts` and reused it in memory/filesystem helper modules.
- Added Wave 1.f execution artifacts: `docs/waves/wave-1/wave-1.f-journal.md` and `docs/waves/wave-1/wave-1.f-changelog.md`.

### Wave 1.g implementation

- Added Wave 1.g execution plan at `docs/waves/wave-1/wave-1.g.md` aligned to canonical Wave G.
- Implemented error model and normalization utilities in `packages/server/src/errors/flow-error.ts` and `packages/server/src/errors/normalize-error.ts`.
- Implemented execution runtime modules in `packages/server/src/execution/*`, including retry engine, block-kind dispatch wrappers, rescue routing, work queue convergence, and request action runner lifecycle integration.
- Added internal execution seam metadata and no-op seam hooks in `packages/server/src/execution/types.ts` and `packages/server/src/execution/internal/seams.ts`.
- Added execution barrel exports in `packages/server/src/execution/index.ts` and wired server root exports in `packages/server/src/index.ts`.
- Added Wave 1.g unit tests in `packages/server/test/execution.test.ts` and expanded server export smoke checks in `packages/server/test/index.test.ts`.
- Added Wave 1.g execution artifacts: `docs/waves/wave-1/wave-1.g-journal.md` and `docs/waves/wave-1/wave-1.g-changelog.md`.

### Wave 1.h implementation

- Added Wave 1.h execution plan at `docs/waves/wave-1/wave-1.h.md` aligned to canonical Wave H.
- Implemented server flow registry in `packages/server/src/registry/flow-registry.ts`, plus registry exports in `packages/server/src/registry/index.ts`.
- Implemented canonical catch-all path parser and endpoint handlers in `packages/server/src/routes/parseFlowRoute.ts` and `packages/server/src/routes/http-handlers.ts`.
- Implemented catch-all route adapter in `packages/server/src/routes/createFlowApiRouter.ts` with internal no-op request bootstrap seam hooks for future middleware context enrichment.
- Added route exports in `packages/server/src/routes/index.ts` and wired registry/routes through `packages/server/src/index.ts`.
- Added Wave 1.h unit coverage in `packages/server/test/registry-routes.test.ts` and expanded server export smoke checks in `packages/server/test/index.test.ts`.
- Added Wave 1.h execution artifacts: `docs/waves/wave-1/wave-1.h-journal.md` and `docs/waves/wave-1/wave-1.h-changelog.md`.

## 2026-02-19

### Wave 1.i implementation

- Added Wave 1.i execution plan at `docs/waves/wave-1/wave-1.i.md` aligned to canonical Wave I.
- Implemented client transport APIs in `packages/client/src/*`, including action/session/state APIs and request/user SSE clients with resume controls.
- Implemented typed flow-bound client helpers in `packages/client/src/action-client/executeAction.ts` and package exports in `packages/client/src/index.ts`.
- Implemented React wrappers and render surfaces in `packages/react/src/*`, including `useProjections`, simplified `useSession`, context-driven renderer resolution, and `useBlockContext`.
- Aligned core/server contracts to the React direction (`renderKey`, `clientOutput`/`llmOutput`, grouped client projections, filtered session snapshot projections).
- Added Wave 1.i unit coverage in `packages/client/test/*` and `packages/react/test/*`.
- Updated client/react package scripts in `packages/client/package.json` and `packages/react/package.json` for deterministic dependency-build-aware typecheck/test execution.
- Updated `README.md` maturity section to reflect implemented client/react package surfaces.
- Added Wave 1.i execution artifacts: `docs/waves/wave-1/wave-1.i-journal.md` and `docs/waves/wave-1/wave-1.i-changelog.md`.

### Wave 1.j implementation

- Added Wave 1.j execution plan at `docs/waves/wave-1/wave-1.j.md` aligned to canonical Wave J.
- Implemented testing harness runtime in `packages/testing/src/runtime/createTestContext.ts` with seeded in-memory stores, target lookup support, and state-change capture.
- Implemented canonical testing utilities in `packages/testing/src/test-utilities/*`:
  - `testBlock`
  - `testSequencer`
  - `testRouter`
  - `testFlow`
  - `testItems`
- Implemented snapshot trace utility in `packages/testing/src/snapshot/snapshotTrace.ts`.
- Implemented scripted generator mocks in `packages/testing/src/mocks/mockGenerator.ts`.
- Expanded testing package exports in `packages/testing/src/index.ts` and added Wave 1.j test coverage in `packages/testing/test/*`.
- Added Wave 1.j execution artifacts: `docs/waves/wave-1/wave-1.j-journal.md` and `docs/waves/wave-1/wave-1.j-changelog.md`.

### Wave 1.k implementation

- Added Wave 1.k execution plan at `docs/waves/wave-1/wave-1.k.md` aligned to canonical Wave K.
- Corrected Wave 1.k implementation per authoritative correction document by deleting the legacy web example target and replacing it with canonical `examples/*` packages.
- Added `examples/hello-chat` with a minimal generator flow, session projection, React usage sample, and flow tests.
- Added `examples/kitchen-sink` with all four block kinds, session resources/projections, user projections, router-by-context, sequencer DSL coverage, React block-renderer usage, and flow/block tests.
- Updated runtime/test infrastructure to support corrected examples:
  - persisted scope resources in execution context
  - resource-backed projection compute context in session-state route
  - `fsd:block_output` emission for block execution results
  - router selection safety for sequencer routes (thenable edge)
  - nested `state` + `resources` seeding for testing harness helpers
- Added Wave 1.k execution artifacts: `docs/waves/wave-1/wave-1.k-journal.md` and `docs/waves/wave-1/wave-1.k-changelog.md`.

### Documentation updates

- Added package-level onboarding docs:
  - `packages/client/README.md`
  - `packages/react/README.md`
  - `packages/server/README.md`
  - `packages/testing/README.md`
- Added best-practice standard for package README maintenance in `docs/BEST_PRACTICES.md` (BP-009).
- Expanded `packages/react/README.md` with hook-by-hook usage documentation (`useFlow`, `useSession`, `useProjections`, `useAction`, `useRequestStream`) and context renderer guidance.
- Renamed client builders to `createClient` and `createTypedClient` in `packages/client/src/action-client/executeAction.ts` and `packages/client/src/index.ts`, and updated related client/react tests and docs.
- Kept untyped session action execution as `session.sendAction(...)` in `packages/react/src/hooks/useSession.ts` until typed session actions are introduced.
- Updated `packages/client/README.md` for snapshot query options (`include_items`, scope-grouped `projections`).
- Replaced `packages/testing/README.md` scaffold notes with concrete API documentation for Wave 1.j testing utilities.
- Updated root `README.md` documentation map to link directly to package-level READMEs.

### Block execution and generator model correction

- Refactored core block execution contract so framework behavior lives on `block.run(...)` in `packages/core/src/blocks/internal/build-block.ts`, with `config.execute` left as user-provided logic only.
- Added generator model abstraction types in `packages/core/src/types/model.ts` and wired `resolveModel` onto `BlockContext` in `packages/core/src/types/block.ts`.
- Reworked generator runtime in `packages/core/src/blocks/generator.ts` to:
  - remove hidden test-context mock hooks
  - resolve models through `ctx.resolveModel(modelId, blockName)`
  - execute model-requested tool blocks via `tool.run(...)`
  - remove legacy `generate` callback fallback so model resolution is the only generation path
- Updated core block dispatch internals to use `run()`:
  - `packages/core/src/blocks/sequencer.ts`
  - `packages/core/src/blocks/router.ts`
- Updated server runtime to call `run()` and wire model resolution:
  - execution dispatch/executors in `packages/server/src/execution/*`
  - context wiring in `packages/server/src/context/*`
  - route/action bootstrap options in `packages/server/src/routes/*` and `packages/server/src/execution/types.ts`
- Migrated testing mocks to the model boundary:
  - added `createMockModelResolver` in `packages/testing/src/mocks/mockGenerator.ts`
  - removed hidden context-property injection from `packages/testing/src/runtime/createTestContext.ts`
  - added `models` fallback mocking support in `packages/testing/src/test-utilities/types.ts`
- Updated unit tests across `packages/core/test/*`, `packages/server/test/*`, and `packages/testing/test/*` to validate the new `run()` and model-resolver behavior.
- Updated onboarding docs for changed public behavior in:
  - `README.md`
  - `packages/server/README.md`
  - `packages/testing/README.md`
- Added AI SDK adapter and tests:
  - new server utility `createAiSdkModelResolver` (`packages/server/src/models/createAiSdkModelResolver.ts`)
  - new server tests using `MockLanguageModelV3` from `ai/test` (`packages/server/test/ai-sdk-model-resolver.test.ts`)
- Fixed `testFlow` generator mocking parity with `testBlock` by adding `generators` / `models` / `unmockedGeneratorPolicy` options and forwarding them through a mock model resolver.
- Added built-in production resolver wiring:
  - new `createDefaultModelResolver` using Vercel AI Gateway (`packages/server/src/models/createDefaultModelResolver.ts`)
  - `createExecutionContext` now defaults to this resolver when `modelResolver` is omitted, so generator blocks call AI SDK without explicit app wiring.
- Expanded AI SDK resolver behavior/tests:
  - added best-effort structured-output handling from `outputSchema` (JSON response format hint + JSON text parsing fallback)
  - added adapter-call assertions for `maxTokens`, `signal`, tools, and prompt forwarding in `packages/server/test/ai-sdk-model-resolver.test.ts`.

- Updated root docs to reference `examples/hello-chat` and `examples/kitchen-sink`.

- Added token budget awareness primitives: model lookup/cost table, token counter interfaces/adapters, provider metadata pass-through, generator `block_output.modelUsage`, request token/cost rollups, and token-aware LLM history limits.
- Expanded OpenAI model lookup coverage with GPT-5 and GPT-4.1 families for token estimation and pricing resolution.
- Added Gemini 3 family model lookup entries and aligned streaming usage reporting to use `GeneratorModel.modelId` directly.
- Refined token budget runtime behavior: distinct `onExceeded: "stop"` incomplete termination, deduplicated warning emission, typed model-usage rollups, and concurrency-safe active-model resolution with added runAction budget-path tests.


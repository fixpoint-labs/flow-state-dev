# Changelog

All notable implementation-repo changes are recorded here as concise, wave-level summaries.

## 2026-05-01

### Migrate / retire queue-shaped patterns onto `taskBoard` substrate (FIX-448)

- **Removed** `drainPool` and `eventQueue` patterns. The `taskBoard` substrate gives both for free: drainPool's lease/concurrent-drain semantics are exactly what taskBoard provides (CAS-safe claim, lease/reclaim, per-task error policy); eventQueue is a sequential taskBoard with `fifoDispatcher` and mid-run enqueue. Existing call sites migrate to `taskBoard({...})` directly. The kitchen-sink's chat-agent demo action `event-queue` is rewritten as `task-queue-demo` against `taskBoard` with `getOrCreateTaskCollection({ backing: "request" })` for mid-handler enqueue. `EventQueueProgress` removed from `@flow-state-dev/react`.
- **Renamed** `blackboard` to `routedSpecialists`. The controller-pick → specialist loop now stores per-iteration records in a sequencer-backed `TaskCollection` (assignee = picked specialist, output = specialist result); the shared workspace stays as a sibling writable resource. `createBlackboard` → `createWorkspace`. `<Plan />` renders the decision sequence natively. Default controller's "previous decisions" prompt section is now read from `collection.list({ status: "completed" })` ordered by `completedAt` and FIFO-trimmed by `maxHistory`.
- **Renamed** `reactiveBlackboard` to `eventActors`. Each actor invocation becomes a `Task` in a request-backed collection (assignee = actor name, `metadata.depth` = reactive cascade depth). The `mesh()` factory is renamed `eventActors()`; `reactiveBlackboard()` factory is renamed `createEventActorsWorkspace()`. `actor()` unchanged. The reEmit cascade is implemented via in-actor `collection.addTask()` calls with depth tracking; `taskBoard` is the inner drain. Entry log stays as a sibling writable session resource. UI continues to render `container: "reactive-blackboard"` containers — the entry-log timeline component is unchanged.
- Net source LOC reduction: ~−2360 across `packages/patterns/src/` (well past the 40% spec target). Kitchen-sink, UI registry, docs, and skill files updated in the same pass.

## 2026-04-30

### `taskBoard` follow-up: dep materialization, sub-agent tool visibility, render hygiene (FIX-447)

- `TaskWorkerInput.deps` is now substrate-supplied. The worker dispatch path resolves each `task.deps[]` entry to its dep's `output` and passes the map to the worker before invocation. Workers read upstream context via `input.deps[depId]` directly — no pattern plumbing required.
- `block_tool_output` items now carry the parent generator's `agentType` and `agentName`. Sub-agent tool calls are now correctly excluded from primary-agent LLM history (the visibility contract in `resolveItemVisibility` was already in place; the framework just wasn't stamping the field).
- `planAndExecute` and `supervisor` no longer emit `task-board-meta` phase markers (`synthesizing`, `completed`-after-synth) from their synthesize step. The substrate's own `boardMetaCompleted` (during board drain) is the canonical board-level meta. Stops the renderer's status badge from flipping back to "Synthesizing…" once the synthesizer ran, and keeps `<TaskPlan />` mounted at a stable chat position.
- `<TaskPlan />` (kitchen-sink + ui registry) row expansions render a vertical timeline of windowed items — compact tool-call rows, message lines, reasoning lines, and the worker's `task.output` Markdown — instead of nesting the chat-thread `<ToolGroup>` card inside the section card. Tool-call summary extraction lifted into a shared `tool-summaries.ts` helper used by both reactive-blackboard and task-plan. Per-task ownership now keys on `item.ts` (timestamps), not `item.itemIndex`, so AI-SDK tool emissions that land after the worker's terminal `task-change` still attribute to the correct task.
- Default P&E executor and synthesizer prompts now thread source URLs through the task chain. Workers see prior-task summaries plus the URLs that actually informed each prior result; the synthesizer is instructed to cite URLs inline as Markdown links and end with a `Sources` section listing only the URLs it relied on. Distinction is explicit: pass and cite sources that were leveraged, not every URL the search returned.
- Substrate-internal task-board blocks (`claimTask`, `checkBoard`, `recordSuccess`, `recordError`, `seedCollection`, board-meta emitters) marked `transient: true` so their auto-emitted `block_output` traces are filtered from client subscriptions and history replay. Idle workers no longer flood the SSE stream with `block_output` trace records every poll tick. `claimTask` also skips its `lastClaimed` state patch when the value is unchanged. Both are point-fixes for FIX-477.
- Pattern-level status messages now describe what the agent is actually doing instead of leaving the chat at the default "Thinking…". `claimTask` emits `Working on: {task.goal}` on each successful claim. P&E, supervisor, and parallelTasks set phase statuses on their planning, evaluation, replanning, review, and synthesis blocks (e.g. `Planning the steps`, `Reviewing progress`, `Adjusting the plan`, `Putting it all together`).

## 2026-04-29

### Migrate patterns onto `taskBoard` substrate; retire legacy plan items (FIX-447)

- Renamed `coordinator` to `parallelTasks`. `coordinator()` still works as a deprecation-warned alias — same config shape, warns once per name.
- `planAndExecute` and `supervisor` now run on the `taskBoard` substrate with a request-backed `TaskCollection`. Both emit `task-change` (per-task lifecycle) and `task-board-meta` (board-level aggregate) items; pair with `<TaskPlan />` for rendering. The old `plan-meta` / `plan-task` ComponentItems are gone.
- Status vocabulary aligns with the substrate (`errored`, `cancelled` with labels). Public output shapes translate back to legacy `failed` / `skipped` for backward compat.
- `supervisor` replaces its wave-level review loop with per-task review baked into each worker chain: `worker → reviewer → applyVerdict`. On rejection, the substrate re-pends the task with feedback; `maxAttemptsPerTask` (default 3) bounds retries. `workers: Record<assignee, block>` enables per-task worker routing. `legacyWorkerAdapter` translates pre-migration `ExecutableTask` workers automatically.
- `emitPlanMeta`, `emitTaskUpdate`, and `emitPlanSnapshot` runtime helpers retired. `BasePlanSchema`, `BasePlanTaskSchema`, and related types remain exported (deprecated) for backward compatibility.

### Per-flow authentication and principal resolver (FIX-23)

- New `authentication` config on `defineFlow`: `{ resolvePrincipal?, defaultUserId?, requireUser?, requireOrg? }`. The framework owns the contract; the host owns credential verification. Per-flow declarations win over a host-level fallback.
- `createFlowApiRouter({ resolvePrincipal })` adds the host-level fallback. The default reads `body.userId` for backwards compatibility.
- `requireUser: false` is now a real option (the Phase 1 hard lock is gone). `defineFlow` rejects flows that declare user-scoped state, clientData, or resources when `requireUser: false`, naming the offending field at registration.
- New helpers in `@flow-state-dev/server`: `createHmacVerifier` (GitHub/Stripe-style webhook signatures with timestamp tolerance and constant-time comparison), `createHs256JwtVerifier`, `extractBearerToken`. RS256/ES256 are out of scope — hosts plug in their own JWKS verifier.
- Docs: new `docs/architecture/authentication.md` and `apps/docs/docs/server/authentication.md` with three integration patterns (HTTP session, webhook with HMAC, bearer token over `Authorization`). Server README gains an Authentication section.

### `<TaskPlan />` + DevTool task-collection viewer (FIX-445)

- New `TaskPlan` component in `@flow-state-dev/ui` (registry: `task-plan`). Section-grouped renderer for any TaskCollection — subscribes to `task-change` and `task-board-meta` items, latest-wins per task, sectioned by status. Per-task rows show goal, assignee, deps, error/feedback, and a retry indicator.
- Pattern wrappers can extend the status vocabulary; consumers register pattern-specific icons/colors via `statusConfig` without forking. Optional `groupByAssignee` toggle adds sub-groups per assignee within each section.
- Legacy `Plan` is unchanged; both ship side-by-side until FIX-447 migrates `planAndExecute` and `supervisor` onto the unified primitive, after which `Plan` becomes a thin alias.
- New "Tasks" tab in DevTool auto-discovers every TaskCollection in the active session and renders a developer-mode table per collection.

### `taskBoard` re-entry across an outer loop (FIX-471)

- Added `backing: "request"` to `taskBoard({ collection })` so multiple board invocations within one request share a single task collection. Unblocks "wrap a board inside a higher-level loop" patterns like the FIX-447 plan-and-execute replan loop.
- Sequencer-backed remains the default; request-backed reuses the same CAS retry path so concurrency semantics are unchanged.
- Documented in `packages/tasks/README.md` and `packages/patterns/README.md`.

### `taskBoard` capability + framework-idiom revision (FIX-446 follow-up)

- `taskBoard().capability` now returns a `DefinedCapability` with a `tasks()` accessor. Blocks across a flow opt in via `uses: [board.capability]` and address the board through `ctx.cap["taskBoard.<name>"].tasks()` instead of plumbing state-refs by hand. Multiple boards in one flow get distinct namespaces.
- Replaced the custom `task_change` item type with a `task-change` *component item* keyed by `${collectionId}/${taskId}`; clients render latest-wins per task automatically.
- Substrate exposes an optional `onChange` callback for advanced consumers that want a typed event stream without going through item emission.

### `taskBoard` pattern (FIX-446)

- New `taskBoard` pattern in `@flow-state-dev/patterns`. Concurrent drain over a `TaskCollection` with dependency gating, per-task worker routing by `task.assignee`, and CAS-safe claim semantics.
- Five standard dispatchers (`fifo`, `topological`, `priority`, `classifier`, `event`) accepted as instances or string names. Default is `topological`.
- HITL-ready: `awaiting_review` keeps the loop alive until external resume, and standard dispatchers skip those tasks. `reviewPolicy` config and `<Plan />` review affordances are follow-ons.
- Individual remix blocks exported (`createSelectNextReadyTask`, `createClaimTask`, `createRunWorker`, `createRecordResult`, `createCheckBoard`, `createSeedCollection`) so consumers can recompose when the default inner pipeline doesn't fit.

### Inbound transport adapter contract (FIX-438)

- New `InboundTransportAdapter` contract in `@flow-state-dev/server`. Every entry point into the runtime — HTTP, MCP, webhooks, scheduled actions, custom transports — implements the same factory shape that produces routes and dispatchers.
- `createFlowApiRouter` ships with a built-in `HttpTransportAdapter`. Public API is unchanged; an `adapters?: InboundTransportAdapter[]` option mounts additional transports. Path collisions throw at construction time.
- `source` is a first-class field on request records (`http` | `mcp` | `webhook` | `scheduled` | `notification`), surfaced as a badge in DevTool's request list. SQLite migration adds the column with `DEFAULT 'http'`.
- Conformance suite ships in `@flow-state-dev/testing` so future MCP/webhook/scheduled adapters plug into the same harness.

### `@flow-state-dev/tasks` substrate (FIX-444)

- New package `@flow-state-dev/tasks` ships the unified Plan/Task primitive substrate. Patterns (Plan & Execute, Task Board, Supervisor) will migrate onto it in follow-on issues.
- Canonical `Task` shape with status enum `pending | in_progress | blocked | awaiting_review | completed | errored | cancelled` and a `TaskCollectionRef` API across two backings: `sequencer` (default, durable per FIX-401) and `resource` (for collections that outlive a request).
- Five standard dispatchers, a `TaskWorkerInput` worker contract, `task_change` item emissions, and helpers (`taskLoopBack`, `dispatchAndExecute`).
- Substrate is HITL-ready (review lifecycle, `awaitReview` / `resumeFromReview`, audit-trail conventions). `<Plan />` rendering, pattern migrations, and Plan Mode reshape are follow-on waves.

## 2026-04-28

### Interrupted-request recovery: client sweep + resume

- New `POST /api/flows/users/:userId/check-interrupted` endpoint sweeps stale `active_requests` and transitions matching `in_progress` records to `interrupted`. Long-running dev servers and serverless deployments now have an on-demand reconciliation path without restarting.
- New `createRecoveryClient` in `@flow-state-dev/client` with `checkInterrupted` and `retry` methods. `useSession` exposes `latestRequest` and `resumeLatestRequest()`.
- DevTool sweeps on mount and on session-list refresh, and shows a Resume button when the latest request is interrupted. The kitchen-sink example surfaces an inline Resume notice above the prompt.

### Generator debug capture: user messages and history

- `BlockDebugPayload` adds optional `user` and `history` fields capturing the user-slot messages and resolved conversation history sent to the model.
- DevTool block detail panel renders new "User Message(s)" (open by default) and "History" (collapsed) sections with role-tagged bubbles.
- Capture still gates on `FSDEV_TRACE_OBSERVABILITY=true`.

### Durable sequencer checkpoint schema (FIX-401)

- Added `SequencerCheckpoint` type and `CheckpointStore` interface — the persistence seam Phase 2 durable execution will plug into without schema migration. Stores ship for memory, filesystem, SQLite, and Postgres.
- `durable: true` is now the sequencer default. `state_snapshot` items now carry a stable `key` per sequencer instance so consumers update in place rather than appending one row per step.
- DevTool snapshot timeline collapses to one row per sequencer instance. Resume-from-checkpoint runtime is a follow-on (FIX-141).

## 2026-04-26

### Org scope — rename + immutable session binding + `requireOrg` opt-in (FIX-428)

- Renamed `project` scope to `org` across core, server, client, react, devtool, stores, tools, patterns, skills, and thought-fabric. `ScopeType` is now `'request' | 'session' | 'user' | 'org'`. Block configs use `orgResources` / `orgStateSchema` / `orgClientData`. SQLite/Postgres tables renamed.
- Session `orgId` and `userId` are now immutable. Mismatches throw `OrgBindingMismatchError` / `UserBindingMismatchError` at context creation; closes a gap where caller-supplied IDs could silently override stored values.
- New `requireOrg: true` block flag bubbles through sequencers/routers; the HTTP action route rejects requests against unbound sessions with `400 OrgRequired`.
- No data migration; pre-1.0 dev/test data under `project-store/` should be recreated. Dynamic resource routing is deferred to FIX-435.

## 2026-04-25

### Up-front skill activation router (FIX-421)

- New `createIntentSelector()` in `@flow-state-dev/skills` — a three-tier sequencer that decides which skills apply before the main generator runs. Tiers: literal `/<skill-name>`, local keyword scan, structured-output classifier (only runs when 1–2 are inconclusive).
- New `keywords` frontmatter field on `SKILL.md` for tier-2 matching.
- `createSkillsCapability` ships `tools`, `context`, and `runSkill` presets (all on by default). Flows using up-front activation drop the tool path with `cap.presets({ runSkill: false })`.
- Chat-agent flow wiring is intentionally a follow-up — this PR ships the primitive plus the capability option so they can land independently.

## 2026-04-24

### Cross-flow schema registry + per-flow isolation (FIX-431)

- Added `isolateUserState` and `isolateProjectState` flags to `defineFlow`. Isolated flows get their user/project storage namespaced by `flowKind` and skip cross-flow schema checks.
- `FlowRegistry.register` collects every non-isolated flow's user/project schemas and throws `CrossFlowSchemaConflictError` at registration time on incompatible declarations.
- New storage-key helpers (`resolveUserStorageKey`, `resolveProjectStorageKey`) and `FlowRegistry.describeSharedSchemas()` for diagnostics.
- New guide at `docs/fundamentals/flow-isolation.md`.

### Prompt caching: audit and default-enable (FIX-423)

- New `caching` field on `generator()` config. Default `{ enabled: true, breakpoints: 'auto', ttl: '5m' }`. Provider-specific markers applied for Anthropic / OpenRouter / Vercel AI Gateway; OpenAI / Google / DeepSeek cache implicitly so we no-op.
- `GeneratorModelUsage` gains `cacheReadInputTokens` and `cacheCreationInputTokens`, normalized from provider metadata or AI SDK v6 aggregate.
- New audit doc at `docs/PROMPT_CACHING.md`. User guide updated in `apps/docs`.

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


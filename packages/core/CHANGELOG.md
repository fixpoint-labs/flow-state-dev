# @flow-state-dev/core

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-17 — Turn-aware history windowing (FIX-608)

`history: { limit: N }` on generators now counts conversational turns rather than raw LLM protocol messages, and `{ limit: { tokens: T } }` packs whole turns from the end without splitting across the budget. New explicit `{ limit: { turns: N } }` form is preferred for new code.

### 2026-05-16 — Sequencer DSL: `.throwIf()`

New `.throwIf((value, ctx) => boolean, Error | factory)` guard primitive on the sequencer DSL. Throws when the predicate is true, otherwise passes through. Pairs with `.rescue([...])` for typed early-stop patterns.

### 2026-05-16 — Idempotency primitives on handler context (FIX-402)

`BlockContext` now exposes `idempotencyKey` (stable `${requestId}:${blockPath}` string suitable for provider idempotency headers) and `runOnce(key, fn)` (memoizes a side effect per request-id and shares inflight promises across concurrent callers).

### 2026-05-14 — `useResourceCollection` invalidates on mid-stream changes

`SessionView` gains a dedicated `resourceChanges: ReadonlyArray<ResourceChangeNotice>` channel populated from `resource_change` SSE items, independent of the consumer's transient-item filter. New `ResourceChangeNotice` type exported.

### 2026-05-14 — Delta store verbs (FIX-405)

Single-field `patchState` calls now route to optional `patchField`, `incState({ field: delta })` to `incField`, and `pushState` to `pushToArray` when an adapter advertises them. Adapters that don't fall back to `set`. `createScopePersist` feature-detects per call. Hot-path cleanup: `MemoryStateContainer.read()` no longer deep-clones, and the `onStateSizeWarning` callback is removed from `ScopeStateOpsOptions`.

### 2026-05-14 — Observable model identity on emissions (FIX-518)

New `ModelIdentity` type (`{ actual, requested?, gateway? }`) exported. Every generator-emitted item (`message`, `reasoning`, `source`, `tool_output`, transient `tool_call_progress`) now carries `model: ModelIdentity`. `BlockTraceItem` for generator blocks gains a top-level `model` field, populated even on tool-only or structured-only turns. Additive — items persisted before this release surface as `model: undefined`.

### 2026-05-14 — `block.asTool()` (FIX-593)

New method on every `BlockDefinition`. Wrapping a block with `.asTool(opts?)` emits a `tool_output` envelope identical to the AI SDK tool-loop path while the block runs normally and returns its typed output unchanged. `agentType` / `agentName` opts control grouping. Failures flip the emitted `tool_output` to `failed` and rethrow.

### 2026-05-12 — Block trace honors `transient` (FIX-586)

Auto-emitted `block_trace` items now inherit `transient` from the originating block. Restores the FIX-478 contract that FIX-573's `block_output → block_trace` unification regressed by hardcoding `transient: false`.

### 2026-05-12 — DevTool: surface context on block failures (FIX-582)

`block_trace.error` and `tool_output.error` gain an optional `details: Record<string, unknown>` field. Generator output-validation failures now throw `OutputValidationError` carrying `{ rawOutput, issues, phase }`. `FlowError` relocated to `@flow-state-dev/core` so handler authors in third-party packages can throw it without a server dependency.

### 2026-05-11 — `makeSchemaStrict` public; BP-016 (FIX-561)

`makeSchemaStrict(schema)` is now re-exported from the package root. It unwraps `optional` / `default` / `nullable` but does NOT transform `z.record()` or non-literal `z.union()` — those still fail OpenAI strict mode and must be rewritten at source. BP-016 codifies the rules.

### 2026-05-11 — Client projection shortcuts: `expose`, `exclude` (FIX-580)

`defineResource` and `defineResourceCollection` now accept `client.expose` (whitelist) and `client.exclude` (blacklist) alongside `client.data`. Field names are type-checked against the state schema. The three projection forms are mutually exclusive; omit all three to ship the full state.

### 2026-05-07 — `useClientData` reflects mid-stream state changes (FIX-576)

`ctx.session.patchState`, `ctx.user.patchState`, `ctx.org.patchState`, and `ctx.request.patchState` (and their `setState` / `incState` / `pushState` / `setStateRecord` / `deleteStateRecord` / `atomicState` siblings) now emit `state_change` SSE items with the matching `scope` value. Previously only sequencer/target-state writes emitted on the wire.

### 2026-05-07 — Container lifecycle: in-flight signal (FIX-574)

`container` items now emit with `status: "in_progress"` when a sequencer or router scope opens, patch to `completed` (or `failed`) via `item.updated` when it closes, then emit the terminal `item.done`. New optional fields: `startedAt`, `completedAt`, `duration`, and `error: { message }` on failure.

### 2026-05-07 — Block trace unification (FIX-573) [BREAKING]

A single `block_trace` item per block run replaces the old `block_output` / `block_debug` split. `block_tool_output` renamed to `tool_output`. Hooks `onBlockDebugCapture` and `onConnectedInput` collapsed into a single `onBlockTraceCapture(payload, ctx)` keyed by phase. Migration: rename `block_output` → `block_trace` and `block_tool_output` → `tool_output` at consumer dispatch sites.

### 2026-05-07 — Lazy collection state, query interface, resource manifest (FIX-427) [BREAKING]

Collection snapshots dropped the eager `items` map; entries now carry `count` and an opt-in `prefetched` window. Per-item `clientData` in the window requires the new `client.state.read` permission. `defineResourceCollection` gains `prefetchWindow?: number` (lexicographic key sort, not recency).

### 2026-05-07 — `item.updated` SSE event (FIX-572)

New `item.updated` event carrying `{ itemId, patch }` with shallow top-level merge semantics. Identity-invariant keys (`id`, `type`, `provenance`, `agentType`, `transient`) are stripped server-side. New `emitItemUpdated(itemId, patch)` on `ResponseEmitter`.

### 2026-05-07 — Lift `.work()` background tasks to a request-level pool (FIX-554) [BREAKING]

Background tasks are queued on a single per-request pool. Inner sequencers no longer auto-await; the request executor drains the pool exactly once before terminal status. `.waitForWork()` now drains by sequencer-instance scope. Migration: code that relied on inner-sequencer auto-await for ordering needs an explicit `.waitForWork()` at the inner sequencer boundary.

### 2026-05-06 — `clientData` privacy fix + rename (FIX-505) [BREAKING]

Default snapshot response no longer includes raw scope state — `response.state` is gone. New per-scope `client: { expose: string[], derived: { name: fn } }` shape on `session`, `user`, and `org`. Legacy `clientData: { name: fn }` keeps working with a one-time deprecation warning per scope per process.

### 2026-05-06 — Trace channel separation, `step_error` removed (FIX-506) [BREAKING]

Public `OutputItem` union shrinks from 15 to 10 entries — the four trace types (`block_output`, `router_decision`, `state_snapshot`, `block_debug`) leave the union and become observability-only. Public `BlockValue<T>` is now `inline | structure`; the `ref` case moves to `@flow-state-dev/core/items/internal`. `step_error` removed entirely.

### 2026-05-06 — `mapModelOutput`

New `BlockDefinition.mapModelOutput((output, ctx) => string)` method declares a separate, model-visible representation of a tool block's output. The structured `TOutput` keeps flowing through items, devtool, tests, and history replay; the mapper fires only at the AI SDK bridge boundary. Inert when the block is used as a regular sequencer step. Expected to be deterministic — replay re-runs it on the persisted structured output.

### 2026-05-06 — Generator: log unparseable candidates

When a generator's output schema rejects the model's response and repair gives up, the candidate string is now logged to stderr (truncated at 2000 chars) alongside the validation error.

### 2026-05-02 — Memory pipeline + naming reliability fixes

`sanitizeToolName` is now exported from `@flow-state-dev/core/utils/tool-name` (and the `@flow-state-dev/core/utils` barrel). `BlockToolOutputItem.toolCall` gains an optional `alias` field so tool-call replay reads the model-facing sanitized name from item metadata rather than re-sanitizing the framework name at replay time. `workIf` predicate signature changed to `(value, ctx)` like `thenIf` and `tapIf`.

### 2026-05-02 — Resource content moved out of scope records (FIX-347)

`SessionRecord`, `UserRecord`, and `OrgRecord` no longer carry a `resourceContent` field. Content lives exclusively in `ContentStore`, keyed by `(scopeType, scopeId, resourceKey)`. Concurrent writes to different resources no longer contend on the scope-record CAS path.

### 2026-05-01 — Per-scope FIFO mutation queue (FIX-492)

In-memory state scopes now serialize mutations through a per-`StateContainer` FIFO queue. `ConcurrentModificationError` is no longer thrown for these scopes. New `flow.request.mutationTimeoutMs` (default 30s) bounds worst-case waits; `ScopeMutationTimeoutError` is thrown on exceedance.

### 2026-04-30 — `emit*` default-transient decouple (FIX-478)

`ctx.emitMessage()` and `ctx.emitComponent()` no longer inherit the producing block's `transient` flag — both default to `transient: false` regardless. `ctx.emitStatus()` continues to default to `transient: true`. All three emitters now accept a per-call `{ transient?: boolean }` override.

### 2026-04-30 — SSE noise reduction (FIX-477)

Framework-level no-op guard in `applyMutation`: when the proposed next state deep-equals current, the persist call is skipped, no `state_change` SSE item is emitted, and the helper returns `false`. New `transientSlot()` helper marks top-level fields on a sequencer's `stateSchema` as in-memory only. Breaking (internal): `runWithCAS` now returns `{ state, committed }`; `applyMutation` and the seven `ScopeStateOps` helpers return `Promise<boolean>`.

### 2026-04-30 — `content.delta` non-replayable (FIX-479)

`content.delta` events are no longer persisted to the events log and no longer await `flushEvents`. Running text is checkpointed via an items snapshot instead; new `ResponseEmitterItemHooks.onItemUpdate` hook fires on each delta. Resume contract change: mid-stream reconnects snap to the latest persisted snapshot rather than replaying the exact token sequence.

### 2026-04-30 — Connection resilience (FIX-476)

`RequestStatus` and `RequestStatusSnapshot` now live in `@flow-state-dev/core/types`.

### 2026-04-29 — Per-flow authentication (FIX-23)

New `authentication` config on `defineFlow`: `{ resolvePrincipal?, defaultUserId?, requireUser?, requireOrg? }`. `requireUser: false` is now a real option; flows that declare user-scoped state, clientData, or resources under `requireUser: false` are rejected at registration with the offending field named.

### 2026-04-28 — Durable sequencer checkpoint schema (FIX-401)

New `SequencerCheckpoint` type and `CheckpointStore` interface. `durable: true` is now the sequencer default. `state_snapshot` items now carry a stable `key` per sequencer instance.

### 2026-04-26 — Org scope rename + immutable session binding (FIX-428) [BREAKING]

`project` scope renamed to `org` across the framework. `ScopeType` is now `'request' | 'session' | 'user' | 'org'`. Block configs use `orgResources` / `orgStateSchema` / `orgClientData`. Session `orgId` and `userId` are now immutable; mismatches throw `OrgBindingMismatchError` / `UserBindingMismatchError`. New `requireOrg: true` block flag.

### 2026-04-24 — Cross-flow schema registry + per-flow isolation (FIX-431)

Added `isolateUserState` and `isolateProjectState` flags to `defineFlow`. Isolated flows get their user/org storage namespaced by `flowKind` and skip cross-flow schema checks. `FlowRegistry.register` throws `CrossFlowSchemaConflictError` on incompatible declarations. New storage-key helpers (`resolveUserStorageKey`, `resolveProjectStorageKey`).

### 2026-04-24 — Prompt caching audit and default-enable (FIX-423)

New `caching` field on `generator()` config, defaulting to `{ enabled: true, breakpoints: 'auto', ttl: '5m' }`. Provider-specific markers applied for Anthropic / OpenRouter / Vercel AI Gateway; OpenAI / Google / DeepSeek cache implicitly. `GeneratorModelUsage` gains `cacheReadInputTokens` and `cacheCreationInputTokens`.

### 2026-04-11 — DevTool: View Sequencer State (FIX-348)

New `SequencerStateSnapshotItem` trace item captures the full state of a sequencer at each step boundary. Sequencers now auto-emit an initial snapshot before execution begins and one after each step completes (including `loopBack` iterations).

### 2026-04-11 — `defineCapability()` (FIX-351)

New `defineCapability()` packages resources, state schemas, targets, helper functions, and presets under a single name. All four block kinds accept `uses: [capability]`. Capabilities compose transitively with cycle detection and diamond dedup. `.presets()` builder ships with boolean toggles and function-form overrides. `ctx.cap.{name}.{fn}` provides memoized helpers.

### 2026-03-20 — Resource Namespaces (FIX-98)

New `defineResourceNamespace()` for typed dynamic resource collections with glob patterns (`files/*`, `files/**`) and parameterized patterns (`[topic]/observations`). `ResourceNamespaceRef` runtime interface with `create`, `get`, `getOrCreate`, `list`, `delete`, `count`. `maxInstances` cap with `none` / `lru` / `oldest` eviction. Per-instance lifecycle hooks. Block-level `sessionResources` / `userResources` / `projectResources` slots accept namespace definitions alongside static resources.

### 2026-03-03 — `contextReducer` utility block (FIX-73)

New `utility.contextReducer(config)` generator factory with three modes: `distill`, `denoise`, `compress`. Mode-specific default output schemas exported with caller override support.

### 2026-03-01 — Sequencer container item emission (FIX-8)

Optional `container` metadata on the shared block config surface so sequencer/router container settings remain attached to built block definitions. Parent metadata extended with `parentInstanceId` and resolved container metadata.

### 2026-03-01 — Block resource declarations (FIX-92)

New `DeclaredResources` type and `declaredResources` field on `BlockDefinition`. Handler, generator, and router blocks accept `sessionResources`, `userResources`, `projectResources`. Sequencers collect declared resources from all child blocks (with build-time conflict detection on same-name/different-reference); `defineFlow` merges them into flow scope configs.

### 2026-02-15 — Monorepo init / package scaffolding

Initial scaffolding for `@flow-state-dev/core`: type contracts (blocks, flows, state/scopes, resources, items, events), shared schema helpers, the four block kinds (`handler`, `generator`, `sequencer`, `router`), `defineFlow`, sequencer DSL, and model-resolver wiring. Token-budget primitives, prompt-caching surface, and model-lookup tables for OpenAI / Gemini / Anthropic families.

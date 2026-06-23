# @flow-state-dev/engine

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-17 — Turn-aware history windowing (FIX-608)

Conversation history packing for generators now operates on turn boundaries — the server-side message-window helper packs whole turns from the end and never splits across token budgets.

### 2026-05-16 — Idempotency primitives on handler context (FIX-402)

`RequestStore` gains `getRunOnceResult` / `setRunOnceResult` to back the new `ctx.runOnce(key, fn)` primitive. Memory and filesystem adapters carry the table. Scope is request-local on purpose; crash-recovery dispatches that mint a new `requestId` start with an empty namespace.

### 2026-05-14 — Delta store verbs (FIX-405)

The in-memory adapter ships the optional `patchField` / `incField` / `pushToArray` verbs. `createScopePersist` feature-detects per call and falls back to `set` when an adapter doesn't advertise the verb. State-and-scopes architecture doc documents the routing decision tree.

### 2026-05-12 — Bash tool: MOAT sandbox adapter (FIX-584)

`createBashCapability` now returns a `cleanupBlock` alongside the capability — wire it into `defineFlow({ request: { onFinished: bashCap.cleanupBlock } })` to release sandboxes at request end. Required for MOAT to avoid orphaning containers; effectively a no-op for the other providers.

### 2026-05-12 — Block trace honors `transient` (FIX-586)

The auto-emit path now reads the originating block's `transient` flag and stamps it on the emitted `block_trace` item. Transient blocks stream their trace lifecycle live to active SSE consumers but rows no longer enter the persisted items log or replay on history reload.

### 2026-05-12 — DevTool: surface context on block failures (FIX-582)

Generator output-validation failures now throw `OutputValidationError` carrying `{ rawOutput, issues, phase }` so the raw model text and Zod issues survive to the trace instead of collapsing to a single message string. Author-thrown `FlowError.details` flows through to `block_trace.error.details` verbatim.

### 2026-05-11 — DevTool full resource visibility (FIX-579)

New privileged debug read surface under `/api/flows/sessions/:id/debug/resources*`. Returns the full server-side resource layer with per-entry `clientView`. Fail-closed — off by default, opt in via `debugEndpointsEnabled: true` on `createFlowApiRouter` or `FSDEV_DEBUG_ENDPOINTS=1`. Loopback-origin gate by default. **Breaking (internal):** the undocumented `include_internal_resources` / `include=internal_state` params on `/state` are removed.

### 2026-05-11 — Session-state schema defaults pre-applied (FIX-561)

`handleCreateSession` now parses an empty `body.state` (or any caller override) through `flow.session.stateSchema` before persisting, so a brand-new session's `state` already contains every declared key with its initial value. Caller-supplied `body.state` still wins; on schema-parse failure the handler falls back to the raw caller state.

### 2026-05-11 — Resource API: multi-segment topics (FIX-561)

`GET /sessions/:id/resources/:ref/:topic` (and `:topic/content`, `PATCH`, `DELETE`) now match topics that contain `/`. The route table uses `*topic` (path-to-regexp v8 wildcard); `stringifyParams` joins the captured array on `/` before the route builder runs. A topic literally named `"content"` remains shadowed by the resource-content route.

### 2026-05-10 — Scheduled actions: declarative cron (FIX-440)

New `schedules?` config block on `defineFlow` accepting a typed `static` map and a dynamic `resolve(scheduleId, ctx)` hook. Cron strings validated at registration for static entries and at dispatch for dynamic ones. New `createBearerSecretPrincipalResolver` exported for the canonical shared-scheduler-secret pattern, with constant-time `timingSafeEqual`. `RequestRecord.source = "scheduled"` plus structured `metadata` (`scheduleId`, `origin`, `cron`, `nominalFireTime`, `dispatchedAt`, `timezone`).

### 2026-05-07 — `useClientData` mid-stream state changes (FIX-576)

Scope-level `patchState` / `setState` / `incState` / `pushState` / `setStateRecord` / `deleteStateRecord` / `atomicState` now emit `state_change` SSE items with the matching `scope` value, where previously only sequencer / target-state writes emitted on the wire.

### 2026-05-07 — Container lifecycle: in-flight signal (FIX-574)

Server now emits `container` items with `status: "in_progress"` when a sequencer or router scope opens, then patches via `item.updated` when it closes. First public-channel item type to use the `item.updated` primitive.

### 2026-05-07 — Block trace unification (FIX-573) [BREAKING]

Server emits a single `block_trace` item per block run, replacing the old `block_output` / `block_debug` split. Block traces stream live: an in-progress trace appears when the block starts, with input, prompt, and output filled in via `item.updated` events. `block_tool_output` renamed to `tool_output`.

### 2026-05-07 — Action POST disconnect no longer kills runAction

The HTTP request signal is no longer propagated into `runAction` via `actionInput.signal`. A tab refresh or browser-side cancel of the originating POST no longer aborts the in-flight execution. Refresh midstream now resumes against the still-running request.

### 2026-05-07 — Store-driven live tail (FIX-569)

The in-process active-streams registry is replaced by `RequestStore.subscribeToEvents`. SSE clients can now tail an in-flight request from any instance. `getEvents` widens with optional `fromSequence` for cursor reads. Conformance harness `createRequestStoreConformanceTests` shipped via `@flow-state-dev/engine/testing`. Long-running flows are no longer at risk of registry eviction; the legacy 5-minute TTL is gone.

### 2026-05-07 — Lazy collection state, query interface, resource manifest (FIX-427) [BREAKING]

New paginated list endpoint (`GET /sessions/:id/resources/:ref?limit=&offset=&topicPrefix=`) and single-item state endpoint. Pagination returns `{ offset, limit, total, hasMore, nextOffset }`. New manifest endpoint (`GET /sessions/:id/manifest`) describes every public resource on a flow.

### 2026-05-07 — `item.updated` SSE event (FIX-572)

New `item.updated` event with `{ itemId, patch }` shallow-merge semantics. New `emitItemUpdated(itemId, patch)` on `ResponseEmitter`. Updates for an unknown `itemId` are dropped with a debug event; updates after `item.done` apply normally.

### 2026-05-07 — Filesystem trace store + dev defaults (FIX-558)

New `FilesystemTraceStore` and `createFilesystemTraceStore`. Registry factories now pick `traceStore.maxRequests` from environment — 1000 when `NODE_ENV=development`, 50 otherwise; explicit config wins. New `createTraceStoreConformanceTests` helper exposed at `@flow-state-dev/engine/testing`. Trace events now survive `fsdev dev` and kitchen-sink `STORE_TYPE=filesystem` restarts.

### 2026-05-07 — Lift `.work()` background tasks (FIX-554) [BREAKING]

The request executor now drains a single per-request background-task pool exactly once before terminal status. Inner sequencers no longer auto-await their own list. The SSE stream stays open until the drain completes; `backgroundTasks: N` status emissions reflect the request-level pool count.

### 2026-05-06 — `clientData` privacy fix + rename (FIX-505) [BREAKING]

The default session snapshot route no longer ships `response.state`. DevTool escape hatch: `?include=internal_state` re-attaches raw state under `internalState`. `FlowClient.state.getSessionState/getUserState/getOrgState` removed.

### 2026-05-06 — Trace channel separation, `step_error` removed (FIX-506) [BREAKING]

New `traces: TraceStore` on `StoreRegistry` with in-memory (default 50 requests, 5 MB/request) and SQLite implementations. Trace items ride the same SSE wire but are server-filtered by default; subscribe with `?include=trace`. The `?unfiltered=true` query param is renamed and gone. `emitWorkStepError` removed.

### 2026-05-06 — `mapModelOutput`

The AI SDK v6 bridge now passes `toModelOutput` from a tool block's `mapModelOutput` so providers materialise next-turn tool-result content from the mapper's string. Devtool inspection emits a transient `block_debug` carrying the mapper output, gated by `FSDEV_TRACE_OBSERVABILITY`.

### 2026-05-02 — MCP server adapter (FIX-22)

`createFlowApiRouter` now accepts `adapters: [createMcpTransportAdapter()]`. Every flow with `mcp.enabled: true` becomes its own MCP server at `POST /api/flows/:kind/mcp`. Authentication runs through the existing `host.resolvePrincipal` hook; `PrincipalResolutionError` maps to HTTP 401 + JSON-RPC `-32001` with `WWW-Authenticate: Bearer realm="MCP"`.

### 2026-05-02 — Memory pipeline + naming reliability fixes

Server-side `itemToLLMMessages` now reads `bto.toolCall.alias ?? sanitizeToolName(bto.toolCall.name)` so historical tool-call/tool-result replay carries the same model-facing name the model produced on the original turn.

### 2026-05-02 — Resource content moved out of scope records (FIX-347)

Execution context, state routes, and resource routes read and write content through `stores.content` directly. The legacy on-record content path and its merge logic are gone. Filesystem adapter writes each resource as a real file under `data/content/<scope>/<id>/<key>`. Operators upgrading from a build that persisted inline content must copy each record's old `resourceContent` map into `ContentStore` before deploying.

### 2026-05-01 — Per-scope FIFO mutation queue (FIX-492)

Server-side in-memory state container now serializes mutations through a per-`StateContainer` FIFO queue. External-store scopes (filesystem, sqlite, postgres) keep optimistic CAS. New `flow.request.mutationTimeoutMs` (default 30s) bounds worst-case waits.

### 2026-04-30 — `emit*` default-transient decouple (FIX-478)

`ctx.emitMessage()` / `emitComponent()` defaults changed at the emitter layer — neither now inherits the producing block's `transient` flag. Documents the **keyed snapshot** pattern (component item with stable `key`, latest-wins per `${requestId}:${key}`).

### 2026-04-30 — SSE noise reduction (FIX-477)

`applyMutation` now no-ops when the proposed next state deep-equals current — no persist, no `state_change` SSE emission, helper returns `false`. New `transientSlot()` helper for sequencer state fields that should never appear on the wire or in checkpoints.

### 2026-04-30 — `content.delta` non-replayable (FIX-479)

`content.delta` events no longer persist to the events log and no longer await the `flushEvents` durability barrier. Per-token disk round-trips no longer serialize concurrent worker streams. Live SSE consumers, devtool observers, and the in-memory event buffer continue to receive every delta.

### 2026-04-30 — Connection resilience (FIX-476)

Server emits `: ping\n\n` SSE comment frames on every live and GET-attach response (default 15s). Heartbeat injection moved out of `@flow-state-dev/vercel` so every deployment gets it. New server-internal sweeper marks `in_progress` requests whose executor heartbeat stopped as `interrupted`. New read-only `GET /api/flows/:flowKind/requests/:requestId/status` endpoint.

### 2026-04-29 — Per-flow authentication (FIX-23)

`createFlowApiRouter({ resolvePrincipal })` adds the host-level fallback. New helpers: `createHmacVerifier` (webhook signatures with timestamp tolerance and constant-time comparison), `createHs256JwtVerifier`, `extractBearerToken`. `requireUser: false` and `requireOrg: true` are enforced at the action route.

### 2026-04-29 — Inbound transport adapter contract (FIX-438)

New `InboundTransportAdapter` contract. Every entry point — HTTP, MCP, webhooks, scheduled actions, custom transports — implements the same factory shape. `createFlowApiRouter` ships with a built-in `HttpTransportAdapter`; new `adapters?: InboundTransportAdapter[]` option mounts additional transports with path-collision detection. `source` is a first-class field on `RequestRecord`.

### 2026-04-28 — Interrupted-request recovery

New `POST /api/flows/users/:userId/check-interrupted` endpoint sweeps stale `active_requests` and transitions matching `in_progress` records to `interrupted`. Long-running dev servers and serverless deployments now have an on-demand reconciliation path.

### 2026-04-28 — Generator debug capture: user messages

`BlockDebugPayload` adds optional `user` and `history` fields capturing the user-slot messages and resolved conversation history sent to the model. Gated by `FSDEV_TRACE_OBSERVABILITY=true`.

### 2026-04-28 — Durable sequencer checkpoint schema (FIX-401)

`CheckpointStore` implementations for memory, filesystem, SQLite, and Postgres. Resume-from-checkpoint runtime is a follow-on.

### 2026-04-26 — Org scope rename (FIX-428) [BREAKING]

Server-side rename of `project` → `org` in stores, routes, and request handling. Action route rejects requests against unbound sessions with `400 OrgRequired` when a downstream block declares `requireOrg: true`.

### 2026-04-24 — Cross-flow schema registry + per-flow isolation (FIX-431)

`FlowRegistry.register` collects every non-isolated flow's user/project schemas and throws `CrossFlowSchemaConflictError` at registration time on incompatible declarations. New `FlowRegistry.describeSharedSchemas()` for diagnostics.

### 2026-04-11 — DevTool: View Sequencer State (FIX-348)

Sequencer state-snapshot trace items emitted at each step boundary on the server side, captured into the trace store for both live and replay.

### 2026-04-11 — `defineCapability()` (FIX-351)

Server-side runtime wiring for capability installation, transitive composition, and `ctx.cap.{name}.{fn}` memoized helper resolution.

### 2026-03-20 — Resource Namespaces (FIX-98)

Full server runtime for namespaces in `createExecutionContext`: flat storage model (instances coexist with static resources), schema validation on create, eviction persistence, and hook context wiring.

### 2026-03-01 — Sequencer container item emission (FIX-8)

Server execution/context wiring emits `container` stream items whenever a scoped sequencer/router frame with container config is entered.

### 2026-03-01 — Block resource declarations (FIX-92)

Server wiring for the declared-resources pipeline: flow scope configs honor block-collected `sessionResources` / `userResources` / `projectResources`.

### 2026-02-27 — Server runtime logging improvements

Added structured action/block execution logging with default console output, bounded payload summaries, retry visibility, and terminal error logs. New `RuntimeLogger` hooks (`logger` option on `runAction` / `executeBlock`) plus reusable helpers (`DEFAULT_RUNTIME_LOGGER`, `summarizeForLog`, `createExecutionLogContext`).

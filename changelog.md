# Changelog

All notable implementation-repo changes are recorded here as concise, wave-level summaries.

## 2026-05-06

### Trace channel separation, public type cleanup, `step_error` removal (FIX-506)

The public `OutputItem` union shrinks from 15 to 10 entries. The four trace types (`block_output`, `router_decision`, `state_snapshot`, `block_debug`) leave the union and are now observability-only — they ride the same SSE wire as production items but are server-filtered by default. Subscribe with `?include=trace` to receive them. The query parameter previously named `?unfiltered=true` is renamed; the old name is gone.

- Public `BlockValue<T>` is now `inline | structure`. The `ref` case and the `refBlockValue` helper move to `@flow-state-dev/core/items/internal`. The four trace type names (`BlockOutputItem`, `RouterDecisionItem`, `StateSnapshotItem`, `BlockDebugItem`) stay exported from `@flow-state-dev/core/items` so first-party imports keep compiling.
- New `traces: TraceStore` on `StoreRegistry` with in-memory (default 50 requests, 5 MB/request) and SQLite implementations. Retention is independent of `RequestRecord` GC, so the DevTool can replay traces from a completed request after its record is gone.
- New `ctx.emit.{message, component, status, trace.*}` namespace. The flat `ctx.emitMessage`, `ctx.emitComponent`, `ctx.emitStatus` continue to work as deprecated aliases that emit a once-per-process console warning on first use. Aliases are removed at next major.
- **Retracts the user-facing portion of commit `8e0bd62b`** ("emit `step_error` for background work failures and render as warning"). `step_error` is removed entirely — the type definition, named export, `emitWorkStepError`, every renderer dispatch, and doc references are gone. Failed `.work()` blocks now surface only via the trace-channel `block_output` and the existing `console.error`. Migration: any code switching on `item.type === "step_error"` should be removed; that case is unreachable.

### Framework: `mapModelOutput` — model-visible representation separate from structured tool output

Adds a new `BlockDefinition.mapModelOutput((output, ctx) => string)` method that lets a tool block declare a separate, model-visible representation of its output. The structured `TOutput` keeps flowing through the framework — `block_tool_output` items, downstream sequencer steps, devtool, tests, and history replay all see the original value. The mapper fires only at the AI SDK bridge boundary, producing the string the LLM observes on its next turn.

- New method on every block kind. Both `TInputSchema` and `TOutputSchema` are preserved — unlike `connectOutput`, `mapModelOutput` does not reshape downstream consumers. When the block is used as a regular sequencer step (not via `tools: [...]`), the mapper is silently inert.
- Plumbed through the AI SDK v6 bridge as `toModelOutput` so providers materialise next-turn tool-result content from the mapper's string instead of the structured envelope.
- Recall tool migrated as the validating consumer: structured `RecallToolResult` keeps flowing through devtool/replay, and the LLM sees a compact bulleted summary built by the new exported `formatRecallSummary` helper. Token cost on a 5-result return drops well below half the previous JSON envelope.
- Devtool inspection: when a tool block declares `mapModelOutput`, the wrapper emits a `block_debug` item carrying the mapper's string. Devtool can render it side-by-side with the structured `block_tool_output`, so you can see what the LLM saw alongside what the block produced. Gated by `FSDEV_TRACE_OBSERVABILITY`; transient, never persisted, never sent to LLM context.
- Mapper is expected to be deterministic: history replay re-runs it on the persisted structured output rather than persisting the string itself.

### Generator: log unparseable candidates + raise consolidation repair attempts

When a generator's output schema rejects the model's response and repair gives up, the framework now logs the actual candidate to stderr alongside the validation error. Previously the only signal was `Generator output validation failed: Expected object, received string` — which tells you the schema saw a string but not *what* string. Operators had to re-run with a debugger or page through the request's block_debug item to see what the model returned.

- New stderr log lines on terminal failure:
  ```
  [generator:generate] "tf.memory/consolidate/generate" output failed schema validation: Expected object, received string
  [generator:generate] candidate (string): Sorry, I cannot consolidate these episodes…
  ```
- Candidate dump is truncated at 2000 chars; full payload is still recoverable from the request's block_debug.
- Same dump fires from both the non-streaming (`generate`) and streaming (`stream`) terminal paths.

Also raises `tf.memory/consolidate/generate`'s repair attempts from the default 1 to 3. Small models occasionally drop out of structured-output mode and return narrative text; with one auto-repair attempt the framework gave up too quickly and surfaced a `step_error` for what was usually transient flakiness. Three attempts let it recover before the background task fails.

## 2026-05-05

### Recall tool: per-source pre-rank — semantic facts always reach the filter

Fixes a structural starvation in the `llm-filter` strategy's prepare gate: when episodic memory was large and recent (200+ episodes at significance 0.9+), the unified intrinsic pre-rank pool filled with episodes and only the most-reinforced semantic facts squeezed in. A real-world repro on devuser showed 47 episodic + 3 semantic in a 50-candidate pool — every wife-related semantic fact was dropped before the LLM filter ran, and the agent answered "Jennifer" by reading episodic chat history while the semantic record about Moni never appeared.

- **Per-source pooling.** `prepareBlock` no longer pools both stores under one cap. Semantic facts pass through unconditionally (the semantic store is bounded by `pruneThreshold` upstream). Episodes are intrinsically pre-ranked and capped at the new `PRE_RANK_EPISODIC_CAP` (default 30).
- **Stage 1.5 exact-phrase pass-through** still runs but only over episodes that didn't make the cap. Semantic facts are all already in.
- **`PRE_RANK_CAP` is deprecated.** Kept exported as the previous value (50) for back-compat with custom strategies that imported it for parity. The strategy itself no longer references it. Will be removed in a future major.
- **Migration:** transparent for `tool: { strategy: 'llm-filter' }` consumers — the change is purely in the candidate pool composition. Custom strategies that used `PRE_RANK_CAP` should switch to `PRE_RANK_EPISODIC_CAP`.

### Recall tool: `RetrievalStrategy` becomes block-factory shaped

Reshapes the public `RetrievalStrategy` contract that custom recall backends implement. Strategies used to expose a single `rank(query, ctx, opts)` method called from inside the recall tool's `execute`. They now expose framework blocks the tool composes as a sequencer (`prepare → optional filter → format`), so no handler in the pipeline reaches into `asRuntime()` to invoke a generator (BP-011).

- **Removed public types**: `RankedResult`, `RetrievalStrategyContext`, `RetrievalStrategyOptions`, and the `rank()` method on `RetrievalStrategy`. Anyone with a custom `RetrievalStrategy` will need to migrate.
- **New public types**: `PrepareInput`, `PrepareEnvelope`. `PrepareInput` is what reaches the strategy's `prepareBlock` (the recall tool defaults/clamps `limit`, stamps `strategyName` and `perItemCharCap`). `PrepareEnvelope` is the carrier threaded between `prepare`, the optional filter+merge, and `format`.
- **`RetrievalStrategy` shape**: `{ name, prepareBlock, filterBlock?, formatBlock? }`. `prepareBlock` is required and produces the envelope; `filterBlock` is the optional LLM filter step (omit it for vector/keyword backends and the tool surfaces the intrinsic top-N directly); `formatBlock` is an optional override on the tool's default formatter.
- **New exports** from `@thought-fabric/core/memory`: `defaultFormatBlock`, `buildResult`, `buildResultMetadata`, `capContent`, `TRUNCATION_MARKER`. Custom strategies that override `formatBlock` can reuse the helpers without re-implementing per-item char capping, hallucination dropping, or score normalisation.
- **Built-in strategy unchanged at the consumer level**: `tool: { strategy: 'llm-filter' }` keeps working; the `llm-filter` strategy now ships `prepareBlock` (intrinsic pre-rank + exact-phrase pass-through) plus `filterBlock` (single bounded LLM call). Token spend per call remains bounded regardless of total store size.
- **Migration**: see `apps/docs/thought-fabric/memory.md` for the new strategy shape and an example.

### Memory capability: orthogonal section presets + configurable formatter (FIX-513 pivot)

Pivots away from the role-named `agent` / `worker` memory capability presets. The original FIX-513 design bundled "context formatter + recall tool" under role labels, which conflated two unrelated axes: which memory tier gets re-injected into the prompt, and whether the agent has a search tool. Authors who wanted only working memory but no digest, or recent episodes alongside the digest, couldn't express that without giving up the formatter entirely.

- **Five orthogonal section presets** replace `agent` / `worker`: `digest`, `working`, `semantic`, `episodic`, `recall`. Default-on set is `['digest', 'working', 'recall']`. Each preset toggles independently with `.presets({...})`. `mem.capability` (no args) keeps the same effective behaviour as the old `agent` preset, so the migration nudge is contained: every consumer of `presets({ agent: …, worker: … })` updates to one of `presets({ digest: …, working: …, recall: …, semantic: …, episodic: … })`.
- **Inclusion is independent of processing.** The capture pipeline still runs `tf.memory/digest/regenerate`, consolidation, and prune for whichever tiers are configured on `memorySystem({...})`. Disabling the `digest` preset on a worker generator just suppresses the section in *that* prompt — the underlying digest stays fresh for any other generator that opts in.
- **Configurable formatter factory.** New export `createMemoryContextFormatter(options?)` from `@thought-fabric/core/memory`. Options: `{ digest?, working?, semantic?: { topN } | bool, episodic?: { limit } | bool }`. The boolean presets use fixed defaults (top-10 facts, last-5 episodes); reach for the factory directly when those defaults aren't right.
- **Pre-FIX-407 sections are back, opt-in.** The simplification that removed semantic-fact and episodic-memory injection from the formatter is partially reversed — they're now selectable sections rather than always-on or always-off. The recall tool path remains the canonical way to fetch *specific* details on demand.
- **Migration:** kitchen-sink's `workerUses` updated from `presets({ agent: false, worker: true })` to `presets({ digest: false, working: false })`. `MemoryCapabilityPreset` type changes from `'agent' | 'worker'` to `'digest' | 'working' | 'semantic' | 'episodic' | 'recall'`. `mem.contextFormatter` direct callers see no change — it remains an alias for `createMemoryContextFormatter()` with default options. Docs at `apps/docs/thought-fabric/memory.md` updated.

### Recall tool: per-source pre-rank gate, semantic facts pass through

Splits the unified pre-rank pool inside the `llm-filter` strategy's `prepareBlock` into two independent gates. Failure mode driving the change: high-significance recent episodes were crowding moderately-reinforced semantic facts out of the unified top-50 pool, leaving the LLM filter with no facts to score against on queries where a fact would have been the right answer.

- **Semantic facts pass through unconditionally.** The semantic store is already bounded by `pruneThreshold`, so the worst case is well within the filter's token budget. No score-based admission, no cap.
- **Episodes are scored intrinsically and capped at `PRE_RANK_EPISODIC_CAP = 30`** (replaces the old unified 50-item cap shared with facts). Stage 1.5 exact-phrase pass-through still runs over episodes the cap dropped; semantic facts skip the pass-through because they're all already admitted.
- New export from `@thought-fabric/core/memory`: `PRE_RANK_EPISODIC_CAP`. Custom strategies that previously imported `PRE_RANK_CAP` for parity should switch to this.
- `PRE_RANK_CAP` is now `@deprecated` but still exported. Internally unused; kept so prior consumers keep compiling. Removed in a future major.
- Visible to consumers: the candidate set the filter sees is different — facts are no longer crowded out, and episodes that would have made the top-50 mixed pool but not the top-30 episodic pool now fall through to the exact-phrase tier rather than the filter.

### Memory pipeline + tool naming reliability fixes

Behavior fixes shipped after the memory + tool-naming work above landed:

- **Memory `contextFormatter` returns an object, not a pre-formatted string.** Returning `<digest>…</digest>\n<working>…</working>` as a single string caused the framework's context aggregator to XML-escape the inner tags as text — the model saw `&lt;working&gt;`. The formatter now returns `{ digest?, working? }`, which the aggregator nests as proper child tags under `<memory>`. Public type on `MemorySystem.contextFormatter` is updated; consumers reading the value directly need to handle the object shape (no behavior change for the standard `context: { memory: mem.contextFormatter }` wiring).
- **Digest regenerates every turn the source signature drifts.** Previously `digestRegenerate` was wired only inside the consolidation and prune `generate-and-persist` chains, both gated by guards that need ≥4 turns and ≥5 episodic writes. Until those gates triggered the digest never refreshed regardless of how much state had changed. Capture now appends `digestRegenerate` as a top-level `.work()` step when `digest` is configured; the block's own staleness guard keeps the cost cheap when nothing has drifted.
- **OpenAI tool-name pattern compliance, end to end.** Framework-namespaced tool blocks like `tf.memory/recall` are aliased to `^[a-zA-Z0-9_-]+$` form before submission to providers that enforce it (notably OpenAI). The alias is now applied in three places: the outbound `tools` dictionary, the auto-described tool listing inside the system prompt, and the `toolName` field on historical tool-call / tool-result messages replayed from session items. Inbound stream chunks and result `toolCalls` are translated back to original framework names so observability stays consistent. `sanitizeToolName` is now exported from `@flow-state-dev/core/utils/tool-name` (and re-exported via the `@flow-state-dev/core/utils` barrel).
- **Tool-call replay reads alias from item metadata, not from the framework name.** Replacing the message-time `sanitizeToolNamesInMessages` band-aid: `BlockToolOutputItem.toolCall` now carries an optional `alias` field (the model-facing sanitised name), populated at emit time inside the generator's `compileToolsWithExecute`. The server's `itemToLLMMessages` reads `bto.toolCall.alias ?? sanitizeToolName(bto.toolCall.name)`, so the toolName the model sees on replay is the same string it produced on the original turn. Items written before this field existed continue to work via the fallback. The `sanitizeToolNamesInMessages` pass is retained as defence-in-depth; it's now a no-op for items emitted on or after this change.
- **Recall tool prompt wording is more directive.** `recallToolDescription` now explicitly tells the model to use the tool for personal/user-specific details that aren't in the visible context summary. The exported constant remains a string; only the wording changed.
- **`workIf` predicate sees the running value.** The condition now takes `(value, ctx)` like `thenIf` and `tapIf` instead of `(ctx)` only. Lets authors gate background dispatch on the upstream output (e.g. skip perspective capture when the assistant produced empty text).
- **Failed background work surfaces as `step_error`.** Rejected `.work()` / `.workIf()` tasks emit a client-visible `step_error` item alongside the existing failed `block_output`, so renderers can show a non-fatal warning instead of treating the failure as a request error. The `ErrorDisplay` renderer now distinguishes by item type — `error` (red, terminal) vs `step_error` (yellow, non-fatal) — rather than by `recovered`.
- **Perspective capture tolerates empty content.** The bundled `${name}/capture` sequencer accepts empty content at its outer schema and short-circuits via `thenIf` so a `.work()` slot receiving an empty assistant response is a no-op instead of a background-work failure. The inner `analyze` block keeps its strict non-empty contract.
- **Kitchen-sink memory now opts into the digest tier.** `memorySystem({...})` was missing `digest: true`; without it the `<memory>` section had nothing to render once working memory was in use. Also fixed `dev:watch` so edits to `thought-fabric-core`, `tools`, `patterns`, and `ui` trigger a Next.js restart — previously those packages' rebuilds didn't propagate without a manual `pnpm dev` restart.

### Memory: simplified `contextFormatter` — digest + working memory only (FIX-407)

- `mem.contextFormatter` now emits a single `<memory>` block containing only the rolling digest (when configured) and current working-memory entries. Output is naturally bounded by the digest's `maxTokens` and the working-memory capacity — no separate budget knob.
- Behavior change: semantic facts and recent episodes are no longer pre-injected into the prompt. Agents retrieve them on demand via the recall tool (FIX-409).
- Returns `undefined` when both the digest and working memory are empty so the generator omits the section entirely.
- No `maxTokens`, `topN`, `strategy`, or `estimateTokens` knobs on the formatter API. Per-generator load behavior moves to the `agent` / `worker` presets in FIX-513.

### Memory: rolling digest tier (FIX-408)

- New `digest` tier in `@thought-fabric/core`'s memory system. A single LLM-generated narrative paragraph that summarises stable knowledge about the user, sitting above atomic semantic facts as the always-on framing layer.
- Regenerates as a side effect of `consolidate` and `prune`. A source-state signature short-circuits the LLM call when nothing has changed; previous digest is fed back into the prompt so framing stays stable across regenerations.
- `memory.system({ digest: true | { maxTokens, topN } })` opts in; default `maxTokens` is 400. Digest scope is inherited from `semantic`.
- `mem.regenerateDigest` exposes a manual escape hatch that bypasses the staleness guard — useful after bulk-loading memory in setup or in tests.
- New `digestMemoryCapability` exposes `get` / `content` for blocks that read the digest. The composed `mem.capability` installs the digest resource alongside the other tiers.

### Resource content moves out of scope records (FIX-347)

- `SessionRecord`, `UserRecord`, and `OrgRecord` no longer carry a `resourceContent` field. Content lives exclusively in `ContentStore`, keyed by `(scopeType, scopeId, resourceKey)`. Concurrent writes to different resources no longer contend on the scope-record CAS path.
- Execution context, state routes, and resource routes all read and write content through `stores.content` directly. The legacy on-record content path and its merge logic are gone.
- Filesystem adapter writes each resource as a real file under `data/content/<scope>/<id>/<key>`. SQLite and Postgres adapters use a dedicated `resource_content` table.
- Operators upgrading from a build that persisted inline content must copy each record's old `resourceContent` map into `ContentStore` before deploying — see the migration note in `packages/server/README.md`.

### Memory: agent-invocable `recall` tool (FIX-409)

- New `mem.tool.recall()` factory on `memory.system()` returns a handler block agents can install on a generator with `tools: [mem.tool.recall()]`. Searches stored memory — semantic facts and past episodes — on demand. Working memory is intentionally excluded; it already lives in the formatter, so surfacing it through the tool would duplicate context cost.
- One unified tool, not three. The agent's mental model is "find a thing I knew" — whether the thing is a fact or an episode is an implementation detail surfaced as a `source` field on each result rather than a routing decision the LLM has to make.
- Pluggable `RetrievalStrategy` interface. V1 ships `'llm-filter'`: query-blind intrinsic pre-rank (top 50 by `confidence × reinforcement` for facts, `significance × exp(-age/50)` for episodes) followed by a single LLM filter call over the bounded candidate set. Token spend per call is bounded regardless of total store size. Optional Stage 1.5 exact-phrase pass-through catches distinctive strings (proper nouns, error codes) buried in low-score memories.
- Result envelope includes `query`, `strategy`, `totalMatched`, `truncatedTo` so the agent can detect "more available" and re-query. Per-item char cap (default 400) with a truncation marker prevents runaway result sizes.
- Configure via `memory.system({ tool: { strategy, model, defaults } })`. Custom strategies implement the same interface; the keyword (FIX-410) and hybrid (FIX-412) backends will plug in without changing the tool surface. The memory capability gains a `tool` preset (off by default in this release; FIX-513 introduces `agent`/`worker` presets that bundle it).

## 2026-05-02 (later)

### MCP server adapter — every flow is reachable from MCP clients (FIX-22)

- New `@flow-state-dev/mcp` package. Mounts as a sibling of the built-in HTTP adapter via `createFlowApiRouter({ adapters: [createMcpTransportAdapter()] })`. Every flow with `mcp.enabled: true` becomes its own MCP server at `POST /api/flows/:kind/mcp`; `GET` and `DELETE` return 405.
- Per-flow `mcp` config and per-action `description` and `mcp.enabled` on `defineFlow`. Tool names derive deterministically from action keys via `decamelize` (`recordPayment` → `record_payment`); collisions and missing descriptions throw at flow registration.
- Authentication runs through the existing `host.resolvePrincipal` hook — bearer tokens, HMAC, or anything else a flow's `authentication.resolvePrincipal` returns. `PrincipalResolutionError` maps to HTTP 401 + JSON-RPC `-32001` with `WWW-Authenticate: Bearer realm="MCP"`.
- v1 ships stateless-only with single-text-content tool results — no `Mcp-Session-Id`, no `notifications/progress`, no `outputSchema`/`structuredContent`. `resources/list` returns the empty list pending a flow-bound resource scope.
- DevTool already renders MCP-originated requests with a purple `MCP` badge from FIX-438; no devtool change needed.

## 2026-05-02

### Quick-start rewrite + new model-setup and first-flow pages (FIX-496)

- `apps/docs/docs/getting-started/quick-start.md` rewritten to introduce ≤6 concepts before the chat works: block, generator, sequencer (mentioned), flow, `useSession`, default item rendering. Removed: counter handler with `return input` (BP-014 violation), `agentType` ceremony, `clientData`, `requireUser: true` boilerplate, the `chatFlow({ id: "default" })` factory ceremony, and the per-item `<ItemRenderer>` map. The example now uses the framework's default `<ItemsRenderer items={...} />` plural renderer and `defineFlow({...})()` to register without a separate factory step.
- New page `apps/docs/docs/getting-started/setting-up-models.md`. Covers env-var-based provider detection (Anthropic, OpenAI, Google, Vercel Gateway, OpenRouter), what `preset/small` resolves to, how to override or define presets, direct `provider/model` strings, and plugging in custom provider instances. Linked from the new quick-start callout so a senior engineer can go from `pnpm install` to a streaming chat in under ten minutes.
- New page `apps/docs/docs/getting-started/your-first-flow.md`. A narrative walkthrough that builds the same chat in five steps, introducing one block, scopes, a `.tap()` state-mutation pattern (BP-012-compliant), sequencer composition, and the React rendering layer. Targets the reader who wants to understand the primitives, not just to copy a recipe.
- `apps/docs/sidebars.ts` Getting Started category reordered to surface the new pages: quick-start → setting-up-models → your-first-flow → installation → project-structure. Sidebar reorg beyond Getting Started is out of scope (FIX-495).

## 2026-05-01

### Per-scope FIFO mutation queue replaces optimistic CAS for in-memory scopes (FIX-492)

- In-memory state scopes (target state, sequencer state — anything without a `persist` callback) now serialize mutations through a per-`StateContainer` FIFO queue. `ConcurrentModificationError` is no longer thrown for these scopes; supervisor patterns with `concurrency > 1` complete reliably under sustained contention instead of intermittently failing once the CAS retry budget exhausts.
- External-store scopes (filesystem, sqlite, postgres adapters) keep the optimistic CAS path. Their `persist` callbacks signal version mismatch when a remote authority advances state; CAS retries with exponential backoff still apply, and `ConcurrentModificationError` continues to surface when retries exhaust.
- New `flow.request.mutationTimeoutMs` (default 30s) bounds the worst-case wait for any in-memory mutation. When a mutator's queue wait + execution exceeds the budget, `ScopeMutationTimeoutError` is thrown instead of hanging the request indefinitely. Set to `Infinity` to disable.
- Supervisor's reviewer chain audit-state moved off the task collection's request scope onto the supervisor sequencer's outer state (`reviewMetadata[taskId]`). The task collection now sees only the irreducible `claim` / `complete` / `fail` writes from `taskBoard`, eliminating the contention surface that drove the original failure.
- No public API change to `atomicState`, `patchState`, `pushState`, `incState`, `setStateRecord`, `deleteStateRecord`. Behavior under `concurrency: 1` is unchanged.

### Tier 1 flow integration test suite (FIX-487)

- New `@flow-state-dev/integration-tests` workspace package (private). Seven scenarios drive whole flows through `runAction` against in-memory stores with mocked generators: hello-chat smoke, ask-mode happy path, tool-loop convergence, build-mode artifact, plan-and-execute, session resume, and the supervisor + task-board regression. Suite finishes in a few seconds; loop guards plus a 30s vitest `testTimeout` catch infinite-loop regressions deterministically.
- `mockGenerator` accepts `{ when, then }` predicate entries alongside plain steps. Predicates match by input and stay matchable on every call; plain steps still consume sequentially. Lets concurrent patterns (supervisor workers, parallel plan-and-execute steps) be mocked without depending on call order.
- `mockGenerator` now simulates the AI SDK's internal multi-step tool loop. When a returned step has `toolCalls` but no terminal `text`/`structuredOutput`, the mock model invokes each tool's `execute` closure and pulls the next script step until a terminal step or `maxSteps` is hit.
- `testFlow` accepts an optional `stores: StoreRegistry`. Multiple runs sharing the same registry preserve session, journal, and resource state across calls. Seeding is idempotent — already-seeded users/sessions/orgs aren't re-`set`.
- New `apps/docs/docs/testing/flow-integration-tests.md` page positions the new tier between `testBlock` and `fsdev run`. Linked from the Testing sidebar.

### Make `fsdev run` the primary CLI dev loop for agents (FIX-490)

- `fsdev run` now emits `[flow-state] *` runtime events to stderr by default at `info` level — action lifecycle, block lifecycle, retries, errors. Previously these were silently dropped because the command never passed a logger to `runAction`. New `--quiet` suppresses them; new `--log-level <debug|info|warn|error>` sets the threshold. The CLI always passes an explicit logger so the server's `console.*`-backed default never writes runtime traces to stdout and corrupt the NDJSON stream.
- New `--capture <path>` writes the full structured run output to a JSON file (`{ command, events, result }`) — additive with stdout NDJSON, parent directories created as needed.
- `AGENTS.md` gains a "Verifying flow changes during development" section that frames `fsdev run` as the default verification tool and shows the kind-of-change → tool routing (CLI for flow logic, vitest for units, browser for UI). `CLAUDE.md` adds a one-line orientation pointer; `apps/kitchen-sink/CLAUDE.md` adds a "Testing this app" section. New `apps/docs/docs/cli/agent-dev-loop.md` page covers the same loop for human readers, linked from `cli/overview.md`.
- Mock-fallback claim in `AGENTS.md` audited and rewritten. `createModelResolver` has no mock fallback — without a configured provider, generator blocks fail with `No provider available for "<provider>"`. The doc now describes the actual behavior and points provider-free smoke tests at vitest.
- `@flow-state-dev/testing` no longer re-exports `createInboundTransportConformanceTests` and `createMockTransportHost` from its index. Conformance helpers import `vitest` at module top level, which made any non-test consumer (notably the CLI) fail to load. They're available via the new `@flow-state-dev/testing/conformance` subpath export.

### Migrate / retire queue-shaped patterns onto `taskBoard` substrate (FIX-448)

- **Removed** `drainPool` and `eventQueue` patterns. The `taskBoard` substrate gives both for free: drainPool's lease/concurrent-drain semantics are exactly what taskBoard provides (CAS-safe claim, lease/reclaim, per-task error policy); eventQueue is a sequential taskBoard with `fifoDispatcher` and mid-run enqueue. Existing call sites migrate to `taskBoard({...})` directly. The kitchen-sink's chat-agent demo action `event-queue` is rewritten as `task-queue-demo` against `taskBoard` with `getOrCreateTaskCollection({ backing: "request" })` for mid-handler enqueue. `EventQueueProgress` removed from `@flow-state-dev/react`.
- **Renamed** `blackboard` to `routedSpecialists`. The controller-pick → specialist loop now stores per-iteration records in a sequencer-backed `TaskCollection` (assignee = picked specialist, output = specialist result); the shared workspace stays as a sibling writable resource. `createBlackboard` → `createWorkspace`. `<Plan />` renders the decision sequence natively. Default controller's "previous decisions" prompt section is now read from `collection.list({ status: "completed" })` ordered by `completedAt` and FIFO-trimmed by `maxHistory`.
- **Renamed** `reactiveBlackboard` to `eventActors`. Each actor invocation becomes a `Task` in a request-backed collection (assignee = actor name, `metadata.depth` = reactive cascade depth). The `mesh()` factory is renamed `eventActors()`; `reactiveBlackboard()` factory is renamed `createEventActorsWorkspace()`. `actor()` unchanged. The reEmit cascade is implemented via in-actor `collection.addTask()` calls with depth tracking; `taskBoard` is the inner drain. Entry log stays as a sibling writable session resource. UI continues to render `container: "reactive-blackboard"` containers — the entry-log timeline component is unchanged.
- Net source LOC reduction: ~−2360 across `packages/patterns/src/` (well past the 40% spec target). Kitchen-sink, UI registry, docs, and skill files updated in the same pass.

## 2026-04-30

### Decouple `emit*` default-transient from `blockTransient`; document the keyed-snapshot pattern (FIX-478)

- `ctx.emitMessage()` and `ctx.emitComponent()` no longer inherit the producing block's `transient` flag. Both default to `transient: false` (persisted) regardless of whether the calling block is transient. The block flag retains its single intended meaning: suppress the framework's auto-emitted `block_output` bookkeeping for that block.
- `ctx.emitStatus()` continues to default to `transient: true` (statuses are naturally ephemeral). All three emitters now accept a per-call `{ transient?: boolean }` override for symmetry.
- Reverts the FIX-447 surgical workarounds (the explicit `transient: false` overrides in `getOrCreateTaskCollection`'s `onChange` and in the `boardMetaActive` / `boardMetaCompleted` blocks) — the architectural fix at the framework layer makes them redundant.
- Documents the **keyed snapshot** pattern (component item with a stable `key`, latest-wins per `${requestId}:${key}`) and the four-cell `transient × key` matrix in `apps/docs/docs/streaming/emitting-items.md`. Cross-links from `OutputItemBase.transient`, `ComponentItem.key`, and the `BlockContext` emit JSDocs. No new APIs — the pattern was already supported, just unnamed.
- Behavior change: third-party blocks declared `transient: true` that previously relied on `emitMessage` / `emitComponent` calls being auto-suppressed will now persist those items. Migration is one keyword: pass `{ transient: true }` explicitly on the emit call.

### Reduce SSE stream noise: no-op `patchState` guard + transient state slots (FIX-477)

- Framework-level no-op guard in `applyMutation`. Every state-write helper (`patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`) now compares the proposed next state against the current state. When deep-equal, the persist call is skipped, no `state_change` SSE item is emitted, and the helper returns `false` instead of `true`. Idempotent writes are now free.
- New `transientSlot()` helper in `@flow-state-dev/core` marks top-level fields on a sequencer's `stateSchema` as in-memory only. Transient slots stay readable across the sequencer's run via `ctx.sequencer.state` but never appear on the SSE stream, never write to the durable checkpoint store, and reset to schema defaults on resume.
- `taskBoard` worker schemas mark `lastClaimed` and `currentTaskId` as `transientSlot`. The narrow `lastClaimed` identity-check guard FIX-447 added to `claim-task.ts` is reverted — the framework guard subsumes it.
- **Breaking (internal):** `runWithCAS` now returns `{ state, committed }` instead of bare `Readonly<TState>`. `applyMutation` and the seven `ScopeStateOps` helpers now return `Promise<boolean>`. Existing call sites that ignore the return value are source-compatible; direct shape assertions on `runWithCAS` need updating.

### Streaming-text throughput: `content.delta` reclassified as non-replayable (FIX-479)

- `content.delta` events (covers both message and reasoning streaming — they share the same wire type) are no longer persisted to the events log and no longer await the `flushEvents` durability barrier. Per-token disk round-trips were serializing concurrent worker streams behind a single per-request events queue; under a supervisor with `concurrency: 3` and three streaming workers the queue saturated and the request appeared to lock up.
- Running text is checkpointed via the items snapshot instead. The emitter mutates the in-flight `MessageItem.content[i].text` (and `ReasoningItem.summary[i].text`) in-place on each delta and fires a new `ResponseEmitterItemHooks.onItemUpdate` hook. `runAction` wires this hook to a coalesced `persistItems` write — the `FilesystemRequestStore`'s `itemWriteQueued` sentinel keeps disk I/O bounded by the natural write rate regardless of token rate.
- Resume contract change. Mid-stream reconnects via `Last-Event-ID` no longer replay the exact token sequence — the running text snaps to the latest persisted snapshot and continues from the next live delta, with the eventual `item.done` payload superseding. Page-load bootstrap now shows the latest accumulated text for in-flight messages instead of empty content, which is strictly better than before. Completed messages still replay exactly.
- Live SSE consumers, devtool observers, and the in-memory event buffer continue to receive every `content.delta` event unchanged. Filesystem and Postgres stores benefit transparently — the change is at the emitter, not the store.

### Sub-agent items as first-class data for parent agents (FIX-480)

- `TaskCollectionRef.list` / `get` now return a `TaskHandle` — the existing `Task` data fields plus an `items()` accessor that returns the items emitted during the worker's claim window. Pattern aggregators (synthesizer prompt builders, reviewer input builders, replanners) can now pick from a worker's natural emissions — `message`, `source`, `tool_call`, `reasoning` — instead of relying solely on `task.output`. Sync, throw-free, returns `[]` until the task is claimed.
- Streaming-text generators (`outputSchema: z.string()`, `agentType` set) now emit their `block_output` as `BlockValue { kind: "ref", sourceItemId }` pointing at the just-emitted `MessageItem`, rather than inlining a duplicate copy of the same text. `resolveBlockValue` resolves the ref transparently to the joined `output_text` content. Object-output generators are unchanged. The streaming path's defensive equality check (returned string == accumulated stream) prevents the ref emission when post-validation transforms (`z.string().transform(...)`) mutate the value.
- `BlockOutputLookup` renamed to `ItemLookup`; the old name stays as a non-breaking alias. `buildItemLookup(items)` indexes every item by id (not just `block_output`s) so refs may resolve to messages.
- Substrate utility `extractTaskItems(items, collectionId, taskId)` and `computeTaskItemWindows(items, collectionId)` exported from `@flow-state-dev/tasks`. Same algorithm the kitchen-sink renderer uses for per-task expansion in `<TaskPlan />`; available server-side for any pattern that wants to inspect a worker's window without touching the renderer.
- Supervisor's `buildResults` handler now also returns a `resultItems` field — `Array<{ taskId, goal, items }>` — alongside `results`. The default synthesizer's user prompt appends a deduped `Sources:` block when worker `source` items are present. Custom synthesizers ignoring the new field continue working unchanged.

### `taskBoard` follow-up: dep materialization, sub-agent tool visibility, render hygiene (FIX-447)

- `TaskWorkerInput.deps` is now substrate-supplied. The worker dispatch path resolves each `task.deps[]` entry to its dep's `output` and passes the map to the worker before invocation. Workers read upstream context via `input.deps[depId]` directly — no pattern plumbing required.
- `block_tool_output` items now carry the parent generator's `agentType` and `agentName`. Sub-agent tool calls are now correctly excluded from primary-agent LLM history (the visibility contract in `resolveItemVisibility` was already in place; the framework just wasn't stamping the field).
- `planAndExecute` and `supervisor` no longer emit `task-board-meta` phase markers (`synthesizing`, `completed`-after-synth) from their synthesize step. The substrate's own `boardMetaCompleted` (during board drain) is the canonical board-level meta. Stops the renderer's status badge from flipping back to "Synthesizing…" once the synthesizer ran, and keeps `<TaskPlan />` mounted at a stable chat position.
- `<TaskPlan />` (kitchen-sink + ui registry) row expansions render a vertical timeline of windowed items — compact tool-call rows, message lines, reasoning lines, and the worker's `task.output` Markdown — instead of nesting the chat-thread `<ToolGroup>` card inside the section card. Tool-call summary extraction lifted into a shared `tool-summaries.ts` helper used by both reactive-blackboard and task-plan. Per-task ownership now keys on `item.ts` (timestamps), not `item.itemIndex`, so AI-SDK tool emissions that land after the worker's terminal `task-change` still attribute to the correct task.
- Default P&E executor and synthesizer prompts now thread source URLs through the task chain. Workers see prior-task summaries plus the URLs that actually informed each prior result; the synthesizer is instructed to cite URLs inline as Markdown links and end with a `Sources` section listing only the URLs it relied on. Distinction is explicit: pass and cite sources that were leveraged, not every URL the search returned.
- Substrate-internal task-board blocks (`claimTask`, `checkBoard`, `recordSuccess`, `recordError`, `seedCollection`, board-meta emitters) marked `transient: true` so their auto-emitted `block_output` traces are filtered from client subscriptions and history replay. Idle workers no longer flood the SSE stream with `block_output` trace records every poll tick. `claimTask` also skips its `lastClaimed` state patch when the value is unchanged. Both are point-fixes for FIX-477.
- Pattern-level status messages now describe what the agent is actually doing instead of leaving the chat at the default "Thinking…". `claimTask` emits `Working on: {task.goal}` on each successful claim. P&E, supervisor, and parallelTasks set phase statuses on their planning, evaluation, replanning, review, and synthesis blocks (e.g. `Planning the steps`, `Reviewing progress`, `Adjusting the plan`, `Putting it all together`).

### Connection resilience (FIX-476)

- Server emits `: ping\n\n` SSE comment frames on every live and GET-attach response (default 15 s). Heartbeat injection moved out of `@flow-state-dev/vercel` into `@flow-state-dev/server` so every deployment — including non-Vercel and POST inline streams — gets it.
- New server-internal sweeper marks `in_progress` requests whose executor heartbeat stopped as `interrupted`, releasing session locks. On by default in `createFlowApiRouter` (30 s cadence, 60 s threshold); set `staleSweepIntervalMs: 0` to disable.
- New read-only `GET /api/flows/:flowKind/requests/:requestId/status` endpoint returns a `RequestStatusSnapshot`. Callable when no SSE is connected; used by the client dismiss path to confirm authoritative server state.
- `useSession` now exposes `isStuck` (watchdog-tripped flag) and `dismissRequest(requestId?)` (works without a live SSE handle). `sendAction` auto-dismisses a stuck prior request before opening the new stream, with a synthetic abort item making the prior attempt visible.
- Client SSE parser detects comment frames and fires a new `onHeartbeat` callback alongside regular events.
- `RequestStatus` and `RequestStatusSnapshot` now live in `@flow-state-dev/core/types`. `@flow-state-dev/server` re-exports `RequestStatus` for backward compatibility.
- Vercel adapter no longer injects heartbeats itself — the core handles it. `VercelHandlerOptions.heartbeatMs` is now a deprecated no-op; configure via `createFlowApiRouter({ defaultSseHeartbeatMs })` or per-flow `defineFlow({ request: { sseHeartbeatMs } })` instead.
- Docs: new `apps/docs/docs/server/connection-resilience.md` (linked from the Server sidebar); sections added to `packages/server/README.md`, `packages/react/README.md`, `apps/docs/docs/streaming/overview.md`; deprecation note in `packages/vercel/README.md`.

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


# @flow-state-dev/core

**The building blocks. Define handlers, generators, sequencers, routers, and flows — all with end-to-end type safety.**

This is the foundation package. Every other package depends on it. It's isomorphic — runs in Node, the browser, edge runtimes, anywhere JavaScript runs.

## Installation

```bash
pnpm add @flow-state-dev/core
```

## What you can build

```ts
import { defineFlow, generator, handler, sequencer, router } from "@flow-state-dev/core";
import { z } from "zod";
```

**A generator that calls an LLM with tools, history, and streaming:**

```ts
const agent = generator({
  name: "agent",
  model: "intent/chat",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  history: true,
  user: (input) => input.message,
  tools: [readDoc, writeDoc],
  itemVisibility: { client: true, history: true },
});
```

The `prompt` (and `user`) slots can also be authored in a separate `.md` file with YAML frontmatter and a LiquidJS body. Load it with `loadPromptFile(...)` and spread `definePromptFile(pf)` into the generator config. See the [Prompts as Markdown](https://flow-state.dev/docs/advanced/generator-prompts-markdown) reference.

**A handler that validates and transforms:**

```ts
const counter = handler({
  name: "counter",
  sessionStateSchema: z.object({ count: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ count: 1 });
    return input;
  },
});
```

**A sequencer that composes them into a pipeline with error recovery:**

```ts
const pipeline = sequencer({ name: "chat-pipeline", inputSchema })
  .step(analyzeInput)
  .stepIf((result) => result.needsContext, enrichWithContext)
  .step(agent)
  .step(counter)
  .rescue([{ when: [ModelError], block: fallback }]);
```

`.rescue()` is also a method on any block. `someBlock.rescue([{ block: fallback }])` returns a block that recovers from its own failure and returns the handler's output instead of throwing — so a single step (or one `forEach` element, `parallel` branch, or `router` route) can fail in isolation while the rest of the chain continues. The chain-level `.rescue()` above is the same operation applied to the whole sequencer.

A later step can check whether an earlier one was recovered with `ctx.wasRescued(blockName | blockDef)` — without the recovered value carrying any marker.

Sequencers can optionally declare an `outputSchema` as a runtime contract on the composed output of the whole chain — validated on every exit path (tail, `exitIf`, `rescue`). Call `.validate()` at build time to catch structural drift early.

```ts
const summarize = sequencer({
  name: "summarize",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ summary: z.string(), wordCount: z.number() }),
}).step(summarizeBlock);

summarize.validate(); // throws if the tail shape drifts from the declared schema
```

**A router that dispatches to different pipelines at runtime:**

```ts
const dispatch = router({
  name: "mode-router",
  routes: [chatPipeline, planPipeline, reviewPipeline],
  execute: (input, ctx) => {
    const mode = ctx.session.state.mode;
    if (mode === "plan") return planPipeline;
    if (mode === "review") return reviewPipeline;
    return chatPipeline;
  },
});
```

**A flow that ties it all together:**

```ts
export default defineFlow({
  kind: "my-app",
  requireUser: true,
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: dispatch,
      userMessage: (input) => input.message,
    },
  },
  resources: {
    artifacts: defineResource({
      scope: "session",
      stateSchema: artifactSchema,
      writable: true,
    }),
  },
  session: {
    stateSchema: z.object({ mode: z.string().default("chat"), count: z.number().default(0) }),
    client: {
      derived: {
        artifactsList: (ctx) => /* derive list from resource state */,
      },
    },
  },
})({ id: "default" });
```

## Exports

### Main (`@flow-state-dev/core`)

**Block builders:**
- `handler(config)` — Synchronous/async logic block
- `generator(config)` — LLM call with framework-managed tool loop, streaming, and structured output repair (deterministic `jsonrepair` then LLM coercion that reshapes off-schema output to the schema; on by default, configured via `repair.coerce` / `repair.coerce.model`, defaulting to `intent/utility`)
  - Provider-native web search: set `search: true` (or a `GeneratorSearchConfig`). This is the model provider's built-in search, distinct from the `@flow-state-dev/tools` `tools.search` tool — the tools `tier` knob does not apply, and the generator's `searchDepth` (`"low" | "medium" | "high"`, OpenAI `searchContextSize`) is a different field from the tools `searchDepth` (`"basic" | "advanced"`). See [Web search](https://flow-state.dev/docs/fundamentals/blocks#web-search).
  - Human-in-the-loop inside the tool loop: a generator tool can call `ctx.suspend()` to gate its own call. The request suspends like any sequencer gate, and on a durable resume the tool re-enters past the approval — prior turns and completed sibling tools replay from the item log, so the model is not re-called for them. Constraints: gate before side effects (the tool re-enters from the top on resume, so guard pre-gate work with `runOnce`), one approval gate per model turn (first-suspension-wins), and a gated tool can't be `cacheable` (the cache short-circuits before the tool body). See [Generator and router suspend/resume](https://flow-state.dev/docs/advanced/generator-and-router-suspend-resume).
- `sequencer(config)` — Fluent composition DSL (21 methods: `step`, `stepIf`, `parallel`, `forEach`, `forEachSideChain`, `doUntil`, `doWhile`, `map`, `tap`, `tapIf`, `rescue`, `branch`, `sideChain`, `sideChainIf`, `waitForSideChain`, `waitForCondition`, `loopBack`, `stepAll`, `stepAny`, `race`, `exitIf`)
  - `.forEach()` / `.forEachSideChain()` take a per-item factory `(item, index, ctx) => block` in place of a block. A block built that way does not exist when `defineFlow` walks the graph, so declare what the factory can produce with `blocks: [...]` in the trailing options (`IterationOptions` / `SideChainIterationOptions`); declared blocks count as the step's children for the dispatcher address check, resource merging, and `requireOrg`. Redundant on a call that passes a block directly.
- `router(config)` — Runtime block selection from declared routes. Route names must be unique per router (validated at build). The selected branch dispatches through the same replay seam as sequencer children, so on a durable resume the branch decision stays stable — the framework validates the re-run selection against the recorded decision and throws `RouteUnavailableError` on a mismatch — and completed work inside the branch replays instead of re-executing. A router whose branch can suspend needs a pure `execute` selector (no side effects, no ambient state reads); see [Control-flow determinism](https://flow-state.dev/docs/advanced/block-memoization-and-replay#control-flow-determinism)
- `dispatcher(config)` — Send one dispatch to one entry the flow declares, in a child session derived from a key or in an existing session named by id. Returns `{ sessionId, requestId, adopted }`. See [Messages, entries, and `dispatcher()`](#dispatches-entries-and-dispatcher)

**Block methods** (available on every `BlockDefinition`):
- `.connectInput(mapper)` — adapt input shape at the call boundary
- `.connectOutput(mapper)` — transform output shape at the call boundary
- `.mapModelOutput(mapper)` — when the block is used as a generator tool, supply a model-visible string representation of its output
- `.asTool(opts?)` — wrap the block so it emits a `tool_output` item when run from a sequencer step (same envelope and lifecycle as the AI SDK tool-loop path)

**Background work lifetime:** `.sideChain()`, `.sideChainIf()`, and `.forEachSideChain()` queue tasks on a per-request pool, not the sequencer that dispatched them. Inner sequencers do not auto-await their own background work before returning; sibling sequencers run their tasks concurrently. The request executor drains the pool before terminal status — on every outcome, and repeatedly until no task is left, so a task that queues more background work is waited on too. Use `.waitForSideChain()` when an inner step depends on a queued task completing first — it drains only the calling sequencer's contributions.

**Event-driven waits:** `.waitForCondition(predicate, { timeoutMs, wakeOn? })` suspends the sequencer until a synchronous predicate over the request's item stream returns true (or the timeout fires). Yields `{ timedOut: boolean }`. Use it to coordinate with side-channel state — a worker writing an artifact, a task-board flipping a status, an external actor resuming a paused review. Predicate helpers ship in `@flow-state-dev/core/items`: `whenResourceChanged({ scope, path, changeType? })`, `whenResourceMatching({ scope, pattern })` (tiny glob with `*` and `**`), and `whenAnyItem(predicate)` as the generic escape hatch. The optional `wakeOn` filter lets high-fanout patterns skip predicate re-evaluation on irrelevant item types; `@flow-state-dev/orchestration` ships `onTaskChangeFor(collectionId)` for collection-bound waiters.

**Flow:**
- `defineFlow(definition)` — Create a flow type with actions, `internal` and `tasks` entries, scopes, resources, and per-scope `client` blocks. See [Messages, entries, and `dispatcher()`](#dispatches-entries-and-dispatcher)

**Concurrency policy:**

Any entry can declare a `concurrency` policy that decides what happens when two requests collide on the same key (the session by default). Set it on the entry — an action, an `internal` entry, a task-board entry, or a chat / webhook / schedule binding — or set a flow-wide default via `RequestConfig.concurrency` (`flow.request.concurrency`); resolution is `entry.concurrency ?? flow.request.concurrency ?? "allow"`, the same ladder for every dispatch type.

`ConcurrencyConfig` is either a bare policy name (`"allow" | "queue" | "reject"`) or `{ policy, key }`, where `key` is `"session"` (default), `"user"`, `"none"`, or a `(ctx) => string | undefined` function. A key that resolves to `undefined` means no arbitration — the request runs as `allow`. The default is `allow` (run concurrently).

```ts
defineFlow({
  kind: "support-chat",
  request: { concurrency: "queue" },                              // flow-wide default
  actions: {
    respond:     { block: respondPipeline },                      // inherits "queue"
    syncInvoice: { block: invoicePipeline,
                   concurrency: { policy: "reject", key: "user" } },
  },
});
```

Exported types: `ConcurrencyConfig`, `ConcurrencyKey`, `ConcurrencyKeyContext`, `ConcurrencyPolicyName`, plus the `validateConcurrencyConfig` validator. The policy is enforced once at the host dispatch seam, so every transport inherits it. See the [Concurrency policies](https://flow-state.dev/docs/advanced/concurrency-policies) reference.

**Utility block factories (`utility.*`):**
- `utility.contextReducer(config)` — Generator factory for `distill`, `denoise`, or `compress` context transformation modes with mode-specific default output schemas (`{ distilled, keyPoints }`, `{ cleaned, removedCategories? }`, `{ compressed, compressionRatio?, dropped? }`)
- `utility.summarizer(config)` — Generator factory for brief, detailed, or executive summaries with optional focus `objectives` and a default `{ summary, keyPoints? }` output contract
- `utility.decomposer(config)` — Generator factory that breaks broad requests into executable tasks using a default `{ tasks: [{ id, goal, deps?, priority? }] }` output contract
- `utility.analyzer(config)` — Generator factory for artifact critique/evaluation with configurable `criteria` and a default `{ findings, score?, recommendation? }` output contract
- `utility.combiner(config)` — Handler factory for deterministic artifact merging via concatenation, deduplication, and structural normalization with default `{ combined, mergeNotes? }` output
- `utility.intentClassifier(config)` — Generator factory for bounded intent classification with required category descriptions and default `{ category, confidence, reasoning? }` output contract
- `utility.intentRouter(config)` — Sequencer factory that composes `intentClassifier` + `router` into classification-driven branching with category descriptions, handlers, optional `confidenceThreshold`, and optional fallback routing
- `utility.keyedRouter(config)` — Router factory for the "pick a block from a `Record<string, Block>` by string key" case. Throws with the registered keys (or routes to `fallback`) when the selected key is unregistered. Input adaptation belongs on the routed blocks via `.connectInput` (BP-013)
- `utility.memoryExtractor(config)` — Generator factory for stateless durable-memory extraction with a default `{ memories: Array<{ type, content, confidence?, source? }> }` output contract (`type` ∈ `fact | preference | constraint | decision`)

Every generator-based utility above accepts an optional `itemVisibility` (`{ client: boolean; history: boolean }`) to control whether output is surfaced to the client/history. All default to unset (silent — output flows only via graph edges). Set explicitly to opt in when the utility should be user-facing.

**Resources:**
- `defineResource(config)` — Portable resource definition. Requires `scope: "session" | "user" | "org"`. Register on a flow's or block's `resources` map.
  - Supports optional `content`/`contentFile` (mutually exclusive), `render`, `llmReadable`, and `llmWritable` for resource content workflows. `contentFile` and file-path `contentTemplate` accept a bare string (resolved from the working directory) or an `AnchoredPath` — `{ path, importerUrl: import.meta.url }` — resolved relative to the declaring module first, with a working-directory fallback
  - `prefetchMode?: 'eager' | 'lazy'` (default `'eager'`) — `'lazy'` defers the load until the declaring block dispatches. Once the resource is resolved its `ref.state` getter is synchronous. Declaring `'lazy'` on a flow-level single resource throws at build time (no per-block load trigger).
  - `sharedToLineage?: boolean` (default `false`, `scope: "session"` only) — give the resource ONE identity across a session lineage, so a session and every child session under it (and every child of those) resolve the same resource through the ordinary resource API. Session **state** is never shared, and sharing does not serialize writes — two children writing one shared resource is ordinary same-resource contention fenced by `expectedVersion`. `true` at `user`/`org` scope throws at build time (those scopes already span every session the principal touches). Also accepted by `defineResourceCollection`, applying to every instance.
  - `reactTo?: { created?, stateUpdated?, deleted?, contentUpdated? }` — bind a block (handler/generator/sequencer) to a mutation. Each entry is a bare block or `{ block, when }`. A state binding (`created`/`stateUpdated`/`deleted`) runs with a `ResourceChange` payload (`key`, `ref`, `kind`, `state`, `prevState`, `evicted`), typed with `resourceChangeSchema(stateSchema)`. A `contentUpdated` binding runs after a server-side content write with a minimal `ResourceContentChange` payload (`key`, `ref`, `kind`), typed with `resourceContentChangeSchema()`; the block `readContent()`s for the fresh body. The block runs blocking inside the originating turn. See the [Reactive blocks](https://flow-state.dev/docs/resources/reactive-blocks) reference.
  - Runtime `ResourceRef` provides `state` (sync getter) plus `patchState`, `setState`, `updateState`, **`incState` / `pushState`** (below), and **`getOrPatchState(key, compute)`** — get-or-compute over state: returns `state[key]` if present, else runs `compute`, patches the result under `key`, and returns it (callback runs only on a miss, so a fetch happens at most once per stored key and downstream readers reuse the stored copy). A stored `null` is a hit; a `compute` resolving to `undefined` stores nothing. No TTL — a per-resource data spine, not a cache. Concurrent misses on the same key within a request are single-flighted (they share one `compute`, so a fanned-out read issues one upstream fetch); distinct keys still compute in parallel.
  - **`incState(increments)` / `pushState(field, value)`** — add to number-valued state fields (`incState({ calls: 1 })`), or append one value to an array-valued one (`pushState("errors", "rate_limited")`), under the same names scope state uses. Both resolve to `void`; read the result off `ref.state`. Each call is a single guarded mutation, so two callers incrementing one counter both land — on the memory, SQLite and Postgres stores, which compare and swap inside the store; the filesystem store holds the guard per key on the **store instance**, which covers every context sharing that instance but does not coordinate two stores pointed at one directory. Both are keyed to `TState` on a `ResourceRef<TState>` / `ResourceContext<TState>` whose state type is written out — number fields for `incState`, array fields and their element type for `pushState`. A handle read off `ctx.resources.<name>` is `ResourceRef<any>`, so only the delta-is-a-number check survives there. They refuse rather than corrupt: incrementing a field that holds something other than a number, or appending to one that holds something other than a list, throws `FlowError` (`code: "resource_delta_refused"`, `retryable: false`) and leaves the stored value alone. A multi-field `incState` applies wholly or not at all. An absent or `null` field is that field's empty state, not a wrong kind of value — it starts from `0` / `[]`. `incState` also refuses a result that is not finite, since two finite operands can overflow to `Infinity`, which `z.number()` accepts but the stores disagree about how to persist. Both honor `writable: false`, and a delta that commits is validated against `stateSchema` like any other state write.
  - **`updateStateWith(ref, updater)` / `withOutcome(run, updater)`** (`@flow-state-dev/core/helpers`) — run a state update whose callback *returns* what it did, as `{ state, result }`, instead of assigning it to a variable outside the callback. On the CAS path an updater can run more than once, so an outward-assigned value can describe an attempt that never committed; these return the result belonging to the invocation that did (or `undefined` if none completed). `withOutcome` takes any mutation runner — `ref.updateState`, a scope's `atomicState`, or your own wrapper — so one helper covers every retry entry point. `scripts/validate-updater-purity.mjs` (in `pnpm typecheck`) rejects the common outward-write forms as a backstop — it catches the naive shapes, not every possible one.
- `defineResourceCollection(config)` — Dynamic resource collection with pattern-based keys (`files/*`, `files/**`, `[topic]/observations`), required `scope: "session" | "user" | "org"`, optional `maxInstances`/`eviction`, lifecycle hooks, and `reactTo` (same `{ created?, stateUpdated?, deleted?, contentUpdated? }` shape as `defineResource`; supersedes the `onInstance*` callbacks for the block case)
  - `prefetchMode?: 'eager' | 'lazy'` (default `'eager'`) — a loading-cost knob, not an API-shape knob. Eager preloads the whole prefix into a per-request cache so reads resolve instantly; `'lazy'` reads per access from the store. The call shape is identical in both modes: `get`/`getOptional`/`list`/`count` all return Promises (always `await` them), and the mutations `create`/`getOrCreate`/`upsert`/`delete` were already async. Flipping `prefetchMode` needs no call-site changes. `'lazy'` requires `eviction: 'none'` (a partial cache can't drive eviction) and throws at build time otherwise.
  - Runtime `ResourceCollectionRef` provides `create()`, `get()`, `getOrCreate()`, `upsert()`, `list()`, `delete()`, `count()`
  - **`create(key, initial, { replace: true })`** — overwrites an existing instance instead of throwing. `setState` semantics; Zod `.default(null)` fills nullables on both the create and replace branches. `maxInstances` only checked when adding a new instance. Use for setup/reset paths.
  - **`upsert(key, update, createOnly?)`** — patch-or-create. On exists: applies `update` via `patchState` semantics (other fields preserved). On missing: creates with `{ ...createOnly, ...update }` (update wins on overlap). The `createOnly` extras fill fields you only need to supply at creation time. Use for incremental-update paths that need to handle first-touch in a single call.
  - "If-exists / if-missing" summary: `create` throws / `create({ replace })` replaces / `getOrCreate` returns as-is / `upsert` patches — all four create on missing.
- `isDefinedResourceCollection(value)` — Type guard for collection definitions

**Capabilities:**
- `defineCapability(config)` — Bundle resources, state schemas, targets, and helper functions under a single name. Blocks declare capabilities via `uses: [cap]` and the framework merges everything transitively.
  - `fns: (ctx) => ({ ... })` — Helper functions exposed at `ctx.cap.{name}.{fn}`, memoized on first access
  - `presets` — Named opt-in/opt-out bundles of any block config surface. Use `.presets({ name: true/false })` to configure
  - `config: { schema?, resolve }` — Open, typed configuration. The resolver maps a validated value onto a block surface (like a preset, but value-carrying). Consumers pass it with `.config(value)`, which composes with `.presets()` in either order
  - `.with(bag)` — The normalized consumer builder. Collapses `.config()` and `.presets()` into one flat call: preset-named keys become preset toggles, the rest become the config value. `cap.with({ allowed: ["x"], dynamicActivation: true })` ≡ `cap.config({ allowed: ["x"] }).presets({ dynamicActivation: true })`. `.config`/`.presets` remain the underlying primitives; a preset name colliding with a config field is a `defineCapability()` error
  - `uses` — Capabilities can depend on other capabilities (transitive composition with diamond dedup)
  - Factory pattern: wrap `defineCapability()` in a function for parameterized capabilities

**Capability schema forwarding:**

When a block lists a capability in `uses`, the capability's declared schemas flow into the block's `ctx` types at factory time. No re-declaration on the block is needed. The forwarded axes are `sessionStateSchema`, `resources` (resource handles), `targetStateSchemas`, `sequencerStateSchema` (from presets), and `stateSchema` (the block's own state, `ctx.self` — valid on any block kind). Block-own declarations merge in; for most axes the block wins on key collision, but `stateSchema` requires a shared field to be the *same schema reference* instead (matching the `resources`/`targetStateSchemas` merges) — a duplicate field with a different reference throws at build time rather than one side silently winning.

```ts
const myCap = defineCapability({
  name: "my-cap",
  sessionStateSchema: z.object({ ticker: z.string() }),
  fns: (ctx) => ({ currentTicker: () => ctx.session.state.ticker }),
});

const myHandler = handler({
  name: "my-handler",
  uses: [myCap],
  execute: async (_input, ctx) => {
    // ctx.session.state.ticker — string, from the capability
    const t = ctx.session.state.ticker;
  },
});
```

Forwarding is direct-only: inner capabilities used by `myCap` do not propagate to `myHandler`. Dynamic `uses` entries (functions) contribute at runtime but not to types.

**Tool-result memoization:**
- `createToolCacheCapability(options?)` — Capability that installs a per-request LRU store on the active context so any tool block declaring `cacheable` serves identical calls from cache. Errors are never cached; identical in-flight calls in the same request coalesce.
- `createInMemoryToolCacheStore(options?)` — Standalone store factory for advanced wiring (e.g. binding a per-board run-scoped store directly).
- `bindToolCacheStore(ctx, store)` — Attach a store to a context without going through the capability path.
- `canonicalizeToolArgs(value)` — Deterministic JSON canonicalizer for custom `keyFn`s that want the substrate's default normalization.
- Types: `ToolCacheStore`, `ToolCacheEntry`, `ToolCacheAccessor`, `CreateToolCacheCapabilityOptions`.
- See [Flow policy](https://flow-state.dev/docs/orchestration/flow-policy) for the full guide, including when to mark a tool cacheable and how Task Board auto-installs the capability.

**Context & client data:**
- `contextFn(schemas, fn)` — Typed context function for generators (scope-aware, portable)
- `client` on scope configs — Per-scope client view: `expose: string[]` (verbatim passthrough by field name) and `derived: { name: fn }` (compute functions receive `{ state, resources }`). State without a `client` block is private. The former `clientData` key on scope configs has been removed — `defineFlow` throws if it is still set.

**Prompt formatters** (`@flow-state-dev/core/prompt`):
- `section`, `list`, `keyValues`, `table`, `entries`, `codeBlock`, `join`, `when` — Composable text formatters for building clean LLM context. `section` takes a string title (default `##`) or `{ title, level }` to nest under another section; `table` renders an array of records as a Markdown table. The same `keyValues` / `list` / `table` shapes are auto-registered as `fsd_*` filters inside `.md` prompt templates.

**Concurrency** (`@flow-state-dev/core`):
- `mapLimit(values, maxConcurrency, mapper)` — bounded-concurrency async fan-out preserving input order. Use it for async work **inside a handler** (`.parallel` fans out blocks, not in-handler async).
- `xmlTag(name, content)`, `renderTaggedContext(tagged, order)` — XML tag rendering used by object-form generator context
- `validateTagName(name)`, `RESERVED_TAG_NAMES` — Reserved-tag list and validator for object-form context keys

**Object-form generator context:**

`generator({ context: { ... } })` accepts an object whose keys become XML tag names. Multiple sources (the generator itself plus capabilities installed via `uses`) that contribute to the same key aggregate inside a single tag, instead of producing scattered sections.

```ts
generator({
  prompt: "You are a research assistant.",
  context: {
    documents: [doc1, doc2],
    userPreferences: () => loadPrefs(),
    memory: { shortTerm: items, longTerm: () => loadLongTerm() },
  },
  uses: [capA, capB], // each may also contribute `documents`
});
// Renders as one combined system message:
//   You are a research assistant.
//
//   <documents>
//     ...all documents from the generator + capA + capB...
//   </documents>
//   <user-preferences>...</user-preferences>
//   <memory>
//     <short-term>...</short-term>
//     <long-term>...</long-term>
//   </memory>
```

Keys may be authored as `camelCase`, `snake_case`, or `kebab-case` (all normalize to kebab-case). Values may be strings, string arrays, nested objects (recursive — produces nested tags), functions resolved at render time, or `null` placeholders that reserve order but emit nothing if unfilled. String leaves are HTML-escaped so `<` / `>` / `&` in user data don't get read as tags. The original array form is unchanged. See the [blocks reference](https://flow-state.dev/docs/fundamentals/blocks) for the full contract.

**Slot types:**
- `ToolsSlot` — Tools accepted by generators: static array or `(ctx) => tools[]`
- `UsesSlot` — Capabilities accepted by blocks: static array or `(ctx) => caps[]`
- `InstructionsSlot<TInput>` — Pattern-level instructions: static string or `(input, ctx) => string | Promise<string>`. Parameterize with the pattern's input type to recover a typed `input` in the callback.

**Type helpers:**
- `StateOf<T>` — Extract state type from schema or resource
- `ContextOf<T, Kind>` — Get context handle type for scope/resource
- `ResourceContext<T>` — Resource context type
- `BlockInput<T>` / `BlockOutput<T>` — Infer block I/O types
- `BlockDefinition` — The fully-typed return interface of `handler()`, `generator()`, `sequencer()`, and `router()`. Generics default to `ZodTypeAny`, so unparameterized `BlockDefinition` is the unconstrained "any block" form — useful when an app-level factory needs to accept or return a block without restating the framework's generics.
- `BlockKind` — `"handler" | "generator" | "sequencer" | "router"` union — useful when writing dispatchers that switch on `block.kind`.
- `BlockContext` — The full block-context interface (the type of `ctx` in `execute`). Generic over the four scope-state types, declared resources, sequencer state, and parent input.
- `BlockResult<TOutput>` — The handler `execute` return-value union.
- `SessionScopeHandle<TState>` / `UserScopeHandle<TState>` / `OrgScopeHandle<TState>` / `RequestScopeHandle<TState>` — The scope handles `ctx.session` / `ctx.user` / etc. resolve to. Use to type a ctx slice (e.g. `(input, ctx: { session: SessionScopeHandle<MySessionState> }) => …`) instead of hand-rolling a `{ session: { patchState: ... } }` shape.
- `ScopeStateOps<TState>` — The state-mutation interface every scope handle exposes (`patchState`, `setState`, `setStateRecord`, etc.).
- `LooseBlockContext<TSessionState>` — Variance-friendly alias for `BlockContext`: typed on session scope, permissive on resources. Use for helper functions that take a block's `ctx` as a parameter. The full `BlockContext`'s `TResources` generic is invariant on `ResourceRegistry`, so a handler's narrow inferred `ResourceRegistry<{ memos: ... }>` can't widen to a `BlockContext`'s default. `LooseBlockContext` sidesteps that by leaving `resources` permissive — helpers accept any block's ctx, call sites retain their narrower typing internally.

### `handler.withDefaults({...})`

Partially-applied handler constructor. Bakes in common config so a family
of sibling handlers can share scaffolding without restating it per call.

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const memoHandler = handler.withDefaults({
  sessionStateSchema,
  resources: { memos: memosCollection },
  outputSchema: z.void(),
});

export const commitBullMemo = memoHandler({
  name: "commit-memo-p2-bull",
  inputSchema: bullThesisSchema,
  execute: async (thesis, ctx) => {
    // ctx.session.state is typed from sessionStateSchema
    // ctx.resources.memos is typed from the resources default
    await ctx.resources.memos.get("p2/bull").patchState({ ... });
  },
});

// Per-call overrides win: pass `outputSchema` again to replace the default.
export const markError = memoHandler({
  name: "mark-error",
  inputSchema: z.unknown(),
  outputSchema: z.object({ status: z.literal("error"), text: z.string() }),
  execute: async (_, ctx) => ({ status: "error" as const, text: "..." }),
});
```

Defaultable fields: `sessionStateSchema`, `userStateSchema`,
`orgStateSchema`, `requestStateSchema`, `sequencerStateSchema`,
`resources`, `outputSchema`, `uses`. `name`, `inputSchema`, `execute`, and
`description` are excluded — those vary per block.

### Prompt files (`@flow-state-dev/core/prompt-file`, `@flow-state-dev/engine/prompt-file`)

Author a generator's prompt as a `.md` file. The isomorphic subpath exports `parsePromptFile(text, options?)`, `definePromptFile(pf)`, `isPromptFile(value)`, and the `PromptFile` / `PromptFileConfig` / `PromptFileParseError` / `PromptFileLoadError` types. The Node-only subpath exports `loadPromptFile(specifier, importerUrl, options?)`, which reads the file and auto-registers sibling `.md` files as partials; only this subpath imports `node:fs`, so browser/bundled consumers use `parsePromptFile` with raw text plus an explicit `partials` map.

**Resolution rule.** Relative specifiers resolve against the caller's `import.meta.url`; absolute specifiers are used as-is (`importerUrl` ignored); `createPromptLoader` joins every `relPath` onto its absolute `baseDir`. Resolution never consults the process working directory — compute `baseDir` with `resolveBaseDir(candidates, { expect? })` (first candidate dir that exists and contains the `expect` probe; throws listing all candidates when none qualifies) composed with `moduleDir(importerUrl, relative?)` (the module's directory, or `undefined` when a bundler has rewritten `import.meta.url` to a non-`file:` URL). Module-relative candidate first, `process.cwd()`-derived fallback for bundled runtimes that pin cwd (Next.js dev/build).

Two ergonomic shortcuts cut the boilerplate:

- **Pass the `PromptFile` straight to `prompt`** instead of spreading `definePromptFile(pf)`. `generator({ prompt: loadPromptFile(...), model })` expands the file's `user` / `caching` / `maxTokens` / `temperature` / `name` / `description` into the config; any sibling field you set explicitly wins (same precedence as `...definePromptFile(pf), <overrides>`).
- **`createPromptLoader(baseDir, options?)`** (Node subpath) captures an absolute `baseDir` plus shared `partialsDir` / `filters` once and returns a `load(relPath)` function, so call sites drop the repeated `import.meta.url` argument. Per-call `filters` merge over the loader's shared filters.

```ts
import { generator } from "@flow-state-dev/core";
import {
  createPromptLoader,
  moduleDir,
  resolveBaseDir,
} from "@flow-state-dev/engine/prompt-file";

const PROMPT_ROOT = resolveBaseDir(
  [moduleDir(import.meta.url, "./prompts"), path.resolve(process.cwd(), "src/prompts")],
  { expect: "_partials" },
);
const load = createPromptLoader(PROMPT_ROOT);
const analyst = generator({ name: "analyst", model, prompt: load("analyst.prompt.md") });
```

**Resource content templates.** The same `.md` format can render resource content against state. The Node subpath exports `loadResourceTemplate(specifier, importerUrl, options?)` and the isomorphic subpath exports `parseResourceTemplate(text, options?)`, `renderResourceTemplate(template, state)`, and the `isResourceTemplate(value)` guard. Wire them via `contentTemplate` (build-time file — a parsed template, a working-directory-relative string path, or an `AnchoredPath` resolved relative to the declaring module) or `contentTemplateRef` (live-editable resource) on `defineResource()` and `defineResourceCollection()`. See the [Resource content from Markdown templates](https://flow-state.dev/docs/advanced/resource-templates-markdown) reference.

### Voice Provider

`VoiceProvider` is a single, ability-flagged interface a flow wires to handle one or more voice surfaces: speak (batch TTS), speakStream (streaming TTS), transcribe (STT), and listVoices (catalog). Each provider declares which abilities it supports via the `abilities` field; runtime type guards (`canSpeak`, `canSpeakStream`, `canTranscribe`, `canListVoices`) narrow the provider so the matching method is callable without `!`. Errors thrown by providers carry a discriminated `VoiceError.kind` so callers can branch on category instead of parsing messages.

This surface replaces the previous resolver-factory pattern (`createAiSdkSpeechResolver`, `createAiSdkTranscriptionResolver`) — those helpers and their `SpeechResolver` / `TranscriptionResolver` types are removed from core. The field is named `abilities` (not `capabilities`) to avoid colliding with the framework's first-class `Capability` concept (`defineCapability`, `uses: [cap]`).

```ts
import { canSpeak, type VoiceProvider } from "@flow-state-dev/core";

async function maybeSpeak(provider: VoiceProvider, text: string) {
  if (canSpeak(provider)) {
    const { audio, mediaType } = await provider.speak({ text });
    return { audio, mediaType };
  }
  return null;
}
```

Exports from the main package and `@flow-state-dev/core/types`:

- Core contract: `VoiceProvider`, `VoiceAbilities`, `SpeakOptions`, `SpeakResult`, `SpeakChunk`, `TranscribeOptions`, `TranscribeResult`, `VoiceInfo`
- Narrowing interfaces: `SpeakCapable`, `SpeakStreamCapable`, `TranscribeCapable`, `ListVoicesCapable`
- Type guards: `canSpeak`, `canSpeakStream`, `canTranscribe`, `canListVoices`
- Errors: `VoiceError`, `VoiceErrorKind`
- Composite factory: `createCompositeVoiceProvider` builds a synthetic provider that delegates each ability to a different underlying provider

Per-provider implementations live in separate packages — `@flow-state-dev/voice-openai` is the first, with `@flow-state-dev/voice-elevenlabs` to follow.

### Types (`@flow-state-dev/core/types`)

Block, flow, resource, scope, streaming, and model type definitions. Use this subpath for type-only imports.

`defineResourceCollection` accepts `writable?: boolean` (default `true`) and `llmReadable?: boolean` / `llmWritable?: boolean` (default `false`). Declared once, they apply to every instance. `writable: false` refuses instance `patchState` / `setState` / `updateState` / `incState` / `pushState`, collection `upsert` on an existing key, and instance `writeContent`; those writes throw `Error` with `Resource "<storageKey>" is read-only` (state) or `Resource "<storageKey>" content is read-only` (content). `create` / `getOrCreate` / `delete` are not gated by `writable`. `llmReadable` exposes instance content to `readResourceContentTool()` and content search (`grepResourceContent` / `searchResources`); `llmWritable` lets `writeResourceContentTool()` overwrite an instance body. The write tool admits a call on `llmWritable` alone; persist still honors `writable`. The generic tools address resources by scope-qualified uri (e.g. `session/files/readme.md`). A content-bearing collection uses those tools; keep collection-specific tools for domain logic they do not cover.

`defineResourceCollection` accepts a `prefetchWindow?: number` (default `0`) that inlines the first N items in the snapshot's `prefetched` window in lexicographic storage-key order. Per-item `clientData` in the window appears only when `client.state.read: true` is also set. `CollectionStateClientConfig` controls per-item state visibility separately from content; single resources don't accept `client.state` (state visibility is governed by `client.data` on those).

Set `client: { live: true }` to stream each mutation's projected `clientData` as an inline delta that the client merges mid-stream without a refetch (the resource-side analog of `state_change`). It requires the resource's `clientData` to be client-visible (`state.read: true` or a projection on collections; a projection on single resources). `lifecycleSchema(statuses)` is a convenience export that returns a `status` enum plus nullable `startedAt` / `completedAt` / `errorMessage` fields to spread into a status-bearing `stateSchema`.

`defineResource` and `defineResourceCollection` carry a derived client-projection type alongside the state type. `ClientDataOf<typeof def>` extracts it — the `Pick` from `expose`, the `Omit` from `exclude`, the return type of `data`, or the full state for the identity default. Pass it to the React hooks (`useResource<T>`, `useResourceCollectionItem<T>`, …) so `clientData` is typed instead of `unknown`. This is a type-level brand only; the runtime payload stays `JsonValue`. For `data` projections, annotate the function's return so the type is captured precisely.

**External resource collections.** `defineExternalResourceCollection({ pattern, scope, stateSchema, read, search, ... })` defines a read-only collection whose instances are read *through* to an app-owned store instead of framework storage — the app stays the source of truth, and the framework re-queries on each read (no copy, no staleness). Reads via `ctx.resources.<coll>.get(key)` / `.getOptional(key)` and the client state/content routes resolve against the required `read({ key, ctx })` hook, validated through `stateSchema`; `search({ query, ctx })` backs the search/list tools (a follow-up slice). The runtime ref is read-only by type (no `create`/`upsert`/`delete`), the client write routes are closed, and `client.content.create`/`update`/`delete` is a build-time error. Patterns are wildcard-only. The hook `ctx` carries a trusted, server-derived `userId`/`scope`/`tenantId` (never caller input — BP-031). It shares the collection runtime core, so addressing, content templates, and client projection are identical to a normal collection.

### Items (`@flow-state-dev/core/items`)

Output item unions, content types, and stream event helpers. Item types: `message`, `reasoning`, `component`, `container`, `tool_output`, `status`, `source`, `state_change`, `resource_change`, `error`.

> The item taxonomy and its pure helpers (`resolveItemVisibility`, `collapseToCanonicalLog`, `resolveBlockValue` / `buildItemLookup`, the `blockPath*` builders, and the `ModelIdentity` / `SuspensionReason` / `SuspensionStatus` / `RequestStatus` leaf types) now live in the zero-dependency [`@flow-state-dev/contracts`](../contracts) package and are **re-exported from these same `@flow-state-dev/core` paths**. Import them from `core` exactly as before — nothing changes for consumers. Browser packages can value-import the canonical helpers from `contracts` without pulling core's heavy authoring dependencies.

`state_change` and `resource_change` share an exported `InvalidationItem` base (common `scope`/`delta`/`version` fields) for consumers that react to "something changed in a scope" generically. It is a base type, not a member of the `OutputItem` union — only the two leaves are.

**`BlockValue<T>`** — `block_output.output` is a discriminated union with three cases: `inline` (novel content on the emitter), `ref` (pointer to another item's content), and `structure` (container of nested BlockValues, used by aggregators like `.stepAll`). Use `resolveBlockValue(value, lookup)` to recover the typed payload `T`; `ctx.getBlockOutput()` resolves transparently. Refs may also point at `MessageItem`s — streaming-text generators emit a ref to their just-emitted message instead of duplicating the text inline. `buildItemLookup(items)` indexes every item by id so the resolver can follow either kind of ref.

### Running a step under an extra abort signal

`.step(block, { abortSignal })` and `.stepIf(cond, block, { abortSignal })` run one
step under an additional abort signal, resolved per dispatch from the running
context:

```ts
sequencer({ name: "work" })
  .tap(startSomethingCancellable)
  .step(worker, { abortSignal: (ctx) => currentCancellation(ctx)?.signal })
  .tap(recordResult);
```

The signal is **composed with the request's, never substituted for it**, so a step
cannot be made to outlive a cancelled request. Return `undefined` and the step runs
exactly as it would without the option. The whole descendant tree sees the composed
signal, so a model call several blocks down aborts with it.

Reach for it when the thing that should stop the step is known only at runtime — a
lease the step's claim depends on, an external cancellation the block itself has no
way to see. A block that can decide for itself should just read `ctx.signal`.

### Releasing what a step was holding

The same bag takes `onSettled`, called once when the step's dispatch leaves by every
path — and told which one: `"returned"`, `"threw"` or `"suspended"`.

```ts
sequencer({ name: "work" })
  .tap(startSomethingCancellable)
  .step(worker, {
    onSettled: (_ctx, outcome) => {
      if (outcome === "suspended") stopSomethingCancellable();
    },
  })
  .tap(recordResult); // stops it itself, once the result is written
```

Suspension is why it exists. `.rescue()` is deliberately never run for a
`SuspensionError` — suspension is control flow, not a failure — and a suspended
request does not abort its signal either, so a step that parks on `ctx.suspend()`
reaches no handler you can compose. Whatever the leading `.tap` started then
outlives the request, silently.

Read the outcome before you release. The hook fires before `recordResult` above,
so releasing on `"returned"` would stop the thing while the step that still needs
it is running. Release on `"suspended"` — the exit with nothing downstream — and
let the downstream handler release the other two when it is finished.

It runs in a `finally` and cannot change the step's outcome, and it is skipped
whenever nothing was dispatched — a `stepIf` condition that skipped the step, or
a step replayed from a durable resume rather than executed (so cleanup does not
re-run on every re-entry). For recovery, use `.rescue()`.

### Helpers (`@flow-state-dev/core/helpers`)

Helpers shared across the framework. `cloneValue`, `deepMerge`, and `deepEqual` operate on the same JSON-serializable state trees and live here as the single canonical home — no per-package copies.

> The pure, dependency-free helpers `deepEqual` / `looseDeepEqual`, `mapLimit`, `toError`, and the string-case utilities (`camelToKebab`, `normalizeTagName`) now live in [`@flow-state-dev/contracts`](../contracts) and are re-exported from these same `@flow-state-dev/core/helpers` paths. Import them from `core` exactly as before; browser packages can value-import them from `contracts` without core's heavy runtime.

- **`cloneValue(value)`** — structural deep copy via the platform `structuredClone`, falling back to a JSON round-trip. Stores clone records on read/write so callers can't mutate stored state through a retained reference.
- **`deepMerge(base, override)`** — recursive merge returning a new object. Scalars and arrays in `override` replace; nested plain objects merge; `base` is never mutated.
- **`deepEqual(a, b)`** — structural equality powering the state-write no-op guard. Primitives compared by `Object.is` (NaN-equal-NaN, `+0 != -0`); plain objects and arrays compared recursively. Rejects non-JSON shapes (Map, Set, functions) with a `TypeError`. `looseDeepEqual` is the throw-free variant.
- **`toError(value, fallback?)`** — coerce an unknown value to `Error`. An `Error` is returned as-is. A non-empty string becomes `new Error(value)`. Anything else, including `""` and objects with a `message`, becomes `new Error(fallback)`. `fallback` defaults to `"Unknown block execution error"`.
- **`withTimeout(promise, timeoutMs, label, onTimeout?)`** — bound a promise with a deadline. Rejects with `"<label> timed out after <ms>ms"` once the deadline passes; `undefined`, `Infinity`, or a non-positive `timeoutMs` means no deadline and arms no timer — the same three `scope-lock` disables on, and `Infinity` is guarded rather than passed through because Node coerces `setTimeout(fn, Infinity)` to 1ms. The timer is cleared on every settle path, so a bounded call that finishes in time leaves nothing holding the event loop open. The bounded work is not cancelled — pair it with an `AbortSignal` when the work itself is cancellable. Pass `onTimeout` to reject with your own error type instead of a plain `Error`. It lives here rather than in `contracts` because it arms a timer — runtime behaviour, unlike the pure helpers above it.

### Graph (`@flow-state-dev/core/graph`)

A reusable typed-edge primitive for relational state. `edgeSchema` describes a directed, typed, bi-temporal `Edge` (`from`/`to`/`type`/`confidence`/`validFrom`/`validUntil`/`source`), and pure traversal helpers walk a plain `Edge[]`: `egoGraph`, `shortestPath`, `neighbors`, `traverse`, `activeAt`, plus `nodeRef`/`parseNodeRef` for `"namespace:key"` node ids. All traversals are depth-bounded and cycle-safe.

Resources opt into a first-class edge graph with `defineResource({ edges: true })` (or `{ vocabulary, maxEdges }`): the framework stores an `edges` array in the resource's state and exposes an `.edges` API (`add`, `supersede`, `remove`, `all`, `neighbors`, `egoGraph`, `shortestPath`, `pruneDangling`) on the live resource reference. Resources without `edges` are unaffected.

## Block state (and its sequencer special case)

Any block — handler, generator, router, or sequencer — can declare its own request-scoped `stateSchema` and read/write it via `ctx.self`. A child block reaches its immediate parent's state the same way, via `ctx.parent`, when it declares `parentStateSchema`. Sequencer instance state below is the common case of this same primitive: `ctx.sequencer` is `ctx.self` addressed by "nearest enclosing sequencer" instead of "this block." See [Block State](https://flow-state.dev/docs/advanced/block-state) for the full addressing model (`ctx.self`, `ctx.parent`, `ctx.sequencer`, `ctx.targets`) and the fan-out/loop isolation contract.

A sequencer can declare a `stateSchema` that gives every step in the pipeline a shared, typed state container. State is read via `ctx.sequencer.state` and written via the seven helpers on `ctx.sequencer`: `patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, and `atomicState`.

```ts
import { sequencer, transientSlot } from "@flow-state-dev/core";
import { z } from "zod";

const counter = sequencer({
  name: "counter",
  stateSchema: z.object({
    count: z.number().default(0),
    // Worker-local scratch. Stays in memory but never appears on the SSE
    // stream, never writes to the durable checkpoint, and resets to its
    // schema default on resume.
    lastClaimed: transientSlot(z.boolean().default(false)),
  }),
}).step(/* ... */);
```

**No-op write guard.** A state-write helper that produces a value structurally equal to the current state is suppressed: no persist call, no `state_change` SSE item, and the helper returns `false` instead of `true`. Callers don't need their own identity check before a repeated write. The comparison uses `Object.is` for primitives (NaN-equal-NaN; `+0 != -0`) and recursive structural equality for plain objects and arrays.

**Transient slots.** `transientSlot()` marks a top-level field on `stateSchema` as in-memory only. Transient slots:

- Hold their value across a sequencer's run, readable by later steps via `ctx.sequencer.state`.
- Do **not** emit `state_change` items on the SSE stream.
- Do **not** appear in `state_snapshot` payloads, so they never enter the durable checkpoint store and reset to their schema default on resume.

Apply `transientSlot()` LAST in the schema chain — after `.optional()`, `.default()`, etc. — so the marker sits on the outermost schema instance referenced by the parent `z.object` shape.

## Dispatches, entries, and `dispatcher()`

Every arrival at a flow is a **dispatch** of one **type**, delivered to one **entry** addressed by `(type, name)`. Each type has its own map on the flow definition, and a dispatch resolves only that map. There is no fallback: an `internal` dispatch named `wake` resolves `flow.internal.wake` or is refused, whatever `flow.actions.wake` is.

| Type | Map on the definition | Sent by |
|---|---|---|
| `public` | `actions` | A caller over HTTP, MCP, voice, or a custom transport |
| `internal` | `internal` | A `dispatcher()` block in one of the flow's own running requests |
| `task` | `tasks` | A task board handing a claimed row to a child session (`tasks: board.tasks`) |
| `chat` | `chat.on` | The chat adapter |
| `webhook` | `webhooks.<provider>.on` | The webhook adapter |
| `schedule` | `schedules.static` | The host scheduler |

`internal` and `tasks` are definition-only, like the transport maps: passing either to the instance call (`defineFlow({ ... })({ internal })`) throws. Every entry of every type has the same core shape as an action — `{ block, inputSchema?, concurrency?, durable?, tokenBudget?, onCompleted?, onErrored?, userMessage? }` — and only `actions` adds the caller-facing `description` and `mcp` fields. A `tasks` entry must be one a board produced; `defineFlow` refuses a hand-written `{ block }` there.

`resolveEntry(flow, type, name, coordinate?)` is the lookup itself, exported for hosts and adapters, alongside `DispatchType`, `DISPATCH_TYPES`, `BlockDispatchType`, `EntryMaps`, `EntryCoordinate`, `InternalEntry`, `TaskEntry`, `isTaskEntry`, `markTaskEntry`, and `TASK_ENTRY`.

### `dispatcher(config)`

A dispatcher is a handler that sends one dispatch to one declared entry instead of doing the work itself. Its address (`type` and `target`) is fixed on the block; the session and the payload are computed per call from the block's input.

```ts
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { z } from "zod";

const summarize = handler({
  name: "summarize",
  inputSchema: z.object({ documentId: z.string() }),
  execute: async (input) => {
    // runs in the child session, on its own request
  },
});

const acknowledge = handler({
  name: "acknowledge",
  inputSchema: z.object({ reason: z.string() }),
  execute: async (input) => {
    // runs in the coordinator's existing session
  },
});

// One child session per document. The same documentId from the same parent
// session lands on the same child, adopted rather than created.
const summarizeInBackground = dispatcher({
  name: "summarize-in-background",
  type: "internal",
  target: "summarize",
  inputSchema: z.object({ documentId: z.string() }),
  session: { key: (input) => input.documentId },
});

// Deliver into a session that already exists. An unknown id is refused, never created.
const wakeCoordinator = dispatcher({
  name: "wake-coordinator",
  type: "internal",
  target: "acknowledge",
  inputSchema: z.object({ coordinatorSessionId: z.string(), reason: z.string() }),
  session: { id: (input) => input.coordinatorSessionId },
  payload: (input) => ({ reason: input.reason }),
});

export default defineFlow({
  kind: "documents",
  actions: {
    upload: { block: summarizeInBackground },
    nudge: { block: wakeCoordinator },
  },
  internal: {
    summarize: { block: summarize },
    acknowledge: { block: acknowledge },
  },
})();
```

| Field | What it does |
|---|---|
| `type` | The dispatch type. Authored dispatchers send `"internal"`; `task` dispatches are sent only by a task board. |
| `target` | The entry name, resolved as `flow.internal[target]`. Checked when the flow is defined. |
| `inputSchema` | What the block accepts. Defaults to `z.unknown()`. |
| `session` | `{ key: (input, ctx) => string }` derives a child of the running session; `{ id: (input, ctx) => string }` names an existing one. |
| `payload` | `(input, ctx) => unknown`, the entry's input. Defaults to the input itself. Validated by the entry's own schema on arrival. |
| `transient` | Hide the block's trace from clients. Default `false`. |

The block returns a `DispatchHandle` (`dispatchHandleSchema`): `{ sessionId, requestId, adopted }` — the session the dispatch runs in, the request it became, and whether a `key` landed on a child that already existed. It returns once the runtime has accepted the request and does not wait for the work; read the child's progress from that session's own request history.

A `key` child is derived from the key together with the running request's principal, tenant, parent session, and lineage, so the same key from a different parent is a different child, and nothing a caller supplies can address someone else's. The child's session record carries `parentSessionId`, `topic` (the key), and `coordinate` (`"internal:summarize"`). An `id` target must exist, belong to this flow kind, this principal, and this tenant, and not be bound to a different org.

`defineFlow` walks every block it can reach — sequencer steps, rescue handlers, a generator's `tools`, the `blocks` a `forEach` / `forEachSideChain` factory declares, and the blocks behind `internal` and `tasks` entries — and throws when a dispatcher names an entry the flow does not declare, naming the block and the address. A target chosen from data is a `router` over declared dispatchers, not a dynamic string.

At run time a refused dispatch throws `DispatchRefusedError` (`code: "dispatch-refused"`), carrying `blockName`, `address`, `detail`, and `refused`:

| `refused` | Meaning |
|---|---|
| `no-entry` | The flow declares no entry at `(type, target)`. |
| `session-not-found` | An `id` names a session that does not exist. |
| `session-not-addressable` | An `id` names a session on another flow, another principal, another tenant, or a different org. |
| `key-occupied` | A `key` derived a child id already held by a record that is not this request's child. |
| `no-dispatch-operation` | This process executes requests but was not wired to dispatch one. |
| `dispatch-rejected` | The host refused before starting — a `reject` concurrency policy whose key is held. |

Every refusal is decided before anything is dispatched, so a `.rescue()` on the dispatcher can branch on `refused` knowing nothing started. A `key` or `id` function that returns an empty string throws a plain `Error` naming the block. On a context no runtime wired (a hand-built test context), the block throws `NoDispatchSeamError` (`code: "no-dispatch-seam"`); attach a `DispatchSeam` under the `DISPATCH_SEAM` symbol key to test one.

**Substrate exports.** A package that builds its own dispatching block (a task board's hand-off) calls `dispatchThroughSeam(ctx, spec)` and stamps the block with `markDispatcher(block, address)` so the definition-time walk sees it. The types are `DispatchAddress`, `SessionTarget`, `DispatchSpec`, `DispatchOutcome`, `DispatchRefusal`, and `DispatchSeam`.

## Reaching the runtime from a capability (`ctx.requestHost`)

`BlockContext` carries an optional `requestHost` member — the one declared way a capability's helper functions reach facilities only the runtime can provide: the task-board row this request was dispatched for, and whether requests it dispatched are still running.

It is **framework-facing**. There is nothing to declare to get one, and app code does not normally touch it: a host built through the shipped entry points supplies it.

```ts
import { requireRequestHost } from "@flow-state-dev/core";

const host = requireRequestHost(ctx); // throws by name when none is wired
```

The member is optional in the *type* so a hand-built test context still type-checks. `requireRequestHost` turns a missing host into a named error (`NoRequestHostError`, `code: "no-request-host"`) rather than `undefined is not a function`.

Which of the host's verbs answer depends on the deployment:

- `parentTask()` — the one parent-board row this request was dispatched for, as `unknown` (parse it with your own schema), or `undefined` when the request was not dispatched for a task.
- `settleParentTask({ outcome: "complete" | "fail", output?, error? })` — settle that row. Resolves `{ ok: true }`, or `{ ok: false, refused: "no-parent-task" | "fence-rejected", detail }`. `fence-rejected` means this request's claim on the row was superseded, so nothing was written.
- `livenessOf(requestIds)` — per-id `boolean` answers for requests this request dispatched. **Absent** unless the deployment can support a trustworthy answer: a request registry shared across processes, request heartbeats enabled, and a stale sweeper running. The default in-memory registry is per-process, so it is absent there. `false` means no live registration was found, never "definitely dead".

The types are `RequestHost`, `ParentTaskOutcome`, `SettleParentTaskInput`, `SettleParentTaskResult`, and `LivenessAnswers`. Nothing on the interface names a store, a flow, a session record, or a task row, and no verb takes an identity or a session id: each closes over the running request's own. To start work in another session, use a [`dispatcher()`](#dispatches-entries-and-dispatcher) block; the flow checks its address when it is defined.

## Key design decisions

**Partial state schemas.** Each block declares only the state fields it touches. A counter block doesn't need to know about a preferences block's state. This keeps blocks reusable and self-documenting about their dependencies.

**Silent by default.** Blocks emit nothing to the client unless they explicitly call `ctx.emit.message()`, `ctx.emit.component()`, or `ctx.emit.status()` — or declare `activeStatusMessage` on the block config, which fires `emit.status` automatically at block start. Generators are the exception — they auto-emit messages and reasoning. This gives you precise control over what the user sees.

**Request-scoped status slot.** `emit.status` writes to a single request-scoped slot — the latest message wins. Clients render one in-flight indicator line, falling back to "Working..." when the slot is empty. See `docs/architecture/items.md` for the full semantics.

**Automatic resource collection.** Blocks declare their resource dependencies via a flat `resources` map of `defineResource()` values. Sequencers collect these from child blocks. `defineFlow` merges them into the flow's `resources` map automatically — blocks bring their own resource requirements, just like partial state schemas. Flow-level declarations take priority.

**Resource content handles.** `ResourceRef.readContent()` returns rendered text or `null`; `readContentRaw()` returns raw text or `null`; `writeContent()` overwrites content when writable.

**LLM content tools are explicit.** Use `readResourceContentTool()` / `writeResourceContentTool()` in a generator's `tools` array when you want LLM access. These are not auto-injected.

**LLM navigation tools.** `resourceSearchTools()` returns the Glob/Grep/Search trio over resources — `globResources` (path glob), `grepResourceContent` (regex/substring over content), and `searchResources` (lexical, term-frequency ranked). All three span static resources and collection instances and return each match's scope-qualified uri — the handle `readResourceContentTool` accepts. Grep and search gate on `llmReadable` (including collection instances whose collection opts in); glob lists uris ungated. Lexical only, not semantic. See [Searching resources](https://flow-state.dev/docs/resources/searching).

**Prompt caching is on by default.** Generators accept a `caching` field; the default is `{ enabled: true, breakpoints: 'auto', ttl: '5m' }`. The AI SDK adapter stamps `providerOptions.anthropic.cacheControl` on the last system message for Anthropic-flavored providers (and opts the Vercel AI Gateway into `caching: 'auto'`); OpenAI / Google / DeepSeek cache implicitly and are left alone. Cache token counts land on `GeneratorModelUsage` as `cacheCreationInputTokens` and `cacheReadInputTokens`. See the [prompt caching guide](https://github.com/fixpoint-labs/flow-state-dev/blob/main/docs/PROMPT_CACHING.md) for the full design, audit, and manual-mode guide.

**Typed target state declarations.** Handler, generator, and router blocks can declare `targetStateSchemas` with Zod schemas. Declared names type `ctx.targets.<name>` as `StateRef<...> | undefined` for state coordination. Use `ctx.getBlockOutput(blockDef)` / `ctx.getBlockResult(blockDef)` for explicit output dependencies, and `ctx.wasRescued(name | blockDef)` to ask whether a prior block in the current sequencer scope was recovered by a `.rescue()` handler (transient, per-iteration under loops; returns `false` when not rescued or not found). See [Composing blocks → Querying rescue status](https://flow-state.dev/docs/sequencers/composing-blocks).

**The `client` block is the data policy.** Each scope's `client` block declares what crosses to the browser — `expose` for verbatim fields, `derived` for projections. State, resources, and intermediate values stay server-side unless you opt them in. Security by architecture, not by convention.

## Dependencies

- `zod` ^3.24.1

## Scripts

```bash
pnpm --filter @flow-state-dev/core build
pnpm --filter @flow-state-dev/core typecheck
pnpm --filter @flow-state-dev/core test
```

## Architecture reference

- [Blocks](https://flow-state.dev/docs/fundamentals/blocks) — Deep dive into all four block kinds
- [Flows](https://flow-state.dev/docs/fundamentals/flows) — defineFlow, actions, lifecycle hooks
- [Sequencer DSL](https://flow-state.dev/docs/sequencers/overview) — Full method reference for the composition DSL
- [State and Scopes](https://flow-state.dev/docs/fundamentals/state-and-scopes) — Scoped state, atomic operations, CAS
- [Resources](https://flow-state.dev/docs/resources/overview) — Data containers and derived client views


## Custom model adapters (`GeneratorModel`)

A generator's model resolves to a `GeneratorModel` — the adapter contract between the framework and a provider SDK. The required surface is `generate(options)` (one call that may run a multi-step tool loop internally via `maxSteps`) plus the optional `stream(options)`.

Two optional single-step methods let the framework own the tool loop instead (`generateStep(options)` and `streamStep(options)`): each call performs **exactly one provider model call**, receives tools *without* `execute` (the framework runs tool calls itself and feeds results back as messages on the next step), and returns that step's assistant turn. Adapters can also surface the step's raw provider response messages on the result (`responseMessages`) so reasoning/thinking content round-trips verbatim between steps. The built-in AI-SDK adapter implements both; when a model lacks them (a hand-rolled test mock, an older adapter), generators fall back to the SDK-driven loop automatically. A fallback model group (`generator({ model: [...] })`) forwards the step methods per candidate, so a fallback-backed generator also drives the framework-owned loop and can suspend inside it. One v1 caveat: fallback instances are cached and shared across concurrent requests, so a candidate switch mid-loop (after a transient failure) is per-call rather than pinned for the whole loop — a switched candidate can receive the previous candidate's accumulated turn history, which surfaces as a provider error rather than silent corruption. Pin a single model when a run must not switch candidates mid-loop. Implement the step methods in a custom adapter to get framework-owned loop semantics — one model call per step, framework-side tool execution, and durable suspension inside the tool loop, which requires a step-capable model.

Two adapter helpers are shared through `@flow-state-dev/core/helpers`: `sanitizeToolName` (provider-safe tool names) and `computeToolAliases` (the sanitize-then-dedupe pass that keeps two colliding tool names distinct in the model-facing dictionary — the generator pre-applies it, so adapters see stable, unique names).

## Model intents

Generators reference a model with a string. The string can be:

- `provider/model` — direct, e.g., `"anthropic/claude-sonnet-4-6"`
- `gateway/provider/model` — routed through a gateway, e.g., `"vercel/openai/gpt-5.5"`
- `intent/<name>` — a named routing group resolved by the model resolver

Configure intents on the resolver. Each intent maps a name to an ordered list of candidate model strings. Resolution walks the list, filters to providers the app has keys for, and falls back to `defaultModel` when nothing in the intent is reachable.

```ts
import { createModelResolver } from "@flow-state-dev/core/models";

const resolver = createModelResolver({
  defaultModel: "anthropic/claude-sonnet-4-6",
  intents: {
    utility: ["anthropic/claude-haiku-4-5", "openai/gpt-5.4-nano"],
    chat: ["anthropic/claude-sonnet-4-6", "openai/gpt-5.5"],
    synthesize: ["anthropic/claude-sonnet-4-6", "openai/gpt-5.5"],
  },
});
```

The framework documents six canonical intent names — `utility`, `chat`, `plan`, `synthesize`, `code`, `reason` — but apps can add their own. `synthesize` doubles as the structured-JSON intent: point it at JSON-reliable models, not the cheapest tier.

Provider preference (the "prefer Anthropic when available" axis) uses the option name `preferProvider` everywhere it appears: `selectModel({ preferProvider })`, `provider("group", { preferProvider })`, and per-call `resolver(modelString, blockName, { preferProvider })`. The earlier `prefer` name is removed.

### Per-intent defaults

Configure `providerOptions` (e.g. Anthropic thinking) per intent so generators don't have to set them at each call site:

```ts
const resolver = createModelResolver({
  defaultModel: "openai/gpt-5.4",
  intents: { plan: ["anthropic/claude-opus-4-7"] },
  intentDefaults: {
    plan: {
      providerOptions: {
        anthropic: { thinking: { type: "enabled", budgetTokens: 16000 } },
      },
    },
  },
});
```

Generator-level `providerOptions` wins on key collisions. Provider-mismatched keys (e.g. `anthropic.*` when an OpenAI candidate resolves) are dropped silently. Intent defaults don't apply when an intent falls through to `defaultModel`.

### Env-var overrides

Env vars can replace which model a declared intent (or `defaultModel`) resolves to per environment, without editing code. The motivating case is running real LLMs cheaply in dev or CI.

- `FSDEV_INTENT_<NAME>` — replace the candidate list for intent `<name>`. `<NAME>` is the intent name uppercased with hyphens replaced by underscores (`my-custom` → `FSDEV_INTENT_MY_CUSTOM`).
- `FSDEV_DEFAULT_MODEL` — replace `defaultModel`. Useful when an intent falls through.

Each value is a `provider/model` or `gateway/provider/model` string. `intent/*` and `preset/*` are rejected. Vars are read once at construction; setting them after the resolver is built has no effect.

```bash
# .env.local
FSDEV_INTENT_CHAT=openai/gpt-5.4-mini
FSDEV_DEFAULT_MODEL=openai/gpt-5.4-mini
```

Invalid values (an `intent/*`/`preset/*` string, or an empty value) for a declared intent throw at construction. An `FSDEV_INTENT_*` that names an intent the resolver doesn't declare is **warned-and-skipped, not fatal** — env vars are ambient, and an app must not crash because a shared/CI environment pins an intent var for some *other* app. (A typo in an intent the app *does* declare still surfaces as a warning.) `FSDEV_DEFAULT_MODEL` set with no declared intents still throws, since the override would have no effect. Each applied or ignored override emits one dev-only `console.warn` (suppressed by `NODE_ENV=production` and `FSD_QUIET_WARNINGS=1`). Tests can pass an explicit `env` option to `createModelResolver` to avoid mutating `process.env`.

See the [models page](https://flow-state.dev/docs/fundamentals/models#env-var-overrides) for the failure-mode taxonomy.

### Observable model identity

Every item produced by a generator carries a `model: ModelIdentity` field, and the unified `BlockTraceItem` for generator blocks gains a top-level `model` field with the same shape. `ModelIdentity = { actual: string; requested?: string; gateway?: string }` answers "which concrete model produced this?" — distinct from `BlockTraceItem.generator.model` (the requested string) and `BlockTraceItem.modelUsage.model` (the token-accounting key). `actual` is always populated; `requested` appears when it differs from `actual` (intent strings, fallback to a non-first candidate, provider substitution); `gateway` appears when the call routed through a gateway. Handler-emitted items do not carry the field. See the [streaming items reference](https://flow-state.dev/docs/streaming/items) for the full surface.

### Strict-mode schema helpers

`makeSchemaStrict(schema)` is exported from the package root. It returns a copy of a Zod schema with `optional` / `default` / `nullable` wrappers unwrapped so the JSON schema sent to OpenAI's structured-output strict mode has every property in `required`. The framework calls it internally before handing schemas to the AI SDK.

```ts
import { makeSchemaStrict } from "@flow-state-dev/core";

const strict = makeSchemaStrict(myGeneratorOutputSchema);
// strict.parse({...}) still works the same. The transform only matters
// when the schema is serialized to JSON schema for the LLM provider.
```

The transform does NOT rewrite `z.record()` or `z.union()` of differently-shaped variants — both still fail OpenAI strict mode and must be fixed in the source schema (array-of-pairs for dynamic keys, a single nullable shape or split generators for unions). `assertStrictCompatible(schema, label?)` detects those eagerly: it runs the transform and throws a `StrictSchemaError` (carrying `.violations` with the offending path) if any survive.

```ts
import { assertStrictCompatible } from "@flow-state-dev/core";

// Passes — array-of-pairs for dynamic keys.
assertStrictCompatible(z.object({ pairs: z.array(z.object({ key: z.string(), value: z.string() })) }));

// Throws StrictSchemaError: "$.metrics: ZodRecord: additionalProperties=true …"
assertStrictCompatible(z.object({ metrics: z.record(z.string(), z.number()) }));
```

`generator()` calls `assertStrictCompatible` automatically at definition when an `outputSchema` is set, so a bad output schema fails at import — not on the first live model call. Call it directly only to assert a bare schema constant in a test. See BP-016 in `docs/contributing/best-practices.md`.

## Token and Cost Adapters

Core exports:
- `ModelLookupEntry`, `DEFAULT_MODEL_LOOKUP`, and `findModelEntry(model, lookup?)`
- `createEstimateTokenCounter(lookup?)` and `estimateTokenCounter`
- `createTiktokenCounter(tiktokenModule)`
- `modelPricingEstimator(lookup?)`

Use a shared lookup table to keep token-ratio and pricing resolution consistent across counters and cost estimation.


## Errors

`FlowError` is a small `Error` subclass author code can throw to attach a machine-readable `code`, a `retryable` flag (default `false`), and an open `details` payload. The runtime preserves these end-to-end so the DevTool can render structured failure context without re-running the flow.

`OutputValidationError` is the runtime-emitted subclass thrown by the generator runtime when the model's output fails `outputSchema`. It populates `details` with `rawOutput`, `issues`, and `phase` so a validation failure carries the raw model text and the Zod issues into the trace automatically.

See [Error handling](https://flow-state.dev/docs/advanced/error-handling) for usage patterns.


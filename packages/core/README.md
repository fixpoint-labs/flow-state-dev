# @flow-state-dev/core

**The building blocks. Define handlers, generators, sequencers, routers, and flows — all with end-to-end type safety.**

This is the foundation package. Every other package depends on it. It's isomorphic — runs in Node, the browser, edge runtimes, anywhere JavaScript runs.

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
  agentType: "primary",
});
```

The `prompt` (and `user`) slots can also be authored in a separate `.md` file with YAML frontmatter and a LiquidJS body. Load it with `loadPromptFile(...)` and spread `definePromptFile(pf)` into the generator config. See the [Prompts as Markdown](../../apps/docs/docs/advanced/generator-prompts-markdown.md) reference.

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
  session: {
    stateSchema: z.object({ mode: z.string().default("chat"), count: z.number().default(0) }),
    resources: { artifacts: { stateSchema: artifactSchema, writable: true } },
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
- `generator(config)` — LLM call with framework-managed tool loop, streaming, and structured output repair
- `sequencer(config)` — Fluent composition DSL (21 methods: `step`, `stepIf`, `parallel`, `forEach`, `forEachBackground`, `doUntil`, `doWhile`, `map`, `tap`, `tapIf`, `rescue`, `branch`, `work`, `workIf`, `waitForWork`, `waitForCondition`, `loopBack`, `stepAll`, `stepAny`, `race`, `exitIf`)
- `router(config)` — Runtime block selection from declared routes

**Block methods** (available on every `BlockDefinition`):
- `.connectInput(mapper)` — adapt input shape at the call boundary
- `.connectOutput(mapper)` — transform output shape at the call boundary
- `.mapModelOutput(mapper)` — when the block is used as a generator tool, supply a model-visible string representation of its output
- `.asTool(opts?)` — wrap the block so it emits a `tool_output` item when run from a sequencer step (same envelope and lifecycle as the AI SDK tool-loop path)

**Background work lifetime:** `.work()`, `.workIf()`, and `.forEachBackground()` queue tasks on a per-request pool, not the sequencer that dispatched them. Inner sequencers do not auto-await their own background work before returning; sibling sequencers run their tasks concurrently. The request executor drains the pool exactly once before terminal status. Use `.waitForWork()` when an inner step depends on a queued task completing first — it drains only the calling sequencer's contributions.

**Event-driven waits:** `.waitForCondition(predicate, { timeoutMs, wakeOn? })` suspends the sequencer until a synchronous predicate over the request's item stream returns true (or the timeout fires). Yields `{ timedOut: boolean }`. Use it to coordinate with side-channel state — a worker writing an artifact, a task-board flipping a status, an external actor resuming a paused review. Predicate helpers ship in `@flow-state-dev/core/items`: `whenResourceChanged({ scope, path, changeType? })`, `whenResourceMatching({ scope, pattern })` (tiny glob with `*` and `**`), and `whenAnyItem(predicate)` as the generic escape hatch. The optional `wakeOn` filter lets high-fanout patterns skip predicate re-evaluation on irrelevant item types; `@flow-state-dev/tasks` ships `onTaskChangeFor(collectionId)` for collection-bound waiters.

**Flow:**
- `defineFlow(definition)` — Create a flow type with actions, scopes, resources, and per-scope `client` blocks

**Utility block factories (`utility.*`):**
- `utility.contextReducer(config)` — Generator factory for `distill`, `denoise`, or `compress` context transformation modes with mode-specific default output schemas (`{ distilled, keyPoints }`, `{ cleaned, removedCategories? }`, `{ compressed, compressionRatio?, dropped? }`)
- `utility.summarizer(config)` — Generator factory for brief, detailed, or executive summaries with optional focus `objectives` and a default `{ summary, keyPoints? }` output contract
- `utility.composer(config)` — Generator factory that assembles coherent artifacts from structured parts/constraints with a default `{ composed, structure? }` output contract
- `utility.decomposer(config)` — Generator factory that breaks broad requests into executable tasks using a default `{ tasks: [{ id, goal, deps?, priority? }] }` output contract
- `utility.analyzer(config)` — Generator factory for artifact critique/evaluation with configurable `criteria` and a default `{ findings, score?, recommendation? }` output contract
- `utility.synthesizer(config)` — Generator factory that reconciles overlapping or conflicting artifacts into a unified output with default `{ synthesis, rationale }` output contract
- `utility.combiner(config)` — Handler factory for deterministic artifact merging via concatenation, deduplication, and structural normalization with default `{ combined, mergeNotes? }` output
- `utility.intentClassifier(config)` — Generator factory for bounded intent classification with required category descriptions and default `{ category, confidence, reasoning? }` output contract
- `utility.intentRouter(config)` — Sequencer factory that composes `intentClassifier` + `router` into classification-driven branching with category descriptions, handlers, optional `confidenceThreshold`, and optional fallback routing
- `utility.keyedRouter(config)` — Router factory for the "pick a block from a `Record<string, Block>` by string key" case. Throws with the registered keys (or routes to `fallback`) when the selected key is unregistered. Input adaptation belongs on the routed blocks via `.connectInput` (BP-013)
- `utility.memoryExtractor(config)` — Generator factory for stateless durable-memory extraction with a default `{ memories: Array<{ type, content, confidence?, source? }> }` output contract (`type` ∈ `fact | preference | constraint | decision`)

Every generator-based utility above accepts an optional `agentType` (`"primary" | "sub" | "trace"`) to control whether output is surfaced to the client/history. `synthesizer` defaults to `"primary"`; all others default to unset (silent — output flows only via graph edges). Set explicitly to opt in when the utility should be user-facing.

**Resources:**
- `defineResource(config)` — Portable resource definition (also usable for block-level resource declarations via `sessionResources`, `userResources`, `orgResources`)
  - Supports optional `content`/`contentFile` (mutually exclusive), `render`, `llmReadable`, and `llmWritable` for resource content workflows
  - `prefetchMode?: 'eager' | 'lazy'` (default `'eager'`) — `'lazy'` defers the load until the declaring block dispatches. Once the resource is resolved its `ref.state` getter is synchronous. Declaring `'lazy'` on a flow-level single resource throws at build time (no per-block load trigger).
- `defineResourceNamespace(config)` — Dynamic resource collection with pattern-based keys (`files/*`, `files/**`, `[topic]/observations`), optional `maxInstances`/`eviction`, and lifecycle hooks
  - `prefetchMode?: 'eager' | 'lazy'` (default `'eager'`) — a loading-cost knob, not an API-shape knob. Eager preloads the whole prefix into a per-request cache so reads resolve instantly; `'lazy'` reads per access from the store. The call shape is identical in both modes: `get`/`getOptional`/`list`/`count` all return Promises (always `await` them), and the mutations `create`/`getOrCreate`/`upsert`/`delete` were already async. Flipping `prefetchMode` needs no call-site changes. `'lazy'` requires `eviction: 'none'` (a partial cache can't drive eviction) and throws at build time otherwise.
  - Runtime `ResourceNamespaceRef` provides `create()`, `get()`, `getOrCreate()`, `upsert()`, `list()`, `delete()`, `count()`
  - **`create(key, initial, { replace: true })`** — overwrites an existing instance instead of throwing. `setState` semantics; Zod `.default(null)` fills nullables on both the create and replace branches. `maxInstances` only checked when adding a new instance. Use for setup/reset paths.
  - **`upsert(key, update, createOnly?)`** — patch-or-create. On exists: applies `update` via `patchState` semantics (other fields preserved). On missing: creates with `{ ...createOnly, ...update }` (update wins on overlap). The `createOnly` extras fill fields you only need to supply at creation time. Use for incremental-update paths that need to handle first-touch in a single call.
  - "If-exists / if-missing" summary: `create` throws / `create({ replace })` replaces / `getOrCreate` returns as-is / `upsert` patches — all four create on missing.
- `isDefinedResourceNamespace(value)` — Type guard for namespace definitions

**Capabilities:**
- `defineCapability(config)` — Bundle resources, state schemas, targets, and helper functions under a single name. Blocks declare capabilities via `uses: [cap]` and the framework merges everything transitively.
  - `fns: (ctx) => ({ ... })` — Helper functions exposed at `ctx.cap.{name}.{fn}`, memoized on first access
  - `presets` — Named opt-in/opt-out bundles of any block config surface. Use `.presets({ name: true/false })` to configure
  - `uses` — Capabilities can depend on other capabilities (transitive composition with diamond dedup)
  - Factory pattern: wrap `defineCapability()` in a function for parameterized capabilities

**Capability schema forwarding:**

When a block lists a capability in `uses`, the capability's declared schemas flow into the block's `ctx` types at factory time. No re-declaration on the block is needed. The four forwarded axes are `sessionStateSchema`, `sessionResources` (resource handles), `targetStateSchemas`, and `sequencerStateSchema` (from presets). Block-own declarations merge in; the block wins on key collision.

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
- See [Flow policy](https://flow-state.dev/docs/patterns/flow-policy) for the full guide, including when to mark a tool cacheable and how Task Board auto-installs the capability.

**Context & client data:**
- `contextFn(schemas, fn)` — Typed context function for generators (scope-aware, portable)
- `client` on scope configs — Per-scope client view: `expose: string[]` (verbatim passthrough by field name) and `derived: { name: fn }` (compute functions receive `{ state, resources }`). State without a `client` block is private. `clientData` is the previous name for `client.derived` and is deprecated.

**Prompt formatters** (`@flow-state-dev/core/prompt`):
- `section`, `list`, `keyValues`, `entries`, `codeBlock`, `join`, `when` — Composable text formatters for building clean LLM context
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

Keys may be authored as `camelCase`, `snake_case`, or `kebab-case` (all normalize to kebab-case). Values may be strings, string arrays, nested objects (recursive — produces nested tags), functions resolved at render time, or `null` placeholders that reserve order but emit nothing if unfilled. String leaves are HTML-escaped so `<` / `>` / `&` in user data don't get read as tags. The original array form is unchanged. See `docs/architecture/blocks.md` for the full contract.

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

### Prompt files (`@flow-state-dev/core/prompt-file`, `@flow-state-dev/core/prompt-file/node`)

Author a generator's prompt as a `.md` file. The isomorphic subpath exports `parsePromptFile(text, options?)`, `definePromptFile(pf)`, `isPromptFile(value)`, and the `PromptFile` / `PromptFileConfig` / `PromptFileParseError` / `PromptFileLoadError` types. The Node-only subpath exports `loadPromptFile(specifier, importerUrl, options?)`, which reads the file and auto-registers sibling `.md` files as partials; only this subpath imports `node:fs`, so browser/bundled consumers use `parsePromptFile` with raw text plus an explicit `partials` map.

Two ergonomic shortcuts cut the boilerplate:

- **Pass the `PromptFile` straight to `prompt`** instead of spreading `definePromptFile(pf)`. `generator({ prompt: loadPromptFile(...), model })` expands the file's `user` / `caching` / `maxTokens` / `temperature` / `name` / `description` into the config; any sibling field you set explicitly wins (same precedence as `...definePromptFile(pf), <overrides>`).
- **`createPromptLoader(baseDir, options?)`** (Node subpath) captures an absolute `baseDir` plus shared `partialsDir` / `filters` once and returns a `load(relPath)` function, so call sites drop the repeated `import.meta.url` argument. Per-call `filters` merge over the loader's shared filters.

```ts
import { generator } from "@flow-state-dev/core";
import { createPromptLoader } from "@flow-state-dev/core/prompt-file/node";

const load = createPromptLoader(path.resolve(process.cwd(), "src/prompts"));
const analyst = generator({ name: "analyst", model, prompt: load("analyst.prompt.md") });
```

### Types (`@flow-state-dev/core/types`)

Block, flow, resource, scope, streaming, and model type definitions. Use this subpath for type-only imports.

`defineResourceCollection` accepts a `prefetchWindow?: number` (default `0`) that inlines the first N items in the snapshot's `prefetched` window in lexicographic storage-key order. Per-item `clientData` in the window appears only when `client.state.read: true` is also set. `CollectionStateClientConfig` controls per-item state visibility separately from content; single resources don't accept `client.state` (state visibility is governed by `client.data` on those).

### Items (`@flow-state-dev/core/items`)

Output item unions, content types, and stream event helpers. Item types: `message`, `reasoning`, `component`, `container`, `tool_output`, `status`, `source`, `state_change`, `resource_change`, `error`.

**`BlockValue<T>`** — `block_output.output` is a discriminated union (FIX-413) with three cases: `inline` (novel content on the emitter), `ref` (pointer to another item's content), and `structure` (container of nested BlockValues, used by aggregators like `.stepAll`). Use `resolveBlockValue(value, lookup)` to recover the typed payload `T`; `ctx.getBlockOutput()` resolves transparently. Since FIX-480, refs may also point at `MessageItem`s — streaming-text generators emit a ref to their just-emitted message instead of duplicating the text inline. `buildItemLookup(items)` indexes every item by id so the resolver can follow either kind of ref.

### Helpers (`@flow-state-dev/core/helpers`)

State-shape primitives shared across the framework. All three operate on the same JSON-serializable state trees, so they live together as the single canonical home — no per-package copies.

- **`cloneValue(value)`** — structural deep copy via the platform `structuredClone`, falling back to a JSON round-trip. Stores clone records on read/write so callers can't mutate stored state through a retained reference.
- **`deepMerge(base, override)`** — recursive merge returning a new object. Scalars and arrays in `override` replace; nested plain objects merge; `base` is never mutated.
- **`deepEqual(a, b)`** — structural equality powering the state-write no-op guard. Primitives compared by `Object.is` (NaN-equal-NaN, `+0 != -0`); plain objects and arrays compared recursively. Rejects non-JSON shapes (Map, Set, functions) with a `TypeError`. `looseDeepEqual` is the throw-free variant.

## Sequencer instance state

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

**No-op write guard.** A state-write helper that produces a value structurally equal to the current state is suppressed: no persist call, no `state_change` SSE item, and the helper returns `false` instead of `true`. Idempotent writes are now free — callers no longer need to guard with manual identity checks. The comparison uses `Object.is` for primitives (NaN-equal-NaN; `+0 != -0`) and recursive structural equality for plain objects and arrays.

**Transient slots.** `transientSlot()` marks a top-level field on `stateSchema` as in-memory only. Transient slots:

- Hold their value across a sequencer's run, readable by later steps via `ctx.sequencer.state`.
- Do **not** emit `state_change` items on the SSE stream.
- Do **not** appear in `state_snapshot` payloads, so they never enter the durable checkpoint store and reset to their schema default on resume.

Apply `transientSlot()` LAST in the schema chain — after `.optional()`, `.default()`, etc. — so the marker sits on the outermost schema instance referenced by the parent `z.object` shape.

## Key design decisions

**Partial state schemas.** Each block declares only the state fields it touches. A counter block doesn't need to know about a preferences block's state. This keeps blocks reusable and self-documenting about their dependencies.

**Silent by default.** Blocks emit nothing to the client unless they explicitly call `ctx.emitMessage()`, `ctx.emitComponent()`, or `ctx.emitStatus()` — or declare `activeStatusMessage` on the block config, which fires `emitStatus` automatically at block start. Generators are the exception — they auto-emit messages and reasoning. This gives you precise control over what the user sees.

**Request-scoped status slot.** `emitStatus` writes to a single request-scoped slot — the latest message wins. Clients render one in-flight indicator line, falling back to "Working..." when the slot is empty. See `docs/architecture/items.md` for the full semantics.

**Automatic resource collection.** Blocks declare their resource dependencies via `sessionResources`/`userResources`/`orgResources` using `defineResource()` values. Sequencers collect these from child blocks. `defineFlow` merges them into the flow's scope configs automatically — blocks bring their own resource requirements, just like partial state schemas. Flow-level declarations take priority.

**Resource content handles.** `ResourceRef.readContent()` returns rendered text or `null`; `readContentRaw()` returns raw text or `null`; `writeContent()` overwrites content when writable.

**LLM content tools are explicit.** Use `readResourceContentTool()` / `writeResourceContentTool()` in a generator's `tools` array when you want LLM access. These are not auto-injected.

**Prompt caching is on by default.** Generators accept a `caching` field; the default is `{ enabled: true, breakpoints: 'auto', ttl: '5m' }`. The AI SDK adapter stamps `providerOptions.anthropic.cacheControl` on the last system message for Anthropic-flavored providers (and opts the Vercel AI Gateway into `caching: 'auto'`); OpenAI / Google / DeepSeek cache implicitly and are left alone. Cache token counts land on `GeneratorModelUsage` as `cacheCreationInputTokens` and `cacheReadInputTokens`. See `docs/PROMPT_CACHING.md` for the full design, audit, and manual-mode guide.

**Typed target state declarations.** Handler, generator, and router blocks can declare `targetStateSchemas` with Zod schemas. Declared names type `ctx.targets.<name>` as `StateRef<...> | undefined` for state coordination. Use `ctx.getBlockOutput(blockDef)` / `ctx.getBlockResult(blockDef)` for explicit output dependencies, and `ctx.wasRescued(name | blockDef)` to ask whether a prior block in the current sequencer scope was recovered by a `.rescue()` handler (transient, per-iteration under loops; returns `false` when not rescued or not found). See [Composing blocks → Querying rescue status](../../apps/docs/docs/sequencers/composing-blocks.md).

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

- [Blocks](../../docs/architecture/blocks.md) — Deep dive into all four block kinds
- [Flows and Actions](../../docs/architecture/flows-and-actions.md) — defineFlow, actions, lifecycle hooks
- [Sequencer DSL](../../docs/architecture/sequencer-dsl.md) — Full method reference for the composition DSL
- [State and Scopes](../../docs/architecture/state-and-scopes.md) — Scoped state, atomic operations, CAS
- [Resources and Client Data](../../docs/architecture/resources-and-client-data.md) — Data containers and derived client views


## Model intents

Generators reference a model with a string. The string can be:

- `provider/model` — direct, e.g., `"anthropic/claude-sonnet-4.6"`
- `gateway/provider/model` — routed through a gateway, e.g., `"vercel/openai/gpt-5.5"`
- `intent/<name>` — a named routing group resolved by the model resolver

Configure intents on the resolver. Each intent maps a name to an ordered list of candidate model strings. Resolution walks the list, filters to providers the app has keys for, and falls back to `defaultModel` when nothing in the intent is reachable.

```ts
import { createModelResolver } from "@flow-state-dev/core/models";

const resolver = createModelResolver({
  defaultModel: "anthropic/claude-sonnet-4.6",
  intents: {
    utility: ["anthropic/claude-haiku-4.5", "openai/gpt-5.5-nano"],
    chat: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.5"],
    synthesize: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.5"],
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
  intents: { plan: ["anthropic/claude-opus-4.7"] },
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

Invalid values, unknown intent names, and an `FSDEV_INTENT_*` without a matching declared intent throw at construction. Each applied override emits one dev-only `console.warn` (suppressed by `NODE_ENV=production` and `FSD_QUIET_WARNINGS=1`) so you can confirm the override took effect. Tests can pass an explicit `env` option to `createModelResolver` to avoid mutating `process.env`.

See the [models page](https://flow-state.dev/docs/fundamentals/models#env-var-overrides) for the failure-mode taxonomy.

### Observable model identity

Every item produced by a generator carries a `model: ModelIdentity` field, and the unified `BlockTraceItem` for generator blocks gains a top-level `model` field with the same shape. `ModelIdentity = { actual: string; requested?: string; gateway?: string }` answers "which concrete model produced this?" — distinct from `BlockTraceItem.generator.model` (the requested string) and `BlockTraceItem.modelUsage.model` (the token-accounting key). `actual` is always populated; `requested` appears when it differs from `actual` (intent strings, fallback to a non-first candidate, provider substitution); `gateway` appears when the call routed through a gateway. Handler-emitted items do not carry the field. See `apps/docs/docs/streaming/items.md` for the full surface.

### Strict-mode schema helper

`makeSchemaStrict(schema)` is exported from the package root. It returns a copy of a Zod schema with `optional` / `default` / `nullable` wrappers unwrapped so the JSON schema sent to OpenAI's structured-output strict mode has every property in `required`. The framework calls it internally before handing schemas to the AI SDK; the public export is for authors who want to assert their generator output schemas pass strict mode at test time. See BP-016 in `docs/contributing/best-practices.md`.

```ts
import { makeSchemaStrict } from "@flow-state-dev/core";

const strict = makeSchemaStrict(myGeneratorOutputSchema);
// strict.parse({...}) still works the same. The transform only matters
// when the schema is serialized to JSON schema for the LLM provider.
```

Note: the helper does NOT transform `z.record()` or `z.union()` of differently-shaped variants — both still fail OpenAI strict and must be rewritten in the source schema. See BP-016 for the rules and the canonical patterns.

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


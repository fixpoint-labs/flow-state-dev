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
  model: "preset/fast",
  prompt: "You are a helpful assistant.",
  inputSchema: z.object({ message: z.string() }),
  history: true,
  user: (input) => input.message,
  tools: [readDoc, writeDoc],
  agentType: "primary",
});
```

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
  .then(analyzeInput)
  .thenIf((result) => result.needsContext, enrichWithContext)
  .then(agent)
  .then(counter)
  .rescue([{ when: [ModelError], block: fallback }]);
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
    clientData: {
      artifactsList: (ctx) => /* derive list from resource state */,
    },
  },
})({ id: "default" });
```

## Exports

### Main (`@flow-state-dev/core`)

**Block builders:**
- `handler(config)` — Synchronous/async logic block
- `generator(config)` — LLM call with framework-managed tool loop, streaming, and structured output repair
- `sequencer(config)` — Fluent composition DSL (21 methods: `then`, `thenIf`, `parallel`, `forEach`, `forEachBackground`, `doUntil`, `doWhile`, `map`, `tap`, `tapIf`, `rescue`, `branch`, `work`, `workIf`, `background`, `waitForWork`, `loopBack`, `thenAll`, `thenAny`, `race`, `exitIf`)
- `router(config)` — Runtime block selection from declared routes

**Flow:**
- `defineFlow(definition)` — Create a flow type with actions, scopes, resources, and clientData

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
- `utility.memoryExtractor(config)` — Generator factory for stateless durable-memory extraction with a default `{ memories: Array<{ type, content, confidence?, source? }> }` output contract (`type` ∈ `fact | preference | constraint | decision`)

Every generator-based utility above accepts an optional `agentType` (`"primary" | "sub" | "trace"`) to control whether output is surfaced to the client/history. `synthesizer` defaults to `"primary"`; all others default to unset (silent — output flows only via graph edges). Set explicitly to opt in when the utility should be user-facing.

**Resources:**
- `defineResource(config)` — Portable resource definition (also usable for block-level resource declarations via `sessionResources`, `userResources`, `orgResources`)
  - Supports optional `content`/`contentFile` (mutually exclusive), `render`, `llmReadable`, and `llmWritable` for resource content workflows
- `defineResourceNamespace(config)` — Dynamic resource collection with pattern-based keys (`files/*`, `files/**`, `[topic]/observations`), optional `maxInstances`/`eviction`, and lifecycle hooks
  - Runtime `ResourceNamespaceRef` provides `create()`, `get()`, `getOrCreate()`, `list()`, `delete()`, `count()`
- `isDefinedResourceNamespace(value)` — Type guard for namespace definitions

**Capabilities:**
- `defineCapability(config)` — Bundle resources, state schemas, targets, and helper functions under a single name. Blocks declare capabilities via `uses: [cap]` and the framework merges everything transitively.
  - `fns: (ctx) => ({ ... })` — Helper functions exposed at `ctx.cap.{name}.{fn}`, memoized on first access
  - `presets` — Named opt-in/opt-out bundles of any block config surface. Use `.presets({ name: true/false })` to configure
  - `uses` — Capabilities can depend on other capabilities (transitive composition with diamond dedup)
  - Factory pattern: wrap `defineCapability()` in a function for parameterized capabilities

**Context & client data:**
- `contextFn(schemas, fn)` — Typed context function for generators (scope-aware, portable)
- `clientData` on scope configs — Derived values exposed to clients (compute functions receive `{ state, resources }`)

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

**Type helpers:**
- `StateOf<T>` — Extract state type from schema or resource
- `ContextOf<T, Kind>` — Get context handle type for scope/resource
- `ResourceContext<T>` — Resource context type
- `BlockInput<T>` / `BlockOutput<T>` — Infer block I/O types

### Types (`@flow-state-dev/core/types`)

Block, flow, resource, scope, streaming, and model type definitions. Use this subpath for type-only imports.

### Items (`@flow-state-dev/core/items`)

Output item unions, content types, and stream event helpers. Item types: `message`, `reasoning`, `component`, `context`, `status`, `state_change`, `resource_change`, `block_output`, `error`, `step_error`.

**`BlockValue<T>`** — `block_output.output` is a discriminated union (FIX-413) with three cases: `inline` (novel content on the emitter), `ref` (pointer to another item's content), and `structure` (container of nested BlockValues, used by aggregators like `.thenAll`). Use `resolveBlockValue(value, lookup)` to recover the typed payload `T`; `ctx.getBlockOutput()` resolves transparently. Since FIX-480, refs may also point at `MessageItem`s — streaming-text generators emit a ref to their just-emitted message instead of duplicating the text inline. `buildItemLookup(items)` indexes every item by id so the resolver can follow either kind of ref.

## Key design decisions

**Partial state schemas.** Each block declares only the state fields it touches. A counter block doesn't need to know about a preferences block's state. This keeps blocks reusable and self-documenting about their dependencies.

**Silent by default.** Blocks emit nothing to the client unless they explicitly call `ctx.emitMessage()`, `ctx.emitComponent()`, or `ctx.emitStatus()` — or declare `activeStatusMessage` on the block config, which fires `emitStatus` automatically at block start. Generators are the exception — they auto-emit messages and reasoning. This gives you precise control over what the user sees.

**Request-scoped status slot.** `emitStatus` writes to a single request-scoped slot — the latest message wins. Clients render one in-flight indicator line, falling back to "Thinking..." when the slot is empty. See `docs/architecture/items.md` for the full semantics.

**Automatic resource collection.** Blocks declare their resource dependencies via `sessionResources`/`userResources`/`orgResources` using `defineResource()` values. Sequencers collect these from child blocks. `defineFlow` merges them into the flow's scope configs automatically — blocks bring their own resource requirements, just like partial state schemas. Flow-level declarations take priority.

**Resource content handles.** `ResourceRef.readContent()` returns rendered text or `null`; `readContentRaw()` returns raw text or `null`; `writeContent()` overwrites content when writable.

**LLM content tools are explicit.** Use `readResourceContentTool()` / `writeResourceContentTool()` in a generator's `tools` array when you want LLM access. These are not auto-injected.

**Prompt caching is on by default.** Generators accept a `caching` field; the default is `{ enabled: true, breakpoints: 'auto', ttl: '5m' }`. The AI SDK adapter stamps `providerOptions.anthropic.cacheControl` on the last system message for Anthropic-flavored providers (and opts the Vercel AI Gateway into `caching: 'auto'`); OpenAI / Google / DeepSeek cache implicitly and are left alone. Cache token counts land on `GeneratorModelUsage` as `cacheCreationInputTokens` and `cacheReadInputTokens`. See `docs/PROMPT_CACHING.md` for the full design, audit, and manual-mode guide.

**Typed target state declarations.** Handler, generator, and router blocks can declare `targetStateSchemas` with Zod schemas. Declared names type `ctx.targets.<name>` as `StateRef<...> | undefined` for state coordination. Use `ctx.getBlockOutput(blockDef)` / `ctx.getBlockResult(blockDef)` for explicit output dependencies.

**clientData as data policy.** `clientData` is how you expose derived state to clients. Internal state, resources, and intermediate values stay server-side unless you deliberately define a clientData compute function. Security by architecture, not by convention.

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


## Token and Cost Adapters

Core exports:
- `ModelLookupEntry`, `DEFAULT_MODEL_LOOKUP`, and `findModelEntry(model, lookup?)`
- `createEstimateTokenCounter(lookup?)` and `estimateTokenCounter`
- `createTiktokenCounter(tiktokenModule)`
- `modelPricingEstimator(lookup?)`

Use a shared lookup table to keep token-ratio and pricing resolution consistent across counters and cost estimation.


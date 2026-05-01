# `@flow-state-dev/core` — first-principles review

Scope: `/home/user/flow-state-dev/packages/core/src/`. Total non-test lines: ~17,200 across 84 source files. Stated mission per the package map: "Isomorphic builders, type contracts, item taxonomy."

This review is unsentimental. The package is doing real work, but it has at least 35–40% bloat that comes from three sources: (1) a sequencer DSL whose method count expanded faster than its op kernel, (2) two duplicated copies of every utility block (`macro/` vs `utility/`), and (3) a model-resolution subsystem that does not belong in an isomorphic builder package.

## 1. Overall size and surface area

Line totals by directory:

| Dir | LOC | Role |
|-----|-----|------|
| `blocks/` (incl. `internal/`) | 5,378 | Builder factories + sequencer DSL |
| `models/` | 3,113 | Vercel AI SDK adapter, provider detection, fallback, caching |
| `types/` | 2,760 | Public type contracts |
| `utility/` | 1,187 | Utility block factories |
| `items/` | 881 | Item taxonomy + events + visibility resolution |
| `capability/` | 833 | `defineCapability`, merge, presets |
| `macro/` | 814 | **Duplicate of `utility/`** (with stale variants) |
| `flow/` | 444 | `defineFlow` |
| `prompt/` | 440 | XML rendering for context |
| `utils/` | 314 | `deepEqual`, `deepMerge`, transient slots, string case |
| `tools/` | 313 | Resource CRUD tool blocks |
| `schema/` | 209 | Zod introspection for action UIs |
| `adapters/` | 159 | Token counters / model lookup |

Type vs runtime split is roughly **30% types, 70% runtime**, which is on its own fine. The problem is which runtime: 18% of the package (`models/`) is provider plumbing that has nothing to do with builders or contracts. Strip `models/` out and the package is closer to 14k LOC — still large for what's billed as "isomorphic builders."

The README says "isomorphic." `models/createAiSdkModelResolver.ts` (821 lines) directly imports the `ai` SDK. That is fine on the server and the browser, but it ties every consumer to the `ai` runtime even when they only want the type contracts. The "isomorphic" claim sits awkwardly with this.

**Two single files dominate:**
- `blocks/sequencer.ts` — 1,934 LOC
- `blocks/generator.ts` — 1,809 LOC

These two files are 21.7% of the package on their own.

## 2. Block builder code

The four block kinds share `blocks/internal/build-block.ts` (239 LOC) which is a fine, lean spine: schema validation, `connectInput`/`connectOutput`, lifecycle hooks, `requiresOrg` bubbling. Each kind then layers a builder on top:

- `handler.ts` (112 LOC). Almost entirely generic-parameter ceremony — the actual factory is ~10 lines (lines 102–112). The generics declaration (lines 16–43, 72–101) takes more room than the runtime. Nothing actually wrong; it is what it costs to give the user inference for state schemas, resources, capabilities, and target schemas. But this same generic block is **copy-pasted** into `router.ts:48–137` and `sequencer-methods.ts:288–324` (config types). Twenty type parameters listed, position-by-position, in three places. If a single helper alias `BlockGenericPack<T>` collected the recurring tuple, three files would lose ~150 LOC of generics-ceremony.

- `router.ts` (281 LOC). Real logic: ~80 lines. The rest is generics + a duplicated "merge resources from routes" pass that overlaps with `resolve-capabilities.ts` because `resolveCapabilities` *also* extracts the router's own resources, and the file then merges them again (router.ts:139–150 has an explicit comment about the harmless double-merge). That is a smell — when the resolved-capability layer is already covering the case, the router shouldn't be re-doing it.

- `generator.ts` (1,809 LOC). This is the legitimate runtime giant. It owns prompt/context resolution, tool compilation, repair policy, retry, source emission, streaming-vs-batch dispatch, and item emission. Some of the bulk (the dynamic-capability surface walker on lines 60–95, the agent-routing helpers, the tool wrap) is justified. But there is also the kind of fan-out you'd expect: `aggregateContextEntries` lives in `context-aggregator.ts` (311 LOC) but the generator still has its own dynamic context walking. The generator is also the only block that materializes `block_output` items itself (lines 1763–1802) — every other kind delegates to `_withExecutionScope`. That asymmetry leaks into `sequencer.ts:478–504` where the sequencer special-cases generator-kind blocks. The two files are coupled by behavior, not just by call signature.

- `sequencer.ts` (1,934 LOC). See §3.

**Leaky abstractions between builders:**
- `sequencer.ts:478–504, 488–503` reach into `block.kind === "generator"` and emit `block_output` themselves on the generator's behalf. The sequencer is pretending to be a generator emitter because the generator can't be trusted to emit when run inside `_withExecutionScope`.
- `router.ts:140–150` reproduces a fragment of capability/resource resolution.
- `sequencer.ts:181–193` hand-rolls a `getEmitterItemCount` helper, with a `Duck-typed helper — reused from generator.ts` comment that confirms the duplication.
- `sequencer.ts:121–135 / router.ts:212–224` both implement "find the most-recent block_output item by instanceId" against a `getItems()` duck-typed response. Same algorithm, two copies, one comment about FIX-413.

Net: the four-kind taxonomy is real and useful, but the trace/streaming protocol is plumbed through these files instead of through a shared emitter helper. Pulling `block_output` emission into `internal/emit-block-output.ts` would remove ~120 lines of duplication and fix the asymmetry that forces the sequencer to special-case generators.

## 3. Sequencer DSL

`blocks/sequencer.ts` is the single largest file (1,934 LOC). The DSL surface declared in `sequencer-methods.ts:84–286` is:

```
then, thenIf, map, parallel, forEach, forEachBackground,
doUntil, doWhile, loopBack, work, background, workIf,
waitForWork, tap, tapIf, rescue, branch, thenAll, thenAny,
race, exitIf, validate, connectInput
```

That is **23 public methods**. With overload counts, `sequencer-methods.ts` declares 47 method signatures.

**Are they composed from a small core?** No. Each method is bespoke. There is a `SequencerOperation` shape (`sequencer.ts:100–108`) with a `run(value, ctx, runtime, stepIndex) => SequencerOpResult`, which would be a fine kernel — but every method builds its own `extend({ name, run })` closure inline, with handcoded path-derivation and descriptor-emission for FIX-413. The path/descriptor handling is identical across `then`, `thenIf`, `tap`, `tapIf`, `branch`, `doUntil`, `doWhile`, `forEach`, `parallel`, `thenAll`, `thenAny`, `race`. Each one calls `childBlockPath`, `executeBlock`, then `refDescriptorForPath`. Twelve methods × ~5 lines × close-to-identical logic.

**Concrete duplication:**
- `then` (sequencer.ts:850–895), `thenIf` (897–964), `tap` (1472–1536), `tapIf` (1538–1585) all have a `Path 1: factory + inlineConfig / Path 2: block / Path 3: connector + block` discriminator built from `arg1/arg2/arg3` argument shifting. This pattern is reimplemented four times. A single `resolveCallShape(args)` helper plus a thin "what to do with the resolved (block, connector)" closure would collapse these to ~30 lines each.
- `work`, `background`, `workIf` are nearly identical fire-and-forget dispatchers (1335–1440). `background` literally calls `definition.work(...)` (1381–1387) — it's a one-line alias declared as a 7-line method. `workIf` differs only in the condition guard prepended to the body.
- `forEach` and `forEachBackground` (1050–1218) duplicate the connector-vs-options arg-shape detection (`hasConnector`/`isConcurrencyOptions`).
- `doUntil` and `doWhile` (1220–1303) differ by 6 lines of the condition placement.
- `thenAll` (1643–1692) and `parallel` (980–1048) compose the same "run children in branchPaths, build a structure descriptor" pipeline; `parallel` keys by object, `thenAll` by index.

**Estimate of what could be deleted:** if the DSL were rebuilt around three primitives — `runChild(block, connector?, path) -> { value, descriptor }`, `runBackground(block, connector?, path) -> Promise<WorkResult>`, and a unified `arg-resolver(args, hasInline)` — the sequencer file is achievable in **600–800 LOC**, not 1,934. That's a ~60% reduction on this file alone.

If the DSL were cut in half (drop `loopBack`, `thenAny`, `race`, `forEachBackground`, `background`, `workIf`, `tapIf`, `doUntil`, `doWhile`, `validate`), the surface becomes 13 methods covering 95% of real usage. `loopBack` in particular is suspicious — a `maxIterations`-bounded jump that targets a step name, when `doUntil`/`doWhile` already cover bounded looping. It's a feature looking for a use case.

`validate()` (sequencer.ts:1859–1889) is dead-code-adjacent: it walks `_def?.typeName` to compare declared vs actual output schema *type names*, which produces false negatives for `ZodEffects`, `ZodOptional`, `ZodDefault`, etc. — i.e., for almost any real Zod schema in production. Deleting it would lose nothing.

## 4. Items system

`items/types.ts` is 376 LOC and defines **15 item types** in `OutputItem`:

`block_output, block_tool_output, router_decision, message, reasoning, component, container, status, state_change, resource_change, error, step_error, source, state_snapshot, block_debug` (+ a `@deprecated context` ghost still in the file at lines 236–239).

This is doing real work. The taxonomy distinguishes:
- conversational items (`message`, `reasoning`, `block_tool_output`) governed by `agentType` for visibility,
- structural / routing items (`block_output`, `router_decision`, `container`),
- live-only signals (`status`, `state_change`, `resource_change`, `state_snapshot`),
- diagnostic items (`error`, `step_error`, `block_debug`),
- provider-native sources (`source`).

The visibility resolver (`items/resolve-visibility.ts`, 53 LOC) and the BlockValue resolver (`items/resolve-value.ts`, 142 LOC) both earn their keep — they're small, single-purpose, and the BlockValue ref-vs-inline-vs-structure distinction (FIX-413) is a real wire-format invariant.

The registry is **not really a registry** — it's a discriminated union plus per-type fields. There is no factory or dispatcher; emit sites construct items as object literals and the union narrows on `item.type`. That is the right shape for this problem.

What is ceremonial:
- `OutputItemBase` includes `requestId`, `itemIndex`, `provenance`, `ts`, `ownedBy`, `agentType`, `agentName`, `transient` on every item. Several are populated by the runtime, not the author. Splitting `OutputItemPersisted` from `OutputItemEmittable` would let block authors stop seeing `itemIndex` and `requestId` in their construction call sites (they are populated by the emitter anyway in `sequencer.ts`).
- `ContextItem` is `@deprecated` but still in the union, still exported.

This subsystem is the smallest of the major ones (881 LOC across 6 files) and is approximately right-sized.

## 5. Capabilities

`capability/` is 833 LOC. `merge.ts` is 447 of those.

What does a capability do at runtime?

- It packages a partial block config under a name. `CapabilityConfig` (`types.ts:109–156`) lists: `resources`, four scope state schemas, `sequencerStateSchema`, `targetStateSchemas`, transitive `uses`, `agentType` allowlist, `fns` (a factory producing `ctx.cap.{name}`), and `presets` (named bundles).
- At build time, blocks listing the capability in `uses` get those declarations folded into their own config via `flattenCapabilities` → `mergeCapabilities` → `mergeWithBlockResources`. Diamond dedup happens by base-reference (`getBaseCapability`).
- At runtime, two things actually use the capability:
  1. `ctx.cap.{name}` — memoized result of `cap.fns(ctx)`.
  2. The generator's dynamic `uses` resolver pulls active-preset `context` and `tools` per call.

**How does this differ from passing `{ tools, context, resources, uses }` directly to a block?** Three real differences:

1. **Diamond dedup.** Two blocks both `uses: [a, b]` where `b uses [a]` — `a` is installed once. This is a real win when capabilities chain (skills → tools → memory).
2. **Presets with overrides.** `cap.presets({ heavyTools: false })` lets consumers turn off bundles. Useful for cap reuse across primary/sub-agent contexts.
3. **`fns` namespace.** `ctx.cap.skill.startSkill(...)` — typed helpers per capability. Hard to reproduce with raw config flattening.

Is there a leaner shape? Yes. The `presets` data structure (with `default: string[]`, `__presetDefs`, `__presetOverrides`, function-form overrides) is heavier than it needs to be. In practice, every capability I scanned has 0–2 presets and their overrides are boolean. The function-form override (`PresetOverrideFn`) is exposed in the types but I see no in-repo usage. Cutting function-form preset overrides would simplify `merge.ts:135–187` substantially.

Also, `capability/types.ts` and `capability/merge.ts` between them define: `CapabilityRef`, `UsesEntry`, `UsesSlot`, `DefinedCapability`, `ConfiguredCapability`, `CapabilityConfig`, `PresetDef`, `PresetContextEntry`, `CapabilityPresetCtx`, `PresetOverrides`, `PresetOverrideFn`, `MergedCapabilitySurface`, `FlattenResult`, `DynamicUsesResolver`, `InferCapabilities`, `InferCapabilityEntry`, `InferSessionState`. **Seventeen exported types for one concept.** Several are internal merge-machinery types that should not be in the public type surface.

## 6. Macros

`macro/` exists, has 814 LOC across 10 files, and is **a stale duplicate of `utility/`**.

Evidence:
- `diff macro/summarizer.ts utility/summarizer.ts`: utility adds an optional `agentType` field; the rest is identical.
- `macro/decomposer.ts` vs `utility/decomposer.ts`: utility has additional `context`, `history`, `agentType` config and a different default model. Same factory contract, slightly different prompts.
- `macro/index.ts` exports 9 factories; `utility/index.ts` exports 12 (the same 9 plus `intentRouter`, `sessionTitleGenerator`, `upsertResource`).
- `grep -rn "from.*macro" --include="*.ts" -l` from the repo root returns **zero hits** — nothing imports `macro/`.

The macro subsystem is dead. It is an old name for the same concept, never deleted, and someone has been forking changes into both folders intermittently (the `agentType` divergence is a recent addition that landed in `utility/` only). 814 LOC of pure dead weight.

The "macro" name is also misleading — these are **factories that return a generator block**. They are not macros in any AST/code-generation sense. The `utility/` name is correct.

**Action: delete `macro/` outright.**

## 7. Schema

`schema/` is 209 LOC. It is not a custom schema system; it is a thin Zod helper layer:
- `common.ts` (12 LOC) — pure type aliases (`JsonObject`, `MaybePromise`, `SchemaInput`, `SchemaOutput`).
- `action-schema.ts` (188 LOC) — `serializeActionSchema(zodSchema)` walks `_def` and produces a JSON shape used by the devtool to render input forms.

The serializer earns its place: someone has to translate Zod schemas to a wire format the devtool can render, and Zod offers no first-class JSON-serialize-the-type helper. But it is fragile — the comment block at lines 47–57 redeclares an internal `ZodDef` type because Zod doesn't expose `_def`. Any Zod 4 migration will break this file.

This is fine where it is and small enough not to justify reorganization.

## 8. Utility blocks

`utility/` ships 12 factory blocks in 1,187 LOC:

| File | LOC | Pattern |
|------|-----|---------|
| `combiner.ts` | 161 | handler — deterministic merge, custom logic |
| `intent-router.ts` | 127 | sequencer composition — classifier + router |
| `intent-classifier.ts` | 110 | generator with per-category validation |
| `context-reducer.ts` | 100 | generator with three modes |
| `session-title-generator.ts` | 85 | generator |
| `summarizer.ts` | 78 | generator |
| `decomposer.ts` | 72 | generator |
| `memoryExtractor.ts` | 71 | generator |
| `synthesizer.ts` | 70 | generator |
| `analyzer.ts` | 69 | generator |
| `composer.ts` | 69 | generator |
| `upsert-resource.ts` | 60 | handler — collection upsert |
| `index.ts` | 115 | barrel |

**8 of 12 utilities are just `generator({ name, model, prompt, outputSchema, agentType })`** with a hardcoded prompt and a `z.object()` output schema. Each is a 60–80 line file because each redeclares the same TS generic plumbing for `<TOutputSchema extends ZodTypeAny = typeof xOutputSchema>` and the same `toUserContent(input)` helper.

A leaner factory:

```ts
export function definePromptUtility<TSchema extends ZodTypeAny>(meta: {
  name: string;
  outputSchema: TSchema;
  prompt: string | ((cfg: any) => string);
  defaultModel?: string;
}) { /* ~25 lines */ }
```

…and each utility becomes:

```ts
export const summarizer = definePromptUtility({
  name: "summarizer",
  outputSchema: summarizerOutputSchema,
  prompt: (cfg) => buildSummarizerPrompt(cfg.granularity, cfg.objectives),
});
```

That collapses 8 files × ~75 LOC ≈ 600 LOC into 8 files × ~30 LOC ≈ 240 LOC, plus the shared factory. Net savings: ~300 LOC.

`combiner.ts` is the odd one out — pure handler logic with custom merge-with-dedup, deserves to stay as-is.

## 9. Tools

`tools/` is 313 LOC across two files.

- `resource-tools.ts` (235 LOC) — defines five `handler({ ... })` blocks: `createResource`, `readResource`, `updateResource`, `deleteResource`, `listResources`. Includes `resolvePathToCollection` / `tryMatchPath` (lines 170–235) — a tiny pattern matcher for resource paths that handles wildcards (`*`) and parameters (`[id]`). Real logic.
- `resource-content-tools.ts` (78 LOC) — two handlers for reading/writing `llmReadable`/`llmWritable` resource content.

Could this be ~10 lines? No — these aren't AI SDK tool primitives, they are framework-specific resource-CRUD blocks that bridge the framework's resource registry to the LLM tool surface. The Vercel AI SDK has tool primitives but they wouldn't help here; the work is in path resolution, scope routing, and emitting framework-shaped error messages. These are appropriately sized.

**However**, the Zod schemas are inline-duplicated five times: every CRUD handler declares its own `path: z.string().describe(...)` and the same `ok: z.literal(true)` output. Moving these to shared `pathInputSchema` and `okOutputSchema` constants would save ~30 LOC and prevent drift.

## 10. Type contracts

`types/` is 2,760 LOC across 19 files. The four-letter answer: **too many types**.

Top-level public types exported (from `types/index.ts` and `index.ts` re-exports):

- 90+ named type exports.
- 30+ named runtime exports.

A meaningful chunk are inference internals that ended up in the public surface:
- `InferStateFromSchema`, `InferResourcesFromSchemas`, `InferResourcesFromDefinitions`, `InferBlockResources`, `InferTargetStatesFromSchemas`, `InferCapabilities`, `InferCapabilityEntry`, `InferSessionState`, `InferFlowBlockContext`, `InferFlowStateMap`, `InferScopeStateFromConfig` — eleven type-utility helpers, most of which are useful only inside the package's own builder generics.
- Two deprecated aliases (`StateHandle`, `TargetHandle`) and the deprecated `DefinedResourceNamespace`/`ResourceNamespaceConfig` family (from `types/resource-collection.ts`) are still exported with no scheduled removal.

Public surface is **not minimal**. A consumer importing `BlockDefinition` should not need to know that `InferStateFromSchema` exists. Almost every file under `types/` exports its internal type helpers.

The locked contracts (BlockKind, AgentType, ItemStatus, OutputItem, StreamEvent, BlockContext) are appropriate. The bloat is the inference machinery and deprecated aliases bleeding into `index.ts`.

## 11. Code duplication

Confirmed duplications inside core:

1. **`macro/` ≈ `utility/`** (814 LOC dead). §6.
2. **`isPlainObject`** — declared in `utils/deep-equal.ts:21`, redeclared in `utility/combiner.ts:27`, and effectively reimplemented inline in `utils/deep-merge.ts:17–22`. Three copies.
3. **Stable JSON serialization for dedup** — `utility/combiner.ts:31–44` defines `stableSerialize`. `blocks/sequencer.ts:244` uses raw `JSON.stringify(visibleState)` for state-change detection (key-order-dependent, so a state mutation that just reorders keys would emit a snapshot). A single `stableHash` helper would tighten both.
4. **`getEmitterItemCount` / `getSequencerEmitterItemCount`** — hand-rolled duck-typing in `blocks/sequencer.ts:182–193` and again in `blocks/generator.ts` (used at line 1783, declared earlier in the file). Same algorithm, two copies.
5. **`findEmittedBlockOutputId` / "router hint installer"** — `sequencer.ts:121–135` walks `response.getItems()` looking for the most recent `block_output` with a given `blockInstanceId`; `router.ts:212–224` does the same. Should be one helper in `internal/`.
6. **`isInlineConfig` / arg-shape resolution** — repeated 4× in sequencer DSL methods (§3).
7. **Block builder generics tuple** — same 20 type parameters listed in `handler.ts:16–43`, `router.ts:48–137`, and (in different shape) `sequencer-methods.ts:288–324`.
8. **Generator `block_output` emission** — `sequencer.ts:315–368` (`emitGeneratorBlockOutput`) overlaps with the streaming-text path in `generator.ts:1763–1802`. They both emit a `block_output` with a `ref` hint; one wins, the other is dead in that path.

## 12. Dead code and hyperflexibility

- **Whole `macro/` directory** — confirmed unimported. (§6)
- **`SequencerDefinition.validate()`** — heuristic `_def.typeName` comparison that fails on common Zod wrappers. (§3)
- **`SequencerDefinition.background()`** — pure alias for `.work()`. Could be removed without functional loss; the user-facing readability gain is marginal.
- **`SequencerDefinition.loopBack(targetStepName, { maxIterations })`** — duplicate of bounded `doUntil`. No callers found in repo grep beyond its own tests.
- **`OptionalSchema = ZodTypeAny | undefined`** — exported from `schema/common.ts:12`, re-exported from `schema/index.ts` and `types/index.ts`. Zero internal callers; pure noise in the public type surface.
- **`PresetOverrideFn`** (capability function-form override) — type is exported, no in-repo callers exercise it. Worth reviewing whether the shape is used externally; if not, drop it and simplify `resolveActivePresets`.
- **`BlockOutputItem.blockDefinitionId`** — declared on `ItemProvenance` (`items/types.ts:32`), never set anywhere in core, never read.
- **`StateHandle`, `TargetHandle`, `DefinedResourceNamespace`, `ResourceNamespaceConfig`, `ResourceNamespaceHandle`, `ResourceNamespaceRef`, `defineResourceNamespace`, `isDefinedResourceNamespace`, `resolveNamespaceKey`** — all marked `@deprecated`. These are doubling the resource-collection type surface.
- **`ContextItem`** — marked `@deprecated`, still in the `OutputItem` union (`items/types.ts:236–239`). Live consumers must still narrow against it.
- **`models/` in core** — the entire 3,113 LOC subsystem ships with the package even when consumers want only types. `createAiSdkModelResolver.ts` (821 LOC), `createFSDProvider.ts` (472 LOC), `createModelResolver.ts` (468 LOC), `fallbackModel.ts` (237 LOC), `caching.ts` (192 LOC), `providerDetection.ts` (180 LOC), etc. This belongs in a `@flow-state-dev/models` or `@flow-state-dev/ai-sdk` package. It is not a builder, it is not a contract, and it imports the `ai` SDK runtime.

## 13. Top 10 files to delete, collapse, or rewrite

1. **`packages/core/src/macro/` (entire directory, 814 LOC, 10 files)** — delete. No imports anywhere in the repo. This is the highest-leverage cut; ~5% of the package gone with no behavior change. (§6)

2. **`packages/core/src/blocks/sequencer.ts:850–1585` (~735 LOC of DSL methods)** — rewrite around three primitives (`runChild`, `runBackground`, `resolveCallShape`). Twelve methods currently re-implement child-path derivation + descriptor emission inline. Target: ~300 LOC for the same surface. (§3)

3. **`packages/core/src/models/` (3,113 LOC)** — extract to `@flow-state-dev/models`. `core` should re-export only the `ModelResolver` and related *types*, not the `ai`-SDK adapter. Cuts the runtime payload of `core` by ~18%.

4. **`packages/core/src/utility/{summarizer,analyzer,composer,memoryExtractor,synthesizer,decomposer,context-reducer,session-title-generator}.ts`** — collapse 8 files behind a `definePromptUtility(meta)` helper. Saves ~300 LOC and stops every per-utility file from redeclaring `<TOutputSchema extends ZodTypeAny = ...>` boilerplate. (§8)

5. **`packages/core/src/blocks/generator.ts:1763–1802` and `packages/core/src/blocks/sequencer.ts:315–368`** — merge into a single `emitBlockOutput(block, output, ctx, opts)` helper in `blocks/internal/emit.ts`. Currently two copies of the FIX-480 / FIX-413 ref-emission logic with subtly different code paths. Removes the sequencer's `block.kind === "generator"` special case at sequencer.ts:478–504. ~80 LOC saved + a leak fixed.

6. **`packages/core/src/blocks/sequencer.ts:1859–1889` (`validate()`)** — delete. The `_def?.typeName` heuristic produces false negatives for ZodEffects/Default/Optional. The function does not protect anything in practice.

7. **`packages/core/src/capability/merge.ts:135–187` (`resolveActivePresets`) + `types.ts:217–235` (`PresetOverrideFn`)** — drop function-form preset overrides. Boolean overrides cover all in-repo usage. Trims ~40 LOC and three exported types. (§5)

8. **`packages/core/src/types/index.ts` and `packages/core/src/index.ts` re-exports** — audit and remove inference-helper types from the public surface (`InferStateFromSchema`, `InferResourcesFromSchemas`, `InferBlockResources`, `InferCapabilityEntry`, `InferSessionState`, etc.). These are internal generic plumbing. Also purge deprecated aliases: `StateHandle`, `TargetHandle`, `DefinedResourceNamespace*`, `ResourceNamespaceConfig`, `ResourceNamespaceHandle`, `ResourceNamespaceRef`, `defineResourceNamespace`, `isDefinedResourceNamespace`, `resolveNamespaceKey`, `OptionalSchema`, `ContextItem`. (§§10, 12)

9. **`packages/core/src/blocks/handler.ts`, `router.ts`, `sequencer-methods.ts` (generic-parameter triplets)** — extract a `BlockGenericPack<T>` helper alias for the 20-parameter tuple repeated three times. ~150 LOC saved across the three files; also unblocks future state-schema additions from being three-place edits. (§2)

10. **`packages/core/src/utils/deep-equal.ts:21–25`, `utility/combiner.ts:27–29`, `utils/deep-merge.ts:17–22`** — three copies of `isPlainObject`. Promote to `utils/is-plain-object.ts`. While there: replace `JSON.stringify(visibleState)` in `sequencer.ts:244` with a `stableSerialize` import from a shared util so state-snapshot dedup is order-stable (currently silently wrong for `{a:1,b:2}` vs `{b:2,a:1}`).

## If I had a week to refactor `core`

**Day 1 — Cuts.** Delete `macro/` (-814 LOC). Drop `OptionalSchema`, `ContextItem`, `StateHandle`/`TargetHandle`, all `*Namespace*` aliases, `validate()`, `background()`, `loopBack()`, `PresetOverrideFn`. Audit and prune `index.ts` re-exports. ~1,300 LOC gone, zero runtime risk if tests pass.

**Day 2 — Shared internal kernel.** Create `blocks/internal/emit.ts` (block-output emission), `blocks/internal/find-output-item.ts` (item lookup duck-typing), `blocks/internal/arg-shapes.ts` (the arg1/arg2/arg3 shape resolver used by `then`/`thenIf`/`tap`/`tapIf`). Promote `isPlainObject`, `stableSerialize` to `utils/`. Wire all call sites. Sequencer and router both stop reaching into each other.

**Day 3 — Sequencer DSL rewrite.** Replace the 12 hand-rolled methods with thin wrappers over `runChild` and `runBackground`. Target sequencer.ts at <800 LOC. Type signatures stay identical (sequencer-methods.ts public surface unchanged) so no consumer breakage.

**Day 4 — Utility collapse.** Build `definePromptUtility`. Migrate 8 generator-flavored utilities to it. Keep `combiner` and `intent-classifier` and `intent-router` and `upsert-resource` as-is (they have real custom logic). Update tests.

**Day 5 — Move `models/` out.** Spin up `@flow-state-dev/models`. `core` keeps `types/model.ts` and `types/speech.ts`; everything in `models/` and `adapters/{tiktoken,token-counter,model-lookup}.ts` moves. Update imports in `server`, `cli`, `vercel`, etc. Re-export from `core/index.ts` for one minor version with a deprecation note, then remove.

After this week, core would land around **10,500 LOC**, the public type surface would shed ~30 named exports, and the sequencer DSL would be implementable in a 30-minute reading. The four-block taxonomy, the items system, capabilities, and `defineFlow` all stay as-is — they earn their footprint.

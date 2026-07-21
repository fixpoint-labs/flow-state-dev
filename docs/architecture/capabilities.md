# Capabilities

A capability is a reusable bundle of block-config surface — resources, state
schemas, context entries, tools, helper fns, and (since FIX-589) generator-only
singletons. Blocks list capabilities in their `uses` slot; the framework merges
each capability's contributions into the consuming block's effective config.

This page documents the surface a capability can contribute, the precedence
rules when multiple capabilities (or block-level settings) provide the same
field, and the constraints on dynamic `uses` entries.

## What capabilities can contribute

`PresetDef` is the union of all fields a capability preset may declare. The
top-level `CapabilityConfig` shares most of the same fields (always-on); the
`presets` map carries opt-in/opt-out bundles.

| Field | Block kinds | Merge semantics |
|---|---|---|
| `resources` | all | Map merged; same accessor + same ref dedupes; different ref at same accessor errors at build time |
| `sessionStateSchema`, `requestStateSchema`, `userStateSchema`, `orgStateSchema` | all (per scope) | `z.object().extend()` semantics (last contributor wins on overlapping keys) |
| `sequencerStateSchema` | sequencer only | Same as above; non-sequencer consumer is a build-time error |
| `targetStateSchemas` | all | Map merged with same-ref dedup |
| `context` | generator only | Entries appended; tag-name aggregation collapses contributions to the same key inside one XML tag |
| `tools` | generator only | Arrays appended at runtime |
| `model` | generator only | **Singleton**, last-wins among capabilities; block-level setting wins over capability |
| `providerOptions` | generator only | Singleton, last-wins; block-level wins |
| `caching` | generator only | Singleton, last-wins; block-level wins |
| `fns` | all | Exposed at `ctx.cap.{name}` with TypeScript inference |

## Generator singletons (model, providerOptions, caching)

Three generator-only singleton slots can be contributed by capability presets:

```ts
export const tradingDesk = defineCapability({
  name: "tradingDesk",
  presets: {
    default: ["core"],
    core: {
      model: (_, ctx) =>
        ctx.session.state.costPreset === "full" ? "intent/chat" : "intent/utility",
      providerOptions: { openai: { reasoningEffort: "medium" } },
      caching: { enabled: true, breakpoints: "auto" },
    },
  },
});
```

### Precedence

1. **Block-level wins.** A generator that sets `model:` explicitly beats anything its capabilities contribute. Same for `providerOptions` and `caching`.
2. **Last-wins among capabilities.** Later preset contributions override earlier (matches `extendSchema` for state schemas).
3. **Missing required slot.** If neither the block nor any capability provides `model`, the generator factory throws at construction time:

   ```
   Generator "trader" requires a model. Set one on the block or via a
   capability that contributes `model`.
   ```

`providerOptions` and `caching` are optional — missing both is fine.

### Block-kind validation

These three slots are generator-only. A capability that declares any of them is rejected at merge time if used by a handler, sequencer, or router:

```
Capability "tradingDesk" preset "core" declares model, but the consuming
block is a handler. model is only valid on generator blocks.
```

Mirrors the existing `tools` / `context` block-kind checks.

### Type-system note

The `model` / `providerOptions` / `caching` fields on `PresetDef` are typed broadly (`ResolvableModel<any, ...>`). TypeScript can't statically know whether a `uses: [cap]` will be attached to a generator or another block kind, so the runtime check at merge time is the load-bearing safety net.

The framework exports `ResolvableModel`, `ResolvableProviderOptions`, and `ResolvableCachingConfig` from `@flow-state-dev/core` so capability authors can type their helper fns over the same shapes the generator config expects.

### Capability schema forwarding (FIX-616)

As of FIX-616, capability-declared schemas flow into consumer block `ctx` types for static `uses` entries. The forwarded axes (own-state added in FIX-914 PR2):

| Capability field | Consumer `ctx` slot |
|---|---|
| `sessionStateSchema` | `ctx.session.state` |
| `resources` | `ctx.resources.*` |
| `targetStateSchemas` | `ctx.targets.*` |
| `sequencerStateSchema` | `ctx.sequencer.state` |
| `stateSchema` | `ctx.self.state` |

For most axes the merge intersects capability contributions with block-own declarations and block-own keys win on collision. **Own-state (`stateSchema`) is the exception**: it merges via `mergeCapabilityOwnStateWithBlock` with explicit collision detection — a field declared by two sources (two capabilities, or a capability and the block's own `stateSchema`) must be structurally compatible (`compareZodSchemasStructurally`) or the build throws, rather than silently letting one side win. Five `Infer*` utilities on `@flow-state-dev/core` drive the computation: `InferCapabilitySessionState<TUses>`, `InferCapabilityResources<TUses>`, `InferCapabilityTargets<TUses>`, `InferCapabilitySequencerState<TUses>`, `InferCapabilityOwnState<TUses>`. Own-state inference feeds `TSelfState` on handler/generator/router; sequencer own-state merges at runtime but isn't typed (matching `SequencerCtx`'s untyped `ctx.cap`).

**Top-level schema only.** Every `Infer*` utility reflects the capability's *top-level* schema declarations (`stateSchema`, `sessionStateSchema`, …). A schema contributed only through a preset or the open-config resolver merges at runtime via `mergeSurfaceInto` but is not reflected in the consumer's `ctx` types — declare the schema at the capability's top level when you want it typed.

**Direct-only contract.** If capability A `uses` capability B, B's schema contributions do NOT flow to blocks that `uses` A. Each capability exposes only what it directly declares. This matches the precedent established by tRPC, Hono, and Fastify middleware chains — transitive type propagation creates fragile deep inference chains. Capability authors who want B's schemas visible to consumers must re-declare them on A.

**Dynamic `uses` entries.** Functions in a `uses` array are evaluated at runtime and continue to contribute resources, context, and tools at runtime. They contribute nothing to types — only static `CapabilityRef` entries are reflected. This is unchanged behavior; FIX-616 adds the static-only forwarding path.

**Escape hatches.** `defineCapability` now accepts four type-only override fields: `sessionStateType`, `resourcesType`, `targetStatesType`, `sequencerStateType` (no underscores). These replace the inferred type on the corresponding axis without changing runtime behavior. Use them when Zod inference is too loose or hits TS2589. Each escape-hatch field requires the corresponding schema to be present — setting one without the schema is a compile error (enforced via a `never`-conditional). The runtime check in `resolve-capabilities` (preset-conditional evaluation and dynamic entry resolution) is unchanged and remains the load-bearing safety net.

## Open config resolver (FIX-915)

`defineCapability` accepts a `config: { schema?, resolve }` field. It is a second, open-valued tuning surface beside presets: presets flip predefined bundles on and off, config carries a typed value and lets the capability's `resolve(config, ctx)` map it onto a `Partial<PresetDef>` surface. That surface merges through the same `mergeSurfaceInto` choke point presets use, so there is no new runtime channel — config is a **build-time transform**, and resolver-emitted tools/context close over the config value at build time. `generator.ts` and the runtime ctx contract are unchanged.

**Where it runs.** `mergeCapabilities` merges, per capability, the required surface, then active presets, then (new) `resolveConfigSurface(cap, { presets, blockKind })`. Config merges *after* presets, so an explicit config value can win over that capability's own preset defaults; cross-capability order stays global last-wins. `resolveConfigSurface` parses `schema.safeParse(__config)` (or passes the raw value when schemaless) and calls the resolver, wrapping a throw with the capability name. The resolver's `ctx.presets` is the set of that capability's active preset names, so the author owns override-vs-add semantics per setting.

**Config-is-opt-in / the `.default({})` contract.** The resolver runs whenever a used capability declares `config`. When `.config()` was not called, the value parsed is `undefined` — and a `z.object({...})` rejects `undefined` even with all-optional fields, so a capability usable without `.config()` must declare `z.object({...}).default({})`. A schema that rejects `undefined`, or a schemaless config, makes `.config()` mandatory (build-time error). The `.config()` argument is typed as `z.input` (a `.default()` field is optional at the call site); the resolver param is `z.output`.

**Single-hop invariant.** Both `.presets()` and `.config()` route through one internal `createConfiguredRef(receiver, patch)` that produces a single `Object.create(base)` clone carrying `__presetOverrides` and/or `__config`, copying forward any sibling carrier the receiver already had. So `.config().presets()` and `.presets().config()` both end exactly **one hop** from the base, and `getBaseCapability` recovers the base with a single `Object.getPrototypeOf` — the predicate is "configured iff `__presetOverrides` or `__config` is an own prop." This is what keeps diamond dedup (by base identity) correct across either chain order. The return types are polymorphic over `this` so the escape-hatch carriers (and the `.config()` argument type) survive chaining — this also repairs a latent `.presets()` carrier drop.

**Diamond with conflicting config throws.** Presets keep first-wins on a diamond. Config carries values, so two paths reaching the same base that would resolve to *different* configuration silently bake one closure and drop the other — `flattenCapabilities` throws instead; paths that resolve identically deduplicate. `assertConfigCompatible` compares the value each ref would feed its resolver: the **parsed** config when a schema exists (so omitting a defaulted field, or a bare ref vs `.config({})` on a `.default({})` schema, dedups rather than false-conflicting), falling back to the raw `.config()` argument when the config is schemaless. For schemaless config a bare ref (a mandatory-config error) and a configured ref resolve differently, so that pairing is a conflict.

**Config on dynamic `uses` is rejected at runtime.** A configured ref returned from a dynamic `(ctx) => CapabilityRef[]` resolver is only known when the generator evaluates it at request time, and that path resolves presets only. `resolveDynamicCapSurface` rejects a ref carrying `__config` with a clear runtime error rather than silently dropping its resolver contributions. Full support is deferred.

## Dynamic `uses` entries

`uses` accepts both static `CapabilityRef` entries and dynamic resolver functions:

```ts
generator({
  uses: [
    tradingDesk.presets({ investmentThesis: true }),                    // static
    (ctx) =>                                                            // dynamic
      ctx.session.state.costPreset === "full"
        ? [tradingDesk.presets({ phase1Memos: true, phase2Debate: true })]
        : [],
  ] as const,
  // ...
});
```

### Constraint: dynamic entries contribute context and tools only

Dynamic resolver functions are evaluated at runtime with `ctx`. Resources and state schemas must be flattened at build time, so capabilities returned from a dynamic `uses` function **only contribute context entries and tool entries** to the consuming block. Anything else (resources, state schemas, target schemas, singletons) is silently dropped from the dynamic path.

**Workaround:** declare the resources statically — either via a static `uses` entry that always activates, or directly on the consuming block's `resources:` slot. The trading-desk's phase-3 trader uses both patterns:

```ts
generator({
  uses: [
    tradingDesk.presets({ investmentThesis: true }), // brings `memos` resource statically
    (ctx) =>
      ctx.session.state.costPreset === "full"
        ? [tradingDesk.presets({ phase1Memos: true, phase2Debate: true })]
        : [],
  ],
  // `p2Contributions` is needed by the dynamic phase2Debate preset's context
  // function but the preset itself activates dynamically, so the resource
  // must be declared statically on the block.
  resources: { p2Contributions: phase2Contributions },
  // ...
});
```

### `as const` on mixed `uses` arrays

When a `uses` array mixes static `CapabilityRef` entries with dynamic function entries, TypeScript collapses the array to a wide type that fails to satisfy the generator's `uses` parameter. Add `as const` to the array (and to each `tradingDesk.presets({...})` call inside) to preserve the tuple shape:

```ts
uses: [
  tradingDesk.presets({ investmentThesis: true }),
  (ctx) =>
    ctx.session.state.costPreset === "full"
      ? ([tradingDesk.presets({ phase1Memos: true })] as const)
      : ([] as const),
] as const,
```

Pure-static `uses: [cap1, cap2]` doesn't need this — TypeScript infers the tuple shape fine. The need shows up only with mixed entries.

## Canonical authority

For full type signatures of `defineCapability`, `PresetDef`, `CapabilityConfig`, and the merge semantics, see `packages/core/src/capability/types.ts` and `packages/core/src/capability/merge.ts`.

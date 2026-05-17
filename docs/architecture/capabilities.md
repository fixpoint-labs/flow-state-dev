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

As of FIX-616, capability-declared schemas flow into consumer block `ctx` types for static `uses` entries. The four forwarded axes:

| Capability field | Consumer `ctx` slot |
|---|---|
| `sessionStateSchema` | `ctx.session.state` |
| `resources` | `ctx.resources.*` |
| `targetStateSchemas` | `ctx.targets.*` |
| `sequencerStateSchema` | `ctx.sequencer.state` |

The merge intersects capability contributions with block-own declarations; block-own keys win on collision. Four `Infer*` utilities on `@flow-state-dev/core` drive the computation: `InferCapabilitySessionState<TUses>`, `InferCapabilityResources<TUses>`, `InferCapabilityTargets<TUses>`, `InferCapabilitySequencerState<TUses>`.

**Direct-only contract.** If capability A `uses` capability B, B's schema contributions do NOT flow to blocks that `uses` A. Each capability exposes only what it directly declares. This matches the precedent established by tRPC, Hono, and Fastify middleware chains — transitive type propagation creates fragile deep inference chains. Capability authors who want B's schemas visible to consumers must re-declare them on A.

**Dynamic `uses` entries.** Functions in a `uses` array are evaluated at runtime and continue to contribute resources, context, and tools at runtime. They contribute nothing to types — only static `CapabilityRef` entries are reflected. This is unchanged behavior; FIX-616 adds the static-only forwarding path.

**Escape hatches.** `defineCapability` now accepts four type-only override fields: `sessionStateType`, `resourcesType`, `targetStatesType`, `sequencerStateType` (no underscores). These replace the inferred type on the corresponding axis without changing runtime behavior. Use them when Zod inference is too loose or hits TS2589. Each escape-hatch field requires the corresponding schema to be present — setting one without the schema is a compile error (enforced via a `never`-conditional). The runtime check in `resolve-capabilities` (preset-conditional evaluation and dynamic entry resolution) is unchanged and remains the load-bearing safety net.

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

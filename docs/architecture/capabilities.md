# Capabilities

A capability is a reusable bundle of block-config surface that blocks list in `uses`. Authoring and the basic merge rules are user-facing: [Authoring capabilities](../../apps/docs/docs/advanced/capabilities-authoring.md), [Using capabilities](../../apps/docs/docs/fundamentals/capabilities.md). Source of truth for types and merging: `packages/core/src/capability/types.ts`, `merge.ts`. This page holds the invariants and the reasons behind them.

## Merge semantics by field

| Field | Block kinds | Merge |
|---|---|---|
| `resources`, `targetStateSchemas` | all | Same reference dedupes; different reference under one name throws at build |
| `*StateSchema` (per scope) | all | `.extend()`; last contributor wins on overlapping keys |
| `sequencerStateSchema` | sequencer only | as above; any other consumer throws at build |
| `stateSchema` (own state) | all | **Exception**: a field declared by two sources must be the same schema reference, or the build throws (`mergeCapabilityOwnStateWithBlock`). No silent last-wins |
| `context` | generator | Appended; same-key tags aggregate |
| `tools` | generator | Appended, **fenced** (below) |
| `controlTools` | generator | Appended, never fenced |
| `model`, `providerOptions`, `caching` | generator | Singletons: block-level wins, then last-wins among capabilities. No `model` anywhere → the generator factory throws at construction |
| `fns` | all | `ctx.cap.<name>` |

Generator-only fields are typed broadly on `PresetDef`, because TypeScript can't know what kind of block a `uses: [cap]` lands on. The **merge-time runtime check** (rejecting `model`/`tools`/`context` on a non-generator) is the load-bearing safety net, not the types.

## The tools fence

A generator's declared `tools:` is the complete and exclusive set of **catalog** tools the model may call. It is a runtime boundary, not a convention.

- **Declaring the slot raises the fence, not a non-empty list.** `tools: []` means "no tools". Omitting `tools:` lets capability tools through. Both resolve to an empty list, so only the declaration tells them apart.
- **`controlTools` cross the fence.** A block holds a control only because it composed the capability carrying it; that composition is the declaration. Controls are usually built inside the capability and never exported, so no `tools:` list could name them, and fencing one would leave the prompt advertising a tool the model can't call.
- **The exemption is per contribution, not per capability.** `createSkillsLibrary` registers the app catalog through `tools` and its own loader through `controlTools`; a capability-level flag would free the whole catalog along with the loader. (`taskTools` contributes its delegation tools entirely as controls.)
- **Fenced tools are dropped, not name-intersected.** A tool the block also named already arrives through the declaration, so an intersection either duplicates an identical instance (stripped by identity dedupe) or collides with a different same-name instance (`assertUniqueToolNames` throws). Dropping says the same thing without the throw.
- **Per-instance registration is not an exemption.** A higher layer (Workforce, from an instance's `blocks/` folder or held packages) can make a name *resolvable* for one instance; the instance still has to name it in `tools:`. When a Workforce seat writes no `tools:` line, the built-in `agent` kind composes the declaration from the presets and packages the seat itself chose. Kind-default presets add nothing. Core always sees one declared list.

Canonical test: `packages/core/test/generator-tools-fence.test.ts`. It asserts on the list the *model* receives, since that is the fence's whole claim.

## Type forwarding

Static `uses` entries forward capability schemas into the consumer's `ctx` types (`ctx.session.state`, `ctx.resources`, `ctx.targets`, `ctx.sequencer.state`, `ctx.self.state`) through the `InferCapability*` utilities.

- **Top-level declarations only.** A schema contributed only through a preset or the config resolver merges at runtime but is not typed.
- **Direct-only.** If A `uses` B, B's schemas do not reach blocks that `uses` A. Transitive inference builds fragile deep chains (and TS2589); A must re-declare what it wants visible.
- **Dynamic entries contribute no types.**
- **Escape hatches** (`sessionStateType`, `resourcesType`, `targetStatesType`, `sequencerStateType`) override inference without runtime effect and require the matching schema to be present.
- Sequencer own-state merges at runtime but isn't typed.

## Open config resolver

`config: { schema?, resolve }` maps a typed value to a `Partial<PresetDef>` that merges through the same `mergeSurfaceInto` choke point as presets. It is a **build-time transform**; resolver-emitted tools and context close over the value at build.

- **Order:** per capability, required surface → active presets → config surface. Config can override its own capability's preset defaults; across capabilities, order stays global last-wins.
- **The `.default({})` contract.** The resolver runs whenever a used capability declares `config`. Without `.config()` the parsed value is `undefined`, which `z.object({...})` rejects even with all-optional fields. A capability usable without `.config()` must declare `.default({})`; otherwise `.config()` is mandatory (build-time error).
- **Single-hop invariant.** `.presets()` and `.config()` both go through `createConfiguredRef`, which produces one `Object.create(base)` clone carrying `__presetOverrides` and/or `__config`. Either chain order ends exactly one hop from the base, so `getBaseCapability` recovers the base with a single `getPrototypeOf`. Diamond dedup (by base identity) depends on this.
- **Diamonds.** Presets keep first-wins. Config carries values, so two paths to one base that resolve *differently* throw in `flattenCapabilities` instead of silently baking one closure. Compatibility compares the **parsed** config when a schema exists (a bare ref and `.config({})` on a `.default({})` schema dedupe), the raw argument when schemaless.

## Dynamic `uses`

Dynamic `(ctx) => CapabilityRef[]` entries contribute **only context, tools and control tools**. Resources, state schemas, targets and singletons from that path are **silently dropped**, because those must be flattened at build. Any resource such an entry's context or tools needs must be declared statically, on a static `uses` entry or the block's own `resources`.

A configured ref (carrying `__config`) returned from a dynamic entry is **rejected at runtime** by `resolveDynamicCapSurface`, rather than silently losing its resolver contributions.

Mixed static and dynamic `uses` arrays need `as const` (on the array and on inner `.presets()` results) or TypeScript widens the tuple and the generator's `uses` parameter rejects it.

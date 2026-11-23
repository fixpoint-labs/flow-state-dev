# Facts for Capabilities (R-10, reference)

Pass 1. Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests and `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit message. Implementation was read only to confirm what a call returns; what is stated below is what a caller can observe.

**[ran]** means a throwaway script in the scratchpad (not in the repo; nothing to clean up) that called `defineCapability`, `flattenCapabilities`, `mergeCapabilities`, `handler()` and `generator()` from `packages/core/src` and printed the result. Everything else is read from the cited line or pinned by a cited test.

Paths are from the repo root. Abbreviations:

- `ty` = `packages/core/src/capability/types.ts`
- `dc` = `packages/core/src/capability/define-capability.ts`
- `mg` = `packages/core/src/capability/merge.ts`
- `rc` = `packages/core/src/blocks/internal/resolve-capabilities.ts`
- `bb` = `packages/core/src/blocks/internal/build-block.ts`
- `gen` = `packages/core/src/blocks/generator.ts`
- `ev` = `packages/core/src/blocks/evaluator.ts`
- `sq` = `packages/core/src/blocks/internal/sequencer-state.ts`
- `seq` = `packages/core/src/blocks/sequencer.ts`
- `ix` = `packages/core/src/index.ts`, `cix` = `packages/core/src/capability/index.ts`
- `handler.ts` = `packages/core/src/blocks/handler.ts`, `router.ts` = `packages/core/src/blocks/router.ts`, `sequencer-methods.ts` = `packages/core/src/blocks/sequencer-methods.ts`
- `ssm` = `packages/core/src/helpers/scope-state-merge.ts`, `dfl` = `packages/core/src/flow/defineFlow.ts`
- `res` = `packages/core/src/types/resource.ts`
- `T` = `packages/core/test`. Tests: `T/capability.test.ts` (`tc`), `T/capability-with.test.ts` (`tw`), `T/capability-config.test.ts` (`tcf`), `T/capability-block-integration.test.ts` (`tbi`), `T/generator-tools-fence.test.ts` (`tfn`), `T/capability-history.test.ts` (`thi`), `T/capability-agent-type-filter.test.ts` (`tvis`), `T/capability-ctx-cap-nesting.test.ts` (`tnest`). Type tests: `T/capability-inference.type-test.ts` (`tinf`), `T/capability-schema-forwarding.type-test.ts` (`tfwd`), `T/capability-config.type-test.ts` (`tcft`), `T/capability-with.type-test.ts` (`twt`), `T/evaluator-context.test-d.ts` (`tevc`).
- Engine tests: `packages/engine/test/scope-state-defaults.test.ts` (`esd`), `packages/engine/test/sequencer-state-bubbling.test.ts` (`esb`).
- Existing pages: `p-use` = `apps/docs/docs/fundamentals/capabilities.md`, `p-auth` = `apps/docs/docs/advanced/capabilities-authoring.md`, `p-bs` = `apps/docs/docs/advanced/block-state.md`, `p-ss` = `apps/docs/docs/advanced/sequencer-state.md`, `p-tgt` = `apps/docs/docs/advanced/state-targets-and-parents.md`, `p-res` = `apps/docs/docs/resources/overview.md`, `p-sc` = `apps/docs/docs/fundamentals/state-and-scopes.md`, `p-c11` = `docs/contributing/docs-revamp/pages/concepts/capabilities.md` (the Concepts page this one is the Reference half of), `p-gen` = `docs/contributing/docs-revamp/pages/reference/generators.md` and its sheet `generators.facts.md` (table G-6 states the `tools:` fence from the generator's side).
- Example: `examples/knowledge-base/src/capability.ts` (`ex`), `createKnowledgeBaseCapability()`, lines 80-125: `name`, `resources`, `fns`, and presets, installed with `uses: [kb]`.

## What the page is

A Reference page for `defineCapability` and everything a block can do with a capability in `uses`. Tables and signatures, no narrative. Lookups it answers by name: **Can a dynamic `uses` entry install a resource?** (No; D-3) and **How are presets turned off?** (`.presets({ name: false })` or `.with({ name: false })`; P-2).

Public names the page may use, all from `@flow-state-dev/core` (`ix:109`, `ix:164-177`):

- value: `defineCapability`.
- types: `CapabilityRef`, `ConfiguredCapability`, `DefinedCapability`, `InferCapabilities`, `PresetContextEntry`, `PresetDef`, `PresetOverrides`, `CapabilityPresetCtx`, `ConfigArgOf`, `UsesEntry`, `UsesSlot`, `WithArg`; and `ToolsSlot` (`ix:268`, `gen:425`).
- **Not exported from the package root:** `CapabilityConfig`, `CapabilityConfigDef`, `CapabilityConfigResolveCtx`, `PresetOverrideFn`, `InferCapabilitySessionState`, `InferCapabilityResources`, `InferCapabilityTargets`, `InferCapabilitySequencerState`, `InferCapabilityOwnState`, and the helpers `flattenCapabilities`, `getBaseCapability`, `mergeCapabilities`, `resolveActivePresets` (they are in `cix:1-34`, which the root re-exports only in part, `ix:164-177`). The page must not tell a reader to import them. The type of a resolver's second argument is reachable only by writing the resolver inline, where it is inferred (`dc:66-74`).

The page's example is the support desk from C-11: the `orders` capability (a session-scoped `orderLog` resource, a `context` preset, a `tools` preset holding `lookUpOrder`), listed by `draftReply` and `summarizeOrder` (`p-c11:18-97`). Rows below use it where a value is needed.

**Vocabulary.** The app-level installable unit is a **kit** (not "plugin"). A capability is block-level: a block lists it in `uses`. A kit's install returns flows, and the flows carry resources, views and capabilities (`p-c11:161`; the vocabulary entry "Kit" in `docs/contributing/user-docs.md` "Words"). The page names kits once, to say a capability is not one, and links to the Kits and slots page. A slot in this page's sense is a block's slot (`ToolsSlot`, `UsesSlot`), not a kit's slot (`ty:604-607`, `gen:425`).

## Table C-1: `defineCapability({ ... })` fields (`ty:229-310`, `dc:25-230`)

`defineCapability(config)` returns the capability. The returned object is the thing you list in `uses`. Reuse one object across blocks: two different `defineCapability` calls with one `name` are an error (C-6), and the same object listed twice is one install.

| Field | Type | Default | What it does | Cite |
| --- | --- | --- | --- | --- |
| `name` | `string` | required | Names the capability. Empty or whitespace-only throws `defineCapability() requires a non-empty name`. It is also the key of the helpers on `ctx.cap`. | `dc:98-100`, `ty:238`, `tc:51-61` |
| `resources` | `Record<string, DeclaredResourceEntry>` (accessor key to a `defineResource(...)` or collection) | none | Resources installed on every block that lists the capability. Scope is on each resource (`defineResource({ scope })`), not on the capability. | `ty:240-245`, `tc:63-69`, `tbi:42-58` |
| `sessionStateSchema`, `requestStateSchema`, `userStateSchema`, `orgStateSchema` | Zod schema | none | State fields for that scope. A static capability's top-level `sessionStateSchema`, `userStateSchema` and `orgStateSchema` reach the flow's scope state defaults (`dfl:768-826`). `requestStateSchema` is read nowhere: no block factory and not `defineFlow` consume it. (`mergeSurfaceInto` accumulates them in `mg:512-523`, and nothing reads the accumulator.) | `ty:246-249`, `dfl:768-826`, `gen:2894-2918`, `seq:2585-2593` |
| `sequencerStateSchema` | Zod object | none | Fields the capability needs on a sequencer's state. Valid only on a sequencer; any other block kind throws at build. | `ty:250-252`, `mg:525-543`, `tc:462-502` |
| `stateSchema` | Zod object | none | The block's own state (`ctx.self`). Valid on every block kind. | `ty:253-255`, `mg:545-549`, `tbi:761-935` |
| `targetStateSchemas` | `Record<string, Zod schema>` | none | Typed handles to named ancestor blocks' state (`ctx.targets`). Valid on every block kind. | `ty:256-258`, `mg:551-556`, `tc:642-705` |
| `fns` | `(ctx: BlockContext) => Record<string, function>` | none | Helper functions at `ctx.cap.<name>`. | `ty:296`, `bb:302-312` |
| `uses` | `readonly (CapabilityRef \| ((ctx) => readonly CapabilityRef[]))[]` | none | Capabilities this one depends on. Static entries install with it; function entries are dynamic (D-1). | `ty:278-283`, `mg:128-195` |
| `itemVisibility` | `ItemVisibility` or an array of them | none: attaches to every block | Attaches the capability only to blocks whose `itemVisibility` deep-equals one of these. A block with none set counts as `{ client: true, history: true }`. | `ty:285-294`, `rc:36-54`, `tvis:19-210` |
| `presets` | `Record<string, PresetDef>` plus `default?: string[]` | none | Named bundles a block turns on or off (P-1). | `ty:299-302`, `dc:138` |
| `config` | `{ schema?, resolve }` | none | A typed value a block passes with `.config(value)` and the resolver that maps it onto the block (O-1). | `ty:304-309`, `ty:196-216` |
| `sessionStateType`, `resourcesType`, `targetStatesType`, `sequencerStateType`, `stateSchemaType` | a type | none | Type-only. Overrides what `ctx` is typed as for that field. Carry no runtime value. Setting one without its schema or map is a compile error. | `ty:260-276`, `dc:58-62`, `tfwd:133-156` |

Facts about the table:

1. **The five `*Type` fields, not four.** `stateSchemaType` overrides the type of `ctx.self` (`ty:275-276`, `dc:62`, `dc:91`). R-10's rows from C-11 and `p-use:191` name only four; the fifth is real, so the table lists five. Row "Type-only overrides" is carried and corrected, see "Rows from other pages".
2. **`context`, `tools`, `controlTools`, `history`, `model`, `providerOptions` and `caching` are not top-level fields.** `CapabilityConfig` has none of them (`ty:229-310`). They go in a preset (P-1) or come from a config resolver (O-1). A dynamic entry can only contribute through presets (D-1).
3. **`fns` is the only part presets do not control.** `presets` has no `fns` slot (`ty:64-148`) and `ctx.cap` is built from the capability's `fns`, whatever presets are on (`bb:302-312`). **[ran]** a capability with `presets: { x: {...}, default: [] }` and `fns` had `fns` on `ctx.cap` with no preset on.
4. **Names with a colon work as capability names** but are not dot-accessible: `defineCapability({ name: \`orders:${scope}\` })` (`p-c11:133`, `p-auth:294-308` use this) lands at `ctx.cap["orders:session"]` (`bb:309`). The page should not show `ctx.cap.orders` for such a name.
5. A preset name and a config field name must not overlap. `defineCapability` throws at definition: `defineCapability("<name>"): preset name(s) [<names>] collide with config field name(s). .with() routes a flat bag by preset-name membership, so the two sets must be disjoint — rename the preset or the config field.` (`dc:102-120`, `tw:157-168`). The check reads the config schema's object keys through `.default()`, `.optional()` and `.strict()` wrappers (`dc:232-242`) and does not run for a scalar or array config schema (nothing to compare).

## Table P-1: What a preset can declare (`PresetDef`, `ty:64-148`)

A preset is a partial block config. The same shape is what a config resolver returns (O-1) and what a preset override function returns (P-3).

| Key | Type | What it does | Block kinds | Cite |
| --- | --- | --- | --- | --- |
| `resources` | map of accessor to resource | Installs resources. | all | `ty:67`, `mg:505-509`, `tbi:141-160` |
| `sessionStateSchema`, `requestStateSchema`, `userStateSchema`, `orgStateSchema`, `stateSchema`, `targetStateSchemas` | as in C-1 | Same as the top-level field, except a scope state schema from a preset or resolver does not reach the flow's defaults: `defineFlow` reads only top-level fields of statically listed capabilities. | all | `ty:70-89`, `mg:511-556` |
| `sequencerStateSchema` | Zod object | Same as the top-level field. | sequencer only | `ty:76`, `mg:526-532` |
| `context` | a string, a `ContextObject`, a function `(input, ctx) => string \| ContextObject \| null \| undefined`, or an array of these | Appended to the generator's `context` after the block's own entries. Object-form entries from two capabilities under one key render in one XML tag. | generator only | `ty:92-94`, `ty:156-167`, `mg:558-570`, `gen:2926-2961`, `p-auth:145-166` |
| `tools` | `GeneratorTool[]` or `(ctx) => GeneratorTool[] \| Promise<...>` | Tools the model may call. Dropped when the generator declares `tools:` (G-1). | generator only | `ty:95-97`, `mg:572-581` |
| `controlTools` | same shape as `tools` | Tools that reach the model whatever the generator's `tools:` says (G-1). | generator only | `ty:99-124`, `mg:583-592`, `tfn:178-223` |
| `history` | `ItemQuery` or `(ctx) => ItemQuery \| Promise<ItemQuery>` | A query added to every `ctx.session.items.history()` read of the generator, through the `history` option's default or a history function of its own. The read's own keys win over the capability's; among capabilities, later keys win. A function is resolved on every run. | generator only | `ty:126-136`, `mg:594-603`, `thi:47-146`, `gen:217-235` |
| `model`, `providerOptions`, `caching` | the generator's own types | Fill the generator's setting when the block sets none. Last capability wins; the block's own setting always wins. | generator only | `ty:138-147`, `mg:605-633`, `gen:2903-2925`, `tbi:644-759` |

Facts about the table:

1. **Block-kind refusal is a build-time throw, not a type error.** Listing a capability whose active preset (or config) declares a generator-only key on any other block throws when the block is built: `Capability "<cap>" preset "<preset>" declares <key>, but the consuming block is a <kind>. <key> is only valid on generator blocks.` For a config resolver the source reads `config` instead of `preset "<name>"`. `sequencerStateSchema` on a non-sequencer throws `... declares sequencerStateSchema, but the consuming block is a <kind>. sequencerStateSchema is only valid on sequencer blocks.` (`mg:499-501`, `mg:526-532`, `mg:559-633`; `tbi:292-338`, `tc:462-502`, `tc:534-607`, `tcf:234-239`, `thi:142-146`, `tbi:738-758`). `handler`, `router`, `sequencer` and `evaluator` all take `uses`; an evaluator's `uses` doc says capabilities "cannot supply an evaluator's model, tools or context" (`ev:386-391`). `p-auth:181` says "The type system enforces block-kind compatibility". It does not: `uses` accepts any `UsesEntry` on every kind (`handler.ts:109`, `ty:601`), and the sources of the failure are the runtime throws above. **Dropped from the page.**
2. **A required (top-level) field is merged first, then each active preset in declaration order, then the config surface** (`mg:722-743`). So a config value can override what the capability's own presets contributed for singletons, and the resolver sees which presets are active (O-2).
3. **A preset whose key set the block cannot take is the error in fact 1.** That answers the pass-7 question on C-11 ("A preset the block cannot take"): a handler listing a capability whose active `context` preset is on throws at build.
4. **`model` is required on a generator unless a capability supplies it.** Neither the block nor a capability gives one: `Generator "<name>" requires a model. Set one on the block or via a capability that contributes \`model\`.` (`gen:2909-2912`, `tbi:701-708`).
5. **Order of what a generator's slots receive.** Context: the block's own entries, then static capability entries, then dynamic ones (`gen:2926-2961`). Tools: the block's own, static control tools, dynamic control tools, static capability tools, dynamic capability tools (`gen:3035`).

## Table P-2: Which presets are on, and how to change that

| Question | Answer | Cite |
| --- | --- | --- |
| Which presets are on with no override? | The names in `default`, or every preset when `default` is absent. `default: []` turns all of them off. | `mg:231-232`, `tc:210-240`, `tbi:409-447`; **[ran]** a capability with presets `a`, `b` and no `default` merged both |
| How is one turned off? | `cap.presets({ name: false })` or `cap.with({ name: false })`. Returns a new reference and leaves `cap` as it was. | `ty:435-456`, `dc:146-151`, `tc:80-93`, `tc:241-256`, `tbi:161-186`, `tbi:469-492` |
| How is one turned on? | `cap.presets({ name: true })`, or a function override. | `mg:239-244`, `tc:257-273`, `tbi:448-467` |
| Does turning a preset off remove the capability's `resources`, state or `fns`? | No. The required top-level fields install whatever presets say. A preset that itself declares `resources` or state takes those away when it is off. | `mg:725-731`, `tbi:161-186` |
| What does a preset do to `ctx.cap` helpers? | Nothing. `fns` is not preset-controlled. | `ty:64-148`, `bb:302-312` |
| Unknown preset name? | Compile error on `.presets()` and `.with()` for a TypeScript caller (`PresetOverrides` keys are the declared names). At runtime `.presets()` itself does not throw; the block that lists the capability throws when it is built: `Unknown preset "<name>" on capability "<cap>"`. **[ran]** `.presets({ zz: true })` returned a reference, and `mergeCapabilities` then threw. | `ty:535-546`, `mg:222-229`, `tc:301-318` |

Facts about the table:

1. **Two references to one capability in one block: the first one reached wins for presets.** Dependencies are reached before their dependents, depth first. A later reference to the same capability keeps nothing of its own preset overrides; only its config is compared (O-4). **[ran]** `flattenCapabilities([c.presets({ a: false }), c])` merged only preset `b`; `flattenCapabilities([c, c.presets({ a: false })])` merged `a` and `b`. `p-auth:238` says "Presets keep their first-wins behavior" (same claim; **carried**). (`mg:154-160`, `tc:184-202`.)
2. **The `p-use` claim that `.presets()` errors "at factory time" is imprecise.** The throw is at the build of the block that lists the capability (`mg:222-229`); the `.presets()` call returns. See "Rows from other pages".
3. **Presets that exist on a named capability are that capability's own page.** `p-use:30-37` shows `.with({ tools: false })` and `.with({ recentContext: false, fullContext: true })` on `workingMemoryCapability as memoryCapability`. Those preset names do not exist on that capability (it has none). **Not carried.** The page's example is `orders` (`tools` and `context` presets).

## Table P-3: Preset override forms (`PresetOverrides`, `ty:535-554`; `mg:236-252`)

| Form | Example | Effect | Cite |
| --- | --- | --- | --- |
| Boolean | `{ tools: false }` | Off or on. | `ty:539-540`, `mg:239-244` |
| Function | `{ tools: (preset) => ({ tools: [other] }) }` | Receives the preset's declared object and returns a partial; the result is spread over the preset (`{ ...preset, ...returned }`, a shallow replace by key). It also turns the preset on, including a preset not in `default`. Use it to change one preset's tools or context for this block. | `ty:548-554`, `mg:246-252`, `tc:274-300`; **[ran]** a function override on a default-off preset made it active and its returned `context` replaced the original |

The function form's argument is typed as that preset's `PresetDef` (`ty:541-545`). It cannot take a typed value from the consumer or see which other presets are active; that is what config is for (O-1). (`p-auth:244`.)

## Table B-1: `.presets()`, `.config()`, `.with()` (`ty:435-506`, `dc:146-227`)

`.presets()` and `.config()` always return a new reference; `.with()` returns the receiver itself when the bag has no preset keys and writes no config (`.with({})` on a capability with no `config`). None changes the original (`dc:214-226`). They can be chained in either order and carry both overrides and config. Two references to one capability dedupe by the original object, whatever was configured.

| Builder | Takes | Compile-time rule | What it does | Cite |
| --- | --- | --- | --- | --- |
| `.presets(overrides)` | `{ presetName: boolean \| fn }` | keys are the declared preset names | Records overrides. | `ty:443-456`, `dc:146-151` |
| `.config(value)` | the config schema's input type (`z.input`); the resolver parameter's type when schemaless | argument type is `ConfigArgOf`; `never` for a capability with no `config`, so the call fails to compile | Records the value. | `ty:458-478`, `ty:338-342`, `dc:152-154`, `tcft:32-48`, `tcft:74-79` |
| `.with(bag)` | a flat bag | the config input intersected with the preset overrides; preset overrides alone when no config; the config value alone when no presets; a scalar or array config is the whole argument | `.presets` and `.config` in one call. | `ty:480-529`, `dc:155-227`, `twt:116-186` |

`.with()` routing, in order (`dc:168-227`):

1. A bag that is not a plain object (a scalar, array or `null`) is the whole config value. No presets can ride with it. (`dc:171-173`, `tw:86-105`.)
2. A key that names a preset (any key of `presets` except `default`) is a preset override. (`dc:189-190`.)
3. Any other key is config, if the capability declares `config` and the key is a field of its closed object schema, or the config schema is open: `passthrough`, scalar, array or schemaless. (`dc:191-195`, `tw:124-135`.)
4. A key that is neither throws at the `.with()` call: `.with() on capability "<name>" received key(s) [<keys>] that match neither a preset nor a config field — a misspelled preset name would otherwise route silently into config. Presets: [<names>]. Config fields: [<names or "(open — any key)" or "(none — no config)">].` It throws when the capability has no `config` at all, and when `config.schema` is a strip or strict object and the key is not one of its fields. (`dc:161-166`, `dc:199-212`, `tw:137-155`.) It does not throw for a `passthrough` object, a scalar, or a schemaless config: non-preset keys pass through as config. (`tw:124-135`.)
5. A bag with preset keys only does not write config, except that an empty bag `{}` on a config-capable capability writes an empty config, so `.with({})` equals `.config({})`. (`dc:214-226`, `tw:107-122`.)

Equivalences: `.with({ allowed, dynamicActivation: true })` is `.config({ allowed }).presets({ dynamicActivation: true })` (`dc:155-159`, `tw:38-48`); both chain orders give the same merged surface (`tcf:137-167`).

## Table O-1: Open config (`config: { schema?, resolve }`, `ty:186-216`, `dc:63-74`)

| Piece | What it is | Cite |
| --- | --- | --- |
| `schema` | Optional Zod schema. Validates the value given to `.config()` and types it: the `.config()` argument is `z.input`, the resolver's first parameter is `z.output`. A `.default()` field is optional at the call and present in the resolver. | `ty:196-206`, `tcft:17-41` |
| `resolve(config, ctx)` | Maps the validated value onto a partial block surface (the keys of table P-1), merged like a preset. Runs when a block that lists the capability is built, so it must be pure. A throw is wrapped: `Config resolver for capability "<name>" threw: <message>`. | `ty:207-215`, `mg:691-701`, `tcf:219-232` |
| `ctx.presets` | `ReadonlySet<string>`: the capability's presets that are active for the block being built. The capability decides whether a config value replaces or adds to what a preset contributes. | `ty:179-184`, `mg:737-740`, `tcf:100-131` |
| `ctx.blockKind` | The consuming block's kind. | `ty:183`, `mg:737-740` |

Facts about the table:

1. **Config is optional only if its schema accepts `undefined`.** Use `z.object({ ... }).default({})` for a capability usable with no `.config()` call. A plain `z.object` rejects `undefined` even when every field is optional. A schema that rejects `undefined`, or a schemaless config, makes `.config()` mandatory: omitting it throws at build, `Capability "<name>" requires configuration: call .config(...) on it (its config schema does not accept an absent value).` (schema) or `Capability "<name>" declares schemaless config and must be used with .config(...).` (schemaless). (`ty:196-206`, `mg:652-690`, `tcf:180-208`, `tw:70-74`.)
2. **A wrong shape throws at build:** `Invalid config for capability "<name>": <zod message>`. (`mg:673-675`, `tcf:173-178`.)
3. **A resolver's surface obeys the block-kind rules of P-1**, and the error names `config` as the source: `Capability "banner" config declares context, ...`. (`mg:499-501`, `tcf:234-239`.)
4. **The same capability twice with different config throws; identical config is allowed.** `Conflicting .config() for capability "<name>": the same capability is used more than once with different configuration. Pass identical config, or configure it in a single place.` Compared on what the schema parses to, so omitting a defaulted field is not a conflict, and a bare reference equals `.config({})` on a schema with a top-level `.default({})`. Schemaless: a bare reference versus a configured one is a conflict, and two configured ones compare by value. (`mg:53-101`, `tcf:246-313`; `p-auth:238`.)
5. **Config is for static `uses` only.** A capability that declares `config` and is reached through a dynamic `uses` function, directly or nested inside a dynamically returned capability's own `uses`, throws when the dynamic function runs (at request time, not build time): `Capability "<name>" declares open config but was reached through a dynamic uses resolver, which is not supported. Use it on a static uses entry.` (`gen:160-178`, `tcf:319-333`; **[ran]** nested case threw the same text; `p-auth:248`.)
6. **Config versus the other two ways to tune** (`p-auth:240-246`): a function preset override changes one named preset and cannot take a consumer value; config takes a typed value and the resolver decides what it means; a factory function (`createXCapability(options)`) does build-time structural work such as choosing a resource's scope (`p-c11:122-145`). Carried as a three-row table.

## Table D-1: Static and dynamic `uses` entries (`ty:593-607`)

`uses` on a block or a capability is `readonly UsesEntry[]`. An entry is a capability reference (static) or `(ctx: BlockContext) => readonly CapabilityRef[]` (dynamic). All five block kinds take `uses`: `handler`, `generator`, `evaluator`, `router`, `sequencer` (`handler.ts:109`, `gen:569`, `ev:391`, `router.ts:133`, `sequencer-methods.ts:493`).

| | Static entry | Dynamic entry (function) | Cite |
| --- | --- | --- | --- |
| When it is read | Once, when the block is built | Every run of the block, with that run's `ctx` | `rc:84-149`, `gen:2937-2961`, `gen:3017-3033` |
| `resources` | Installed, bubbled up to the flow | **Not installed.** The block has no declared resources from it and the capability is not in the block's resolved list | `rc:100-119`, `rc:131-147`; **[ran]** a handler with `uses: [() => [capWithResource]]` had no declared resources; the same capability listed statically declared `notes` |
| State schemas, `stateSchema`, `targetStateSchemas`, `sequencerStateSchema` | Installed | Not installed | same |
| `fns` / `ctx.cap.<name>` | Built | **Not built** (the helper namespace comes from the static resolved list) | `bb:302-312`, `rc:142-147` |
| `context`, `tools`, `controlTools`, `history` presets | Merged at build | Resolved each run, from the capability's active presets, its own and those of its static `uses` dependencies | `gen:144-206`, `gen:217-235`, `gen:2937-3033` |
| `model`, `providerOptions`, `caching` | Merged | Not read | `gen:160-206` (only context, history, tools, controlTools are collected) |
| Open `config` | Allowed | Throws when the function runs (O-1 fact 5) | `gen:171-178` |
| `itemVisibility` filter | Applied | Applied to each returned capability | `rc:125-129`, `gen:226`, `gen:2947`, `gen:3022` |
| Types | Reflected in `ctx` | Contribute nothing to types | `ty:617-624`, `tinf:58-65`, `tinf:146-157` |

Answers to the lookups:

- **Can a dynamic `uses` entry install a resource? No.** Resources must exist before the block runs, so declare them on the capability or on a static entry (`ty:593-601`, `p-auth:274`, `p-auth:287`). A dynamic function may return a capability that has resources; they are simply not installed (**[ran]**). So list the resource-bearing capability statically beside the dynamic entry.
- A dynamic entry on a handler, router, sequencer or evaluator does nothing: only a generator collects dynamic context, history and tools (`gen:2937-3033`; `rc:111-119` returns `mergedSurface: undefined` with only dynamic entries). **[ran]** a handler with only a dynamic entry had zero resolved capabilities.
- Dynamic entries nested in a capability's own `uses` are collected too, and run with the same rules (`mg:172-180`, `rc:121-128`; **[ran]** a generator listing a capability whose `uses` held a function got that function's context).

## Table I-1: What `uses` reflects into `ctx` types

Only the capability's top-level declarations are read, and only for capabilities listed directly in the block's `uses`.

| Capability field | Appears as | Cite |
| --- | --- | --- |
| `sessionStateSchema` | `ctx.session.state` | `ty:639-665`, `tfwd:90-101` |
| `resources` | `ctx.resources.<key>` (a resource ref or collection ref) | `ty:668-685`, `tfwd:158-163` |
| `targetStateSchemas` | `ctx.targets.<key>` (a state ref, possibly undefined) | `ty:688-705`, `tfwd:165-170` |
| `sequencerStateSchema` | `ctx.sequencer.state` | `ty:747-763`, `tfwd:172-177` |
| `stateSchema` | `ctx.self.state` | `ty:766-785`, `tfwd:179-182` |
| `fns` | `ctx.cap.<name>` | `ty:614-629`, `tinf:44-56` |

Each `*Type` override in C-1 replaces the type for its row (`ty:645-657`, `tfwd:133-147`); the override survives `.presets()`, `.config()` and either chain (`tcft:50-72`).

Limits, each stated by a test or a type:

1. **Preset- and config-contributed schemas are not reflected.** A schema supplied only through a preset or a config resolver merges at runtime (the container exists, `ctx.self` is populated) but adds nothing to the types. Declare it at the capability's top level to have it typed. (`ty:639-665`: the inference reads `TSessionStateSchema` etc., the top-level generics; `p-use:150`.)
2. **`requestStateSchema`, `userStateSchema` and `orgStateSchema` are never reflected.** There is no inference utility for them (`ty:613-785`), and the blocks' type parameters read their own schema only (`ev:324-327`, `handler.ts:50-59`). They still merge at runtime (`mg:515-523`). **New row; not in any earlier record.**
3. **Directly listed only.** A capability's `uses` dependencies contribute nothing to the block's types, though they install at runtime (including their `fns` at `ctx.cap.<name>`, `bb:302-312`, `rc:122-144`; **[ran]** a handler listing `outer` (which `uses: [inner]`, both with `fns`) resolved `inner` and `outer`). To have an inner capability's schemas typed on the consumer, redeclare them on the outer capability. (`ty:617-629` reads only `TUses[number]`; `p-use:187`.)
4. **Dynamic entries contribute nothing** to types (D-1). `tinf:58-65` pins `InferCapabilities` of a dynamic-only list as `{}`.
5. **A capability with no `fns` types as `ctx.cap.<name>: Record<string, never>`** (`tinf:104-112`), but at runtime there is no `<name>` key at all (`bb:308-309` writes a key only for a capability whose `fns` is defined). Reading `ctx.cap.<name>` on such a capability yields `undefined`. The page says: a capability with no `fns` exposes nothing on `ctx.cap`. (This resolves the "Helpers" row on R-10.)
6. **A sequencer's `uses` capabilities are not typed on its context.** The sequencer's `ctx` hard-codes no capability helpers (`seq:2591`). Handler, generator, router and evaluator are typed (`handler.ts:50-65`, `gen:507-518`, `router.ts:82-95`, `ev:323-336`, `tevc:30-66`).
7. **The `ctx.cap` namespace is the intersection over the listed capabilities, keyed by `name`** (`ty:613-629`, `tinf:52-56`).

## Table F-1: What each field installs, and when

"At build" means when the block (handler, generator, ...) that lists the capability is constructed, which is before any request. A refusal there is a thrown error at the line that builds the block.

| Capability part | Lands on | When | If two sources declare the same thing | Cite |
| --- | --- | --- | --- | --- |
| `resources` (top level or preset) | The block's declared resources; bubbles through sequencers and routers to the flow, so a flow that includes the block declares nothing | At build | Same `defineResource` reference: one install. A different reference under one accessor key throws: `Resource conflict in capability "<cap>" (<source>): accessor "<key>" is declared with different defineResource() references`. The same rule applies between a capability and the block's own `resources`: `Resource conflict: accessor "<key>" is declared with different defineResource() references. Use the same reference across blocks.` | `mg:322-342`, `mg:770-789`, `tbi:42-122`, `tc:337-397`, `tc:841-872`, `p-use:103` |
| `sessionStateSchema`, `requestStateSchema`, `userStateSchema`, `orgStateSchema` | The flow's scope state defaults (session, user, org), from top-level fields of statically listed capabilities only. A preset, resolver or dynamic entry contributes none. `requestStateSchema` is applied nowhere. | At `defineFlow` | Every declaration of a session, user or org field (flow, blocks, capabilities) is compared, and two that disagree on the type or the default are refused, naming both: for example `capability "cap-a" (used by block "both") defaults it to 1 and capability "cap-b" (used by block "both") to 2`. A field only one side names is unioned in. | `dfl:768-826`, `ssm:1-40`, `esd:924-930`. The block-level last-wins `extendSchema` (`mg:356-369`) feeds an accumulator nothing reads, so the page does not state it. |
| `stateSchema` (own state, `ctx.self`) | The block's own state; any block kind | At build | A field declared by two sources (two capabilities, or a capability and the block's own `stateSchema`) must be the same schema object, or the block throws `Own-state conflict (<where>): field "<key>" is declared by two sources with different schema references. Two contributors to the same ctx.self field must share the schema definition (reference one constant) or use distinct field names.` Both sides must be `z.object()`. | `mg:421-481`, `tbi:761-935`, `p-use:148`, `p-auth:90` |
| `targetStateSchemas` | The block's `ctx.targets` | At build | Same schema reference: one. Checked only among capabilities (`mergeTargetsInto`): a different reference under one name across capabilities throws `Target conflict in capability "<cap>" (<source>): "<name>" is declared with different schema references`. Not checked against the block's own `targetStateSchemas`: `ctx.targets` is an untyped Proxy at runtime, the block's schema wins at the type level and conflicting types collapse to `never`. | `mg:375-395`, `mg:552-556`, `rc:131-140`, `ty:729-731`, `tc:659-705` |
| `sequencerStateSchema` | The sequencer's state, absorbed with the sequencer's own `stateSchema` | At build | Two capabilities, or a capability and the sequencer's own state, must agree on a shared field's kind (wrappers `.default()`, `.optional()`, `.nullable()` ignored); a mismatch throws `SequencerSchemaMismatchError` naming the sequencer and the field. When two capabilities agree, the later one's schema is kept; when a capability and the sequencer's own `stateSchema` agree, the sequencer's field is kept. A capability field that is new to the sequencer joins, with its default; a field that rejects `undefined` joins as optional. Both must be `z.object()`. | `mg:525-543`, `sq:33-131`, `esb:329-398`, `p-auth:346-350` |
| `fns` | `ctx.cap.<name>` | The factory runs when the block runs, once per run, unless an ancestor block already built the same name (then the ancestor's is kept) | Two capabilities with one name: error (C-6). | `bb:291-312`, `tnest:20-117` |
| preset `context` | Generator's `context` array, appended after the block's own | At build (static); each run (dynamic) | None: entries concatenate. Object-form entries from several capabilities under one key render in one XML tag; incompatible shapes under one key make the render throw. | `mg:558-570`, `gen:2926-2961`, `p-auth:145-166` |
| preset `tools` | Generator's tool list, unless the generator declares `tools:` | Each run | None: all included; the same tool instance is deduped by identity, and two tools of one name are refused | `mg:572-581`, `gen:2971-3036`, `tfn:106-238` |
| preset `controlTools` | Generator's tool list, always | Each run | None | `mg:583-592`, `tfn:178-223` |
| preset `history` | The generator's history reads | Each run | Queries merge in order, later keys win; the read's own keys win over all | `mg:594-603`, `gen:217-235`, `thi:47-146` |
| `model`, `providerOptions`, `caching` | The generator, when the block sets none | At build | Last capability wins; the block's own wins | `mg:605-633`, `gen:2903-2925`, `tbi:644-736` |

Facts about the table:

1. **Validation is at build, not "factory time".** `p-use:109` and `p-auth:74` say "factory time", which a reader may take as the `defineCapability` call. The throws above fire where the block is built (`handler(...)`, `generator(...)`, `sequencer(...)`), or at `defineFlow` for the flow-level state merge. `defineCapability` itself throws only for an empty name and a preset/config name overlap (C-1 facts).
2. **"A block's own declaration wins for most axes" is not true.** The block's own declaration wins only for the singletons `model`, `providerOptions`, `caching` and for `history` keys (the read's own keys), and the block's own tools come first. A resource accessor, a target, and an own-state field declared by both a capability and the block must be the same reference or schema, or the build throws (`mg:335-340`, `mg:389-392`, `mg:436-440`, `mg:784-787`). **R-10's rows from C-11 said this correctly (corrected by pass 5); `p-use:148` still says "For most axes the block's own declaration wins on key collision" and is dropped.**
3. **`fns(ctx)` is called with the running block's `ctx`** (`bb:309`, `ty:296`).
4. **The flow gets the resource from the block.** `defineFlow` merges the declared resources of every block it reaches (`dfl:770-800` for scope state; `p-use:103` for resources; `tbi:188-216` for a sequencer).

## Table C-6: Composition and build-time refusals (`mg:128-195`, `mg:41-101`)

| Situation | Result | Cite |
| --- | --- | --- |
| A capability lists dependencies in `uses` | Dependencies install first, transitively, and a dependency reached by two paths installs once, with the presets of the first reference reached; different `.config()` values throw (`mg:70-101`, `mg:154-159`) | `mg:128-195`, `tc:143-162`, `tbi:494-607` |
| A cycle (A uses B, B uses A) | Throws at build: `Capability cycle detected: "<name>" depends on itself (transitively)` | `mg:148-152`, `tc:163-174` |
| Two different `defineCapability()` calls with one name, both reached by one block's flattened `uses` | Throws (`defineCapability` itself never checks; two blocks that each list a different one build fine): `Capability name collision: "<name>" is declared by two different defineCapability() calls` | `mg:161-165`, `tc:175-183` |
| One reference listed in two places with different `.config()` | Throws (O-1 fact 4) | `mg:157-159` |
| One reference listed in two places with different `.presets()` | The first reached wins (P-2 fact 1) | `mg:154-160` |
| A capability's `itemVisibility` does not match the block's | The capability is dropped for that block, independently per capability; the filter is not transitive through `uses` | `rc:36-54`, `rc:125-129`, `tvis:52-210` |
| The same capability in a sequencer and in one of its steps | Resources dedupe | `tbi:218-240` |

Facts about the table:

1. **`itemVisibility` on a capability is an allowlist.** A capability with `itemVisibility: { client: true, history: true }` is dropped for a sub-agent generator whose `itemVisibility` is `{ client: true, history: false }`; a block with no `itemVisibility` counts as `{ client: true, history: true }`; an array lists several allowed values (`rc:36-54`, `tvis:52-127`, `tvis:192-208`). A dropped capability contributes none of its parts, including its tools preset (`tvis:129-167`) and, for a capability reached through a dynamic function, the same check applies (`gen:226`, `gen:2947`, `gen:3022`).
2. **Evaluators:** `uses` brings resources, state and helpers, never model, tools or context (`ev:386-391`; context/tools on an evaluator throws as in P-1 fact 1).

## Table G-1: A generator's `tools:` and a capability's tools

(Stated from the generator's side in `p-gen` table G-6; this page carries the capability side. Link, do not restate in full.)

| The generator | Capability `tools` preset | Capability `controlTools` | Cite |
| --- | --- | --- | --- |
| declares no `tools:` | reach the model | reach the model | `tfn:225-237`, `gen:2974-3036` |
| declares `tools: []` | dropped | reach the model | `tfn:106-131`, `tfn:178-192` |
| declares `tools: [a]` or a function | dropped, unless the generator names that tool itself, which then arrives through the generator's own list | reach the model | `tfn:133-176`, `gen:2989-3013` |

- What the fence tests is the declaration of the slot, not the list's length (`gen:2974-2980`, `tfn:107-131`, `tfn:225-237`). A `tools:` function fences the same way, and the resolved list is recomputed each run (`tfn:146-159`).
- Dynamic capability tools behave the same: fenced by a declared `tools:`, with control tools through (`tfn:120-131`, `tfn:194-207`). The fence short-circuits: behind a declared `tools:`, the preset's tool functions are not even called (`gen:3017-3033`).
- Context, resources, state and `fns` always arrive (`gen:2926-2961`, `tfn:225-237`).
- One capability can have both: its `tools` half fenced, its `controlTools` half not (`tfn:209-223`). Use `controlTools` only for a tool whose presence the block's own configuration already implies, such as a skill loader a block switched on, built inside the capability and never exported, so no `tools:` list could name it. A grant the block did not ask for (memory recall, MCP, resource tools) belongs in `tools` (`ty:99-121`).
- To keep one catalog tool behind a declared `tools:`, name it in the list. A capability may expose the tool for that purpose (memory's `system()` exposes `mem.tool.recall()`, which is the memory page's, not this one's; `p-use:128`).

## Stored parts: the four questions

A capability keeps no data of its own. What it declares are shapes and wiring; the data lives where each part's scope puts it. Per stored part:

| Part | Who owns it | Who can see it | Where it is stored | How many exist |
| --- | --- | --- | --- | --- |
| `resources` entry | The resource's `scope`: `session` (the session), `user` (the user, shared across every flow that user touches), `org` (the org) | Every block that lists the capability gets the accessor on `ctx.resources`; the browser sees it only through the resource's client config | The session, user or org store the resource's `scope` names, under the resource's `ref` | One per session for `session`; one per user (or per org) for `user` (or `org`); one per flow instance too when `flowIsolation: true`; one per session lineage when `sharedToLineage: true` (session scope) |
| `sessionStateSchema`, `userStateSchema`, `orgStateSchema` (fields) | The scope's record | Every block in the flow that reads that scope; the browser sees only fields the scope's client config exposes | The scope's record | One record per session, user, or org; the capability adds fields to it |
| `requestStateSchema` (fields) | Nothing: applied nowhere (revise round 1). The page does not describe request-state storage. | n/a | n/a | n/a |
| `stateSchema` (own state, `ctx.self`) | The block that lists the capability | That block, and its immediate children as `ctx.parent` | In memory for one run of the block; not persisted across a suspend; transient in production so a client cannot read it back | One per run of that block, a fresh one each run |
| `sequencerStateSchema` (fields) | The sequencer that lists the capability | Steps inside it as `ctx.sequencer` | The sequencer's own state; a durable sequencer checkpoints it at each step (latest only) | One per execution of one sequencer instance |
| `targetStateSchemas` | none; it stores nothing | The block, as a typed handle onto a named ancestor block's state | Nowhere of its own | none |
| `fns` | none | The block that lists it | Nothing stored; the helper object is built per block run | none |
| `.config(value)` | The code that wrote it | The resolver, at build | The reference in app code, never a store | One per `.config()` call |

On the page (revise round 1) this table is cut to where each part's data lives, with links; owner, visibility and count detail moved to Resources (R-08), Flows (R-05) and Blocks (R-01). Cites: resource scope and `flowIsolation`/`sharedToLineage` `res:20-23`, `res:190-250`, `res:622-638`; scope levels `p-res:378-386`, `p-res:331`; scope records and client exposure `p-sc:20-25`; own state `p-bs:8-23`, `p-bs:61`, `p-bs:117-121`; sequencer state `p-ss:7`, `p-ss:29`, `p-ss:119-124`; targets `p-tgt:5-30`; `p-c11:149` ("A capability stores nothing itself. Its resource does"). `p-bs:119` says own state is "transient by default in production" and "a non-sequencer block that suspends mid-execution loses its in-memory state on resume today" (`p-bs:121`).

Whose copy it is: a capability reference is shared app code, not user data, so there is no per-user copy of a capability to edit. Editing it in code changes every block that lists it, which is the point (`p-c11:153`).

## Rows from other pages

`grep -rhE --include=*.record.md -e '→ R-10( \(corrected by pass 5\))?$' docs/contributing/docs-revamp/pages` returns 21 rows: 15 from the C-11 record (its sixteenth row, "Addressing modes", goes to R-01 and is not mine), one each from worker-md, memory, models and recall-tool, and two from type-helpers. Each checked against the code. Result per row, in the order the sheet lists them:

| # | Row (shortened) | Disposition | Where / why |
| --- | --- | --- | --- |
| 1 | recall-tool: a generator with its own `tools` list does not receive the capability's tools; add `mem.tool.recall()` | **Carried, generic part** | G-1. The `mem.tool.recall()` spelling is memory's, stays on the Memory reference (`p-use:128` names it once; not repeated here). |
| 2 | Dependencies install transitively; a base capability shared by two installs once | **Carried** | C-6; `tc:143-162`, `tbi:494-607` |
| 3 | Refusals: `.with()` throws for a non-preset key on a config-less or closed-schema capability; passthrough, scalar or schemaless config pass through; unknown preset passed to `.presets()` throws when a block builds, not at the call (corrected by pass 5) | **Carried, true** | B-1 steps 3-4; P-2; `dc:161-212`, `mg:222-229`; **[ran]** |
| 4 | `.with()` routing: preset key toggles; config field is config; neither throws for config-less or closed-schema, passes for schemaless, scalar or passthrough; a non-object bag is all config (corrected by pass 5) | **Carried, true** | B-1; `dc:168-227` |
| 5 | Open config validation: wrong shape is a build-time error; same capability twice with conflicting config throws, identical allowed | **Carried** | O-1 facts 2 and 4 |
| 6 | `.presets({ name: boolean })` and `.config(value)` compose in either order; `.with()` is both in one call | **Carried** | B-1; `tcf:137-167` |
| 7 | Helpers: a capability with no `fns` installs resources and state and exposes nothing on `ctx.cap.{name}` | **Carried, with a sharper statement** | I-1 limit 5: the type says `Record<string, never>`, the runtime has no key |
| 8 | What each field installs and where it lands; validation at factory time | **Carried; "factory time" corrected** | F-1; the throws are at the block's build (F-1 fact 1) |
| 9 | Generator `tools:` slot: declared (even `[]`) drops capability tools; omitted lets them through; context, resources, state and helpers always arrive | **Carried** | G-1 |
| 10 | Control tools reach the model whatever `tools:` says | **Carried** | G-1; `tfn:178-223` |
| 11 | Type inference map: each capability field and the `ctx` location it types | **Carried, extended** | I-1. `p-use:145` labels `sequencerStateSchema` "(preset)": it is a top-level field and also valid in a preset, but inference reads only the top level (limit 1). Added: request, user and org state are never reflected (limit 2); a sequencer's own `ctx` is not typed (limit 6). |
| 12 | Merge and collision rules (corrected by pass 5): resource accessor, target, `stateSchema` field must share the reference; block's own wins only for singletons | **Carried, true** | F-1 fact 2. Added the scope-state rule: block-level last wins, and `defineFlow` refuses disagreements (F-1 row 2). |
| 13 | Inference limit: preset-only or open-config schemas merge at runtime but are not reflected in `ctx` types | **Carried** | I-1 limit 1 |
| 14 | Limit: inner capability schema contributions do not flow to the block using the outer one | **Carried, qualified** | I-1 limit 3. True for types only; at runtime a dependency's resources, state and `fns` all install. The row as worded could be read as a runtime limit. |
| 15 | Static versus dynamic `uses`: function entries contribute context, tools and `controlTools` at runtime and nothing to types | **Carried, extended** | D-1. Adds `history`; adds that a dynamic entry installs no resource, state or `ctx.cap` helper, collects no `model`/`providerOptions`/`caching`, rejects open config. |
| 16 | Type-only overrides: `sessionStateType`, `resourcesType`, `targetStatesType`, `sequencerStateType`, compile-time only | **Carried, corrected** | There are five. `stateSchemaType` types `ctx.self` (`ty:275-276`, `dc:62`, `dc:91`). C-1. |
| 17 | worker-md: default presets when none named, tools off by default, refusal of an unknown capability or preset | **Carried in part; part dropped** | Carried: with no `default` list every preset is on; an unknown preset throws at build (P-2). **Dropped: "tools off by default".** For a capability on a block, a `tools` preset is on like any other unless `default` leaves it out. "A worker that names none gets each installed capability's own default presets and none of their tools" is the `WORKER.md` `capabilities:` hiring rule (`worker-md.facts.md:111`, `W/worker-capabilities.ts:285-352`) and stays on the WORKER.md reference. The refusal "unknown capability" at hire is also that page's. |
| 18 | `uses` reflects into ctx types: static entries only, directly listed only; function entries contribute nothing | **Carried** | I-1 limits 3 and 4 |
| 19 | `.config()` argument type and compile-time refusal when no config is declared | **Carried** | B-1 (`ConfigArgOf`, `tcft:74-79`) |
| 20 | `model`, `providerOptions`, `caching`: generator-only, merge-time error text, last wins, block wins | **Carried** | P-1 (last row, fact 1, fact 4); exact text `... declares model, but the consuming block is a <kind>. model is only valid on generator blocks.` (`mg:608-613`, `tbi:738-758`) |
| 21 | memory: presets change prompt and tools only; capture pipeline and `ctx.cap` helpers unaffected | **Carried in part; part dropped** | Carried: a preset never controls `fns`, so `ctx.cap` helpers and a capability's top-level resources are unaffected by presets (P-2). **Dropped: "change only prompt and tools".** In general a preset can also declare resources, state schemas, targets, `history`, and `model` (P-1), so "only prompt and tools" is true of the memory capability's presets and not of presets. The capture pipeline is memory's, stays on the Memory reference. |

## Claims on today's pages the page does not carry

- `p-use:11-37`, `p-use:67`, `p-use:30-37`, `p-use:81-93`, `p-auth:49-69`, `p-auth:101-119`, `p-auth:170-179`, `p-auth:260-264`, `p-auth:316-324`: the memory examples (`workingMemoryCapability as memoryCapability`, `ctx.cap.memory.remember`, `.recall`, presets `recentContext`, `fullContext`, `tools`). `workingMemoryCapability` is named `workingMemory`, has helpers `add`, `evict`, ... and no `remember`/`recall`, no presets, no context formatter, no tools (the C-11 record's pass 5 found this; `packages/memory/src/capabilities.ts:49-89`). The page uses `orders`.
- `p-use:40`: "errors at factory time" for an unknown preset to `.presets()`. See P-2 row 6.
- `p-use:148`: "For most axes the block's own declaration wins on key collision." See F-1 fact 2.
- `p-use:187` and the heading "Direct only": carried as I-1 limit 3, qualified for runtime.
- `p-auth:181`: "The type system enforces block-kind compatibility." See P-1 fact 1.
- `p-auth:316`: "the result is cached". The factory runs once per block run and is not stored beyond that (`bb:302-312`); one more run builds a new object. Not carried.
- `p-auth:338`: "Session, request, user, org state schema: same reference: merged via `.extend()`; different references: last-wins for matching keys". True for the block-level merge (`mg:356-369`); not the whole truth, because `defineFlow` refuses a field two declarations disagree on (F-1 row 2). Carried as F-1 row 2.
- `p-use:96-109` and `p-auth:72-88` tables list Context formatters and "Preset `controlTools` merged into generator's tools, whatever the generator declares" correctly; `p-auth:86` "Preset `sequencerStateSchema` | Merged into sequencer's state schema" omits that a capability's `sequencerStateSchema` on a non-sequencer throws. Carried with that added (F-1).

## Not verified, left off the page

- Real provider behavior of `providerOptions` and `caching` set by a capability. Only that they reach the generator config when the block sets none was read (`tbi:710-736`).
- How `uses` reaches an agent through `defineAgentWorkerFlow` or a kit's `uses` slot, and which presets a worker may pick. That is the Workforce reference (`W/worker-capabilities.ts` is its code); the page does not state it.
- `PresetDef.stateSchema` merge when the own-state schema is not a plain `z.object` with default policy: `mg:413-419` says a non-default `.strict()`/`.passthrough()`/`.catchall()` on a merged own-state schema is not preserved. No test pins it; left off.
- That an `orgStateSchema` or `userStateSchema` declared by a capability reaches the flow's scope-state defaults for a capability reached only through a *dynamic* entry: `dfl:770-800` documents "Dynamic uses and presets contribute none", consistent with D-1. No test of the dynamic case was read; the page says only "not installed".
- `ConfigArgOf` and `WithArg` as public types for readers to write against: they are exported (`ix:164-177`) but the page need only name what a reader calls. The page lists them in the import line and does not document their conditional logic.
- A `string[]` value in `presets` (`ty:302`, `dc:53`) is typed as allowed so the `default` key fits the same record; it has no meaning as a preset and is not mentioned.
- Tracker identifiers appear in code comments next to these fields. None is on this sheet or goes on the page.

## Words and shapes the writer may use

- "listed in `uses`", "a block that lists the capability". Not "attach" and not "plugin".
- The `orders` example. Capability field names in code font as written above. Error texts verbatim in a lookup table, not narrated.
- Tables the page can split to stay at six rows each: C-1 by what the field installs (always-on parts; helpers and composition; presets and config; type-only), P-1 by block kind (any block; generator only), D-1 by what each entry kind does.

## Draft notes (pass 3)

- Rows from other pages: all 21 were carried as the sheet's table above dispositions say. Rows 17 (worker-md) and 21 (memory) are dropped in the parts named there ("tools off by default"; "change only prompt and tools"), because each is true of one surface (`WORKER.md` hiring, the memory capability) and not of capabilities in general. Row 1's `mem.tool.recall()` spelling is not on the page; the `tools:` fence is.
- Left off the page as mechanism or unverified: the `Not verified` list above, and the ordering note on which of two merged `sequencerStateSchema` is kept beyond one sentence.
- The dynamic-entry example (`uses: [orders, (ctx: BlockContext): CapabilityRef[] => ...]`) needs the return annotation: an untyped arrow in a mixed `uses` array fails to infer. Every example type-checked against `packages/core/src` in a scratch project (since deleted); a deliberately wrong file was rejected, so the check reaches the code.
- Vocabulary: the page says "kit" for the app-level unit and links Kits and slots only by saying a capability is not one.

## Revise round 1

- **Moved, not stated here any more** (target page holds it): the opening definition and "why" to Concepts (C-11); generator `model` required error, context order, history merge, tool order, dedup, the `tools:` fence table and `controlTools` guidance to Generators (R-02); per-kind preset keys and their error text, `ctx.self`/`ctx.sequencer`/targets lifetime and conflict rules to Blocks (R-01); resource identity and the conflict error to Resources (R-08); scope state merge at `defineFlow` to Flows (R-05); the block default `itemVisibility` to Items (R-06); `InferCapabilities`, the type-only fields and the inference limits to Type helpers (R-38).
- **Corrected after pass 5:** scope state schemas are not "merged into the block's schema". Only top-level `sessionStateSchema`, `userStateSchema` and `orgStateSchema` of statically listed capabilities reach the flow's defaults (`dfl:768-826`); presets, resolvers and dynamic entries contribute none; `requestStateSchema` is applied nowhere. A dependency reached by two paths installs once with the first reference's presets, and different `.config()` values throw.
- **`fns` in a nested block:** a block inside a block that lists the same capability receives the outer block's helper object, built with the outer block's `ctx` (`bb:302-312`, `tnest:57-85`).
- **`itemVisibility` and `uses`:** each capability, dependencies included, is checked against its own `itemVisibility`. A dropped capability does not drop its dependencies (`rc:125-129`).
- **Dynamic example** branches on `ctx.session.state.refundsEnabled === true`, a value that varies by session; type-checked in a scratch file against `packages/core/src`.

## Revise round 2

- **Examples now complete.** The page shows `tools/look-up-order.ts` (same handler as the Concepts page) and `capabilities/refund-rules.ts` (a capability with one `context` preset, `default: ["context"]`), so every import in the four earlier examples resolves. Prose no longer says where those files live.
- **`requestStateSchema`** is stated once on the page, in a sentence under the first fields table (accepted, applied nowhere). It was removed from the table, so the table has six rows, and cut from the `defineFlow` row of the install table.
- **Dedup versus config (B-1, C-6):** two references to one capability install it once. Different `.config()` values throw (O-1 fact 4); different `.presets()` take the first reached (P-2 fact 1). The earlier "whatever was configured" wording was wrong.
- **"Open" means a config schema with no fixed set of keys** (`passthrough`, scalar, array or schemaless), defined once in `.with()` routing step 3. The section is titled "Config". A capability that declares any `config` throws when reached through a dynamic function (O-1 fact 5), so the dynamic-entry rows say "`config`", not "open config"; the error text stays verbatim.
- Dropped from the page: the internal type name `ConfigArgOf`, the "singletons" wording, and the sentence that a capability "belongs to no user and stores nothing itself" (covered by "What a capability stores").

## Revise round 3

- **`requestStateSchema`** has its own row ("Accepted and ignored") in both the top-level field table and the preset table, so it no longer sits in a row with keys that do something. The sentence above the first table is gone.
- **Dynamic example:** the `orders` capability now declares `sessionStateSchema: z.object({ refundsEnabled: z.boolean().default(false) })`, so `ctx.session.state.refundsEnabled` is a declared field (`ty:639-665`) and `orders` is listed statically beside the dynamic entry. The Concepts page's `orders` has no such field; this page's intro line names it.
- **`.with()` step 4:** the throw happens at the `.with()` call, before any schema parses the value (`dc:199-212`). A strip or strict object counts as closed in steps 3 and 4, so the two agree; Zod's strip behaviour on parse is not reached.
- **Stored parts:** a config value "travels with the `.config()` reference in app code".

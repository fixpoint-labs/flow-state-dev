# Facts for Capabilities (C-11, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited.

Paths are from the repo root. Abbreviations:

- `dc` = `packages/core/src/capability/define-capability.ts`
- `ty` = `packages/core/src/capability/types.ts`
- `mg` = `packages/core/src/capability/merge.ts`
- `ct` = `packages/core/test/capability.test.ts`
- `bi` = `packages/core/test/capability-block-integration.test.ts`
- `fn` = `packages/core/test/generator-tools-fence.test.ts`
- `cn` = `packages/core/test/capability-ctx-cap-nesting.test.ts`
- `cw` = `packages/core/test/capability-with.test.ts`
- `ft` = `packages/core/test/flow.test.ts`
- `kb` = `examples/knowledge-base/src/capability.ts` (the one example; a frozen reference, not a public package)
- `use` = `apps/docs/docs/fundamentals/capabilities.md` (the page C-11 keeps)
- `aut` = `apps/docs/docs/advanced/capabilities-authoring.md` (to B-32 and Reference)
- `dk` = `packages/core/src/kit/define-kit.ts`
- `ci` = `packages/core/src/index.ts`

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/capabilities`; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften.

## Flags against the page plan (read first)

1. **The plan's example, `orders`, does not exist in the repo.** No capability named `orders`, `createOrdersCapability` or `draftReply` is in `packages/*/src`, `examples/` or `goals/`. The nearest real shapes are `kb` (a capability with a resource, `fns`, an `index` context preset and a `search` tools preset, built by a factory `createKnowledgeBaseCapability()`, `kb:80-178`) and the docs' `notesCapability` and `memoryCapability` (`aut:28-68`). The page's `orders` capability is made up; every API it shows must be one cited below, and every example must type-check (user-docs.md, Code examples). The made-up pieces (`lookUpOrder` tool, `ordersResource`, a context formatter) are the page's own and are declared on the page.
2. **Plan example 3 spells the toggle `orders.presets({ tools: false })`.** That is a real call (`dc:146-151`, `ct:80-93`, `ct:241-255`, `bi:161-186`). The existing user page leads with `.with({ tools: false })` instead (`use:89-104`). Both exist; `.with()` is the flat shorthand for the same thing (`dc:155-159`, `cw:38-48`). Use `.presets()` as the plan says and give `.with()` one sentence and a link, or leave `.with()` to Reference.
3. **The plan's "turning parts off" claim needs one correction on tools.** A preset named `tools` turns the tools off, but a capability's tools are also dropped when the block declares its own `tools:` list (see section 4). So "get the context but not the tools" has two true answers: switch the preset off (`orders.presets({ tools: false })`), or name `tools:` on the generator. The page can give the first and mention the second in one sentence.
4. **"Where must a capability's resources be declared?"** The plan's question 3. The supported reading is in section 5: resources are declared on the capability's `resources` (or a preset's `resources`), statically. A function in `uses` cannot add a resource. Only the static form is confirmed by source (`ty:590-598`) and by the old docs (`aut:274`, `aut:287`). No test builds a flow whose dynamic `uses` entry returns a capability with a resource and asserts the failure, so the failure shape is not stated. **[verify]** for the failure; the rule itself is [page].
5. **Kit versus capability (plan question 4).** Cited definitions only, in section 8; the choice is derived from them.
6. **`ctx.cap` is typed per the `uses` array.** The page does not need it, but the old page opens its "one line" story with it (`use:11`). Only mention `ctx.cap.orders` if the example's `fns` is shown.

## 1. What a capability is (opening, model figure)

- A capability is "a packaging layer over existing declare-in-config primitives. It bundles resource declarations, state schema fragments, target declarations, helper function factories, and optional presets under a single name. Blocks declare capabilities via `uses`, and the framework merges all declarations transitively into the block's effective config." `ty:2-9`. [page]
- Plain-words version on the existing page: "a bundle of resources, state, helpers, and block-level configuration packaged under one name." `use:8`; `aut:9`. [page]
- You install one by listing it in a block's `uses` array. `use:10`; `ty:6-8`. [page]
- `defineCapability` is exported from `@flow-state-dev/core`. `ci:110`. [page]
- A capability has a `name`. An empty or whitespace-only name throws `defineCapability() requires a non-empty name`. `dc:98-100`; `ct:51-61`. [ref]
- Two different `defineCapability()` calls with the same `name` in one block's `uses` throw `Capability name collision`. `mg:158-165`; `ct:175-182`. [ref]
- The returned object is the same reference reused across blocks; that is how a capability that two others both use is installed once. `dc:1-7`; `ct:143-153`. [ref]

## 2. What a capability carries (the three parts and the rest)

The page's three parts, each a field of `defineCapability`:

- **Resources.** `resources: { accessorKey: resourceDefinition }`, a flat map; scope is carried by each `defineResource({ scope })`. `ty:240-245`. A block that uses the capability has these in its declared resources. `bi:41-58` ("capability resources appear in declaredResources"); generator `bi:124-139`. [page]
- **Context.** A preset's `context` entry: a string, an object (keys become XML tag names), or a function `(input, ctx)` returning one of those or `null`/`undefined`. `ty:150-167`. Generator only. `ty:91-94`; refused on a handler: `bi:292-310`. [page]
- **Tools.** A preset's `tools`: an array of tools or a function of `ctx`. `ty:95-97`. Generator only; on a router it throws. `bi:312-338`. [page]

The rest (name, do not teach, link to Reference):

- State schemas: `sessionStateSchema`, `requestStateSchema`, `userStateSchema`, `orgStateSchema`, `sequencerStateSchema` and `stateSchema` (the block's own state, `ctx.self`), `targetStateSchemas`. `ty:246-258`. [ref]
- Helper functions: `fns: (ctx) => ({ ... })`, reached on `ctx.cap.<name>` during a run. `ty:296-297`; `use:116-136`. A handler nested as a sequencer step also gets `ctx.cap`. `cn:20-40`. [page if the example shows `fns`; else ref]
- A capability can itself `uses` other capabilities; they install with it, dependencies before dependents, and a shared one installs once. `ty:278-283`; `ct:143-161`; `bi:494-577`. [ref] A cycle throws `Capability cycle detected`. `mg:148-151`; `ct:163-173`. [ref]
- `itemVisibility` restricts a capability to blocks whose own `itemVisibility` matches. `ty:285-294`. [ref]
- A preset can also set a generator's `model`, `providerOptions`, `caching`, and a `history` query; `controlTools` (section 4). `ty:99-148`. [ref]

What lands where, in the old page's own words:

| Capability field | Where it lands |
| --- | --- |
| Resources | The block's resource declarations, bubbled up through sequencers to the flow. `use:140-141`; `aut:78` |
| Context formatters | Merged into the generator's context array. `use:144` |
| Tools | The generator's tool list, unless the generator declares `tools:` itself. `use:145` |
| Helper functions | `ctx.cap.{name}`. `use:143` |

[page: the three rows the example uses; the rest ref]

A resource carried by a capability reaches the flow through the block: a sequencer built with `uses: [cap]` shows the capability's resources, and a step's resources too. `bi:188-216`. A capability used by the sequencer and by a step installs its resource once. `bi:218-240`. A router does the same. `bi:242-290`. A handler, generator, sequencer and router all take `uses`. `bi:41-290`. [page, one sentence]

An example capability, as it is built today (`kb:85-171`): `name`, `resources: { concepts: collection }`, `fns`, `presets: { index: { context: ... }, search: { tools: ... }, default: ["index", "search"] }`. [page: the shape only; this file is not a public export (`kb:18-19`), so the page does not import from it]

## 3. One line instead of three (the opening claim)

- Without a capability, a new tool means finding every generator that uses the thing and updating its `tools` array; with one, the tool is added once to the preset and every consumer picks it up. `aut:361`. [page] This is the answer to question 1 ("how many places do you edit?"): one, the capability. Derived from `aut:354-361`; the test that backs "a preset's tools reach every block that lists the capability" is `fn:225-236` (a generator that names no `tools:` receives the capability's tool). [page]
- A block's one line is `uses: [cap]`. `use:19-27`. [page]
- `uses` on a generator, handler, sequencer and router. `bi:41-290`. [page]

## 4. Turning parts off (presets)

- A preset is a named bundle of block config inside a capability: `presets: { tools: { tools: [...] }, context: { context: [...] }, default: [...] }`. `ty:34-43`; `aut:49-68`. [page]
- `default` is a reserved key listing the presets on by default. `ty:300-302`. If `default` is omitted, every preset is on. `aut:121`; `ct:210-223`. If it is given, only those are on. `ct:225-239`. [page]
- `cap.presets({ name: false })` turns a preset off; `cap.presets({ name: true })` turns a non-default preset on. The call returns a new reference and does not change the original. `ct:80-93`, `ct:241-272`; `bi:448-492`. [page]
- A preset that is turned off contributes nothing, but the capability's always-on surface (its top-level `resources`) is still installed. `bi:161-186`. [page]
- An unknown preset name throws `Unknown preset "<name>" on capability "<cap>"` when the capability is resolved. `ct:301-313`. [ref]
- A preset that sets a field the block kind cannot take throws at build time naming the capability, preset and field (`context`/`tools` on a handler or router, `sequencerStateSchema` on a handler). `bi:292-357`; `aut:181-183`. A preset with only resources works on every kind. `bi:359-406`. [ref]
- `.with({ ... })` is a one-call shorthand that routes a flat bag: a key that names a preset toggles it, anything else is config. It equals `.config({...}).presets({...})`. `dc:155-167`; `cw:29-62`. A key matching neither throws. `dc:199-212`; `cw:137-156`. [page one sentence, or ref]
- Function-form overrides: `cap.presets({ alpha: (preset) => ({ ...preset, ... }) })` rewrites one preset. `ct:274-299`; `aut:244`. [ref]

### Tools are also dropped by a block's own `tools:`

- A generator's `tools:` is the complete list of tools the model may call. Declare it and the tools a capability contributes through `tools` are dropped. `tools: []` means none. `fn:106-118`; `use:154-172`. [page, one sentence, this is question 2's second answer]
- A generator that declares no `tools:` receives the capability's tools. `fn:225-236`; `use:166`. [page]
- A tool the block names in its own `tools:` list stays. `fn:161-176`. [ref]
- Context, resources, state schemas and helpers arrive either way. `use:170-172`. [page]
- `controlTools` are the exception: a preset's `controlTools` reach the model whatever `tools:` says. `fn:178-223`; `ty:99-124`. [ref]
- The same fence applies to a dynamic `uses` entry's tools. `fn:120-131`. [ref]

## 5. Where resources must be declared (question 3)

- A capability's resources are declared on the capability: top-level `resources`, or a preset's `resources`. `ty:240-245`, `ty:64-67`; `bi:141-159`. [page]
- A function entry in `uses` (a "dynamic" entry, `(ctx) => CapabilityRef[]`) contributes context, tools and control tools at run time, "nothing to types", and no resources. "Dynamic entries contribute context, tools and control tools only. Resources must be declared statically (on the capability's required surface or elsewhere) because they need to exist before block execution." `ty:590-598`; `mg:134-136`; `aut:274`, `aut:287`; `use:215-216`. [page: the rule, one sentence; the dynamic form itself is ref]
- A capability reached through a dynamic entry that declares open config throws at request time. `mg:166-180` (the dynamic path in `mg`); `capability-config.test.ts:319-332` (`packages/core/test/capability-config.test.ts`). [ref]
- A resource the capability declares and a block's own resource of the same name: the same reference is deduplicated, different references throw a resource conflict. `bi:81-122`; `aut:336,344`. [ref]
- Where the declaration travels: capability resources are on the block's `declaredResources`; a flow built from the block collects them. `bi:41-58`, `bi:188-216`; `use:140`. A flow collects the resources of a block's static tools when a capability also contributes tools. `ft:695-716`. [page: one clause, "the flow gets the resource from the block"]

## 6. A capability that takes config

Two mechanisms; the plan's example 4 is the second.

- **Factory.** A capability that needs build-time config is a function that returns `defineCapability(...)`, named `createXCapability(options)`. `aut:289-312`; `kb:80-85` (`createKnowledgeBaseCapability()`); `use:92-106` ("Parameterized capabilities", `createSkillsCapability({ scope: "session" })`). [page]
- A factory can install different resources depending on its argument: the docs' `storageCapability(scope)` builds `store: defineResource({ scope, ... })` and names the capability `storage:${scope}`. `aut:294-308`. [page]
- A factory's parameter propagates: a capability that depends on a parameterized capability either hardcodes the choice or becomes parameterized itself. `aut:310`. [ref]
- Two `defineCapability` calls produce two capabilities; a factory called twice with different arguments must give them different names, since two different calls with the same name collide (section 1). `mg:158-165`; derived. [ref]
- **Open config (not a factory).** `config: { schema, resolve }` on `defineCapability`; a consumer passes a typed value with `cap.config(value)`. `ty:173-216`; `dc:63-74`; `aut:187-200`. [ref: the plan links open config to `reference/capabilities`]
- Using the same capability twice in a block with conflicting config throws; identical config dedupes. `aut:238`; `mg:158-165` (`assertConfigCompatible`). [ref]

## 7. What it gets you (observable, tied to the example)

Each of these is observable and cited; the page picks three or four.

- **One edit, every consumer.** Add a tool to the preset once; every block that lists the capability gets it. `aut:361`. Verified in miniature: the tool reaches a generator that declares no `tools:`. `fn:225-236`.
- **A block gets resource, context and tools from one line.** `use:19-27`; `bi:124-159`.
- **Switch a part off per block.** `.presets({ tools: false })` on one generator leaves other consumers unchanged, because the call returns a new reference. `ct:80-93`.
- **Mistakes show before the code runs.** Capabilities are validated at factory time: a preset field the block kind cannot take, an unknown preset name, a resource conflict, a name collision. `use:150`; `bi:292-338`, `bi:101-122`; `ct:175-182`. The page may say "at build time" without listing; the list is ref.
- **Types follow.** A block that lists a capability reads the capability's declared session state and resources typed on `ctx`, without re-declaring them. `use:187-201`; `ty` (`InferCapabilitySessionState`, `InferCapabilityResources`, exported `ty:` via `capability/index.ts:12-17`). [one clause; the table is ref]
- **Shared dependencies install once.** `ct:143-153`; `bi:517-548`. [ref unless the example has a dependency]
- **Helpers where the block can reach them, including nested steps.** `cn:20-40`. [page if `fns` is in the example]

## 8. How it fits with the others (kit, flow, block, resource)

- **Capability vs kit (figure 2, question 4).**
  - A capability attaches to a block; its parts land on the block that lists it. `ty:6-8`; `use:10`.
  - A kit "packages a feature so an app installs it with one config object", lists in `createFlowState({ kits: [...] })`. `dk:4-6`. [page]
  - A kit "declares what it needs (`config`, the kits it `requires`), the typed places other kits fill (`slots`), what it fills in the kits it requires (`contributes`), an optional folder it owns in the app (`directory`), and an `install` that returns the flows it serves." `dk:6-9`. [page, shortened]
  - "It composes existing pieces: resources, views and capabilities ride on the flows the install returns." `dk:9-11`. So a kit contains capabilities; a capability does not contain kits. [page]
  - Rule for question 4, derived from the above: a whole feature with screens (views, flows, a folder in the app) is a kit; a bundle for one ability on a block is a capability. A kit installs into an app via `createFlowState`; a capability attaches to a block via `uses`. [page] There is no stated rule anywhere; this sentence is derived from the two definitions. **[verify]** with the owner.
  - `defineKit` is exported from `@flow-state-dev/core`. `ci:113`. [ref: the Kits page is C-12]
- **Capability vs block.** A block is the unit of work; a capability is what a block lists in `uses` to be configured. Blocks can be handler, generator, evaluator, sequencer or router; `uses` is taken by handler, generator, sequencer and router (tests above) and by the evaluator (`packages/core/src/blocks/evaluator.ts:391`, `uses?: TUses`). So every block kind takes `uses`. [ref; the page links to Blocks]
- **Capability vs resource.** A resource is the stored thing; a capability can carry resources and the context/tools that use them. `ty:240-245`. [page]
- **Capability vs tool.** A capability can bring tools (preset `tools`); a tool is a block the model calls. `ty:95-97`. [page]
- **Capability vs flow.** A flow's resources come from the blocks in it, including a capability's. `bi:188-216`; `ft:695-716`. [page one clause, or skip]
- **Capability vs open config / dynamic `uses` / type inference.** Link to `reference/capabilities`. [ref]
- **Writing one step by step** is B-32. [link only]

## 9. Stored parts: the four questions

A capability itself stores nothing: it is a definition, built at factory time and reused by reference (`dc:1-7`). What it brings can store data, through the resources it declares. The answers follow the resource's own scope, set on `defineResource({ scope })`, so the page states them for the example's resource only, and links to Resources (C-xx) for the rest.

For the capability's `resources` (the one stored part):

- **Who owns it.** The scope the resource declares: `"session"`, `"user"`, `"org"` or per-request. Scope is on the resource, not on the capability. `ty:240-245` (comment: "scope is intrinsic to each resource via `defineResource({ scope })`", `ty:65-66`); examples `aut:21-26` (session), `ct:26-34` (session and user). [page]
- **Who can see it.** The user or session whose scope it is. A session-scoped resource is keyed by the session id and tenant; user-scoped by the user and org; org-scoped by the org id. `apps/docs/docs/fundamentals/state-and-scopes.md:25` (the figure description). The browser sees only fields the scope's client config exposes (same line). [page, one clause; detail on Resources]
- **Where it is stored.** In the flow's store (memory by default, SQLite or Postgres when configured). Not stated on the capability; a capability does not choose a store. [ref: persistence page]
- **How many exist.** One per scope key. A capability-owned session resource is one record per session; user-scoped, one per user per org; org-scoped, one per org. `state-and-scopes.md:25`. A factory such as `storageCapability(scope)` changes which of these it is (`aut:294-308`). [page, example resource only]
- **A capability's own state** (`sessionStateSchema`, `stateSchema`) lands in the block's existing scopes, not in a new store: `sessionStateSchema` merges into session state and `stateSchema` into the block's own state `ctx.self`. `aut:79-81`; `use:187-199` (the `market` example: `ctx.session.state.ticker`). [ref]
- **Two capabilities, one stored field.** Own-state fields declared by both a capability and the block, or by two capabilities, must be the same schema reference or the build throws; session and request schemas merge by `.extend()` with last-wins on matching keys. `aut:90`, `aut:338-339`; `bi:799-884`. [ref]

## 10. Code the page may show (each type-checks against `@flow-state-dev/core`)

Signatures, from the surface:

- `defineCapability({ name, resources?, sessionStateSchema?, ..., fns?, presets?, uses?, config? })` returns the capability. `dc:25-97`.
- `presets: { [name]: PresetDef | string[] } & { default?: string[] }`. `dc:53`; `ty:302`.
- `capability.presets({ [name]: boolean | (preset) => preset })` returns a configured capability. `dc:146-151`; `ty` `PresetOverrides`.
- `capability.with(bag)`, `capability.config(value)`. `dc:152-227`.
- Block option: `uses: [capability]` on `generator`, `handler`, `sequencer`, `router`. `ty:595-608` (`UsesSlot`); `bi:41-290`.
- `defineResource({ scope, stateSchema })`. `ct:26-34`; `aut:21-26`.
- Generator needs `name`, `model`, `prompt`; `model: "openai/gpt-6-luna"` is the repo's small-model name for examples. `bi:124-139` uses `model: "intent/utility"`; `use:19-27` uses `openai/gpt-6-luna`.
- A tool is a block: `handler({ name, inputSchema, outputSchema, execute })` placed in a preset's `tools` array or a generator's `tools:` list. `fn:29-35`, `fn:106-118`.

Shape of the four plan examples (names are the page's; the API is cited):

1. Define: `defineCapability({ name: "orders", resources: { orders: ordersResource }, presets: { context: { context: [formatOrders] }, tools: { tools: [lookUpOrder] }, default: ["context", "tools"] } })`. Pattern from `aut:49-68` and `kb:154-170`.
2. Use: `generator({ name: "draftReply", model, prompt, uses: [orders] })`. `use:19-27`.
3. Turn a part off: `uses: [orders.presets({ tools: false })]`. `ct:241-255`, `bi:161-186`; `aut:174-176`.
4. Factory: `export function createOrdersCapability(options) { return defineCapability({ name: "orders", resources: { orders: defineResource({ scope: options.scope, ... }) }, ... }) }`. Pattern from `aut:294-308`, `kb:80-171`. File layout: `src/lib/` or the flow's folder; the layout in `user-docs.md` has no `capabilities/` folder, so the page puts it under `src/flows/<flow>/capabilities/` or `src/lib/`. **[verify]** the owner's preference.

## 11. Existing-page claims to leave out or correct

- `use:5-7` says a capability "turns on a feature like memory, MCP tools, or skills" and the import in `use:10-27` is `workingMemoryCapability` from `@flow-state-dev/memory`. The page's example is `orders`; the memory import is not needed. [leave out]
- `use:77-79` says an unknown name passed to `.presets()` "errors at factory time". The test throws on `resolveActivePresets`, at block build (`ct:301-313`), not when `.presets()` is called (`ct:80-93`: the call succeeds and returns a new reference). So "errors when the block is built" is the supported wording. [ref; do not repeat "factory time"]
- `use:150` "Capabilities are validated at factory time" is broadly true for block-kind and conflicts (`bi:292-338`, `bi:101-122`); keep it to "when the block is built".
- `aut:312` links to `@flow-state-dev/memory` as a model factory-shaped capability; not needed here.
- Findings in the Reference rows' own sheet, not here: open config, dynamic `uses`, type inference, merging rules (`aut:330-350`), `controlTools`, `.default({})` contract.

## 12. What a reader must not be told (outsider rule)

- Nothing about why `.with()` was added, how `Object.create` chains the configured clone (`dc:122-146`), reference-equality dedupe machinery, or the merge order. The guarantee is: a configured capability is a new reference and the original is unchanged (`ct:80-93`); a shared capability installs once (`ct:143-153`).
- Do not quote the tracking labels in `ty`, `dc` or the test headers.

## 13. Revision 1 (the page now matches these)

- The page's example is the made-up `orders` capability from section 10, built with `defineCapability`, `defineResource` and `handler`. Every block type-checks against `@flow-state-dev/core` source. The earlier memory example was untrue: `workingMemoryCapability` is named `workingMemory`, has no `remember` or `recall`, and ships no presets, context formatter or tools (`packages/memory/src/capabilities.ts:49-89`). Nothing on the page cites it.
- Presets are toggled with `.with({ tools: false })` (`dc:155-167`, `cw:38-48`). The page does not name `.presets()` or `.config()` as call sites; those are Reference.
- Moved to `reference/capabilities` (R-10) and not stated on the page: dependencies and install-once, `.with()` routing and refusals, open config validation and conflicts, what each field installs, the type-inference table and its limits, merge and collision rules, addressing modes (R-01), dynamic `uses`, the type-only overrides. Control tools are Reference only; the page no longer mentions them (`fn:178-223`).
- "Mistakes show up when the block is built" replaces "factory time" (`ct:301-313`, `bi:292-338`, `mg:158-165`).
- Links: `../build/write-a-capability.md` (B-32), `../reference/capabilities.md` (R-10), `./resources.md`, `./kits-and-slots.md`, `./generators-and-tools.md`.

## 14. Revision 2

- The page carries a model figure, `figures/capabilities.svg`: the `orders` capability with its resource, context preset and tools preset, listed by `draftReply` (all three parts) and by `summarizeOrder` (`.with({ tools: false })`: resource and context only). Each claim restates sections 2 and 4 (`bi:124-186`, `ct:80-93`, `dc:155-167`). Hatching marks the resource as stored (section 9).
- "Generator" and "resource" are defined in the opening sentence where first used. The example block that switches tools off is `summarizeOrder`.
- The tools rule is worded as "declaring `tools:`" (`fn:106-118`, `fn:225-236`).

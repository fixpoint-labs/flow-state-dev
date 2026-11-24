# Facts for Write a capability (B-32, recipe)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`. Paths are from the repo root.

Abbreviations:

- `dc` = `packages/core/src/capability/define-capability.ts`
- `ty` = `packages/core/src/capability/types.ts`
- `mg` = `packages/core/src/capability/merge.ts`
- `bb` = `packages/core/src/blocks/internal/build-block.ts`
- `hd` = `packages/core/src/blocks/handler.ts`
- `gn` = `packages/core/src/blocks/generator.ts`
- `ct` = `packages/core/test/capability.test.ts`
- `bi` = `packages/core/test/capability-block-integration.test.ts`
- `fn` = `packages/core/test/generator-tools-fence.test.ts`
- `cw` = `packages/core/test/capability-with.test.ts`
- `cwt` = `packages/core/test/capability-with.type-test.ts`
- `cc` = `packages/core/test/capability-config.test.ts`
- `goc` = `packages/core/test/generator-object-context.test.ts`
- `ft` = `packages/core/test/flow.test.ts`
- `kb` = `examples/knowledge-base/src/capability.ts` (the one example; a frozen reference, not a public package)
- `aut` = `apps/docs/docs/advanced/capabilities-authoring.md` (the page B-32 rewrites)
- `use` = `apps/docs/docs/fundamentals/capabilities.md`
- `c11` = `docs/contributing/docs-revamp/pages/concepts/capabilities.md` (the drafted C-11 page, with its sheet `capabilities.facts.md` beside it)
- `ro` = `apps/docs/docs/resources/overview.md`
- `ci` = `packages/core/src/index.ts`

Legend: **[page]** the page states it. **[ref]** belongs on `reference/capabilities`; the page links, does not state it. **[test]** pinned by a test. **[ran]** I ran it against this checkout with a throwaway test (removed afterwards; the code that ran is the code in "Code the page may show" below, and it type-checks under `strict: true`). **[source]** read from source, not run. **[verify]** not confirmed; keep off the page or soften.

The sitemap's two questions are **Q1: What does a block write to get all three?** and **Q2: How does a consumer turn the tools off?** The steps are: a tool, a context section, a resource; bundle them; presets; a factory for config.

## Read this first: decisions for pass 3

1. **The scenario is C-11's.** C-11 builds an `orders` capability from `lookUpOrder`, `orderLog` and a context line, listed by `draftReply` and `summarizeOrder` (`c11:18-77`). B-32 builds the same one, so a reader coming from C-11 meets the same names. The user-docs layout has no `capabilities/` or `resources/` folder; C-11 uses `src/flows/support/capabilities/` and `src/flows/support/tools/`, and this sheet adds `src/flows/support/resources/` for the resource. **[verify]** the folder names with the owner. Nothing in `docs/contributing/user-docs.md` rules them out.
2. **C-11's `lookUpOrder` returns an invented value** (`` `Order ${input.orderId} has shipped.` ``, `c11:30`). The page's tool must read a real thing: it calls the stand-in `findOrder(orderId)` from `src/lib/orders.ts`, imported and not shown, and writes the order id to the `orderLog` resource. Both ran (facts 8 and 16). **[page]**
3. **The resource gets its own file, not the capability file.** The tool declares the resource (`resources: { orderLog }`) so it can write it, and the capability lists the tool. If the resource lived in the capability's file, the tool would import the capability's file and the capability would import the tool: a cycle. So the resource is a leaf module both import. This is derived from the imports, not stated anywhere. **[page: one clause]**
4. **A preset's `context` function cannot read a declared resource with types.** In a preset's `context` callback, `ctx.resources.orderLog.state` fails to compile: `Property 'state' does not exist on type 'AnyResourceRef'` (**[ran]**, `ty:53-58` types the callback's `ctx` as a plain `BlockContext`; `ro:152` says a handle read off `ctx.resources.<name>` is not narrowed to its schema). The kb example reaches the resource with `ctx: any` (`kb:157`). So the page's context entry is a static string, the same as C-11's (`c11:42`), and the resource's visible use is in the tool. **[page]**
5. **The finished code for step 4 is a factory that builds the tool inside it.** The tool declares the resource, and the resource's `scope` is the factory's argument, so the tool and the resource are both created inside `createOrdersCapability` (**[ran]**, code below). The page therefore either (a) builds the fixed-scope `orders` first and then replaces the three files with the factory, or (b) builds the factory from step 1. The sitemap's step order (tool, context, resource, bundle, presets, factory) and "do not reprint a file to change one line" (`docs/contributing/user-docs.md:313-314`) point at (a), with the factory shown as the new finished file for the capability and the page saying in a sentence that the tool and resource move into it. Pass 3's call; the word budget is 800.
6. **Open config is not the plan's "factory for config".** Two mechanisms exist: a factory function (`createXCapability(options)`) and `config: { schema, resolve }` read with `.config(value)` (facts 38 to 40). The plan's step is the factory; C-11's sheet sends open config to Reference (`capabilities.facts.md` section 6). The page does the factory and gives open config one sentence and the link. **[page]**
7. **`aut` and `use` both lead with a `.presets()` or `.with()` call.** `aut:174-178` turns the tools preset off with `memoryCapability.presets({ tools: false })`; `use:69` and C-11 use `.with({ tools: false })`. Both work (fact 25). The page uses `.with()` as C-11 does and names `.presets()` in one clause, so the two pages agree.
8. **The existing `aut` page is mostly Reference.** Its merge table, `ctx.cap`, composition, dynamic `uses`, config resolver, `.default({})` contract and merging rules (`aut:72-93`, `:185-250`, `:252-287`, `:314-350`) are on the Reference page; the rewrite keeps the example and the "when to extract" advice (`aut:352-363`). Nothing from those sections is on this sheet except where a step needs it.
9. **`aut:312` and `use:7-13` import `@flow-state-dev/memory`'s capability.** Leave it out; C-11's sheet found `workingMemoryCapability` has no presets, tools or `remember`/`recall` (`capabilities.facts.md` section 13).

## The one scenario

A support desk. A `support` flow has a generator `draftReply` that answers a customer's question about an order, and `summarizeOrder`, a generator that should see the order context but never call a tool. The capability is `orders`. **[names only]**

Stand-ins the page imports and does not show: `findOrder` from `src/lib/orders.ts` (a function taking an order id, returning `{ status: string }`; a name the other pages reuse, `docs/contributing/user-docs.md:324-325`).

## What a capability is (the opening and the model)

1. **A capability bundles resources, state schemas, targets, helper functions and presets under one name; a block installs it by listing it in `uses`.** `ty:2-9`; `aut:9`; `use:7-9`. **[page]**
2. **`defineCapability` is exported from `@flow-state-dev/core`**, as are `defineResource`, `handler` and `generator`. `ci:52` (`defineResource`), `ci:109` (`defineCapability`); `handler`/`generator` are exported (`ci` re-exports blocks; the tool and generator examples import them from `@flow-state-dev/core`, `bi:12-15` imports them by path, `c11:23`). **[page]**
3. **A capability has a `name`; an empty or whitespace-only name throws `defineCapability() requires a non-empty name`.** `dc:98-100`; **[test]** `ct:51-61`. **[ref]**
4. **A capability's top-level fields are `name`, `resources`, the state schemas, `fns`, `uses`, `presets` and `config`.** `ty:238`, `ty:243`, `ty:246-258`, `ty:280`, `ty:297`, `ty:302`, `ty:309`. **[page: name, resources, presets; the rest ref]**
5. **There is no top-level `context` or `tools` on a capability.** They exist only inside a preset: `PresetDef.context` (`ty:92-94`) and `PresetDef.tools` (`ty:95-96`). `CapabilityConfig` (`ty:229-310`) declares no `context` or `tools`. **[page]** (This is why the recipe's tool and context section sit under `presets`.) Resources, by contrast, can be top-level (`ty:243`) or inside a preset (`ty:67`).

## Step 1: A tool

6. **A tool is a block.** A generator's `tools` list takes blocks, and a preset's `tools` takes the same: `GeneratorTool = BlockDefinition<any, any>` (`gn:422`); `PresetDef.tools?: GeneratorTool[] | ((ctx) => GeneratorTool[] | Promise<...>)` (`ty:95-96`). `apps/docs/docs/fundamentals/blocks.md:124`: "Any block or sequence of blocks can be used as a tool." **[page]**
7. **A tool written with `handler({ name, inputSchema, outputSchema, resources, execute })` is the shape the tests and pages use.** `fn:31-36` (`inputSchema`, `outputSchema`, `execute`); `c11:26-32`. **[ran]** the tool in "Code the page may show" ran as a tool call: the model was offered `lookUpOrder`, called it with `{ orderId: "A1" }`, and got `{ status: "shipped A1" }` back. **[page]**
8. **A tool block can declare resources.** `handler({ resources: { orderLog } })` (`hd:98-104`); inside `execute`, `ctx.resources.orderLog.patchState({ ... })` compiles under `strict` and writes the resource (**[ran]**: the resource's `lastOrderId` read `A1` in the next model step's context). A tool's `resources` reach the flow (`ft:697-727`: "collects resources from a static tool when a capability also contributes tools"). **[page]**
9. **The tool block's name is the name the model sees.** The model was offered `lookUpOrder` for `handler({ name: "lookUpOrder" })` (**[ran]**, `fn:88-98` reads names from `options.tools`). **[page: one clause]**

## Step 2: A context section

10. **A preset's `context` is a string, an object, a function of `(input, ctx)`, or an array of those.** `PresetContextEntry` (`ty:156-168`) is `string | ContextObject | ((input, ctx) => string | ContextObject | null | undefined)`; `PresetDef.context` takes one entry or an array (`ty:92-94`). **[page: the string form; the others ref]**
11. **A string context entry reaches the model as its own system message after the prompt, before the user message.** **[ran]** the messages the model received for `draftReply` were `[system: "Answer.", system: "Quote the order number whenever you mention an order.", user: "where is A1?"]`. **[test]** `goc:181-190` ("array-form string entries continue to emit as separate system messages"). **[page]**
12. **A context function runs before each model call, not once per run.** **[ran]** with a function entry that read the resource: the first model call saw "No order has been discussed yet." and the second, after the tool wrote `lastOrderId`, saw "Last order discussed: A1." **[source]** that the function form needs a cast to read a resource (decision 4). **[ref or cut]**; the page uses the string.
13. **Context is generator-only.** A preset with `context` on a handler throws when the block is built: `Capability "gen-only-ctx" ... declares context, but the consuming block is a handler. context is only valid on generator blocks.` `mg:558-570`; **[test]** `bi:293-310`, `ct:534-562`. **[ref]**; the page says in one sentence that context and tools are for generators.

## Step 3: A resource

14. **A resource is `defineResource({ scope, stateSchema })`**, scope `"session"`, `"user"` or `"org"`. `ro:14-37` (`scope` required, any other value throws `defineResource() requires an explicit scope of "session", "user", or "org" (got …)`); `ty:243` takes a flat map of accessor key to resource. **[page]**
15. **The accessor key is the capability's `resources` key, and it is the name on `ctx.resources`.** `resources: { orderLog }` gives a block `ctx.resources.orderLog` (**[ran]**); the key must match what the tool declares (`resources: { orderLog }` in both). `bi:42-58` ("capability resources appear in declaredResources"). **[page]**
16. **State fields use `.nullable().default(null)`** in this repo's examples (`c11:41`); a field read before any write is `null`. **[ran]** the first model call, before the tool ran, saw no order; after `patchState({ lastOrderId: "A1" })` it read `A1`. **[page: the schema as written]**
17. **A resource the capability declares and the tool declares, by the same reference, installs once.** The same `orderLog` listed in the capability's `resources` and in the tool's `resources` built and ran without a conflict (**[ran]**). **[test]** `bi:81-99` (capability resource and block resource, same reference: deduplicated). Two different references under one accessor throw `Resource conflict` (`bi:101-120`; `bb:77`). **[page: "the same one"]**; the throw is **[ref]**.

## Step 4: Bundle them (Q1)

18. **`defineCapability({ name, resources, presets })` bundles them.** The capability in the code below ran. **[page]**
19. **Q1: One entry in the block's `uses`.** `uses: [orders]` on `draftReply` gave the model, in one run (**[ran]**): the `orderLog` resource, the "Quote the order number" system message, and the tool `lookUpOrder` in the tool list. `c11:57-76`; `bi:125-159` (generator with `uses`: capability and preset resources appear in `declaredResources`). **[page]**
20. **`uses` is taken by `handler`, `generator`, `sequencer` and `router`**, and by `evaluator`. `hd:109`, `hd:200`, `gn:569`; `bi:41-290`; `packages/core/src/blocks/evaluator.ts:391` (from `capabilities.facts.md` section 8). **[page: one clause]**
21. **The flow gets the resource from the block.** A flow that includes `draftReply` has `orderLog` without declaring it on `defineFlow`: a block's declared resources, including a capability's, are collected into the flow (`bi:188-216` for sequencers; `ft:697-727` for a generator with tools and a capability). **[page: one clause]**
22. **A capability whose presets are all off still installs its top-level `resources`.** `bi:161-186` (opt out of the preset; `res1` stays, the preset's `res2` goes). **[ref or one clause]**

## Step 5: Presets (Q2)

23. **A preset is a named part of a capability: `presets: { context: { context: "..." }, tools: { tools: [lookUpOrder] }, default: ["context", "tools"] }`.** `ty:302`; `ty:60-148`; `aut:49-68`; `c11:44-54`. The preset's name is the key; its value is a partial block config. **[page]**
24. **`default` is a reserved key listing the presets that are on unless a block says otherwise; with no `default`, every preset is on.** `mg:231-232` (`rawPresets.default ?? presetEntries.map(([k]) => k)`); **[test]** `ct:210-223` (no `default`: all active), `ct:225-239` (explicit `default`: only those). `aut:121`. **[page]**
25. **Q2: `orders.with({ tools: false })` turns the tools preset off for one block.** The generator that listed it was offered no tools and still received the context message and the resource (**[ran]**: tool list `[]`, messages `[system: prompt, system: context, user]`, `declaredResources` kept `orderLog`). `.presets({ tools: false })` is the same switch; `.with()` is the flat form (`dc:155-167`). **[test]** `ct:80-93`, `ct:241-255` (`.presets` boolean off), `cw:38-48` (`.with()` equals `.config().presets()`), `bi:161-186`. **[page]**
26. **A preset can be turned on as well as off:** `orders.with({ summary: true })` for a preset left out of `default`. `mg:238-247`; **[test]** `ct:257-272`, `bi:448-467`. **[page: one clause or cut]**
27. **`.with()` returns a new capability and leaves the original alone**, so one block's change does not reach the blocks that list `orders`. `dc:146-154`, `dc:266-279` (`Object.create(base)`); **[test]** `ct:80-93` (the original has no overrides), `cw:57-62`. Observed: `orders` listed by `draftReply` and `orders.with({ tools: false })` listed by `summarizeOrder` in one flow built without conflict (**[ran]**, same capability, same resource). **[page]**
28. **A misspelled preset name is refused.** `.with({ tool: false })` throws at the call: `.with() on capability "orders:session" received key(s) [tool] that match neither a preset nor a config field ... Presets: [context, tools]. Config fields: [(none — no config)].` (**[ran]**; `dc:199-212`; **[test]** `cw:137-156`). It is also a compile error for a capability with no config: `@ts-expect-error - notAPreset is neither config nor a known preset` (`cwt:44-45`). `.presets({ tool: false })` throws when the block is built: `Unknown preset "tool" on capability "orders:session"` (**[ran]**; `mg:226-228`; **[test]** `ct:301-313`). **[page: one sentence]**; the exact messages are **[ref]**.
29. **A block's own `tools:` list also drops the capability's tools.** A generator that declares `tools:` has stated the complete catalog of tools the model may call, and a capability's `tools` preset tools are dropped: `tools: []` leaves the model no capability tool. A generator that declares no `tools:` receives the capability's tools. `fn:107-118`, `fn:225-236`; `aut:125`; `use:148-161`. Context, resources and helpers arrive either way (`use:165`). **[page: one sentence; C-11 owns the detail, `c11:99-120`]**
30. **`controlTools` is the one exception**: a preset's `controlTools` reach the model whatever `tools:` says (`fn:178-223`; `ty:99-124`). **[ref]**; the page does not mention it (as C-11 does not).
31. **A preset that sets a field its block cannot take throws when the block is built.** `context`, `tools` and `controlTools` on a handler or router, and `sequencerStateSchema` on a non-sequencer, name the capability, preset and field. `mg:558-600`; **[test]** `bi:293-357`. A preset with only `resources` works on every kind (`bi:359-406`). **[ref]**

## Step 6: A factory for config

32. **A capability that needs a value at build time is a function that returns `defineCapability(...)`**, named `createXCapability(options)`. `aut:289-312`; `use:98-108` (`createSkillsCapability({ scope: "session" })`); `kb:80-85` (`createKnowledgeBaseCapability()`). **[test]** `bi:579-606` (a `capFactory({ scope })` that picks a resource by scope and names the capability `factory-${scope}`). **[page]**
33. **A factory can build the resource from its argument.** `createOrdersCapability({ scope: "user" })` produced a block whose `declaredResources.orderLog.scope` was `"user"`, and the capability's `name` was `orders:user` (**[ran]**). `aut:294-308` (`storageCapability(scope)`, name `` `storage:${scope}` ``). **[page]**
34. **A factory's argument can change which resource it installs, which is why a factory exists and a preset is not enough.** A preset can only switch parts the capability already declared; it cannot pick a resource's `scope`, because scope is set on `defineResource`. `ty:65-66` ("scope is intrinsic to each resource via `defineResource({ scope })`"); `ty:60-148`. **[page: one sentence]**
35. **Give each call a different name.** Two different `defineCapability()` calls with the same `name` in one block's `uses` throw `Capability name collision: "orders:session" is declared by two different defineCapability() calls` (**[ran]**, a block with two `createOrdersCapability({ scope: "session" })` calls); `mg:158-165`; **[test]** `ct:175-182`. That is why the name carries the argument (`orders:${options.scope}`). **[page]**
36. **Call the factory once and export the result.** Two blocks in one flow, each calling `createOrdersCapability({ scope: "session" })` separately, make two `orderLog` resource objects; building the flow throws `Resource conflict: "orderLog" is declared with different defineResource() references. Use the same reference across blocks, or pick distinct accessor keys.` (**[ran]**; `bb:77`). The same configured capability listed by two blocks builds fine (**[ran]**, fact 27). So the finished file ends with `export const orders = createOrdersCapability({ scope: "session" })` in one module that every block imports. **[page]**; the conflict message is **[ref]**.
37. **A factory's parameter propagates**: a capability that depends on a parameterized capability either fixes the choice or takes the parameter itself. `aut:310`. **[ref]**
38. **Open config is the other way to take a value.** `defineCapability({ config: { schema, resolve } })` and `cap.config(value)`; the value is validated against the Zod schema, and `resolve` maps it onto a preset-shaped surface. `ty:173-216`; `dc:63-74`, `dc:152-154`; `aut:185-200`; **[test]** `cc:59-98`. Use it for a value (a list, a limit), a factory when the shape changes. `aut:240-250`. **[ref]**; the page names `.config()` once and links.
39. **A schema that rejects `undefined` makes `.config()` mandatory**; a capability meant to be used bare declares `.default({})` on the schema. `aut:204-215`; **[test]** `cc:173-210`. **[ref]**
40. **`.with()` routes a flat bag by name: a preset key toggles the preset, anything else is config.** `dc:155-167`; `cw:29-48`. Preset names and config field names must not overlap: `defineCapability` throws at definition. `dc:102-120`; **[test]** `cw:157-170`. **[ref]**

## When to write one (the opening's reason)

41. **Without a capability, adding a tool to a shared set means finding every generator that uses it and updating its `tools` array; with one, add the tool to the preset once.** `aut:361`; **[test]** `fn:225-236` (a block that declares no `tools:` receives the capability's tool). **[page]**
42. **A single resource used by one block does not need a capability; extract one when several blocks need the same combination, or several generators share context and tools.** `aut:352-363`. **[page: one sentence, optional]**

## Stored parts: the four questions

A capability stores nothing. It is a definition built when the block is built (`dc:1-7`). The one stored part is the `orderLog` resource it carries.

43. **Who owns it.** The scope on `defineResource({ scope })`, not the capability. With `scope: "session"` the session owns it; with `"user"`, the user in an organization; with `"org"`, the organization. `ty:65-66`; `ro:43`; `resource.ts:199-204` (`packages/core/src/types/resource.ts`: "Intrinsic scope this resource lives in"). **[page]**
44. **Who can see it.** Blocks of the flow read and write it through `ctx.resources.orderLog`. A client sees it only if the resource's `client` config exposes fields (`apps/docs/docs/resources/client-access.md`; `apps/docs/docs/fundamentals/state-and-scopes.md:25`: "the browser sees only fields the scope's client config exposes"). The example declares no `client` config. **[page: one clause; detail on the Resources page]**
45. **Where it is stored.** In the app's store (stores are declared on `createFlowState` as named profiles, `persistence/overview.md:11`): in memory by default, lost on restart; a file, SQLite or Postgres store keeps it. The capability does not choose a store. `apps/docs/docs/persistence/overview.md:7`, `:25`. **[page: one clause, link to Persistence]**
46. **How many exist.** One per scope key. A session-scoped resource is one record per session (`state-and-scopes.md:25`: keyed by the session id and the tenant). A user-scoped one is one per user per organization, shared across every flow the user touches unless the resource sets `flowIsolation` (`resource.ts:205-231`). An org-scoped one is one per organization. So `createOrdersCapability({ scope: "user" })` makes the order log follow a customer between sessions, and `{ scope: "session" }` starts a fresh one in each. **[page: session and user only]**
47. **Switching a capability's scope changes where existing data is read.** The factory's argument is the scope, so a deployment that changes `"session"` to `"user"` reads a different record. **[verify]** no test or page states what happens to existing session records; keep it off the page.

## Code the page may show

All of this compiled under `strict: true` against `@flow-state-dev/core` source and ran through `runAction` with a scripted model that called the tool (**[ran]**), except where marked. Titles follow the layout.

```ts title="src/flows/support/resources/order-log.ts"
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

export const orderLog = defineResource({
  scope: "session",
  stateSchema: z.object({ lastOrderId: z.string().nullable().default(null) }),
});
```

```ts title="src/flows/support/tools/look-up-order.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { findOrder } from "../../../lib/orders";
import { orderLog } from "../resources/order-log";

export const lookUpOrder = handler({
  name: "lookUpOrder",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ status: z.string() }),
  resources: { orderLog },
  execute: async (input, ctx) => {
    const order = await findOrder(input.orderId);
    await ctx.resources.orderLog.patchState({ lastOrderId: input.orderId });
    return { status: order.status };
  },
});
```

```ts title="src/flows/support/capabilities/orders.ts"
import { defineCapability } from "@flow-state-dev/core";
import { lookUpOrder } from "../tools/look-up-order";
import { orderLog } from "../resources/order-log";

export const orders = defineCapability({
  name: "orders",
  resources: { orderLog },
  presets: {
    context: { context: "Quote the order number whenever you mention an order." },
    tools: { tools: [lookUpOrder] },
    default: ["context", "tools"],
  },
});
```

```ts title="src/flows/support/blocks/draft-reply.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { orders } from "../capabilities/orders";

export const draftReply = generator({
  name: "draftReply",
  model: "openai/gpt-6-luna",
  prompt: "Answer the customer's question about their order.",
  inputSchema: z.string(),
  user: (input) => input,
  uses: [orders],
});
```

Ran with `model` swapped for a scripted model (the string `"openai/gpt-6-luna"` needs a resolver and key; the string form compiles, as `c11:57-76` and `bi:125-139` show with other strings). **[source]** for the string.

```ts title="src/flows/support/blocks/summarize-order.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { orders } from "../capabilities/orders";

export const summarizeOrder = generator({
  name: "summarizeOrder",
  model: "openai/gpt-6-luna",
  prompt: "Summarize the order in one sentence.",
  inputSchema: z.string(),
  user: (input) => input,
  uses: [orders.with({ tools: false })],
});
```

The factory, as the finished capability file (the resource and the tool move inside it, fact 33 and decision 5). **[ran]** with `scope` as a parameter, then called once at the bottom:

```ts title="src/flows/support/capabilities/orders.ts"
import { defineCapability, defineResource, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { findOrder } from "../../../lib/orders";

export function createOrdersCapability(options: { scope: "session" | "user" }) {
  const orderLog = defineResource({
    scope: options.scope,
    stateSchema: z.object({ lastOrderId: z.string().nullable().default(null) }),
  });

  const lookUpOrder = handler({
    name: "lookUpOrder",
    inputSchema: z.object({ orderId: z.string() }),
    outputSchema: z.object({ status: z.string() }),
    resources: { orderLog },
    execute: async (input, ctx) => {
      const order = await findOrder(input.orderId);
      await ctx.resources.orderLog.patchState({ lastOrderId: input.orderId });
      return { status: order.status };
    },
  });

  return defineCapability({
    name: `orders:${options.scope}`,
    resources: { orderLog },
    presets: {
      context: { context: "Quote the order number whenever you mention an order." },
      tools: { tools: [lookUpOrder] },
      default: ["context", "tools"],
    },
  });
}

export const orders = createOrdersCapability({ scope: "session" });
```

The `export const orders = ...` line was not in the ran file (it called the factory inline); it is a plain call and type-checks as written. **[source]**

## Observed results to state (all [ran])

- `draftReply` with `uses: [orders]`: tool list `["lookUpOrder"]`; system messages `["Answer the customer's question…", "Quote the order number…"]` then the user message; after the tool call the `orderLog` read `lastOrderId: "A1"`.
- `summarizeOrder` with `uses: [orders.with({ tools: false })]`: tool list `[]`; the same two system messages; `declaredResources` still held `orderLog`.
- `createOrdersCapability({ scope: "user" })`: capability name `orders:user`; the block's `declaredResources.orderLog.scope` was `"user"`.
- Two `createOrdersCapability({ scope: "session" })` in one block: throws `Capability name collision`.
- Two blocks in one flow, each with its own factory call: `defineFlow` throws `Resource conflict`.

## Leave out of the page (and where it lives)

- Helper functions and `ctx.cap.<name>` (`fns`): the sitemap's steps do not include them; the C-11 page dropped them as well (`c11` record, pass 7 finding 5). `aut:314-328`; **[ref]** (`reference/capabilities`).
- State schemas on a capability (`sessionStateSchema`, `stateSchema`, `targetStateSchemas`), type inference, merge and collision rules, dynamic `uses`, `itemVisibility`, capability composition (`uses` inside a capability) and diamond dedup, function-form preset overrides, cross-capability context aggregation, and `controlTools`: all **[ref]** (`aut:72-93`, `:145-166`, `:240-287`, `:330-350`; `use:169-226`).
- A preset that sets `model`, `providerOptions`, `caching` or `history`: `ty:99-148`; **[ref]**.
- Nothing about why `.with()` exists, how the configured copy is built (`Object.create`), or how merging orders entries (`dc:122-146`). The guarantee is fact 27.
- No tracking labels from `ty` or `dc` comments (`FIX-` ids) appear on the page.

## Revise round 1

Facts 11, 12, 13, 29, 28, 35, 36 now live only on the reference page; the recipe links it for: where a context string lands in the messages, context/tools on non-generators, a generator's own `tools:` list, other preset switches and unknown names, and name or resource collisions. Fact 36's instruction (call the factory once, import `orders`) stays on the page. Step 6 tells the reader to delete the step 1 and 3 files the factory replaces.

## Revise round 2

Stated on the page now, no new facts: facts 28 (misspelled key refused at `.with()` and at build), 34 and 36 (why a factory; two separate calls throw `Resource conflict`), 35 (name carries scope), 46, 16 (session starts `null`, user follows the customer), 45 and 43 (store is the flow's, in memory by default; the capability stores nothing).

## Revise round 3 (owner read: capabilities are for any block; `fns`)

The owner found the page framed capabilities as a generator feature and left out helpers. The facts below are new; facts 20, 31 and 35 and the `fns` line under "Leave out of the page" are superseded where they disagree.

48. **Every block kind takes `uses`.** `hd:109`, `hd:200`; `gn:569`; `packages/core/src/blocks/evaluator.ts:391`; `packages/core/src/blocks/router.ts:133`; `packages/core/src/blocks/sequencer-methods.ts:493`. Each kind resolves its capabilities when it is built: `packages/core/src/blocks/evaluator.ts:481`, `gn:2853`, `hd:162`, `packages/core/src/blocks/router.ts:223`, `packages/core/src/blocks/sequencer.ts:2586`. **[page]**
49. **A preset's `context` or `tools` on any block that is not a generator throws when the block is built**, naming the capability and preset: `Capability "orders" preset "context" declares context, but the consuming block is a handler. context is only valid on generator blocks.` `mg:559-579` (the check is `blockKind !== "generator"`, so it covers evaluator, router and sequencer too). **[ran]**: a handler with `uses: [orders]` threw that message when built. So a non-generator lists `orders.with({ context: false, tools: false })`. This corrects the brief's "context and tools take effect only on generators": on another kind they throw unless switched off. **[page: one sentence]**; the message is **[ref]**.
50. **`fns` builds helpers at `ctx.cap.<capability name>`, once per block run, with that block's `ctx`.** `ty:296-297` (`fns?: (ctx: BlockContext) => TFns`, "produces ctx.cap.{name}"), `ty:429-430`; `bb:293-312` (`capObj[base.name] = base.fns(ctx)` at the start of `run`). Reference rows: `reference/capabilities.md:109`, `:312`. **[page]**
51. **Presets do not control `fns`.** With `orders.with({ context: false, tools: false })` the handler's `ctx.cap.orders.lastOrderId()` returned the seeded `"B2"` (**[ran]**); `bb:305-310` reads `fns` off the base capability, not off a preset. `reference/capabilities.md:109`, `:167`. **[page]**
52. **`ctx.cap` is typed from a block's static `uses`.** `packages/core/src/types/block.ts:477-479` (`cap: TCapabilities`); `ty:613-628` (`InferCapabilities` maps each capability's name to its `fns` return type); **[test]** `packages/core/test/capability-inference.type-test.ts:118-131`. **[ran]**: under the kitchen-sink tsconfig, `ctx.cap.orders.lastOrderID()` fails with `TS2551: Property 'lastOrderID' does not exist ... Did you mean 'lastOrderId'?`, and assigning the declared `string | null` return to a `number` fails. **[page: one clause]**
53. **The `ctx` that `fns` receives is a plain `BlockContext`**, whose `ctx.resources.<name>` is the union `AnyResourceRef` (`packages/core/src/types/resource.ts:534-537`, `:548-553`; `packages/core/src/types/block.ts:411`), so `.state` and `.patchState` need a cast. `ContextOf<typeof orderLog>` is the resource handle type `ResourceContext` (`packages/core/src/types/resource.ts:576-582`, `:385-389`; `reference/type-helpers.md:115`). The state it carries is `any` for a `defineResource` result (**[ran]**: `StateOf<typeof orderLog>` and `(typeof orderLog)["StateType"]` both resolve to `any`, against both the built package and core source), so the page's helper declares its return type, `(): string | null`. The same pattern, cast and all, is in `packages/memory/src/capabilities.ts:69`. **[page: one sentence]**
54. **The helper reads and writes the resource for a handler.** **[ran]** with `testBlock` and the session resource seeded `{ lastOrderId: "A1" }`: `refundLastOrder` returned `{ orderId: "A1", refundCents: 1200 }`, called the `refundOrder` stand-in once with `"A1"`, and left `orderLog` at `{ lastOrderId: null }`; run again with nothing seeded it returned `null`. Capability resources are part of a block's own declared resources (`hd:162-172`) and are loaded before `run` builds the helpers (`bb:287-291`). **[page]**
55. **A capability name with a colon is valid, and its helpers land at `ctx.cap["orders:session"]`.** **[ran]**: a handler listing a capability named `orders:session` reached its helper through `ctx.cap["orders:session"]`; with the factory named `` `orders:${options.scope}` ``, `ctx.cap.orders` fails to compile (`TS2339: Property 'orders' does not exist on type '{ "orders:session": ...; "orders:user": ... }'`). `reference/capabilities.md:124`. So the factory names its capability `"orders"` for every scope. **[page: one clause]**
56. **A fixed name is safe in the factory as long as it is called once.** Two different `defineCapability` objects with one name are an error only when both reach one block's `uses` (`reference/capabilities.md:91`; `mg:160-165`); the page's one `export const orders = createOrdersCapability(...)` is one object, listed by every block (fact 27). **[page: the instruction to call it once]**; the collision message stays **[ref]**.
57. **Stand-in `refundOrder(orderId)`** from `src/lib/orders.ts`, returning `{ refundCents: number }`, as `reference/generators.md:33-41` uses it. **[names only]**

## Order lookup scoped to the caller

- **A handler's `ctx.session.identity` carries the resolved `userId` and `orgId`.** `BlockContext.session` is a `SessionScopeHandle` (`packages/core/src/types/block.ts:353`), whose `identity` is a `ScopeIdentity` (`packages/core/src/types/scope.ts:298`) with optional `userId` and `orgId` (`packages/core/src/types/scope.ts:9-13`). The engine fills both from the loaded session record (`packages/engine/src/context/createExecutionContext.ts:3313-3320`) and refuses a request whose `userId` is not that record's (`packages/engine/src/context/createExecutionContext.ts:1056-1058`), so the value is the caller's, never input. **[test]** `packages/integration-tests/src/two-users-one-tenant/cross-flow-admission.test.ts:61-62` reads both off `ctx.session.identity` in a handler. **[page: code only]**
- **A tool block runs with the generator's context**, scoped per call (`packages/core/src/blocks/internal/tool-executor.ts:74-78`, `:163-177`), so `ctx.session.identity` in a tool's `execute` is the same caller's. **[page: code only]**
- **Stand-in `findOrder(orderId, caller)`** from `src/lib/orders.ts`, `caller` being `{ userId?, orgId? }`; it returns `undefined` for an order the caller does not own, which the example's not-found branch handles. **[names only]**
- **`lookUpOrder` records `lastOrderId` only for an order `findOrder` returned**, so `refundLastOrder` (step 6) can refund only an order that passed the caller check. Read from the page's own code. **[page: code only]**

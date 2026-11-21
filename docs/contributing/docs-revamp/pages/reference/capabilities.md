---
title: Capabilities
type: reference
description: "Every field of defineCapability, what a preset can declare, how presets, config and dynamic uses entries work, what each part installs and when, and what the build refuses."
---

# Capabilities

A capability is a named bundle of resources, state, helper functions, prompt context and tools that a block lists in `uses` to receive all of it. A block is the unit of work in a flow, a generator is the block that calls a model, and a resource is named, stored data a block declares.

This page lists everything a capability can declare, what a block that lists it gets, and what the build refuses. [Capabilities](../concepts/capabilities.md) explains what a capability is for.

The examples use the `orders` capability of a support desk: a user-scoped `customerOrders` collection of the customer's orders, a `refundsEnabled` session state field, a `context` preset and a `tools` preset holding `lookUpOrder`, a handler block the model calls as a tool to read an order's status from that collection.

```ts title="src/flows/support/resources/orders.ts"
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

export const customerOrders = defineResourceCollection({
  pattern: "orders/*",
  scope: "user",
  stateSchema: z.object({ status: z.string() }),
});
```

```ts title="src/flows/support/tools/look-up-order.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { customerOrders } from "../resources/orders";

export const lookUpOrder = handler({
  name: "lookUpOrder",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ status: z.string() }),
  resources: { orders: customerOrders },
  execute: async (input, ctx) => {
    const order = await ctx.resources.orders.getOptional(input.orderId);
    return { status: order?.state.status ?? "No order with that number." };
  },
});
```

```ts title="src/flows/support/capabilities/orders.ts"
import { defineCapability } from "@flow-state-dev/core";
import { z } from "zod";
import { customerOrders } from "../resources/orders";
import { lookUpOrder } from "../tools/look-up-order";

export const orders = defineCapability({
  name: "orders",
  resources: { orders: customerOrders },
  sessionStateSchema: z.object({ refundsEnabled: z.boolean().default(false) }),
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

Everything on this page imports from `@flow-state-dev/core`. A capability is code shared by every block that lists it. A capability is not a kit: a kit is installed by the app, and a capability is listed by a block.

## Lookups

| Question | Answer |
| --- | --- |
| Can a dynamic `uses` entry install a resource? | No. Declare the resource on the capability and list that capability statically. [Static and dynamic entries](#static-and-dynamic-uses-entries) |
| How are presets turned off? | `orders.presets({ tools: false })` or `orders.with({ tools: false })`. Each returns a new reference and leaves `orders` as it was. [Which presets are on](#which-presets-are-on) |
| Why did my generator lose the capability's tools? | It declares `tools:`. [Tools a generator is given](./generators.md#tools-a-generator-is-given) |
| Why is `ctx.cap.<name>` missing? | The capability has no `fns`, or the entry is dynamic. [`fns`](#what-each-part-installs) |
| Where does `.with()` send a key? | To a preset, to config, or it throws. [Routing](#with-routing) |
| Why is a field missing from `ctx`'s type? | It came from a preset or config, or from a dependency. [Type helpers](./type-helpers.md) |

## `defineCapability` fields

`defineCapability(config)` returns the capability. The returned object is what a block lists in `uses`. Reuse one object across blocks. Two different `defineCapability` calls with one `name` are an error only when both reach one block's `uses`, directly or through a dependency. One object listed twice is one install.

Parts every block that lists the capability receives:

| Field | Type | What it does |
| --- | --- | --- |
| `name` | `string`, required | Names the capability. Empty or whitespace-only throws `defineCapability() requires a non-empty name`. It is also the key of the capability's helpers on `ctx.cap`. |
| `resources` | map of accessor to `defineResource(...)` or collection | Resources installed on the block. Scope is set on each resource, not on the capability. [Resources](./resources.md) |
| `sessionStateSchema`, `userStateSchema`, `orgStateSchema` | Zod schema | Fields added to that scope's state. Listed statically, they reach the flow's scope state defaults. [Flows and actions](./flows.md) |
| `requestStateSchema` | Zod schema | Accepted and ignored. |
| `sequencerStateSchema` | Zod object | Fields the capability needs on a sequencer's state. Only a sequencer accepts it. [Blocks](./blocks.md) |
| `stateSchema` | Zod object | The block's own state, `ctx.self`. Valid on every block kind. [Blocks](./blocks.md) |
| `targetStateSchemas` | map of name to Zod schema | Typed handles to named ancestor blocks' state, `ctx.targets`. Valid on every block kind. [Blocks](./blocks.md) |

Helpers, composition and filtering:

| Field | Type | What it does |
| --- | --- | --- |
| `fns` | `(ctx: BlockContext) => Record<string, function>` | Helper functions at `ctx.cap.<name>`. Presets do not control it. |
| `uses` | `readonly UsesEntry[]` | Capabilities this one depends on. Static entries install with it; function entries are dynamic. |
| `itemVisibility` | `ItemVisibility` or an array | Attaches the capability only to blocks whose `itemVisibility` is one of these. Default: every block. A block that sets no `itemVisibility` gets the default on [Visibility](./items.md#visibility). |

Presets and config:

| Field | Type | What it does |
| --- | --- | --- |
| `presets` | map of name to `PresetDef`, plus `default?: string[]` | Named bundles a block turns on or off. |
| `config` | `{ schema?, resolve }` | A typed value a block passes with `.config(value)`, and the resolver that maps it onto the block. |

The type-only fields `sessionStateType`, `resourcesType`, `targetStatesType`, `sequencerStateType` and `stateSchemaType` are on [Type helpers](./type-helpers.md).

`context`, `tools`, `controlTools`, `history`, `model`, `providerOptions` and `caching` are not top-level fields. They go in a preset, or come from a config resolver.

A capability name containing a colon is valid. A factory that names its capability `orders:session` lands its helpers at `ctx.cap["orders:session"]`, which is not dot-accessible.

A preset name and a config field name must not overlap. `defineCapability` throws at definition:

```text
defineCapability("<name>"): preset name(s) [<names>] collide with config field name(s). .with() routes a flat bag by preset-name membership, so the two sets must be disjoint — rename the preset or the config field.
```

## What a preset can declare

A preset is a partial block configuration. A config resolver returns the same shape, and so does a preset override function.

Keys any block accepts:

| Key | Type | What it does |
| --- | --- | --- |
| `resources` | map of accessor to resource | Installs resources. |
| `sessionStateSchema`, `userStateSchema`, `orgStateSchema`, `stateSchema`, `targetStateSchemas` | as in the field table | Same as the top-level field, except that a scope state schema from a preset does not reach the flow's defaults. |
| `requestStateSchema` | Zod schema | Accepted and ignored. |
| `sequencerStateSchema` | Zod object | Same as the top-level field. Sequencer only. |

Keys only a generator accepts:

| Key | Type | What it does |
| --- | --- | --- |
| `context` | a string, a `ContextObject`, a function `(input, ctx) => string \| ContextObject \| null \| undefined`, or an array of these | Added after the block's own `context` entries. [How context is assembled](./generators.md#in-what-order-is-context-assembled) |
| `tools` | `GeneratorTool[]` or `(ctx) => GeneratorTool[] \| Promise<...>` | Tools the model may call. Dropped when the generator declares `tools:`. |
| `controlTools` | same as `tools` | Tools that reach the model whatever the generator's `tools:` says. |
| `history` | `ItemQuery` or `(ctx) => ItemQuery \| Promise<ItemQuery>` | A query added to every `ctx.session.items.history()` read the generator makes. [How it merges](./generators.md#history-and-user) |
| `model`, `providerOptions`, `caching` | the generator's own types | Fill the generator's setting when the block sets none. The last capability wins. The block's own setting always wins. |

A block kind that cannot take a key throws when the block is built, and [Blocks](./blocks.md) lists which kinds take which. [Generators](./generators.md#options) covers `model`.

A capability's top-level fields merge first, then each active preset in declaration order, then the config resolver's output. For a setting that holds one value, such as `model`, config overrides a preset.

### Which presets are on

| Question | Answer |
| --- | --- |
| Which are on with no override? | The names in `default`, or every preset when `default` is absent. `default: []` turns all of them off. |
| How is one turned off? | `cap.presets({ name: false })` or `cap.with({ name: false })`. |
| How is one turned on? | `cap.presets({ name: true })`, or a function override. |
| Does turning one off remove the capability's top-level `resources`, state or `fns`? | No. A preset that itself declares `resources` or state takes those away when it is off. |
| What does a preset do to `ctx.cap` helpers? | Nothing. |
| What if the name is unknown? | A TypeScript caller gets a compile error, because the override keys are the declared names. At runtime `.presets()` returns a reference, and the block that lists the capability throws when it is built: `Unknown preset "<name>" on capability "<cap>"`. |

When one block lists a capability in two places, the first reference reached supplies the presets. Dependencies are reached before their dependents, depth first. `[orders.presets({ context: false }), orders]` merges only `tools`. `[orders, orders.presets({ context: false })]` merges both.

### Preset override forms

| Form | Example | Effect |
| --- | --- | --- |
| Boolean | `{ tools: false }` | Turns the preset off or on. |
| Function | `{ tools: (preset) => ({ tools: [other] }) }` | Receives the preset's declared object and returns a partial, spread over the preset as `{ ...preset, ...returned }`. It also turns the preset on, including one not in `default`. |

A function override is typed as that preset's `PresetDef`. It cannot take a value from the consumer or see which other presets are on. Config does that.

## `.presets()`, `.config()` and `.with()`

`.presets()` and `.config()` always return a new reference. `.with()` does too, except that `.with({})` on a capability with no `config` returns the capability itself. None of them changes the original. They chain in either order. Two references to one capability install it once. Different `.config()` values throw; different `.presets()` take the first reached.

| Builder | Takes | Compile-time rule | What it does |
| --- | --- | --- | --- |
| `.presets(overrides)` | `{ presetName: boolean \| fn }` | Keys are the declared preset names. | Records overrides. |
| `.config(value)` | The config schema's input type; the resolver parameter's type when schemaless | On a capability with no `config`, the call fails to compile. | Records the value. |
| `.with(bag)` | A flat bag | The config input intersected with the preset overrides; either alone when the other is absent. | `.presets` and `.config` in one call. |

`.with({ allowed, dynamicActivation: true })` equals `.config({ allowed }).presets({ dynamicActivation: true })`.

### `.with()` routing

1. A bag that is not a plain object (a scalar, an array, `null`) is the whole config value. No presets ride with it.
2. A key naming a preset, any key of `presets` except `default`, is a preset override.
3. Any other key is config, when the capability declares `config` and the key is a field of its closed object schema, or when the schema is open, meaning it has no fixed set of keys: `passthrough`, scalar, array or schemaless.
4. A key that is neither throws at the `.with()` call, before any schema parses the value, naming the unmatched keys, the presets and the config fields. It throws when the capability has no `config`, and when `config.schema` is a strip or strict object and the key is not one of its fields. An open schema passes the key through.
5. A bag that holds only preset keys writes no config. The exception is `{}` on a capability with config, which writes an empty config, so `.with({})` equals `.config({})`.

## Config

Config lets a block pass a typed value to a capability. The capability decides what the value means.

```ts title="src/flows/support/capabilities/order-policy.ts"
import { defineCapability } from "@flow-state-dev/core";
import { z } from "zod";

export const orderPolicy = defineCapability({
  name: "orderPolicy",
  config: {
    schema: z.object({ refundLimitCents: z.number().default(5000) }).default({}),
    resolve: (config) => ({
      context: `Refunds above ${config.refundLimitCents} cents need a manager.`,
    }),
  },
});
```

A block lists `orderPolicy.config({ refundLimitCents: 2000 })`, or `orderPolicy` alone for the default.

| Piece | What it is |
| --- | --- |
| `schema` | Optional Zod schema. It validates the value given to `.config()` and types it: the `.config()` argument is `z.input`, the resolver's first parameter is `z.output`. A `.default()` field is optional at the call and present in the resolver. |
| `resolve(config, ctx)` | Maps the validated value onto a partial block surface, the keys of a preset, merged like one. It runs when a block that lists the capability is built, so keep it pure. A throw becomes `Config resolver for capability "<name>" threw: <message>`. It obeys the block-kind rules of a preset, and the error names `config` as the source. |
| `ctx.presets` | `ReadonlySet<string>`: the capability's presets that are on for this block. The resolver decides whether a value replaces or adds to what a preset contributes. |
| `ctx.blockKind` | The kind of the block being built. |

| Situation | Result |
| --- | --- |
| No `.config()` call, and the schema accepts `undefined` | Allowed. Use `z.object({ ... }).default({})`: a plain `z.object` rejects `undefined` even when every field is optional. |
| No `.config()` call, and the schema rejects `undefined` or there is none | Throws at build: `Capability "<name>" requires configuration: call .config(...) on it (its config schema does not accept an absent value).` Without a schema: `Capability "<name>" declares schemaless config and must be used with .config(...).` |
| A value of the wrong shape | Throws at build: `Invalid config for capability "<name>": <zod message>` |
| One capability listed twice with different config | Throws `Conflicting .config() for capability "<name>": ...`. Identical config is allowed. Configs compare by what the schema parses to, so omitting a defaulted field is not a conflict. With no schema, a bare reference against a configured one is a conflict, and two configured ones compare by value. |
| Reached through a dynamic `uses` function, directly or inside a dynamically returned capability's own `uses` | Throws when the function runs, at request time and not at build: `Capability "<name>" declares open config but was reached through a dynamic uses resolver, which is not supported. Use it on a static uses entry.` |

### Tuning a capability

| Way | Changes | Takes a value from the consumer |
| --- | --- | --- |
| Function preset override | One named preset | No |
| Config | Whatever the resolver maps | Yes, typed |
| A factory, `createXCapability(options)` | The capability's structure, such as a resource's scope, when it is built | Yes, at build |

## Static and dynamic `uses` entries

`uses` on a block or a capability is `readonly UsesEntry[]`. An entry is a capability (static) or `(ctx: BlockContext) => readonly CapabilityRef[]` (dynamic).

```ts title="src/flows/support/capabilities/refund-rules.ts"
import { defineCapability } from "@flow-state-dev/core";

export const refundRules = defineCapability({
  name: "refundRules",
  presets: {
    context: { context: "Refunds above 5000 cents need a manager." },
    default: ["context"],
  },
});
```

```ts title="src/flows/support/blocks/draft-reply.ts"
import { generator, type BlockContext, type CapabilityRef } from "@flow-state-dev/core";
import { z } from "zod";
import { orders } from "../capabilities/orders";
import { refundRules } from "../capabilities/refund-rules";

export const draftReply = generator({
  name: "draftReply",
  model: "openai/gpt-6-luna",
  prompt: "Answer the customer's question about their order.",
  inputSchema: z.string(),
  user: (input) => input,
  uses: [
    orders,
    (ctx: BlockContext): CapabilityRef[] => (ctx.session.state.refundsEnabled === true ? [refundRules] : []),
  ],
});
```

`refundRules` is a capability with a `context` preset. The dynamic entry runs on every run of `draftReply` and adds it only while the session's `refundsEnabled` field is `true`.

| | Static entry | Dynamic entry |
| --- | --- | --- |
| When it is read | Once, when the block is built | Every run of the block, with that run's `ctx` |
| `resources` | Installed, and bubbled up to the flow | Not installed |
| State schemas, `stateSchema`, `targetStateSchemas`, `sequencerStateSchema` | Installed | Not installed |
| `fns` at `ctx.cap.<name>` | Built | Not built |
| `config` | Allowed | Throws when the function runs |

| | Static entry | Dynamic entry |
| --- | --- | --- |
| `context`, `tools`, `controlTools`, `history` presets | Merged at build | Resolved each run from the capability's active presets, and those of its static `uses` dependencies |
| `model`, `providerOptions`, `caching` | Merged | Not read |
| `itemVisibility` filter | Applied | Applied to each returned capability |
| Types on `ctx` | Reflected | Contribute nothing |

List a resource-bearing capability statically beside the dynamic entry.

A dynamic entry on a handler, router, sequencer or evaluator does nothing: only a generator collects dynamic context, history and tools. A dynamic function inside a capability's own `uses` is collected on a generator and follows the same rules.

## What each part installs

"At build" means when the block that lists the capability is constructed, before any request. A refusal there is a thrown error at the line that builds the block.

| Part | Lands on | When | If two sources declare the same thing |
| --- | --- | --- | --- |
| `resources` | The block's declared resources, which bubble through sequencers and routers to the flow, so a flow that includes the block declares nothing. | At build | A conflict throws. [Resources](./resources.md) |
| `sessionStateSchema`, `userStateSchema`, `orgStateSchema` | The flow's scope state defaults. A schema from a preset, a config resolver or a dynamic entry does not reach them. | At `defineFlow` | Two declarations of a field that disagree on type or default are refused, naming both. [Flows and actions](./flows.md) |
| `stateSchema` | The block's own state, `ctx.self` | At build | A conflict throws. [Blocks](./blocks.md) |
| `targetStateSchemas` | `ctx.targets` | At build | A conflict throws. [Blocks](./blocks.md) |
| `sequencerStateSchema` | The sequencer's state, alongside its own `stateSchema` | At build | A mismatch throws. [Blocks](./blocks.md) |
| `fns` | `ctx.cap.<name>`, built from `fns(ctx)` with the running block's `ctx` | When the block runs, once per run. A block inside another block that lists the same capability receives the outer block's helper object, built with the outer block's `ctx`. | Two capabilities with one name: an error. |

| Part | Lands on | When | If two sources declare the same thing |
| --- | --- | --- | --- |
| `context` | The generator's `context`, after the block's own entries | At build when static, each run when dynamic | Entries concatenate. [Generators](./generators.md#in-what-order-is-context-assembled) |
| `tools` | The generator's tool list, unless it declares `tools:` | Each run | All are included. [Generators](./generators.md#tools-a-generator-is-given) |
| `controlTools` | The generator's tool list, always | Each run | All are included. |
| `history` | The generator's history reads | Each run | Queries merge. [Generators](./generators.md#history-and-user) |
| `model`, `providerOptions`, `caching` | The generator, when the block sets none | At build | The last capability wins. The block's own wins. |

The block's own declaration wins only for `model`, `providerOptions`, `caching` and the keys of a `history` read. A resource accessor and an own-state field declared by both a capability and the block must share one reference, or the build throws. A target declared by two capabilities must too. A target a capability and the block both declare is not checked: the block's own schema wins in the type, and conflicting types collapse to `never`.

### Composition and refusals

| Situation | Result |
| --- | --- |
| A capability lists dependencies in `uses` | They install first, transitively. A dependency reached by two paths installs once, with the presets of the first reference reached. |
| A cycle | Throws at build: `Capability cycle detected: "<name>" depends on itself (transitively)`. |
| Two `defineCapability()` calls with one name | Throws: `Capability name collision: "<name>" is declared by two different defineCapability() calls`. |
| One reference listed twice with different `.config()` | Throws. |
| One reference listed twice with different `.presets()` | The first reached wins. |
| A capability's `itemVisibility` does not match the block's | The capability is dropped for that block, with all its parts including tools. A dependency in its `uses` is checked against its own `itemVisibility`, not dropped with it. |

### When each refusal fires

| Where | What throws |
| --- | --- |
| The `defineCapability` call | An empty name, and a preset name that overlaps a config field. The overlap check covers object config schemas only. |
| The `.with()` call | A key that matches neither a preset nor a config field. |
| The build of a block | Unknown preset, block-kind mismatch, missing or invalid config, conflicting config, cycle, name collision, and every merge conflict above. |
| `defineFlow` | Scope state fields two declarations disagree on. |
| A dynamic function running | A capability with `config` reached through it. |

## What a capability stores

A capability keeps no data. It declares shapes, and the data lives where each part's scope puts it.

| Part | Where its data lives |
| --- | --- |
| `resources` | The store the resource's scope names. [Resources](./resources.md) |
| Session, user and org state fields | The scope's record, one per session, user or org. [Flows and actions](./flows.md) |
| `stateSchema`, `sequencerStateSchema` | The block's or the sequencer's own state. [Blocks](./blocks.md) |
| `targetStateSchemas`, `fns`, `.config(value)` | Nowhere. Targets point at an ancestor block's state, helpers are built per block run, and a config value travels with the `.config()` reference in app code. |

## Next

- [Capabilities](../concepts/capabilities.md), the idea and a worked example.
- [Write a capability](../build/write-a-capability.md), a step by step guide to making one.
- [Generators](./generators.md), the `tools:` option and how context and history are assembled.
- [Type helpers](./type-helpers.md), what `uses` reflects into a block's types.
- [Resources](./resources.md), the scope and options of the data a capability installs.
- [Memory](./memory.md), the capability that ships with the framework.

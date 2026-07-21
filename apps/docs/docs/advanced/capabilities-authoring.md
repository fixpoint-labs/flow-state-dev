---
sidebar_position: 1
---

# Authoring capabilities

This page is for building new capabilities. If you just want to use a bundled one, see [Using capabilities](/docs/fundamentals/capabilities).

A capability bundles resources, state schemas, helper functions, and block-level configuration under one name. `defineCapability()` is the entry point. The merge machinery — what gets installed where, how diamonds dedup, how presets compose — is what this page is about.

## Defining a capability

A capability can bundle any combination of resources, state schemas, helper functions, and block-level configuration presets.

Here's one that manages notes — a resource, a state schema slice, and helper functions:

```ts
import { defineCapability, defineResource } from "@flow-state-dev/core";
import { z } from "zod";

const notesResource = defineResource({
  stateSchema: z.object({
    entries: z.array(z.object({ text: z.string(), createdAt: z.number() })),
  }),
});

const notesCapability = defineCapability({
  name: "notes",
  sessionResources: { notes: notesResource },
  sessionStateSchema: z.object({ noteCount: z.number().default(0) }),

  fns: (ctx) => ({
    add: async (text: string) => {
      const entries = ctx.session.resources.notes.state.entries;
      await ctx.session.resources.notes.patchState({
        entries: [...entries, { text, createdAt: Date.now() }],
      });
      await ctx.session.incState({ noteCount: 1 });
    },
    list: () => ctx.session.resources.notes.state.entries,
  }),
});
```

And here's one that bundles resources with generator-specific configuration — context formatters and tools — as presets:

```ts
const memoryCapability = defineCapability({
  name: "memory",
  sessionResources: { memories: memoryResource },

  fns: (ctx) => ({
    remember: async (fact: string) => { /* ... */ },
    recall: (query: string) => { /* ... */ },
  }),

  presets: {
    context: {
      context: [memoryContextFormatter],
    },
    tools: {
      tools: [recallTool, saveTool],
    },
    default: ["context", "tools"],
  },
});
```

The presets here handle something that would otherwise be repetitive and error-prone: every generator that needs memory would need to independently wire up the same context formatter and the same tools. With the capability, `uses: [memoryCapability]` installs the resource *and* injects the context formatter and tools into the generator's config automatically.

## What gets installed

When a block lists a capability in `uses`, the framework merges the capability's declarations into the block's config at factory time:

| Surface | Where it goes |
|---------|--------------|
| `sessionResources`, `userResources`, `orgResources` | Block's declared resources (bubble through sequencers to the flow) |
| `sessionStateSchema`, `requestStateSchema`, etc. | Merged into block-level state schemas via Zod `.extend()` |
| `targetStateSchemas` | Merged into block's target declarations |
| `stateSchema` | Merged into the block's own state (`ctx.self`) — valid on any block kind, since any block can hold state |
| `fns` | Available at `ctx.cap.{name}` during execution |
| Preset `context` entries | Concatenated into generator's context array (string, object-form, or function — see [Generator context](/docs/advanced/generator-context)) |
| Preset `tools` | Merged into generator's tools |
| Preset `sequencerStateSchema` | Merged into sequencer's state schema |

The merge happens before the block is built. This is the key thing: capabilities aren't just a way to share resources. They're a way to share any block configuration. A generator that `uses` a capability with context and tools presets gets those injected into its config as if they were declared inline. The existing propagation — sequencer resource collection, `defineFlow` resource merging — works unchanged.

`stateSchema` merges differently from the other schema fields: a field declared by two sources (two capabilities, or a capability and the block's own `stateSchema`) must be the *same schema reference*, or the build throws — no silent last-wins. This is the same reference-equality rule the sibling `resources` and `targetStateSchemas` merges use: to share a field deliberately, both sides reference one schema constant; otherwise use distinct field names. It's how a generator capability (a skills registry, say) can give its host generator a working `ctx.self` container without the generator author declaring `stateSchema` directly, while still catching an accidental name collision at build time instead of silently dropping one side. See [Block state](/docs/advanced/block-state) for `ctx.self`/`ctx.parent`.

Schema declarations also flow into types. A block that lists a capability in `uses` gets the capability's `sessionStateSchema`, resource schemas, `targetStateSchemas`, `sequencerStateSchema`, and `stateSchema` reflected in its `ctx` types without re-declaring them. See [Type inference from capability declarations](/docs/fundamentals/capabilities#type-inference-from-capability-declarations) for the full rules and limits.

## Presets

Presets are how capabilities contribute block-level configuration — context formatters, tools, state schemas, and resources — as named bundles that consumers can toggle. They're the mechanism that makes capabilities more than just shared resources.

A preset can declare any field a block config supports. The most common use is packaging context and tools for generators:

```ts
const memoryCapability = defineCapability({
  name: "memory",
  sessionResources: { memories: memoryResource },
  fns: (ctx) => ({ remember, recall }),

  presets: {
    recentContext: {
      context: [(input, ctx) => formatRecentMemories(ctx)],
    },
    fullContext: {
      context: [(input, ctx) => formatAllMemories(ctx)],
    },
    tools: {
      tools: [recallTool, saveTool],
    },
    default: ["recentContext", "tools"],
  },
});
```

By default, all listed presets are active. If you omit the `default` array, every preset is on.

### Cross-capability context aggregation

Preset `context` entries can be authored as object-form values, where the keys become XML tag names. When two capabilities both contribute under the same key — for example, two `recentContext` presets each adding to `documents` — the runtime aggregates their values inside a single `<documents>` block in author order. This stops the model from seeing fragmented sections like `<documents>...</documents>` from cap A then unrelated content then a second `<documents>` from cap B.

```ts
const sourceA = defineCapability({
  name: "source-a",
  presets: { defaults: { context: () => ({ documents: "from A" }) } },
});

const sourceB = defineCapability({
  name: "source-b",
  presets: { defaults: { context: () => ({ documents: "from B" }) } },
});

generator({
  uses: [sourceA, sourceB],
  // Renders: <documents>\n  from A\n  from B\n</documents>
});
```

If two contributors collide on the same key with incompatible shapes (a string from one and a nested object from another), the render throws. See [Generator context — object form](/docs/advanced/generator-context) for the full contract.

### Configuring presets

```ts
// Default — recentContext and tools are both active
uses: [memoryCapability]

// Turn off the tools preset (read-only generator)
uses: [memoryCapability.presets({ tools: false })]

// Swap to full context instead of recent
uses: [memoryCapability.presets({ recentContext: false, fullContext: true })]
```

The type system enforces block-kind compatibility: a preset with `context` or `tools` only works on generators. A preset with `sequencerStateSchema` only works on sequencers. Resource-only presets work on all block kinds.

If a preset contributes a field incompatible with the consuming block kind, you get a clear error at factory time naming the capability, preset, and offending field.

## Open config with a resolver

Presets flip predefined surfaces on and off. They can't carry a *value* — a list, a limit, a field name. When a capability needs real per-consumer configuration, declare a `config` block: a Zod `schema` that types and validates the value, and a `resolve` function — a **resolver** — that maps the validated value onto the same block surface a preset produces.

```ts
const banner = defineCapability({
  name: "banner",
  config: {
    schema: z.object({ note: z.string(), loud: z.boolean().default(false) }),
    resolve: (cfg) => ({ context: [cfg.loud ? cfg.note.toUpperCase() : cfg.note] }),
  },
});

// A consumer passes typed config:
generator({ uses: [banner.config({ note: "ship it", loud: true })] });
```

The resolver returns the same partial block surface a preset does — `context`, `tools`, `resources`, state schemas, generator singletons — and it's merged through the same pipeline, so everything you know about preset merging and block-kind compatibility applies. A resolver that emits `context` or `tools` only works on generators; the error naming the offending field reports `config` as the source.

### The `.default({})` contract

The resolver runs whenever a used capability declares `config`. If the consumer didn't call `.config()`, the schema is parsed against an absent value. A plain `z.object({ ... })` rejects `undefined` even when every *field* is optional — optional fields don't make the object itself optional. So a capability meant to be usable **without** `.config()` must declare a schema that accepts an absent value:

```ts
config: {
  schema: z.object({ allowed: z.array(z.string()).default([]) }).default({}), // note the outer .default({})
  resolve: (cfg) => ({ /* cfg.allowed is [] when .config() is omitted */ }),
}
```

A schema that rejects `undefined` (no outer default), or a schemaless config, makes `.config()` mandatory — omitting it is a build-time error. The `.config()` argument is typed as the schema's **input** (a `.default()` field is optional at the call site), while the resolver's `config` parameter receives the schema's **output** (that field is present).

### The resolver sees active presets

The resolver's second argument carries the names of the capability's presets that are active for this block, so config can reconcile against a preset default — the capability owns whether a config value replaces or adds to what a preset contributes. There's no fixed framework rule.

```ts
resolve: (cfg, ctx) => ({
  context: [ctx.presets.has("dynamicActivation") ? formatDynamic(cfg) : formatStatic(cfg)],
}),
```

### Composing with presets

`.config()` and `.presets()` chain in either order and compose on one capability:

```ts
generator({ uses: [skills.config({ allowed: ["research"] }).presets({ dynamicActivation: true })] });
generator({ uses: [skills.presets({ dynamicActivation: true }).config({ allowed: ["research"] })] });
```

Using the same capability twice with **conflicting** `.config()` values in one block throws — config carries values, so silently baking one and dropping the other would be a correctness bug. Identical config deduplicates. (Presets keep their first-wins behavior; the stricter rule is specific to config.)

### Config vs. function-form preset overrides vs. bespoke factories

There are three ways to tune a capability, and they don't overlap:

- **Function-form preset overrides** (`.presets({ name: (preset) => Partial<PresetDef> })`) surgically mutate one named preset's surface. Use them to tweak a preset you already declared. They can't accept typed open input, see the full active-preset set, or reconcile across presets from a consumer value.
- **Open config** (`.config(value)`) accepts a typed value and lets the resolver own how it maps onto the block. Use it for per-consumer values.
- **Bespoke factories** (`createXCapability(options)`, below) do structural build-time work — installing different resources, wiring dependent tiers — that a post-construction resolver can't. `.config()` complements factories; it doesn't replace them.

Config on a capability returned from a **dynamic** `uses` resolver is not supported in this version and throws at request time — use `.config()` on a static `uses` entry.

For the consumer's view of `.config()`, see [Configuring open config](/docs/fundamentals/capabilities#configuring-open-config).

## Capability composition

Capabilities can depend on other capabilities. This works the same way as block-level `uses`:

```ts
const searchCapability = defineCapability({
  name: "search",
  uses: [memoryCapability],
  fns: (ctx) => ({
    searchAndRemember: async (query: string) => {
      const results = await doSearch(query);
      await ctx.cap.memory.remember(results.summary);
      return results;
    },
  }),
});
```

A block that uses `searchCapability` gets memory's resources installed too. Dependencies are resolved transitively and deduplicated. If two capabilities both depend on the same base capability, it's installed once (diamond deduplication).

## Dynamic `uses`

`uses` arrays accept a function that returns capability refs at runtime: `(ctx) => CapabilityRef[]`. Static entries install resources at build time; dynamic entries add context and tools at runtime. Resources have to be declared statically somewhere — you can't conditionally install a new resource per request.

The typical use is gating context or tools on session state without forking the block:

```ts
generator({
  uses: (ctx) => [
    memoryCapability,
    ctx.session.state.expert ? expertToolsCapability : userToolsCapability,
  ],
});
```

Both branches must already have their resources declared statically — usually by listing them unconditionally in a static `uses` entry alongside.

## Parameterized capabilities

When a capability needs configuration, wrap `defineCapability()` in a function:

```ts
const storageCapability = (scope: "session" | "user") =>
  defineCapability({
    name: `storage:${scope}`,
    ...(scope === "session"
      ? { sessionResources: { store: storeResource } }
      : { userResources: { store: storeResource } }),
    fns: (ctx) => ({ save, load }),
  });

// Usage
uses: [storageCapability("session")]
```

One trade-off: parameterization propagates. If a capability depends on a parameterized capability, it either hardcodes the choice or becomes parameterized itself. This is the right behavior — the parameter represents a real decision that someone has to make — but it can surprise people the first time they hit a three-level chain.

See [`@flow-state-dev/memory`](../memory/overview) for a production-grade factory-shaped capability with presets, attached resources, and dependent tiers — `createMemoryCapability(options)` is exactly this pattern at scale.

## ctx.cap

Helper functions live at `ctx.cap.{capabilityName}`. Each capability's `fns(ctx)` factory is called once per block execution and the result is cached.

```ts
execute: async (input, ctx) => {
  // Typed — autocomplete shows available helpers
  await ctx.cap.memory.remember("user prefers dark mode");
  const facts = ctx.cap.memory.recall("preferences");
}
```

`ctx.cap` is a plain object with properties, not a Proxy. Destructuring works: `const { memory } = ctx.cap`.

If a capability doesn't declare `fns`, it still installs resources and state schemas — it just doesn't contribute to `ctx.cap`.

## Merging rules

When multiple capabilities (or a capability and a block) declare the same surface:

| Surface | Same reference | Different references |
|---------|---------------|---------------------|
| Resource | Deduplicated silently | Error: resource conflict |
| Target | Deduplicated silently | Error: target conflict |
| State schema | Merged via Zod `.extend()` | Last-wins for matching keys |
| Context entries | Concatenated | N/A |
| Tools | Both included | N/A |

Resource deduplication uses reference equality. If two capabilities pass the same `defineResource()` reference, there's no conflict. If they create different resource objects for the same name, the framework throws at factory time.

## When to extract a capability

Not everything needs to be a capability. A single resource used by one block doesn't benefit from the abstraction. Extract a capability when:

- Multiple blocks need the same combination of resources + state + helpers
- Several generators share the same context formatters, tools, or both — and you want them to stay in sync when the set changes
- A domain concept (memory, artifacts, search) has a clear boundary with both data and behavior
- You want `ctx.cap.{name}` helpers instead of loose function imports

The second point is worth emphasizing. Without a capability, adding a new tool to your memory system means finding every generator that uses memory and updating its `tools` array. With a capability, you add the tool once to the preset and every consumer picks it up automatically.

Start concrete. If you find yourself spreading the same config into three blocks, that's when a capability earns its keep.

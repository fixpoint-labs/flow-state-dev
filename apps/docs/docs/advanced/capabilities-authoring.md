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
      const entries = (ctx.session.resources.notes.state).entries;
      await ctx.session.resources.notes.patchState({
        entries: [...entries, { text, createdAt: Date.now() }],
      });
      await ctx.session.incState({ noteCount: 1 });
    },
    list: async () => (ctx.session.resources.notes.state).entries,
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
| `fns` | Available at `ctx.cap.{name}` during execution |
| Preset `context` entries | Concatenated into generator's context array (string, object-form, or function — see [Generator context](/docs/advanced/generator-context)) |
| Preset `tools` | Merged into generator's tools |
| Preset `sequencerStateSchema` | Merged into sequencer's state schema |

The merge happens before the block is built. This is the key thing: capabilities aren't just a way to share resources. They're a way to share any block configuration. A generator that `uses` a capability with context and tools presets gets those injected into its config as if they were declared inline. The existing propagation — sequencer resource collection, `defineFlow` resource merging — works unchanged.

Schema declarations also flow into types. A block that lists a capability in `uses` gets the capability's `sessionStateSchema`, resource schemas, `targetStateSchemas`, and `sequencerStateSchema` reflected in its `ctx` types without re-declaring them. See [Type inference from capability declarations](/docs/fundamentals/capabilities#type-inference-from-capability-declarations) for the full rules and limits.

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

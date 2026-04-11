---
sidebar_position: 1
---

# Capabilities

Blocks declare their data dependencies individually: resources here, state schemas there, targets somewhere else, context formatters in a separate array, tools in yet another. It works, but it means every block that needs "memory" has to independently wire up the same resource, the same state slice, the same helper imports. Drift is silent — two blocks can declare slightly different shapes for what's supposed to be the same thing.

`defineCapability()` solves this. A capability bundles all the pieces that belong together under one name. Blocks install it with `uses: [capabilityName]`, and the framework handles the rest.

## Defining a capability

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

This bundles a resource, a state schema slice, and helper functions. Now any block that needs notes just declares it:

```ts
const myHandler = handler({
  name: "note-taker",
  uses: [notesCapability],
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ count: z.number() }),
  execute: async (input, ctx) => {
    await ctx.cap.notes.add(input.text);
    return { count: ctx.cap.notes.list().length };
  },
});
```

`ctx.cap.notes` gives you the helper functions. The resource and state schema are installed automatically. No manual spreading, no import coordination.

## What gets installed

When a block lists a capability in `uses`, the framework merges the capability's declarations into the block's config at factory time:

| Surface | Where it goes |
|---------|--------------|
| `sessionResources`, `userResources`, `projectResources` | Block's declared resources (bubble through sequencers to the flow) |
| `sessionStateSchema`, `requestStateSchema`, etc. | Merged into block-level state schemas via Zod `.extend()` |
| `targetStateSchemas` | Merged into block's target declarations |
| `fns` | Available at `ctx.cap.{name}` during execution |
| Preset `context` entries | Concatenated into generator's context slot |
| Preset `tools` | Merged into generator's tools array |

The merge happens before the block is built. Existing propagation — sequencer resource collection, `defineFlow` resource merging — works unchanged. No new runtime primitive. Capabilities are a packaging layer over the declare-in-config primitives you already use.

## Presets

Sometimes a capability has optional features. A memory capability might offer different context formatters (recent vs. full history) or tools (read-only vs. read-write). Presets let you package these as named bundles that consumers can toggle.

```ts
const memoryCapability = defineCapability({
  name: "memory",
  sessionResources: { memories: memoryResource },
  fns: (ctx) => ({ remember, recall }),

  presets: {
    recentContext: {
      context: [(input, ctx) => formatRecentMemories(ctx)],
    },
    tools: {
      tools: [recallTool, saveTool],
    },
    default: ["recentContext", "tools"],
  },
});
```

By default, all listed presets are active. If you omit the `default` array, every preset is on.

### Configuring presets

```ts
// Default — recentContext and tools are both active
uses: [memoryCapability]

// Turn off the tools preset (read-only)
uses: [memoryCapability.presets({ tools: false })]

// Add a non-default preset
uses: [memoryCapability.presets({ fullHistory: true })]
```

Presets can declare any field a block config supports. The type system enforces block-kind compatibility: a preset with `context` or `tools` only works on generators. A preset with `sequencerStateSchema` only works on sequencers. Resource-only presets work on all block kinds.

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
- You're passing the same `sessionResources` / `context` / `tools` set to several generators
- A domain concept (memory, artifacts, search) has a clear boundary
- You want `ctx.cap.{name}` helpers instead of loose function imports

Start concrete. If you find yourself spreading the same config into three blocks, that's when a capability earns its keep.

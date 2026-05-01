---
sidebar_position: 1
---

# Authoring capabilities

Use `defineCapability()` when several blocks need the same resources, state, helper functions, context, or tools. A capability packages that surface under one name. Blocks install it with `uses`, and the framework merges the declarations into the block's effective config.

This page is for authors building a new capability. If you only want to attach bundled capabilities like memory, MCP, bash, or skills, start with [Using capabilities](/docs/fundamentals/capabilities).

## The smallest useful capability

A capability can install resources and expose helpers on `ctx.cap`.

```ts
import { defineCapability, defineResource } from "@flow-state-dev/core";
import { z } from "zod";

const notesResource = defineResource({
  ref: "notes",
  scope: "session",
  stateSchema: z.object({
    entries: z.array(z.object({ text: z.string(), createdAt: z.number() })),
  }),
  default: { entries: [] },
  writable: true,
});

export const notesCapability = defineCapability({
  name: "notes",
  resources: { notes: notesResource },
  fns: (ctx) => ({
    add: async (text: string) => {
      const entries = ctx.resources.notes.state.entries;
      await ctx.resources.notes.patchState({
        entries: [...entries, { text, createdAt: Date.now() }],
      });
    },
    list: () => ctx.resources.notes.state.entries,
  }),
});
```

Any block can use it:

```ts
const saveNote = handler({
  name: "save-note",
  uses: [notesCapability],
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ count: z.number() }),
  execute: async (input, ctx) => {
    await ctx.cap.notes.add(input.text);
    return { count: ctx.cap.notes.list().length };
  },
});
```

`ctx.cap.notes` is typed from the `fns` return value. The `notes` resource is declared once on the capability and bubbles through sequencers to the flow.

## What can be bundled

When a block lists a capability in `uses`, the framework merges the capability's declarations into the block at factory time.

| Surface | Where it goes |
|---------|---------------|
| `resources` | Block resource declarations. Each resource carries its own scope. |
| `requestStateSchema`, `sessionStateSchema`, `userStateSchema`, `orgStateSchema` | Block-level state schema fragments. |
| `sequencerStateSchema` | Sequencer-local state schema, for sequencer blocks only. |
| `targetStateSchemas` | Named target state declarations. |
| `fns` | Helpers available at `ctx.cap.{name}` during execution. |
| Preset `context` entries | Generator context entries. |
| Preset `tools` entries | Generator tools. |

The merge happens before execution. A generator that uses a capability with context and tools presets behaves as if those entries were declared inline.

## Presets

Presets are named bundles of block config. They let a capability install resources and helpers for every block, while making generator-specific surfaces like context and tools configurable.

```ts
const memoryCapability = defineCapability({
  name: "memory",
  resources: { memories: memoryResource },
  fns: (ctx) => ({
    recall: (query: string) => recallMemories(ctx.resources.memories, query),
  }),
  presets: {
    recentContext: {
      context: () => ({ memory: formatRecentMemories() }),
    },
    tools: {
      tools: [recallTool, saveMemoryTool],
    },
    default: ["recentContext", "tools"],
  },
});
```

Consumers can keep the defaults, turn off a preset, or swap presets:

```ts
uses: [memoryCapability]

uses: [memoryCapability.presets({ tools: false })]

uses: [memoryCapability.presets({ recentContext: false, fullContext: true })]
```

If you omit `default`, every preset is active. The type system and runtime both reject presets on incompatible block kinds. A `context` preset belongs on generators, not handlers.

## Object-form context aggregation

Capability context can return object-form values. Keys become XML tag names. When several capabilities contribute to the same key, the values aggregate under one tag in author order.

```ts
const sourceA = defineCapability({
  name: "source-a",
  presets: { context: { context: () => ({ documents: "from A" }) } },
});

const sourceB = defineCapability({
  name: "source-b",
  presets: { context: { context: () => ({ documents: "from B" }) } },
});

generator({
  name: "researcher",
  model: "preset/medium",
  uses: [sourceA, sourceB],
  prompt: "Answer from the documents.",
});
```

The model sees one `<documents>` section containing both contributions. If one capability contributes a string and another contributes a nested object for the same key, rendering throws. Pick one shape per logical key. See [Generator context](/docs/advanced/generator-context) for the full contract.

## Composition and diamond deduplication

Capabilities can depend on capabilities:

```ts
const searchCapability = defineCapability({
  name: "search",
  uses: [memoryCapability],
  fns: (ctx) => ({
    searchAndRemember: async (query: string) => {
      const results = await search(query);
      await ctx.cap.memory.recall(query);
      return results;
    },
  }),
});
```

Dependencies resolve transitively. If two capabilities both depend on the same base capability, the base installs once. Configured references created by `.presets()` keep a prototype link to the base reference, so diamond dedup still works when one branch customizes presets.

The framework also rejects same-name collisions from different capability objects. Capability names become `ctx.cap` keys, so two unrelated `name: "memory"` definitions are not safe to merge.

## Dynamic `uses`

`uses` entries can be functions when the active capability depends on runtime state:

```ts
const featureCapability = defineCapability({
  name: "features",
  sessionStateSchema: z.object({
    memoryEnabled: z.boolean().default(true),
  }),
  uses: [
    (ctx) => (ctx.session.state.memoryEnabled ? [memoryCapability] : []),
  ],
});
```

Dynamic entries can contribute runtime context and tools. Resources must be declared statically somewhere, because the runtime needs to know the resource graph before execution starts. A common pattern is to statically install the storage capability and dynamically install only the tool/context capability.

## Agent-type filters

Use `agentType` when a capability should attach to only some generators in a multi-agent flow.

```ts
export const skillsCapability = createSkillsCapability({
  agentType: "primary",
});
```

A block with no `agentType` is treated as `"primary"` for this check. This is useful for skills, large prompt context, or expensive tools that should attach to the main coordinator but not to `agentType: "sub"` workers. See [Agent types](/docs/advanced/agent-types) for the visibility model.

## Parameterized factories

When a capability needs configuration, export a factory:

```ts
export function createStorageCapability(scope: "session" | "user") {
  const resource = defineResource({
    ref: `storage-${scope}`,
    scope,
    stateSchema: storageStateSchema,
    default: { records: {} },
    writable: true,
  });

  return defineCapability({
    name: `storage:${scope}`,
    resources: { storage: resource },
    fns: (ctx) => ({
      save: (key: string, value: string) =>
        ctx.resources.storage.patchState({
          records: { ...ctx.resources.storage.state.records, [key]: value },
        }),
    }),
  });
}
```

Parameterization propagates. If a capability depends on a parameterized capability, it either hardcodes the choice or becomes parameterized itself. That is usually the right pressure. The parameter represents a real application decision.

## Merge rules

When multiple capabilities, or a capability and a block, declare the same surface:

| Surface | Same reference | Different references |
|---------|----------------|----------------------|
| Resource | Deduplicated | Error on the same accessor key |
| Target | Deduplicated | Error on the same target name |
| State schema | Merged by object shape | Last declaration wins for duplicate fields |
| Context entries | Concatenated | Not applicable |
| Tools | Included together | Not applicable |

Resource and target deduplication use reference equality. Share one `defineResource()` value when two capabilities intentionally refer to the same storage.

## When to extract a capability

Not every shared object needs a capability. Extract one when:

- Multiple blocks need the same combination of resources, state, and helpers.
- Several generators share context formatters, tools, or both.
- A domain concept has both data and behavior, like memory, artifacts, search, or skills.
- You want consumers to install the domain with one `uses` entry.

Start concrete. If you find yourself spreading the same config into three blocks, a capability has probably earned its place.

---
sidebar_position: 7
---

# Using capabilities

A capability is a bundle of resources, state, helpers, and block-level configuration packaged under one name. Installing a capability is how you turn on a feature like memory, MCP tools, or skills without wiring up each piece by hand.

You install a capability by listing it in a block's `uses` array. The framework merges in everything the capability provides — resources, state schemas, context formatters, tools — and exposes its helper functions on `ctx.cap.{name}` during execution.

```ts
import { generator, handler } from "@flow-state-dev/core";
import { workingMemoryCapability as memoryCapability } from "@flow-state-dev/memory";

// For the full multi-tier system, use `system()` from the same module — see
// Ecosystem → Memory for details.

const assistant = generator({
  name: "assistant",
  uses: [memoryCapability],
  model: selectModel("gpt-4o"),
  prompt: (input) => input.message,
});

const noteTaker = handler({
  name: "note-taker",
  uses: [memoryCapability],
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ count: z.number() }),
  execute: async (input, ctx) => {
    await ctx.cap.memory.remember(input.text);
    return { count: ctx.cap.memory.recall("").length };
  },
});
```

The generator gets memory's context formatter and tools injected automatically. The handler gets the helper functions on `ctx.cap.memory`. Both share the same underlying resource — no manual coordination.

## Installing a capability

List the capability in `uses`:

```ts
generator({
  name: "assistant",
  uses: [memoryCapability],
  model: selectModel("gpt-4o"),
  prompt: (input) => input.message,
});
```

Multiple capabilities compose:

```ts
uses: [memoryCapability, mcpCapability, skillsCapability]
```

Capabilities can declare other capabilities they depend on. Those dependencies install transitively. If two capabilities depend on the same base capability, it's installed once. You don't have to track this — just list what you want.

## Configuring presets

A capability can ship with named presets that toggle pieces of its behavior. The default usually does the right thing, but you can opt parts in or out.

```ts
// Default — recent context and tools are both active
uses: [memoryCapability]

// Read-only generator — turn off the tools preset
uses: [memoryCapability.presets({ tools: false })]

// Swap to full context instead of recent
uses: [memoryCapability.presets({ recentContext: false, fullContext: true })]
```

Each capability documents which presets it ships with and what they do. If you pass a preset name that doesn't exist on the capability, you get an error at factory time.

## Parameterized capabilities

Some capabilities require configuration. They're exposed as factories — call the function to get a configured capability:

```ts
import { storageCapability } from "@flow-state-dev/tools/storage";

uses: [storageCapability("session")]
```

Parameterization is a real decision: a capability scoped to `"session"` and one scoped to `"user"` install into different state surfaces. If you switch the parameter, anything that depended on it has to switch too.

## Using capability helpers

Once installed, helper functions are available at `ctx.cap.{capabilityName}`:

```ts
execute: async (input, ctx) => {
  await ctx.cap.memory.remember("user prefers dark mode");
  const facts = ctx.cap.memory.recall("preferences");
}
```

`ctx.cap` is a plain object. Destructuring works:

```ts
const { memory } = ctx.cap;
await memory.remember("...");
```

Types follow what the capability declared. Autocomplete shows the available helpers and their signatures.

If a capability doesn't declare any helpers, it still installs resources and state — there just isn't anything to call on `ctx.cap` for that name.

## What gets installed

A capability can contribute any of:

| What | Where it lands |
|---------|--------------|
| Resources | The block's resource declarations, bubbled up through sequencers to the flow |
| State schemas | Merged into block-level state schemas |
| Helper functions | Available at `ctx.cap.{name}` during execution |
| Context formatters | Merged into the generator's context array |
| Tools | Merged into the generator's tool list |

Capabilities are validated at factory time, so most install mistakes show up before your code runs.

## When to reach for one

If a capability exists for what you need — memory, MCP, skills, storage — use it. The point of the abstraction is that you don't have to learn the internals to install one.

If you find yourself wiring the same combination of resources, state, and tools into three different blocks, that's a signal you might want to author one. See [Authoring capabilities](/docs/advanced/capabilities-authoring) for how `defineCapability` works under the hood.

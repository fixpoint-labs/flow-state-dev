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

## Configuring open config

Presets are on/off switches. Some capabilities also accept a typed **value** — a list, a limit, a field name — through `.config()`. The capability author declares what the value looks like and a resolver that turns it into behavior; you pass it in one place:

```ts
// A capability that accepts a list of allowed skills:
uses: [skills.config({ allowed: ["research", "summarize"] })]
```

`.config()` and `.presets()` compose. You can set both on the same capability, in either order:

```ts
uses: [skills.config({ allowed: ["research"] }).presets({ dynamicActivation: true })]
```

The value is validated against the capability's schema — a wrong shape is a build-time error. One thing to watch: using the **same** capability more than once in a block with **conflicting** `.config()` values throws (config carries values, so the framework won't silently pick one). Pass identical config, or configure it in a single place.

Each capability documents the config it accepts. See [authoring open config](/docs/advanced/capabilities-authoring#open-config-with-a-resolver) to write one.

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

## Type inference from capability declarations

When a block lists a capability in `uses`, the framework reflects the capability's declared schemas into the block's `ctx` types at factory time. You don't need to re-declare what the capability already claims.

The axes where this flows:

| Capability field | Where it appears in `ctx` |
|---|---|
| `sessionStateSchema` | `ctx.session.state` |
| `sessionResourceSchemas` / `sessionResources` | `ctx.session.resources.*` |
| `targetStateSchemas` | `ctx.targets.*` |
| `sequencerStateSchema` (preset) | `ctx.sequencer.state` |
| `stateSchema` | `ctx.self.state` |

If the block declares its own schema for the same axis, both are merged. For most axes the block's own declaration wins on key collision; `stateSchema` is stricter — a field declared by both a capability and the block (or by two capabilities) must be structurally compatible, or the build throws instead of silently picking one side. `ctx.targets`, `ctx.sequencer`, and `ctx.self` here are three of [block state](/docs/advanced/block-state)'s four addressing modes — the remaining one, `ctx.parent`, addresses the immediate parent's state, which a capability can't declare into (it isn't the parent's own capability).

Type inference reflects the capability's **top-level** schema declarations. A schema contributed only through a preset (or the open-config resolver) still merges at runtime — the container works and `ctx.self` is populated — but it isn't reflected in the block's `ctx` types, so declare the schema at the capability's top level when you want it typed without re-declaring it on the block.

Here's a concrete example. A capability declares session state with a `ticker` field. A handler lists it in `uses` and reads `ticker` without declaring anything itself:

```ts
import { defineCapability, handler } from "@flow-state-dev/core";
import { z } from "zod";

const marketCapability = defineCapability({
  name: "market",
  sessionStateSchema: z.object({
    ticker: z.string(),
    lastPrice: z.number().nullable(),
  }),
  fns: (ctx) => ({
    currentTicker: () => ctx.session.state.ticker,
  }),
});

const priceLogger = handler({
  name: "price-logger",
  uses: [marketCapability],
  execute: async (_input, ctx) => {
    // ctx.session.state.ticker is typed as string — no re-declaration needed
    // ctx.session.state.lastPrice is typed as number | null
    const ticker = ctx.session.state.ticker;
    await ctx.session.patchState({ lastPrice: 42.5 });
  },
});
```

The `ticker` and `lastPrice` fields are typed because `marketCapability` declared them. No `sessionStateSchema` on the handler is necessary.

For a fully-bundled multi-tier capability — resources, context, tools, and dependent sub-capabilities behind one `uses:` entry — see [Memory → Overview](../memory/overview).

### Limits

**Direct only.** If a capability itself `uses` another capability, the inner capability's schema contributions do not flow up to the block that `uses` the outer one. Each capability exposes only what it directly declares. If you need the inner schemas visible to consumers, re-declare them on the outer capability.

**Dynamic `uses` entries are runtime-only.** When `uses` contains a function — `(ctx) => [...]` — the returned capabilities contribute context and tools at runtime but nothing to types. Only static `CapabilityRef` entries are reflected.

**The `sessionStateType` escape hatch.** When a capability's `sessionStateSchema` produces a type that is too loose or causes TS2589 (type instantiation too deep), `defineCapability` accepts a `sessionStateType` field as a type-only override. The equivalent escape hatches exist for resources, target states, and sequencer state: `resourcesType`, `targetStatesType`, `sequencerStateType`. These are compile-time only — they carry no runtime value.

## When to reach for one

If a capability exists for what you need — memory, MCP, skills, storage — use it. The point of the abstraction is that you don't have to learn the internals to install one.

If you find yourself wiring the same combination of resources, state, and tools into three different blocks, that's a signal you might want to author one. See [Authoring capabilities](/docs/advanced/capabilities-authoring) for how `defineCapability` works under the hood.

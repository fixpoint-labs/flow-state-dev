---
sidebar_position: 1
sidebar_label: Overview
---

# Memory

`@flow-state-dev/memory` gives your agent something to hold onto between turns. One factory, four optional tiers, and a capability you wire into a generator with one line.

If you've ever watched an agent forget what the user told it two turns ago, you already know why this package exists. Most non-trivial agents need to remember something across turns. What the user just said. What they prefer in general. What happened last session. The memory system lets you compose those needs from four tiers, each independent, each opt-in. Pick what you need, leave the rest.

## Installation

Memory ships separately from `@flow-state-dev/core`, so you only pay for it when you want it. Install it alongside the framework:

```bash
pnpm add @flow-state-dev/memory
# or
npm install @flow-state-dev/memory
```

Then import the factory and capabilities directly from the package root:

```ts
import { system, workingMemoryCapability } from "@flow-state-dev/memory";
```

## What memory is

Memory here is a composed system, not a single store. Each tier has its own scope and lifecycle, and you can mix them.

| Tier | Scope | Best for |
|------|-------|----------|
| Working | session | Recent observations, decaying salience over the current conversation |
| Episodic | user | Past sessions stored as discrete episodes, recallable by content |
| Semantic | user | Consolidated facts the agent has decided are worth keeping |
| Digest | user | Summarized rollups across many sessions |

Working is always present. Episodic, semantic, and digest are opt-in via config. Working-only is a real configuration. A chat that just needs to remember the last few turns can wire in working alone and stop there.

Once you have semantic or episodic configured, the system also runs a periodic [hygiene pass](./hygiene): semantic confidence decays over time so stale facts rank below freshly-reinforced ones, and old persistent episodes are evicted. The pass is on by default and tunable — turn it off entirely with `hygiene: false` if you'd rather keep raw confidence and unbounded growth.

## Choosing an entry point

There are two ways into memory. They take the same tier configs; they differ in what they wire up.

- **`createMemoryCapability()`** builds the read side: the `<memory>` context block, the recall tool, and typed helpers. It does not build the capture pipeline, so nothing writes into memory on its own.
- **`system()`** builds that same capability and adds the write side: auto-capture, consolidation, prune, and the hygiene janitor.

The decision is about writes. If your flow never feeds turns back into memory — a rewrite step, a summariser, a personalisation read — reach for `createMemoryCapability`. If it captures what happened so memory grows over time, reach for `system()`.

## Quickest start

This flow only reads memory, so it uses `createMemoryCapability`:

```ts
import { defineFlow, generator } from "@flow-state-dev/core";
import { createMemoryCapability } from "@flow-state-dev/memory";

const mem = createMemoryCapability({
  model: "openai/gpt-5.4-mini",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});

const reply = generator({
  uses: [mem],
  // The capability injects a <memory> context block, installs the recall tool,
  // and exposes typed mem.* helpers on ctx.cap.
});

export const myFlow = defineFlow({
  kind: "my-flow",
  resources: { ...mem.sessionResources, ...mem.userResources },
  actions: { /* ... */ },
});
```

That's enough to give the agent a per-turn `<memory>` summary and a recall tool it can call when the auto-injected context isn't enough.

`system()` gives you the same generator surface — swap `createMemoryCapability(...)` for `system(...)` and `uses: [mem]` for `uses: [mem.capability]` — plus the capture pipeline that writes new observations back into the tiers. See [Configuration](./configuration#choosing-an-entry-point) for the side-by-side.

## How it integrates

`mem.capability` is the piece that actually wires the system into a block. A capability is FSD's way of bundling resources, context, and tools so a block can pick up everything it needs with a single `uses:` entry. Here, it contributes:

- A context formatter that produces the `<memory>` section the generator reads each turn.
- The `memory/recall` tool the model can invoke to search semantic facts and past episodes on demand.
- Typed `ctx.cap.*` helpers so handlers can read and write memory without manually reaching into resources.

If you only need a subset, [presets](./configuration#capability-presets) toggle each piece individually. If you only need working memory, you can skip `system()` entirely and use `workingMemoryCapability` directly. See [Configuration](./configuration#per-tier-capabilities).

For the broader picture of how `uses` wires resources, context, and tools into a block, see [Capabilities](../fundamentals/capabilities).

## Where it lives

Memory ships from its own package, `@flow-state-dev/memory`, so apps that don't need it don't carry it. Install it alongside `@flow-state-dev/core` when an agent needs cross-turn persistence. It previously lived at `@thought-fabric/core/memory`. That path no longer resolves, so update old imports to `@flow-state-dev/memory`.

## Further reading

- [Configuration](./configuration) — every knob `system()` exposes and when to reach for them.
- [Recall tool](./recall-tool) — the agent-invocable search surface, plus custom strategies.
- [Resources](../resources/overview) — how memory persistence is scoped.

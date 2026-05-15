---
sidebar_position: 1
---

# Memory

`@flow-state-dev/patterns/memory` — cross-turn memory for agents. One factory, four optional tiers, capabilities you wire into generators with one line.

Most non-trivial agents need to remember something across turns: what the user just said, what they prefer in general, what happened last session. The memory system lets you compose those needs from four tiers, each independent, each opt-in.

## What memory is

Memory in FSD is a composed system, not a single store. Each tier has its own scope and lifecycle.

| Tier | Scope | Best for |
|------|-------|----------|
| Working | session | Recent observations, decaying salience over the current conversation |
| Episodic | user | Past sessions stored as discrete episodes, recallable by content |
| Semantic | user | Consolidated facts the agent has decided are worth keeping |
| Digest | user | Summarized rollups across many sessions |

Working is always present. Episodic, semantic, and digest are opt-in via config. Working-only is a real configuration — a chat that just needs to remember the last few turns can wire in working alone.

## Quickest start

```ts
import { defineFlow, generator } from "@flow-state-dev/core";
import { system } from "@flow-state-dev/patterns/memory";

const mem = system({
  model: "openai/gpt-4o-mini",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});

const reply = generator({
  uses: [mem.capability],
  // The capability injects a <memory> context block, installs the recall tool,
  // and exposes typed mem.* helpers on ctx.cap.
});

export const myFlow = defineFlow({
  kind: "my-flow",
  sessionResources: mem.sessionResources,
  userResources: mem.userResources,
  actions: { /* ... */ },
});
```

That's enough to give the agent a per-turn `<memory>` summary and a recall tool it can call when the auto-injected context isn't enough.

## How it integrates

`mem.capability` is what wires the system into a block. It contributes:

- A context formatter that produces the `<memory>` section consumed by the generator each turn.
- The `tf.memory/recall` tool the model can invoke to search semantic facts and past episodes on demand.
- Typed `ctx.cap.*` helpers so handlers can read and write memory without manually reaching into resources.

If you only need a subset, [presets](./configuration#capability-presets) toggle each piece individually. If you only need working memory, you can skip `system()` entirely and use `workingMemoryCapability` directly — see [Configuration](./configuration#per-tier-capabilities).

See [Capabilities](../fundamentals/capabilities) for how `uses` wires resources, context, and tools into a block.

## Where it lives

Memory is shipped from `@flow-state-dev/patterns/memory`. It previously lived at `@thought-fabric/core/memory`; that path still works for one minor version via a `@deprecated` re-export. Update imports to the patterns path. See the migration note in the `@thought-fabric/core` README for callers on the old path.

## Further reading

- [Configuration](./configuration) — every knob `system()` exposes and when to reach for them.
- [Recall tool](./recall-tool) — the agent-invocable search surface, custom strategies.
- [Resources](../resources/overview) — how memory persistence is scoped.

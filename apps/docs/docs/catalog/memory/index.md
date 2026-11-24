---
title: Memory
type: catalog
description: "Give an agent something to hold onto between turns: four tiers, three of them optional, behind one capability."
---

# Memory

`@flow-state-dev/memory` gives your agent something to hold onto between turns. Four tiers, three of them optional, and a capability (a bundle of context, tools and storage) you add to a generator (the block that calls the model) with one line.

If you've ever watched an agent forget what the user told it two turns ago, you already know why this package exists. What the user said a moment ago. What they prefer in general. What happened last session. The memory system lets you compose those needs from tiers. Pick what you need, leave the rest.

## Installation

Memory ships separately from `@flow-state-dev/core`, so you only pay for it when you want it. Install it alongside the framework:

```bash
pnpm add @flow-state-dev/memory
# or
npm install @flow-state-dev/memory
```

Everything imports from the package root, `@flow-state-dev/memory`: `createMemoryCapability`, `system`, and `workingMemoryCapability`.

## What memory is

Memory is built from tiers. Each has its own scope and lifecycle, and you can mix them.

| Tier | Scope | Best for |
|------|-------|----------|
| Working | session | Recent observations, decaying salience over the current conversation |
| Episodic | user by default, or org | Past sessions stored as discrete episodes, recallable by content |
| Semantic | follows episodic | Consolidated facts the agent has decided are worth keeping |
| Digest | follows semantic | Summarized rollups across many sessions |

Working is always present. Episodic, semantic, and digest are opt-in via config. Semantic needs episodic, and digest needs semantic: `digest: true` without `semantic: true` throws when the capability is built. A chat that only needs the last few turns can use working memory alone.

Memory also tidies itself. With semantic or episodic configured, a periodic [hygiene pass](./hygiene.md) ranks stale facts below reinforced ones and evicts old episodes. It is on by default; `hygiene: false` turns it off.

Each memory records who it is about, so facts about the user and facts about other people they mention stay separate in every tier. The [memory reference](../../reference/memory.md) has the subject rules.

## Choosing an entry point

Both entry points take the same tier configs and differ in what they wire up:

- **`createMemoryCapability()`** builds the read side: the `<memory>` context block, the recall tool, and typed helpers. It does not build the capture pipeline, so nothing writes into memory on its own.
- **`system()`** builds that same capability and adds the write side: auto-capture of observations from each turn, consolidation (turning episodes into lasting facts), prune (trimming old facts), and the hygiene pass.

The decision is about writes. If your flow never feeds turns back into memory, for example a rewrite step, a summarizer, or a step that tailors a reply to stored preferences, reach for `createMemoryCapability`. If it captures what happened so memory grows over time, reach for `system()`.

## Quickest start

This flow reads memory that another flow has filled, so it uses `createMemoryCapability`. The memory goes in a helper file, the generator that uses it in a block file, and the flow exposes the block as an action:

```ts title="src/lib/memory.ts"
import { createMemoryCapability } from "@flow-state-dev/memory";

export const mem = createMemoryCapability({
  model: "openai/gpt-6-luna",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});
```

```ts title="src/flows/support/blocks/reply.ts"
import { generator } from "@flow-state-dev/core";
import { mem } from "../../../lib/memory";
import { z } from "zod";

export const reply = generator({
  name: "reply",
  model: "openai/gpt-6-luna",
  prompt: "You answer support questions. Use what you remember about the user.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
  // The capability injects a <memory> context block, installs the recall tool,
  // and exposes typed helpers on ctx.cap.
  uses: [mem],
  // Show the reply in the chat and keep it in history.
  itemVisibility: { client: true, history: true },
});
```

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { reply } from "./blocks/reply";

export const supportFlow = defineFlow({
  kind: "support",
  actions: { reply },
});
```

This flow only reads. It gets a per-turn `<memory>` block and a recall tool the agent can call when the injected context isn't enough, and nothing in the flow writes to either. Episodic and semantic memory are stored per user by default and shared across the flows that user touches, so they fill when a flow that runs `system()` captures turns for the same user. Until then the recall tool finds nothing. Working memory is per session, so another flow does not fill it.

The memory resources come with `uses: [mem]`, so the flow does not list them.

## Whose memory it is

By default memory belongs to the user. Episodic, semantic and digest are stored at each user's id, so one customer's conversation never sees another customer's facts. A user's memory is shared by every flow they use, unless the flow sets `isolateUserState: true` or the tier sets `flowIsolation`. With `scope: "org"` the stored tiers belong to the organization instead. Working memory belongs to the session.

No memory resource is visible to a client, so a browser cannot read it directly. The agent reaches memory through the `<memory>` block and the recall tool.

Memory lives in the server's configured store. The default store is in-memory, so a restart loses everything the agent remembered. Use a persistent store, such as SQLite, Postgres or the filesystem store, to keep it.

`system()` gives you the same generator surface plus the capture pipeline that writes new observations back into the tiers. Swap `createMemoryCapability(...)` for `system(...)`, and `uses: [mem]` for `uses: [mem.capability]`. Then run the capture after each reply: make `reply` a sequencer that ends in `.sideChain(mem.captureFromItems)`. Attaching the capability writes nothing on its own. The [memory reference](../../reference/memory.md) has the side-by-side.

## How it integrates

A capability is the framework's way of bundling resources, context, and tools so a block can pick up everything it needs with a single `uses:` entry. Memory's capability (`mem` from `createMemoryCapability`, or `mem.capability` from `system()`) contributes:

- A context formatter that produces the `<memory>` section the generator reads each turn. By default it carries the digest and the working-memory entries, and leaves facts and episodes out.
- The `memory/recall` tool the model can invoke to search semantic facts and past episodes on demand. It does not search working memory.
- Typed `ctx.cap.*` helpers so handlers can read and write memory without manually reaching into resources.

To use only part of it, or to use working memory alone, see the [memory reference](../../reference/memory.md) for presets and per-tier capabilities.

For the broader picture of how `uses` wires resources, context, and tools into a block, see [Capabilities](../../concepts/capabilities.md).

## Further reading

- [Memory reference](../../reference/memory.md): every option `createMemoryCapability` and `system()` take, presets, and defaults.
- [Hygiene](./hygiene.md): how stale facts and old episodes age out.
- [Relations](./relations.md): the opt-in layer that stores typed connections between entities, for connection and multi-hop recall.
- [Recall tool](./recall-tool.md): the agent-invocable search surface, plus custom strategies.
- [Resources](../../concepts/resources.md): how memory persistence is scoped.
- [The built-in worker](../workforce/index.md): the recipe for attaching memory to a roster of workers, including giving each worker its own.

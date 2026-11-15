---
title: The recall tool
type: catalog
description: What the model calls when the always-on memory view is not enough.
---

# The recall tool

`memory/recall` is the agent-invocable side of the memory system. The auto-injected `<memory>` context handles the always-on view. The recall tool is what the model reaches for when that view isn't enough and it wants to search for a past episode or semantic fact tied to what the user asked.

The tool installs with `mem.capability` by default. The [memory reference](../../reference/memory) covers turning it off, the `recall` preset on `createMemoryCapability` for a flow without `system()`, and its options. A generator that lists its own `tools` does not receive the capability's tools, so add `mem.tool.recall()` to that list; the [capabilities reference](../../reference/capabilities) has the rule.

## What the model sees

The model sees a tool with a `query` argument, an optional `limit` and an optional `sinceTurn`. A call runs the configured retrieval strategy (default `llm-filter`) over semantic facts and recent episodes and returns a ranked list, capped at `limit`. It reads semantic facts and episodes, never working memory, so a flow that configures only the working tier gets an empty result from every call. In that setup, leave the recall preset off.

```ts title="src/lib/memory.ts"
import { system } from "@flow-state-dev/memory";

export const mem = system({
  model: "openai/gpt-6-luna",
  working: true,
  episodic: true,
  semantic: true,
  tool: {
    defaults: { limit: 8, perItemCharCap: 600 },
  },
});
```

`tool.defaults` sets how many results come back when the model passes no `limit`, and how much of each item's content the model reads. Longer content is cut and marked as truncated, so the model knows it didn't see the whole record. The memory reference has the defaults and the full shape of what comes back.

## Ranking and decay

The default `llm-filter` strategy shows the model every semantic fact with its raw `confidence`, so a fact's age does not change what the tool returns. To weight by age in a custom strategy, call `effectiveConfidence(fact)`, exported from `@flow-state-dev/memory`. The programmatic `mem.recall()` helper, which handlers call directly, is a separate surface from the tool and ranks differently. See [Hygiene](./hygiene) for decay.

To use a different strategy, set `tool: { strategy }` on `system()` or `createMemoryCapability`. The strategy contract is in the memory reference.

## When to use it vs. context auto-injection

The two surfaces complement each other, and most flows want both.

- **Context auto-injection** costs no extra model call per turn but is always on. Right for the digest and working-memory excerpts the agent should always see.
- **The recall tool** costs a tool call and a follow-up turn, but the agent decides when to use it. Right when the relevant context depends on what the user asked: the agent picks when to look, what to search for, and how many results to ask for.

When [relations](./relations) are enabled, a companion `memory/connect` tool answers connection questions ("what links X to Y", "what's connected to X") by traversing the edge graph, and recall can return relation edges as results.

See the [memory reference](../../reference/memory) for toggling each surface, and [Tools](../tools/overview) for how tool blocks work in general.

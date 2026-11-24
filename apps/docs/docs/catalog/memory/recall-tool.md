---
title: The recall tool
type: catalog
description: What the model calls when the always-on memory view is not enough.
---

# The recall tool

`memory/recall` is a tool the model can call to search memory. Every turn, the model already gets a `<memory>` block in its context; it calls recall when that block isn't enough and it wants a past episode or semantic fact tied to what the user asked.

`mem` below is the memory system you create with `system()`. The tool installs with `mem.capability` by default, and the [memory reference](../../reference/memory.md) covers turning it off. A flow built with `createMemoryCapability` instead of `system()` turns the tool on through that function's `recall` preset, also covered there. A generator that lists its own `tools` does not receive the capability's tools, so add `mem.tool.recall()` to that list; the [capabilities reference](../../reference/capabilities.md) has the rule.

## When the model searches

A support agent has `uses: [mem.capability]`. A user asks about a detail from a session three weeks ago, and it isn't in the summary at the top of the prompt.

```ts title="src/flows/support/blocks/support-agent.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { mem } from "../../../lib/memory";

export const supportAgent = generator({
  name: "support-agent",
  model: "openai/gpt-6-luna",
  prompt: "You help customers with their orders. Be brief and specific.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
  uses: [mem.capability],
  // Show the reply in the chat and keep it in history.
  itemVisibility: { client: true, history: true },
});
```

The `<memory>` section gains a line saying more memories exist than are shown and to check memory before saying it doesn't know. The tool's own description says to call it for a specific detail that isn't in the summary, and not to re-fetch facts already shown. forces a call: the model decides.

The tool searches semantic facts (consolidated statements the agent kept), past episodes (records of something that happened in an earlier session) and, with [relations](./relations.md) on, graph edges. It does not search working memory or the digest, which are already in the prompt.

## What comes back

The model sends a `query`, an optional `limit` and an optional `sinceTurn`, which drops episodes from before that turn. The default `limit` is 5 and tops out at 20. A call that asks for more fails the input check.

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

`tool.defaults` sets how many results come back when the model passes no `limit`, and how much of each item's content the model reads. A `defaults.limit` above 20 is treated as 20. Longer content is cut and marked as truncated, so the model knows it didn't see the whole record.

The model reads one line per result, `- <content>`, not the structured result. When more matched than were returned, a final line says how many. The structured result, with each item's `id`, `source`, `score` and `metadata`, goes to the devtool and the history; the [memory reference](../../reference/memory.md) has its full shape.

## How results are chosen

The default strategy, `llm-filter`, runs in three steps.

1. **Prepare**, with no model call. Every semantic fact is a candidate. Episodes are ranked by significance and recency, and the top 30 are kept. An older episode that contains a distinctive phrase from the query is added back.
2. **Filter**, one model call. It uses `tool.model`, or the memory system's `model`, and returns the IDs of the relevant candidates, most relevant first. It may return fewer than `limit`, and it never pads.
3. **Format**. The tool returns those items in the filter's order. An ID the filter invents is dropped.

A fact's age does not by itself keep it out. The filter model decides, and it sees each fact's stored confidence. Each result's `score` is its rank rescaled so the top item is 1. It is not a probability.

To use a different strategy, set `tool: { strategy }` on `system()` or `createMemoryCapability`. The strategy contract is in the memory reference.

## When it comes back empty or fails

A new user has no stored episodes or facts. The tool returns no results and makes no model call, and the model reads `No memories matched "<query>".`

If the filter's model call fails, say on a rate limit, the tool does not throw into the generator. It returns an ordinary result with an `error` field, and the model reads `Recall failed: <error>`.

With only working memory configured, the tool is installed and describes itself as a memory search, but every call comes back empty. Leave it off with `mem.capability.with({ recall: false })`.

## Recall or automatic context

The two surfaces complement each other, and most flows want both.

- **Context auto-injection** costs no extra model call per turn but is always on. Right for the digest and working-memory excerpts the agent should always see.
- **The recall tool** costs a tool call, one filter model call and a follow-up turn, but the agent decides when to use it. Right when the relevant context depends on what the user asked.

When relations are enabled, a companion `memory/connect` tool answers connection questions ("what links X to Y") by traversing the edge graph, and recall can return relation edges as results.

See the [memory reference](../../reference/memory.md) for toggling each surface, [Hygiene](./hygiene.md) for how stored facts age, and [Tools](../tools/index.md) for how tool blocks work in general.

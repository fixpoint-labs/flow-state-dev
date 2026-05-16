---
sidebar_position: 3
---

# Recall tool

`memory/recall` is the agent-invocable side of the memory system. The auto-injected `<memory>` context handles the always-on view. The recall tool is what the model reaches for when that view isn't enough, and it wants to go searching for a past episode or semantic fact tied to what the user just asked.

The tool installs as part of `mem.capability` by default. If you want context-only memory, turn it off with `mem.capability.presets({ recall: false })`.

## Default behavior

The agent sees a tool with a `query` argument and an optional `limit`. Under the hood, the system runs the configured retrieval strategy (default: `llm-filter`) over candidate semantic facts and recent episodes, ranks them, and returns a capped list of items the model can read.

```ts
import { system } from "@flow-state-dev/memory";

const mem = system({
  model: "openai/gpt-5.4-mini",
  episodic: true,
  semantic: true,
  tool: {
    defaults: { limit: 5 },
  },
});
```

Each item gets a content cap of 400 chars by default (`DEFAULT_PER_ITEM_CHAR_CAP`). Anything longer gets truncated with a marker (`TRUNCATION_MARKER`) so the model knows it didn't see the full record. Override with `tool: { defaults: { perItemCharCap } }`.

> **Working-only caveat:** If you configure `system({ working: { ... } })` alone, the recall tool's description still says it searches "semantic facts + past episodes". The description string doesn't currently adapt to the configured tiers. Pre-existing, tracked separately. If you're working-only, leave the recall preset off.

## Strategies

A retrieval strategy is a block factory that produces a handler-shaped block. (A handler is FSD's term for a plain function block: typed input, typed output, no LLM call.) The default `llm-filter` strategy uses an LLM to score candidates by relevance. To plug in something else, pass a different `strategy` to `system()`, or construct the recall tool directly.

```ts
import { handler } from "@flow-state-dev/core";
import type { RetrievalStrategy } from "@flow-state-dev/memory";

const myStrategy: RetrievalStrategy = handler({
  name: "my-strategy",
  // input: { query: string; limit: number; candidates: MemoryItem[] }
  // output: { results: RecallResultItem[] }
  execute: async ({ input }) => {
    const ranked = input.candidates
      .map((c) => ({ ...c, relevance: scoreSomehow(c, input.query) }))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, input.limit);
    return { results: ranked };
  },
});
```

Vector retrieval over an embedding store fits the same shape. Point `strategy` at a block that runs an embedding query and returns the ranked candidates.

## When to use it vs. context auto-injection

The two surfaces complement each other, and most flows want both.

- **Context auto-injection** is free per turn (no extra LLM call) but always-on. Right for the digest and working-memory excerpts the agent should always see.
- **The recall tool** costs a tool call and a follow-up turn, but the agent decides when to use it. Right when the relevant context depends on what the user just asked: the agent picks when to look, what to search for, and how many results to ask for.

The defaults give you both.

See [Configuration](./configuration#capability-presets) for toggling each surface, and [Tools](../tools/overview) for how tool blocks work in general.

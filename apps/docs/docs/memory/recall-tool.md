---
sidebar_position: 3
---

# Recall tool

`memory/recall` is the agent-invocable side of the memory system. The model calls it when the auto-injected `<memory>` context isn't enough — when it needs to search for a past episode or semantic fact relevant to the current turn.

The tool installs as part of `mem.capability` by default. Turn it off with `mem.capability.presets({ recall: false })` if you want context-only memory.

## Default behavior

The agent sees a tool with a `query` argument and an optional `limit`. The system runs the configured retrieval strategy (default: `llm-filter`) over candidate semantic facts and recent episodes, ranks them, and returns a capped list of items the model can read.

```ts
import { system } from "@flow-state-dev/memory";

const mem = system({
  model: "openai/gpt-4o-mini",
  episodic: true,
  semantic: true,
  tool: {
    defaults: { limit: 5 },
  },
});
```

The default per-item content cap is 400 chars (`DEFAULT_PER_ITEM_CHAR_CAP`); items longer than that are truncated with a marker (`TRUNCATION_MARKER`) so the model knows it didn't see the full record. Override with `tool: { defaults: { perItemCharCap } }`.

> **Working-only caveat:** If you configure `system({ working: { ... } })` alone, the recall tool's description still says it searches "semantic facts + past episodes" — the description string doesn't currently adapt to the configured tiers. Pre-existing; tracked separately. If you're working-only, leave the recall preset off.

## Strategies

A retrieval strategy is a block factory that produces a handler-shaped block. The default `llm-filter` strategy uses an LLM to score candidates by relevance. Custom strategies plug in by passing a different `strategy` to `system()` or by constructing the recall tool directly.

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

Vector retrieval over an embedding store fits the same shape — point `strategy` at a block that runs an embedding query and returns the ranked candidates.

## When to use it vs. context auto-injection

The two surfaces complement each other:

- **Context auto-injection** is free per turn (no extra LLM call) but always-on. It's right for the digest and working-memory excerpts the agent should always see.
- **The recall tool** costs a tool call and a follow-up turn but is agent-controlled. It's right when the relevant context depends on what the user just asked — the agent decides when to look, what to search for, and how many results to ask for.

Most flows want both. The defaults give you both.

See [Configuration](./configuration#capability-presets) for toggling each surface, and [Tools](../tools/overview) for how tool blocks work in general.

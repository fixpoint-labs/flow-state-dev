# @flow-state-dev/memory

Cross-turn memory for agents built on `@flow-state-dev/core`. One factory, four optional tiers (working, episodic, semantic, digest), and a capability you wire into a generator with one line.

This package is its own install. **It is not part of core.** Add it alongside `@flow-state-dev/core` when your agent needs to remember anything across turns.

## Install

```bash
pnpm add @flow-state-dev/memory
# or
npm install @flow-state-dev/memory
```

Peer of `@flow-state-dev/core`.

## Quick start

```ts
import { defineFlow, generator } from "@flow-state-dev/core";
import { system } from "@flow-state-dev/memory";

const mem = system({
  model: "openai/gpt-5.4-mini",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
  digest: true,
});

const chat = generator({
  uses: [mem.capability],
  // ...
});

export const myFlow = defineFlow({
  kind: "my-flow",
  sessionResources: mem.sessionResources,
  userResources: mem.userResources,
  actions: { /* ... */ },
});
```

`mem.capability` contributes a `<memory>` context block, the agent-invocable `memory/recall` tool, and typed `ctx.cap.*` helpers. Wire it once and the generator has memory.

## What's in the package

| Tier | Scope | Best for |
|------|-------|----------|
| Working | session | Recent observations, decaying salience over the current conversation |
| Episodic | user | Past sessions stored as discrete episodes, recallable by content |
| Semantic | user | Consolidated facts the agent has decided are worth keeping |
| Digest | user | Summarized rollups across many sessions |
| Hygiene | session | Time-based confidence decay and episodic TTL maintenance |

The system implements the read-side `MemoryProvider` contract: `recall(ctx, cue?)` for cross-store ranked retrieval, `formatContext(input, ctx)` for the per-turn context block. Future memory implementations plug in behind the same shape.

**Key exports:** `system`, `MEMORY_CAPABILITY_PRESETS`, `MemoryProvider`, `MemorySystem`, `MemoryItem`, `RankedMemoryItem`, `workingMemoryCapability`, `episodicMemoryCapability`, `semanticMemoryCapability`, `digestMemoryCapability`, `workingMemoryCapture`, `createEpisodicMemoryResource`, `createSemanticMemoryResource`, `createDigestMemoryResource`, `createRecallTool`, `createMemoryContextFormatter`, `memorySystemJanitor`, `effectiveConfidence`, `janitorResource`, plus per-tier helpers (`addWorkingMemory`, `addSemanticFact`, `recentEpisodes`, `encodeEpisode`, …).

## Where it came from

Memory previously lived at `@thought-fabric/core/memory`. It now ships from this dedicated package so apps can install memory without pulling in a Thought Fabric dependency. Thought Fabric will host specialized cognitive memory variants on top of the `MemoryProvider` contract when those land.

## Running tests

```bash
pnpm --filter @flow-state-dev/memory test
```

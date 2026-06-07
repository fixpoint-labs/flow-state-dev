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

There are two entry points. They take the same tier configs and differ only in what they wire up. Pick by what your flow does with memory.

### `createMemoryCapability` — read-side memory

Use this when a flow only consumes memory: context injection, the recall tool, typed helpers. No auto-capture pipeline is built.

```ts
import { defineFlow, generator } from "@flow-state-dev/core";
import { createMemoryCapability } from "@flow-state-dev/memory";

const mem = createMemoryCapability({
  model: "openai/gpt-5.4-mini",
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
});

const reader = generator({
  uses: [mem],
  // ...
});

export const readerFlow = defineFlow({
  kind: "reader-flow",
  resources: { ...mem.sessionResources, ...mem.userResources },
  actions: { /* ... */ },
});
```

`mem` is the capability itself — `uses: [mem]` contributes a `<memory>` context block, the agent-invocable `memory/recall` tool, and typed `ctx.cap.*` helpers.

### `system()` — the same capability plus the write side

Use this when the flow also writes into memory: auto-observation, consolidation, prune, and the hygiene janitor. `system()` builds the same capability internally (`mem.capability`) and adds the capture pipeline.

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

export const chatFlow = defineFlow({
  kind: "chat-flow",
  resources: { ...mem.sessionResources, ...mem.userResources },
  actions: {
    // ...capture after each turn, e.g. a sequencer ending in `.work(mem.captureFromItems)`
  },
});
```

Rule of thumb: if your flow never calls into the capture pipeline, reach for `createMemoryCapability`. If it captures, reach for `system()`.

## What's in the package

| Tier | Scope | Best for |
|------|-------|----------|
| Working | session | Recent observations, decaying salience over the current conversation |
| Episodic | user | Past sessions stored as discrete episodes, recallable by content |
| Semantic | user | Consolidated facts the agent has decided are worth keeping |
| Digest | user | Summarized rollups across many sessions |
| Hygiene | session | Time-based confidence decay and episodic TTL maintenance |

Two entry points: `createMemoryCapability()` builds the read-side capability; `system()` builds the same capability plus the auto-capture and lifecycle pipeline.

## Subject attribution

Every memory carries a `subject` — `'user'` for the primary user, a lowercase first name for other people (`'moni'`), a lowercase-hyphenated name for orgs. The subject is computed once by the observer and carried through the whole pipeline: working entry → episode → semantic fact → digest. Consolidation and prune read the stored subject instead of re-guessing ownership, and refuse to rewrite or merge a fact across subjects. The digest narrates the primary user; other people are described in relation to the user (e.g. "his wife Moni"), never collapsed into the user persona.

## Relations (knowledge graph)

The semantic tier can store typed directed relationships between subjects, not just standalone facts. Turn it on with `semantic: { relations: true }`:

```ts
const mem = system({
  model: 'openai/gpt-5.4-mini',
  working: true,
  episodic: true,
  semantic: { relations: true },
})
```

Relations are opt-in and default off. When disabled, the semantic store is unchanged — no edge field, no extra prompting, no behaviour difference. When enabled, consolidation extracts edges alongside facts in the same LLM call (e.g. `user --married to--> moni`) and stores them on the semantic resource's edge graph.

Endpoints reuse the subject namespace, so an edge connects the same canonicalized subject strings facts use. An edge whose endpoint is not a known fact subject is dropped by default; set `createImplicitEntities: true` to mint the node instead. Relation types are free text unless you pass a `vocabulary`, in which case out-of-vocabulary types are dropped. The hygiene janitor removes dangling edges whose endpoints were culled.

```ts
semantic: {
  relations: {
    vocabulary: ['married to', 'works at', 'owns'], // optional; free-text if omitted
    maxEdges: 500,                                  // optional size cap
    createImplicitEntities: false,                  // default: drop unknown endpoints
  },
}
```

### Reading relations

When relations is enabled, three read paths open up (all no-ops or absent when it's off):

- **`memory/connect` tool.** Installed on the generator automatically (default-on via the `connect` preset; also available as `mem.tool.connect()`). The agent calls it with `from` alone to list everything connected to an entity, or `from` and `to` to find the path between two entities. Results come back in the same envelope shape as `memory/recall`. Unreachable targets return empty results; relations being off returns a recoverable error envelope rather than throwing.
- **Graph-expanded recall.** A normal `memory/recall` query also surfaces edges connected to entities named in the query, so a relation relevant only because it links to a mentioned person/place is pulled into the candidate set instead of being missed by keyword matching alone.
- **Typed helpers** on `ctx.cap.memory`: `connections(entity)` (neighbour edges), `relate(from, to)` (shortest-path edges or `null`), and `egoGraph(entity)` (`{ nodes, edges }`). Each returns empty/`null` when relations is disabled.

The system implements the read-side `MemoryProvider` contract: `recall(ctx, cue?)` for cross-store ranked retrieval, `formatContext(input, ctx)` for the per-turn context block. Future memory implementations plug in behind the same shape.

**Key exports:** `system`, `createMemoryCapability`, `CreateMemoryCapabilityOptions`, `MemoryCapability`, `MEMORY_CAPABILITY_PRESETS`, `MemoryProvider`, `MemorySystem`, `MemoryItem`, `RankedMemoryItem`, `workingMemoryCapability`, `episodicMemoryCapability`, `semanticMemoryCapability`, `digestMemoryCapability`, `workingMemoryCapture`, `createEpisodicMemoryResource`, `createSemanticMemoryResource`, `createDigestMemoryResource`, `createRecallTool`, `createConnectTool`, `edgeToMemoryItem`, `graphExpandCandidates`, `createMemoryContextFormatter`, `memorySystemJanitor`, `effectiveConfidence`, `janitorResource`, plus per-tier helpers (`addWorkingMemory`, `addSemanticFact`, `recentEpisodes`, `encodeEpisode`, …).

## Where it came from

Memory previously lived at `@thought-fabric/core/memory`. It now ships from this dedicated package so apps can install memory without pulling in a Thought Fabric dependency. Thought Fabric will host specialized cognitive memory variants on top of the `MemoryProvider` contract when those land.

## Running tests

```bash
pnpm --filter @flow-state-dev/memory test
```

---
sidebar_position: 6
---

# API Reference

Cognitive architecture primitives built on flow-state-dev. Provides attention, memory, and identity domains for agentic workflows.

**Import:** Use subpath exports. `@thought-fabric/core/attention`, `@thought-fabric/core/memory`, `@thought-fabric/core/identity`.

---

## attention

Relevance and salience for what the agent attends to.

### filterRelevance(config)

Handler block factory. Deterministic keyword-based relevance filtering. No LLM. Fast. Removes or annotates items below a threshold using keyword overlap heuristics.

```ts
import { filterRelevance } from "@thought-fabric/core/attention";

const block = filterRelevance({ name: "filter", criteria: { ... } });
```

Returns a `BlockDefinition` (handler). Use as a step in a sequencer or as a tool.

### scoreSalience(config)

Generator block factory. LLM-based salience scoring along configurable dimensions (goal relevance, recency, novelty, emotional weight).

```ts
import { scoreSalience } from "@thought-fabric/core/attention";

const block = scoreSalience({
  name: "salience",
  dimensions: { ... },
  weights: { ... },
  model: "gpt-5-mini",
});
```

Returns a `BlockDefinition` (generator). Output schema: `scores`, `composite`, `ranking`, `itemScores`.

---

## memory

Three-tier memory: working (session), episodic (cross-session), and semantic (stable knowledge).

### Unified System

| Function | Purpose |
|----------|---------|
| `system(config)` | Factory that wires all three tiers. Returns `capture`, `recall`, `contextFormatter`, and per-tier helpers. |

### Unified System Blocks

| Function | Kind | Purpose |
|----------|------|---------|
| `memorySystemCapture(config)` | sequencer | Full pipeline: observe → reflect → tick (+ consolidation) |
| `memorySystemObserve(config)` | generator | LLM extraction with durability/category classification |
| `memorySystemReflect(config)` | handler | Routes observations to working, episodic, and semantic stores |
| `memorySystemTick(config)` | handler | Advances decay clock |
| `memorySystemConsolidate(config)` | sequencer | Guard → generate → persist consolidation pipeline |

### Working Memory Blocks

| Function | Kind | Purpose |
|----------|------|---------|
| `workingMemoryCapture(config?)` | sequencer | Standalone: observe → remember → tick |
| `workingMemoryObserve(config?)` | generator | LLM extraction. Output: observations array. |
| `workingMemoryRemember(config?)` | handler | Persist observations into the resource. |
| `workingMemoryTick(config?)` | handler | Advance decay clock, recompute salience. |
| `workingMemorySnapshot()` | handler | Read current entries and turn counter. |
| `workingMemoryAdd(config?)` | handler | Manual entry. No LLM extraction. |

### Resources

| Export | Scope | Purpose |
|--------|-------|---------|
| `workingMemoryResource` | session | Working memory resource definition |
| `workingMemoryResources` | session | Pre-keyed `{ workingMemory: workingMemoryResource }` |
| `memorySystemResource` | session | Tracking state (watermark, consolidation counters) |
| `createEpisodicMemoryResource(scope)` | user/project | Episodic memory resource factory |
| `createSemanticMemoryResource(scope)` | user/project | Semantic memory resource factory |

### Context

- `workingMemoryContextFormatter` — Context slot for generators (working memory only).
- `system().contextFormatter` — Cross-store context formatter (all tiers).

### Working Memory Helpers

| Function | Purpose |
|----------|---------|
| `addWorkingMemory` | Add entry with auto-eviction at capacity |
| `evictWorkingMemory` | Remove entry by ID |
| `pinWorkingMemory` / `unpinWorkingMemory` | Toggle pinned status |
| `refreshWorkingMemory` | Update lastAccessedAtTurn |
| `advanceWorkingMemory` | Tick decay, recompute salience for all entries |
| `workingMemoryItems` | Read entries sorted by salience |
| `formatWorkingMemoryEntries` | Format entries for LLM context |

### Episodic Memory Helpers

| Function | Purpose |
|----------|---------|
| `encodeEpisode` | Write a new episode |
| `recentEpisodes` | Get recent episodes |
| `markEpisodesConsolidated` | Mark episodes as processed by consolidation |

### Semantic Memory Helpers

| Function | Purpose |
|----------|---------|
| `addSemanticFact` | Add a new fact |
| `updateSemanticFact` | Update existing fact content |
| `reinforceSemanticFact` | Increase confidence via reinforcement |
| `removeSemanticFact` | Remove a fact (invalidation) |
| `semanticFacts` | All facts |
| `querySemanticFacts` | Filter facts by predicate |

### Config Defaults

| Constant | Contents |
|----------|----------|
| `DEFAULT_WORKING_MEMORY_CONFIG` | `capacity`, `maxPinnedSlots`, `decay` |
| `DEFAULT_EPISODIC_CONFIG` | `scope`, `significanceThreshold`, `maxEpisodes` |
| `DEFAULT_CONSOLIDATION_CONFIG` | `episodicThreshold`, `onEviction`, `minInterval` |

### Pure Math (no side effects)

- `computeDecay(elapsed, strategy, rate)` — Decay factor. Strategies: `power-law`, `exponential`, `none`.
- `computeSalience(entry, currentTurn, decay)` — `importance × decay(elapsed)`.

---

## identity (placeholders)

Wave 2 placeholders. Not yet implemented.

- `perspective(config)` — Perspective block.
- `constitution(config)` — Constitution block.

---

## Usage

```ts
import { system as memorySystem } from "@thought-fabric/core/memory";
import { filterRelevance, scoreSalience } from "@thought-fabric/core/attention";

const mem = memorySystem({ model: "gpt-5-mini", working: true, episodic: true, semantic: true });

const pipeline = sequencer({ name: "pipeline", inputSchema: chatInput })
  .work((input) => input.message, mem.capture)
  .then(chat);

const filter = filterRelevance({ name: "filter" });
const salience = scoreSalience({ name: "rank" });
```

See [Memory](/thought-fabric/memory) for a full guide.

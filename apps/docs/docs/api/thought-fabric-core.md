# @thought-fabric/core

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

Working memory: observe, remember, tick, snapshot.

### Blocks

| Function | Kind | Purpose |
|----------|------|---------|
| `workingMemoryCapture(config?)` | sequencer | Bundled: observe → remember → tick. Primary entry point. |
| `workingMemoryObserve(config?)` | generator | LLM extraction. Output: observations array. |
| `workingMemoryRemember(config?)` | handler | Persist observations into the resource. |
| `workingMemoryTick(config?)` | handler | Advance decay clock, recompute salience. |
| `workingMemorySnapshot()` | handler | Read current entries and turn counter. |
| `workingMemoryAdd(config?)` | handler | Manual entry. No LLM extraction. |

### Resource

- `workingMemoryResource` — `defineResource()` for working memory. Use in flow `sessionResources`.
- `workingMemoryResources` — Pre-keyed `{ workingMemory: workingMemoryResource }`.

### Context

- `workingMemoryContextFormatter` — Context slot for generators. Assign to `context: [workingMemoryContextFormatter]`.

### Helpers (verb-first naming)

| Function | Purpose |
|----------|---------|
| `add` | Add entry with auto-eviction at capacity |
| `evict` | Remove entry by ID |
| `pin` / `unpin` | Toggle pinned status |
| `refresh` | Update lastAccessedAtTurn |
| `advance` | Tick decay, recompute salience for all entries |
| `items` | Read entries sorted by salience |
| `formatForContext` | Format entries for LLM context |

### Pure math (no side effects)

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
import { workingMemoryCapture } from "@thought-fabric/core/memory";
import { filterRelevance, scoreSalience } from "@thought-fabric/core/attention";

const pipeline = sequencer({ name: "pipeline" })
  .then(chat)
  .work(workingMemoryCapture({ model: "gpt-5-mini" }));

const filter = filterRelevance({ name: "filter" });
const salience = scoreSalience({ name: "rank" });
```

See [Working Memory](/docs/guides/working-memory) for a full guide.

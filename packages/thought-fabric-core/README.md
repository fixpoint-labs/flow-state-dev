# @thought-fabric/core

**Cognitive architecture primitives for AI agents. Attention, memory, identity, and more.**

`@thought-fabric/core` provides general-purpose cognitive domains that shape how AI agents perceive, remember, reason, and act. Each domain is a namespace you import by name.

## Status

This package is in Wave 1 foundation mode.

| Domain | Namespace | Status |
|--------|-----------|--------|
| Attention | `attention` | Salience scoring + relevance filtering implemented |
| Memory | `memory` | Working memory implemented |
| Identity | `identity` | Scaffold |
| Perception | — | Wave 2+ |
| Reasoning | — | Wave 2+ |
| Metacognition | — | Wave 3+ |
| Learning | — | Wave 4+ |

## Usage

```ts
import { attention, memory } from '@thought-fabric/core'

// Attention
const salienceBlock = attention.scoreSalience({
  name: 'task-salience'
})

const filterBlock = attention.filterRelevance({
  name: 'reasoning-filter',
  mode: 'hard',
  threshold: 0.6
})

// Memory — one-line working memory capture
const memoryCapture = memory.workingMemoryCapture({
  model: 'gpt-5-mini'
})
```

## API Surface

### Attention

- `scoreSalience(config)` → generator `BlockDefinition`
  - Dimension-based salience scoring with configurable weights
  - Default dimensions: `goalRelevance`, `recency`, `novelty`, `emotionalWeight`
  - Output includes per-dimension scores, composite score, per-item scoring, and ranking
- `filterRelevance(config)` → handler `BlockDefinition`
  - Deterministic relevance filtering against criteria
  - `hard` mode returns filtered items only
  - `soft` mode returns all items annotated with relevance scores
  - Uses pre-scored signals when available, with keyword-overlap fallback for raw strings

### Memory

**Resource:**

- `workingMemoryResource` — Session-scoped resource definition for working memory state. Declare via `sessionResources: { workingMemory: workingMemoryResource }`.

**Blocks:**

- `workingMemoryCapture(config?)` → sequencer — Bundled observe + tick pipeline. One line to add working memory to a flow. Input: `z.string()` (text to extract memories from).
- `workingMemoryObserve(config?)` → generator — LLM-based memory extraction. For advanced composition when you want to control observe and tick independently.
- `workingMemoryTick(config?)` → handler — Advances the decay clock and recomputes salience. Use with `.tap()`.
- `workingMemorySnapshot()` → handler — Returns current entries sorted by salience + turn counter.
- `workingMemoryAdd(config?)` → handler — Directly add an entry without LLM extraction.

**Helpers (raw resource operations):**

- `add(ref, entry, config?)` — Add entry with auto-eviction at capacity
- `evict(ref, id)` — Remove by ID (overrides pin)
- `pin(ref, id, config?)` / `unpin(ref, id)` — Pin/unpin protection
- `refresh(ref, id, config?)` — Reset access time (access boost)
- `tick(ref, config?)` — Advance turn counter, recompute salience
- `items(ref)` — Entries sorted by salience descending
- `formatForContext(ref)` — Numbered list for LLM context injection
- `workingMemoryContext(input, ctx)` — Ready-made `context:` slot for generators (reads resource + formats)

**Math:**

- `computeDecay(elapsed, strategy, rate)` — ACT-R power-law, exponential, or none
- `computeSalience(entry, currentTurn, decay)` — `importance × decay(elapsed)`

### Identity

- `constitution(config)` — Placeholder (not implemented)
- `perspective(config)` — Placeholder (not implemented)

## Dependencies

- `@flow-state-dev/core`
- `zod` (direct dependency)

## Scripts

```bash
pnpm --filter @thought-fabric/core build
pnpm --filter @thought-fabric/core typecheck
pnpm --filter @thought-fabric/core test
```

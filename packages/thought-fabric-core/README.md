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
// Preferred: subpath import with clean names
import { capture, observe, resource, context } from '@thought-fabric/core/working-memory'
// OR as a namespace
import workingMemory from '@thought-fabric/core/working-memory'

// One-line working memory capture
const memoryCapture = capture({ model: 'gpt-5-mini' })

// Compose your own pipeline
const pipeline = sequencer({ name: 'custom', inputSchema: z.string() })
  .then(observe({ model: 'gpt-5-mini' }))
  .then(remember())
  .tap(tick())

// Attention (namespace import)
import { attention } from '@thought-fabric/core'

const salienceBlock = attention.scoreSalience({ name: 'task-salience' })
const filterBlock = attention.filterRelevance({
  name: 'reasoning-filter',
  mode: 'hard',
  threshold: 0.6,
})
```

## Import Patterns

Working memory supports two import styles:

```ts
// Named imports — pick what you need
import { capture, observe, resource, add, advance } from '@thought-fabric/core/working-memory'

// Default import — namespace object
import workingMemory from '@thought-fabric/core/working-memory'
workingMemory.capture({ model: 'gpt-5-mini' })
```

Block factories and helpers use distinct vocabulary to avoid collisions. `tick` is always the block (pipeline step). `advance` is always the helper (direct resource operation).

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

- `resource` — Session-scoped resource definition for working memory state. Declare via `sessionResources: { workingMemory: resource }`.

**Blocks:**

- `capture(config?)` → sequencer — Bundled observe → remember → tick pipeline. One line to add working memory to a flow. Input: `z.string()` (text to extract memories from).
- `observe(config?)` → generator — LLM-based memory extraction. Returns structured observations without persisting them. Pair with `remember` for full control.
- `remember(config?)` → handler — Persists observations into the resource. Handles `replaces` eviction. Graceful per-observation error handling.
- `tick(config?)` → handler — Advances the decay clock and recomputes salience. Use with `.tap()`.
- `snapshot()` → handler — Returns current entries sorted by salience + turn counter.
- `store(config?)` → handler — Directly add an entry without LLM extraction.

**Helpers (direct resource operations):**

- `add(ref, entry, config?)` — Add entry with auto-eviction at capacity
- `evict(ref, id)` — Remove by ID (overrides pin)
- `pin(ref, id, config?)` / `unpin(ref, id)` — Pin/unpin protection
- `refresh(ref, id, config?)` — Reset access time (access boost)
- `advance(ref, config?)` — Advance turn counter, recompute salience
- `items(ref)` — Entries sorted by salience descending
- `formatForContext(ref)` — Bullet list for LLM context injection (no scores or IDs)
- `context(input, ctx)` — Ready-made `context:` slot for generators (reads resource + formats)

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

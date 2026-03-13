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
import {
  workingMemoryCapture,
  workingMemoryResource,
  workingMemoryContextFormatter,
} from '@thought-fabric/core/memory'
import { sequencer, generator } from '@flow-state-dev/core'

// One-line working memory capture
const memoryCapture = workingMemoryCapture({ model: 'gpt-5-mini' })

// Add to a pipeline
const pipeline = sequencer({ name: 'chat', inputSchema: z.string() })
  .then(chatGenerator)
  .work(memoryCapture)

// Inject memory into a generator's context
const chat = generator({
  name: 'chat',
  model: 'gpt-5',
  inputSchema: z.string(),
  sessionResources: { workingMemory: workingMemoryResource },
  context: [workingMemoryContextFormatter],
  user: (input) => input,
})

// Attention (namespace import)
import { attention } from '@thought-fabric/core'

const salienceBlock = attention.scoreSalience({ name: 'task-salience' })
const filterBlock = attention.filterRelevance({
  name: 'reasoning-filter',
  mode: 'hard',
  threshold: 0.6,
})
```

## Import Paths

Each domain exposes a subpath: `@thought-fabric/core/memory`, `@thought-fabric/core/attention`, etc. The root export aggregates domains into namespace objects.

```ts
// Subpath — direct named imports (tree-shakeable)
import { workingMemoryCapture, addWorkingMemory } from '@thought-fabric/core/memory'

// Root — namespace imports
import { memory } from '@thought-fabric/core'
memory.workingMemoryCapture(...)
```

Both paths use the same qualified names. No short aliases, no default namespace objects.

## Naming Conventions

Word order encodes category:

| Category | Pattern | Example |
|----------|---------|---------|
| Block factory | `workingMemory[Verb]` | `workingMemoryCapture`, `workingMemoryTick` |
| Resource/schema | `workingMemory[Noun]` | `workingMemoryResource`, `workingMemoryEntrySchema` |
| Formatter | `workingMemory[Noun]Formatter` | `workingMemoryContextFormatter` |
| Accessor | `workingMemory[Noun]` | `workingMemoryItems` |
| Helper | `[verb]WorkingMemory` | `addWorkingMemory`, `advanceWorkingMemory` |
| Pure math | no prefix | `computeDecay`, `computeSalience` |

The inversion is the signal: `workingMemoryAdd` is a block (a thing you compose in a pipeline). `addWorkingMemory` is a helper (an action on a resource ref). The English reads naturally either way.

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

- `workingMemoryResource` — Session-scoped resource definition. Declare via `sessionResources: { workingMemory: workingMemoryResource }`.

**Blocks** (pipeline composition, `workingMemory[Verb]` prefix):

- `workingMemoryCapture(config?)` → sequencer — Bundled observe → remember → tick pipeline. Input: `z.string()`.
- `workingMemoryObserve(config?)` → generator — LLM-based memory extraction. Returns structured observations without persisting them.
- `workingMemoryRemember(config?)` → handler — Persists observations into the resource. Handles `replaces` eviction.
- `workingMemoryTick(config?)` → handler — Advances the decay clock and recomputes salience. Use with `.tap()`.
- `workingMemorySnapshot()` → handler — Returns current entries sorted by salience + turn counter.
- `workingMemoryAdd(config?)` → handler — Directly add an entry without LLM extraction.

**Helpers** (direct resource operations, verb-first):

- `addWorkingMemory(ref, entry, config?)` — Add entry with auto-eviction at capacity
- `evictWorkingMemory(ref, id)` — Remove by ID (overrides pin)
- `pinWorkingMemory(ref, id, config?)` / `unpinWorkingMemory(ref, id)` — Pin/unpin protection
- `refreshWorkingMemory(ref, id, config?)` — Reset access time (access boost)
- `advanceWorkingMemory(ref, config?)` — Advance turn counter, recompute salience

**Accessors and formatters:**

- `workingMemoryItems(ref)` — Entries sorted by salience descending
- `formatWorkingMemoryEntries(ref)` — Bullet list for LLM context injection (no scores or IDs)
- `workingMemoryContextFormatter(input, ctx)` — Ready-made `context:` slot for generators (reads resource + formats)

**Schemas:**

- `workingMemoryEntrySchema` / `workingMemoryStateSchema` — Zod schemas
- `workingMemoryObservationsSchema` — Schema for observe block output

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

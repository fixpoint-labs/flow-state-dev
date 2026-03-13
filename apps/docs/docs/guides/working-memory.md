---
sidebar_position: 9
---

# Working Memory

Working memory is a bounded, salience-scored store that tracks what stays in cognitive focus during a conversation. It lives in the `memory` domain of `@thought-fabric/core`.

Entries decay over time based on a configurable strategy (ACT-R power-law by default). As new information arrives, old low-salience entries get evicted automatically. Pinned entries survive eviction, up to a configurable limit.

## Quick Start

The fastest way to add working memory is `workingMemoryCapture`. It's a sequencer that extracts memories from text using an LLM, persists them, then advances the decay clock:

```ts
import { workingMemoryCapture } from '@thought-fabric/core/memory'
import { sequencer } from '@flow-state-dev/core'

const memoryCapture = workingMemoryCapture({ model: 'gpt-5-mini' })

// Add to a pipeline with .work() — runs in the background
const pipeline = sequencer({ name: 'chat', inputSchema: z.string() })
  .then(chatGenerator)
  .work(memoryCapture)
```

The capture block declares its own session resource. The framework installs it automatically when the flow runs. No manual resource setup needed.

## Composable Blocks

If you need more control, use the individual blocks that `workingMemoryCapture` bundles together.

### Observe → Remember → Tick

```ts
import {
  workingMemoryObserve,
  workingMemoryRemember,
  workingMemoryTick,
} from '@thought-fabric/core/memory'

const pipeline = sequencer({ name: 'chat', inputSchema: z.string() })
  .then(chatGenerator)
  .work(
    sequencer({ name: 'memory', inputSchema: z.string() })
      .then(workingMemoryObserve({ model: 'gpt-5-mini', maxExtractPerTurn: 5 }))
      .then(workingMemoryRemember())
      .tap(workingMemoryTick())
  )
```

Three blocks, three responsibilities:

- **`workingMemoryObserve`** is a generator that analyzes input text and extracts structured observations. It returns an array of `{ content, importance, pinned?, replaces? }` objects. It does not persist anything on its own.
- **`workingMemoryRemember`** is a handler that takes the observations from observe and writes them to the working memory resource. If an observation includes a `replaces` field, the old entry is evicted before the new one is added. Errors on individual observations are caught and skipped, so one bad observation doesn't abort the batch.
- **`workingMemoryTick`** advances the turn counter by 1 and recomputes salience for every entry. Use it with `.tap()` since it's a side-effect with no meaningful output.

This separation lets you insert custom logic between steps. For example, you could filter observations before persisting them, or log what was extracted without modifying the pipeline.

### Reading Memory

To inject memory into an LLM's system context, pass `workingMemoryContextFormatter` in the `context` array:

```ts
import { generator } from '@flow-state-dev/core'
import {
  workingMemoryResources,
  workingMemoryContextFormatter,
} from '@thought-fabric/core/memory'

const chat = generator({
  name: 'chat',
  model: 'gpt-5',
  inputSchema: z.string(),
  sessionResources: workingMemoryResources,
  context: [workingMemoryContextFormatter],
  user: (input) => input,
})
```

Under the hood, this reads the `workingMemory` resource and formats entries as a bullet list ordered by salience:

```
Active memories:
- (pinned) User prefers TypeScript
- Working on a chat application
- Previous topic was authentication
```

Salience scores are intentionally omitted from the public format. They're an internal eviction mechanism, not a confidence signal, and risk being over-interpreted by the consuming LLM. Ordering already communicates priority (most relevant first).

The `context` field takes an array, so you can compose multiple formatters for different concerns:

```ts
context: [workingMemoryContextFormatter, identityContextFormatter],
```

If you need custom formatting, use `formatWorkingMemoryEntries(ref)` directly — it returns the raw bullet list without the header.

### Composing Resources

`workingMemoryResources` is a pre-keyed object that maps the correct resource key for you. Use it directly, or spread it alongside other resources:

```ts
// Simple — just working memory
sessionResources: workingMemoryResources

// Composing with other pattern resources
sessionResources: {
  ...workingMemoryResources,
  ...episodicMemoryResources,
}

// Composing with custom resources
sessionResources: {
  ...workingMemoryResources,
  userPrefs: userPrefsResource,
}
```

This avoids hard-coding the resource key name, which is an internal contract between the blocks and the resource declaration.

### Snapshot and Manual Store

`workingMemorySnapshot` returns the current state as structured data:

```ts
import { workingMemorySnapshot } from '@thought-fabric/core/memory'
// Output: { entries: WorkingMemoryEntry[], currentTurn: number }
```

`workingMemoryAdd` lets you insert entries directly without LLM extraction:

```ts
import { workingMemoryAdd } from '@thought-fabric/core/memory'
// Input: { content: string, importance: number, pinned?: boolean, id?: string, metadata?: object }
```

## Helpers

For direct resource manipulation outside of blocks, helper functions operate on a resource ref. Helpers use verb-first naming to distinguish them from block factories: `addWorkingMemory` is an action, `workingMemoryAdd` is a block.

```ts
import {
  addWorkingMemory,
  workingMemoryItems,
  pinWorkingMemory,
  unpinWorkingMemory,
  refreshWorkingMemory,
  evictWorkingMemory,
  advanceWorkingMemory,
} from '@thought-fabric/core/memory'

const ref = ctx.session.resources.get('workingMemory')

// Add an entry
await addWorkingMemory(ref, {
  content: 'User wants to build a REST API',
  importance: 0.8,
  pinned: true,
})

// Read entries sorted by salience
const sorted = workingMemoryItems(ref)

// Pin/unpin
await pinWorkingMemory(ref, 'entry-id')
await unpinWorkingMemory(ref, 'entry-id')

// Refresh access time (models "re-accessing" a memory)
await refreshWorkingMemory(ref, 'entry-id')

// Manually evict (overrides pin)
await evictWorkingMemory(ref, 'entry-id')

// Advance the clock (recompute salience for all entries)
await advanceWorkingMemory(ref)
```

## Configuration

All blocks accept an optional config:

```ts
import { workingMemoryCapture } from '@thought-fabric/core/memory'

workingMemoryCapture({
  model: 'gpt-5-mini',        // LLM for extraction
  capacity: 7,                 // Max entries (default: 7, Miller's number)
  maxPinnedSlots: 2,           // Max pinned entries (default: 2)
  maxExtractPerTurn: 3,        // Max observations per extraction (default: 3)
  decay: {
    strategy: 'power-law',     // 'power-law' | 'exponential' | 'none'
    rate: 0.5,                 // Decay rate (default: 0.5)
  },
})
```

**Decay strategies:**

- **`power-law`** (default) — ACT-R activation decay: `(1 + elapsed)^(-rate)`. Fast initial drop with a long tail. Matches how human working memory behaves.
- **`exponential`** — `exp(-rate × elapsed)`. Steeper, more aggressive decay.
- **`none`** — No decay. Salience equals importance forever. Useful for testing or fixed-context scenarios.

## Complete Export Reference

All exports available from `@thought-fabric/core/memory` for working memory:

| Export | Kind | Description |
|--------|------|-------------|
| **Block factories** | | |
| `workingMemoryCapture(config?)` | sequencer | Bundled observe → remember → tick pipeline |
| `workingMemoryObserve(config?)` | generator | LLM-based memory extraction |
| `workingMemoryRemember(config?)` | handler | Persists observations into the resource |
| `workingMemoryTick(config?)` | handler | Advances the decay clock, recomputes salience |
| `workingMemorySnapshot()` | handler | Returns current entries + turn counter |
| `workingMemoryAdd(config?)` | handler | Directly add an entry (no LLM) |
| **Resource** | | |
| `workingMemoryResource` | resource definition | Session-scoped resource definition |
| `workingMemoryResources` | pre-keyed object | `{ workingMemory: workingMemoryResource }` for `sessionResources` |
| **Helpers** | | |
| `addWorkingMemory(ref, entry, config?)` | helper | Add entry with auto-eviction at capacity |
| `evictWorkingMemory(ref, id)` | helper | Remove by ID (overrides pin) |
| `pinWorkingMemory(ref, id, config?)` | helper | Pin an entry to protect from eviction |
| `unpinWorkingMemory(ref, id)` | helper | Remove pin protection |
| `refreshWorkingMemory(ref, id, config?)` | helper | Reset access time (access boost) |
| `advanceWorkingMemory(ref, config?)` | helper | Advance turn counter, recompute salience |
| **Accessors & formatters** | | |
| `workingMemoryItems(ref)` | accessor | Entries sorted by salience descending |
| `formatWorkingMemoryEntries(ref)` | helper | Bullet list for LLM context (no scores/IDs) |
| `workingMemoryContextFormatter(input, ctx)` | formatter | Ready-made `context:` slot for generators |
| **Schemas** | | |
| `workingMemoryEntrySchema` | Zod schema | Single entry schema |
| `workingMemoryStateSchema` | Zod schema | Full state schema (entries + turn counter) |
| `workingMemoryObservationsSchema` | Zod schema | Observe block output schema |
| **Config & math** | | |
| `DEFAULT_WORKING_MEMORY_CONFIG` | const | Defaults: capacity 7, maxPinnedSlots 2, power-law 0.5 |
| `computeDecay(elapsed, strategy, rate)` | pure function | Decay factor computation |
| `computeSalience(entry, currentTurn, decay)` | pure function | `importance × decay(elapsed)` |
| **Types** | | |
| `WorkingMemoryEntry` | type | Single entry |
| `WorkingMemoryState` | type | Full state |
| `DecayStrategy` | type | `'power-law' \| 'exponential' \| 'none'` |
| `WorkingMemoryDecayConfig` | type | Decay strategy + rate |
| `WorkingMemoryHelperConfig` | type | Capacity, maxPinnedSlots, decay |
| `AddEntryInput` | type | Input for adding an entry |
| `Observations` | type | Observe block output type |
| `WorkingMemoryBlockConfig` | type | Base block config |
| `WorkingMemoryCaptureConfig` | type | Capture sequencer config |
| `WorkingMemoryObserveConfig` | type | Observe generator config |

## Naming Conventions

Word order encodes the category:

| Category | Pattern | Example |
|----------|---------|---------|
| Block factory | `workingMemory[Verb]` | `workingMemoryCapture` |
| Helper (action) | `[verb]WorkingMemory` | `addWorkingMemory` |
| Resource/schema | `workingMemory[Noun]` | `workingMemoryResource` |
| Formatter | `workingMemory[Noun]Formatter` | `workingMemoryContextFormatter` |

`workingMemoryAdd` is a block you compose in a pipeline. `addWorkingMemory` is a helper you call on a resource ref. The inversion tells you which is which without checking docs.

## Edge Cases

| Situation | Behavior |
|-----------|----------|
| Add at capacity, all entries pinned | Entry is added anyway, exceeding capacity |
| Pin at `maxPinnedSlots` | `pin()` returns false, entry stays unpinned |
| Explicit `evict()` on a pinned entry | Removes it (explicit eviction overrides pin) |
| Same salience at eviction time | First entry in array order is evicted (stable) |
| Observe extracts 0 items | No entries added, tick still advances the clock |
| Remember receives `replaces` with non-existent ID | Evict is a no-op, new entry is still added |
| Remember fails on one observation | Skips it, persists the rest (partial success) |

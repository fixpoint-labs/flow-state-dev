---
sidebar_position: 9
---

# Working Memory

Working memory is a bounded, salience-scored store that tracks what stays in cognitive focus during a conversation. It lives in the `memory` domain of `@thought-fabric/core`.

Entries decay over time based on a configurable strategy (ACT-R power-law by default). As new information arrives, old low-salience entries get evicted automatically. Pinned entries survive eviction, up to a configurable limit.

## Quick Start

The fastest way to add working memory is `capture`. It's a sequencer that extracts memories from text using an LLM, persists them, then advances the decay clock:

```ts
import { capture, resource } from '@thought-fabric/core/working-memory'
import { sequencer } from '@flow-state-dev/core'

const memoryCapture = capture({ model: 'gpt-5-mini' })

// Add to a pipeline with .work() — runs in the background
const pipeline = sequencer({ name: 'chat', inputSchema: z.string() })
  .then(chatGenerator)
  .work(memoryCapture)
```

The capture block declares its own session resource. The framework installs it automatically when the flow runs. No manual resource setup needed.

You can also import the whole domain as a namespace:

```ts
import workingMemory from '@thought-fabric/core/working-memory'

const memoryCapture = workingMemory.capture({ model: 'gpt-5-mini' })
```

## Composable Blocks

If you need more control, use the individual blocks that `capture` bundles together.

### Observe → Remember → Tick

```ts
import { observe, remember, tick } from '@thought-fabric/core/working-memory'

const pipeline = sequencer({ name: 'chat', inputSchema: z.string() })
  .then(chatGenerator)
  .work(
    sequencer({ name: 'memory', inputSchema: z.string() })
      .then(observe({ model: 'gpt-5-mini', maxExtractPerTurn: 5 }))
      .then(remember())
      .tap(tick())
  )
```

Three blocks, three responsibilities:

- **`observe`** is a generator that analyzes input text and extracts structured observations. It returns an array of `{ content, importance, pinned?, replaces? }` objects. It does not persist anything on its own.
- **`remember`** is a handler that takes the observations from observe and writes them to the working memory resource. If an observation includes a `replaces` field, the old entry is evicted before the new one is added. Errors on individual observations are caught and skipped, so one bad observation doesn't abort the batch.
- **`tick`** advances the turn counter by 1 and recomputes salience for every entry. Use it with `.tap()` since it's a side-effect with no meaningful output.

This separation lets you insert custom logic between steps. For example, you could filter observations before persisting them, or log what was extracted without modifying the pipeline.

### Reading Memory

To inject memory into an LLM's system context, pass `context` as the `context:` slot:

```ts
import { generator } from '@flow-state-dev/core'
import { resource, context } from '@thought-fabric/core/working-memory'

const chat = generator({
  name: 'chat',
  model: 'gpt-5',
  inputSchema: z.string(),
  sessionResources: { workingMemory: resource },
  context: context,
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

If you need custom formatting, use `formatForContext(ref)` directly — it returns the raw bullet list without the header.

### Snapshot and Manual Store

`snapshot` returns the current state as structured data:

```ts
import { snapshot } from '@thought-fabric/core/working-memory'
// Output: { entries: WorkingMemoryEntry[], currentTurn: number }
```

`store` lets you insert entries directly without LLM extraction:

```ts
import { store } from '@thought-fabric/core/working-memory'
// Input: { content: string, importance: number, pinned?: boolean, id?: string, metadata?: object }
```

## Helpers

For direct resource manipulation outside of blocks, the helper functions operate on a resource ref. Blocks and helpers use distinct vocabulary — `tick` is the pipeline block, `advance` is the direct helper.

```ts
import { add, items, pin, unpin, refresh, evict, advance } from '@thought-fabric/core/working-memory'

const ref = ctx.session.resources.get('workingMemory')

// Add an entry
await add(ref, {
  content: 'User wants to build a REST API',
  importance: 0.8,
  pinned: true,
})

// Read entries sorted by salience
const sorted = items(ref)

// Pin/unpin
await pin(ref, 'entry-id')
await unpin(ref, 'entry-id')

// Refresh access time (models "re-accessing" a memory)
await refresh(ref, 'entry-id')

// Manually evict (overrides pin)
await evict(ref, 'entry-id')

// Advance the clock (recompute salience for all entries)
await advance(ref)
```

## Configuration

All blocks accept an optional config:

```ts
import { capture } from '@thought-fabric/core/working-memory'

capture({
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

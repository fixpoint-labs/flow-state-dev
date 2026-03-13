---
sidebar_position: 3
---

# Memory

The memory domain (`@thought-fabric/core/memory`) provides working memory: a bounded, salience-scored store that tracks what stays in cognitive focus during a conversation. It lives in session scope. Entries decay over time based on a configurable strategy. As new information arrives, low-salience entries get evicted. Pinned entries survive eviction, up to a limit.

## Quick Start

The fastest way to add working memory is `workingMemoryCapture`. It's a sequencer that extracts memories from text using an LLM, persists them, then advances the decay clock:

```ts
import { workingMemoryCapture } from '@thought-fabric/core/memory'
import { sequencer } from '@flow-state-dev/core'

const memoryCapture = workingMemoryCapture({ model: 'gpt-5-mini' })

const pipeline = sequencer({ name: 'chat', inputSchema: z.string() })
  .then(chatGenerator)
  .work(memoryCapture)
```

The capture block declares its own session resource. The framework installs it automatically when the flow runs. No manual resource setup needed.

## Working Memory Model

- **Capacity**: Default 7 entries (Miller's number). Configurable.
- **Pinned slots**: Default 2. Pinned entries survive eviction; unpinned low-salience entries are evicted first.
- **Decay**: Salience = `importance × decay(elapsed)`. Default strategy is power-law (ACT-R style): `(1 + elapsed)^(-rate)`.
- **Eviction**: When at capacity, the lowest-salience unpinned entry is removed before adding a new one.

## Blocks

### workingMemoryCapture

Bundled sequencer: observe → remember → tick. One block for the common case. Input: a string (the text to extract from).

```ts
import { workingMemoryCapture } from '@thought-fabric/core/memory'

workingMemoryCapture({
  model: 'gpt-5-mini',
  capacity: 7,
  maxPinnedSlots: 2,
  maxExtractPerTurn: 3,
  decay: { strategy: 'power-law', rate: 0.5 },
})
```

### workingMemoryObserve

Generator that uses an LLM to extract structured observations from input text. Output: `{ observations: [{ content, importance, pinned?, replaces? }] }`. Does not persist anything.

```ts
import { workingMemoryObserve } from '@thought-fabric/core/memory'

workingMemoryObserve({
  model: 'gpt-5-mini',
  maxExtractPerTurn: 5,
})
```

### workingMemoryRemember

Handler that persists observations into the resource. Handles `replaces` (evict old entry before adding new one). Errors on individual observations are caught and skipped; partial success is preferred.

### workingMemoryTick

Handler that advances the turn counter and recomputes salience for all entries. Use with `.tap()` since it's a side-effect with no meaningful output.

### workingMemorySnapshot

Handler that returns current state: `{ entries: WorkingMemoryEntry[], currentTurn: number }`. Entries are sorted by salience.

### workingMemoryAdd

Handler that adds an entry directly without LLM extraction. Input: `{ content, importance, pinned?, id?, metadata? }`.

## Composable Pipeline

For more control, wire the blocks yourself:

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

## Injecting Memory into Prompts

Use `workingMemoryContextFormatter` in a generator's `context` array:

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

This formats entries as a bullet list ordered by salience. Salience scores are omitted from the formatted output; they're for eviction, not confidence. Ordering already communicates priority.

## Helpers

For direct resource manipulation outside blocks, use verb-first helpers:

| Helper | Purpose |
|--------|---------|
| `addWorkingMemory(ref, entry, config?)` | Add entry with auto-eviction at capacity |
| `evictWorkingMemory(ref, id)` | Remove by ID (overrides pin) |
| `pinWorkingMemory(ref, id, config?)` | Pin to protect from eviction |
| `unpinWorkingMemory(ref, id)` | Remove pin |
| `refreshWorkingMemory(ref, id, config?)` | Reset access time (access boost) |
| `advanceWorkingMemory(ref, config?)` | Advance turn, recompute salience |
| `workingMemoryItems(ref)` | Entries sorted by salience |
| `formatWorkingMemoryEntries(ref)` | Bullet list for LLM context |

```ts
import {
  addWorkingMemory,
  workingMemoryItems,
  pinWorkingMemory,
} from '@thought-fabric/core/memory'

const ref = ctx.session.resources.get('workingMemory')

await addWorkingMemory(ref, {
  content: 'User wants to build a REST API',
  importance: 0.8,
  pinned: true,
})

const sorted = workingMemoryItems(ref)
await pinWorkingMemory(ref, 'entry-id')
```

## Decay Strategies

| Strategy | Formula | Use case |
|----------|---------|----------|
| `power-law` (default) | `(1 + elapsed)^(-rate)` | ACT-R style; fast initial drop, long tail |
| `exponential` | `exp(-rate × elapsed)` | Steeper, more aggressive decay |
| `none` | 1 | No decay; salience = importance forever. Good for testing. |

## Resource and Schemas

- `workingMemoryResource` — Session-scoped resource definition.
- `workingMemoryResources` — Pre-keyed `{ workingMemory: workingMemoryResource }` for `sessionResources`.
- `workingMemoryEntrySchema`, `workingMemoryStateSchema` — Zod schemas for type validation.

## Pure Math Functions

`computeDecay(elapsed, strategy, rate)` and `computeSalience(entry, currentTurn, decay)` are exported for custom logic or testing.

## Naming Convention

- `workingMemory[Verb]` — Block or item (e.g. `workingMemoryCapture`, `workingMemoryObserve`).
- `[verb]WorkingMemory` — Helper (e.g. `addWorkingMemory`, `evictWorkingMemory`).

## Further Reading

The [Working Memory guide](/docs/guides/working-memory) has a complete export reference, edge-case table, and detailed examples.

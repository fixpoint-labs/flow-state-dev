---
sidebar_position: 3
---

# Memory

The memory domain (`@thought-fabric/core/memory`) gives agents structured recall across three tiers: **working memory** for the current conversation, **episodic memory** for significant experiences across sessions, and **semantic memory** for distilled, stable knowledge. Each tier has its own retention model. Together they form a pipeline where observations flow in, get classified, and settle into the right store based on how durable they are.

## Quick Start

The fastest way to add the full memory system is `memory.system()`. It wires up all three tiers, gives you a capture pipeline, a cross-store recall function, and a context formatter for injecting memories into LLM prompts:

```ts
import { system as memorySystem } from '@thought-fabric/core/memory'
import { sequencer } from '@flow-state-dev/core'

const mem = memorySystem({
  model: 'gpt-5-mini',
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
})

const pipeline = sequencer({ name: 'chat', inputSchema })
  .work((input) => input.message, mem.capture)
  .then(chatGenerator)
```

`mem.capture` is a sequencer that runs in the background via `.work()`. It observes the user's message, classifies memories by durability and category, routes them to the right stores, advances the decay clock, and (when enough evidence accumulates) consolidates episodic memories into semantic facts. One line to add to a pipeline.

The capture block declares its own resources. The framework installs them automatically when the flow runs. No manual resource setup needed.

If you only need working memory, you can still use the standalone `workingMemoryCapture` block:

```ts
import { workingMemoryCapture } from '@thought-fabric/core/memory'

const memoryCapture = workingMemoryCapture({ model: 'gpt-5-mini' })

const pipeline = sequencer({ name: 'chat', inputSchema })
  .work((input) => input.message, memoryCapture)
  .then(chatGenerator)
```

## How the Tiers Work

Each tier serves a different purpose:

| Tier | Scope | Retention | What it stores |
|------|-------|-----------|---------------|
| **Working** | Session | Decays over turns | Active context: what the agent is tracking right now |
| **Episodic** | User or Project | Persistent | Significant experiences: facts, events, preferences worth remembering across sessions |
| **Semantic** | User or Project | Stable | Distilled knowledge: patterns, preferences, and facts extracted from repeated episodic evidence |

Information flows upward. A user message enters as working memory. If the observer classifies it as `persistent` or `permanent`, it also goes to episodic memory. If it's a stable category (fact, preference, or relationship) with persistent/permanent durability, it goes directly to semantic memory too. Over time, the consolidation pipeline reviews unconsolidated episodes and distills them into semantic facts via an LLM call.

Working memory is bounded and ephemeral. Episodic memory is an append-only log. Semantic memory is a curated knowledge base where facts get reinforced, updated, or invalidated as new evidence arrives.

## The Unified System

`memory.system()` is the primary API. It returns an object with everything you need:

```ts
const mem = memorySystem({
  model: 'gpt-5-mini',
  working: { capacity: 7 },
  episodic: { scope: 'user', significanceThreshold: 0.6 },
  semantic: { consolidation: { episodicThreshold: 5 } },
})
```

**What you get back:**

| Property | Type | Purpose |
|----------|------|---------|
| `mem.capture` | Sequencer | Full pipeline: observe → reflect → tick (+ consolidation) |
| `mem.consolidate` | Sequencer | Standalone consolidation (when semantic configured) |
| `mem.recall(ctx, cue?)` | Function | Cross-store recall, ranked by relevance |
| `mem.contextFormatter` | Context fn | Drop into a generator's `context` array |
| `mem.working` | Object | Resource + helpers for direct manipulation |
| `mem.episodic` | Object | Resource + helpers (if configured) |
| `mem.semantic` | Object | Resource + helpers (if configured) |

Pass `true` for any tier to use defaults. Pass an object to customize:

```ts
// Defaults for everything
const mem = memorySystem({ model: 'gpt-5-mini', working: true, episodic: true, semantic: true })

// Custom episodic, default semantic
const mem = memorySystem({
  model: 'gpt-5-mini',
  working: { capacity: 10 },
  episodic: { scope: 'project', significanceThreshold: 0.5, maxEpisodes: 500 },
  semantic: true,
})
```

Semantic requires episodic. You can't have semantic without episodic, because consolidation draws from the episodic store.

## The Capture Pipeline

`mem.capture` is a sequencer: **observe → reflect → tick**, with consolidation running as background work when semantic is configured.

**Observe** is a generator block. It sends recent conversation items to an LLM and gets back classified observations:

```ts
// Each observation has:
{
  content: string        // What to remember
  importance: number     // 0–1 score
  durability: 'transient' | 'session' | 'persistent' | 'permanent'
  category: 'fact' | 'event' | 'preference' | 'task' | 'relationship'
  replaces: string       // ID of existing entry this supersedes, or ''
}
```

The observer checks existing working memory for contradictions. If a user says "I joined Stripe" and working memory has "works at Google," the observer marks the new entry with `replaces` pointing to the old one. Stale memories are worse than missing memories.

**Reflect** is a handler that routes observations to the right stores:
- All items → working memory (with auto-eviction at capacity)
- `persistent`/`permanent` items above the significance threshold → episodic memory
- `persistent`/`permanent` items with stable categories (`fact`, `preference`, `relationship`) → semantic memory directly

**Tick** advances the working memory decay clock and recomputes salience scores.

**Consolidation** (when semantic is configured) runs as `.work()` — background processing that doesn't block the pipeline. It checks whether enough episodic evidence has accumulated, and if so, calls an LLM to distill patterns into semantic facts.

## Injecting Memory into Prompts

Use `mem.contextFormatter` in a generator's `context` array:

```ts
import { generator } from '@flow-state-dev/core'

const chat = generator({
  name: 'chat',
  model: 'gpt-5',
  inputSchema: z.string(),
  context: [mem.contextFormatter],
  user: (input) => input,
})
```

The formatter calls `recall()` internally and organizes memories into sections:

```
Known facts:
- User works at Stripe
- User prefers TypeScript

Current focus:
- Working on a REST API migration

User preferences:
- Prefers concise responses
- Likes code examples over explanations
```

Semantic facts appear first (highest authority), then working memory entries, then recent episodic memories. Duplicates across stores are filtered — if semantic memory has "User works at Stripe," the same entry won't appear again from working memory.

For direct access, use `mem.recall(ctx, cue?)`:

```ts
const memories = mem.recall(ctx)
// Returns: RankedMemoryItem[] sorted by relevance

const focused = mem.recall(ctx, 'TypeScript preferences')
// Token overlap with cue boosts relevance
```

## Consolidation

Consolidation is how episodic memories become semantic facts. It runs automatically as part of the capture pipeline when semantic memory is configured.

**When it triggers:** Consolidation runs when `episodicWritesSinceLastConsolidation` reaches the threshold (default: 5), or when a persistent/permanent entry is evicted from working memory. There's also a minimum turn interval to prevent rapid re-triggering (default: 4 turns).

**What it does:** The consolidation pipeline has three stages, gated so the LLM call is skipped entirely when conditions aren't met:

1. **Guard** — Checks trigger conditions. If not met, returns early. If met, reads unconsolidated episodes and existing semantic facts.
2. **Generate** — LLM call that synthesizes facts from episodes. Can create new facts, reinforce existing ones, update contradicted facts, or invalidate stale ones.
3. **Persist** — Writes the results to the semantic store, marks episodes as consolidated, resets counters.

Contradiction handling is central. If episodic evidence contradicts an existing semantic fact, the LLM should update or invalidate it. The prompt emphasizes this: stale facts are worse than missing facts.

```ts
// Consolidation output per fact:
{
  content: string
  confidence: number     // 0–1, based on evidence strength
  category: 'fact' | 'preference' | 'relationship' | 'pattern'
  action: 'new' | 'reinforce' | 'update' | 'invalidate'
  targetFactId: string   // For reinforce/update/invalidate
  sourceEpisodeIds: string[]
}
```

**Direct extraction vs consolidation:** Not everything waits for consolidation. During the reflect step, items classified as `persistent` or `permanent` with stable categories (`fact`, `preference`, `relationship`) go directly to semantic memory. This means a user saying "My name is Jake" gets stored as a semantic fact immediately, without waiting for the consolidation threshold. Consolidation is for finding patterns across multiple episodes — things no single observation makes obvious.

## Working Memory

Working memory is a bounded, salience-scored store scoped to a session. Entries decay over time. When capacity is reached, the lowest-salience unpinned entry is evicted.

### Model

- **Capacity**: Default 7 entries (Miller's number). Configurable.
- **Pinned slots**: Default 2. Pinned entries survive eviction; unpinned low-salience entries go first.
- **Decay**: Salience = `importance × decay(elapsed)`. Default strategy is power-law (ACT-R style): `(1 + elapsed)^(-rate)`.
- **Eviction**: When at capacity, the lowest-salience unpinned entry is removed before adding a new one.

### Standalone Blocks

If you're not using the unified system, these blocks give you fine-grained control:

| Block | Kind | Purpose |
|-------|------|---------|
| `workingMemoryCapture` | Sequencer | Bundled: observe → remember → tick |
| `workingMemoryObserve` | Generator | LLM extraction of observations |
| `workingMemoryRemember` | Handler | Persists observations to resource |
| `workingMemoryTick` | Handler | Advances decay clock |
| `workingMemorySnapshot` | Handler | Returns current state sorted by salience |
| `workingMemoryAdd` | Handler | Direct entry addition (no LLM) |

```ts
import {
  workingMemoryObserve,
  workingMemoryRemember,
  workingMemoryTick,
} from '@thought-fabric/core/memory'

const pipeline = sequencer({ name: 'chat', inputSchema })
  .work(
    (input) => input.message,
    sequencer({ name: 'memory', inputSchema: z.string() })
      .then(workingMemoryObserve({ model: 'gpt-5-mini' }))
      .then(workingMemoryRemember())
      .tap(workingMemoryTick())
  )
  .then(chatGenerator)
```

### Helpers

For direct resource manipulation outside blocks:

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

### Decay Strategies

| Strategy | Formula | Use case |
|----------|---------|----------|
| `power-law` (default) | `(1 + elapsed)^(-rate)` | ACT-R style; fast initial drop, long tail |
| `exponential` | `exp(-rate × elapsed)` | Steeper, more aggressive decay |
| `none` | 1 | No decay; salience = importance forever. Good for testing. |

## Episodic Memory

Episodic memory records significant experiences across sessions. It's an append-only log of episodes scoped to either `user` or `project`. Episodes are written during the reflect step when items have `persistent` or `permanent` durability and meet the significance threshold.

### Resource

Episodic memory uses a resource factory because the scope varies:

```ts
import { createEpisodicMemoryResource } from '@thought-fabric/core/memory'

const epResource = createEpisodicMemoryResource('user')   // or 'project'
```

When using `memory.system()`, this is handled for you.

### Helpers

| Helper | Purpose |
|--------|---------|
| `encodeEpisode(ref, input, maxEpisodes)` | Write a new episode |
| `recentEpisodes(ref, limit?)` | Get recent episodes (default: 10) |
| `markEpisodesConsolidated(ref, ids)` | Mark episodes as processed by consolidation |

## Semantic Memory

Semantic memory is a curated knowledge base of stable facts. Unlike episodic memory (which records what happened), semantic memory records what's *true* — distilled from evidence over time. Facts have confidence scores that increase with reinforcement and can be updated or invalidated when new evidence contradicts them.

### How facts arrive

Facts enter semantic memory through two paths:

1. **Direct extraction** (during reflect): Items classified as `persistent`/`permanent` with a stable category (`fact`, `preference`, `relationship`) go straight to semantic memory. No waiting for consolidation.
2. **Consolidation** (background): After enough episodic evidence accumulates, an LLM reviews unconsolidated episodes and extracts patterns, reinforces existing facts, or corrects outdated ones.

### Resource

Like episodic, semantic memory uses a resource factory:

```ts
import { createSemanticMemoryResource } from '@thought-fabric/core/memory'

const semResource = createSemanticMemoryResource('user')   // or 'project'
```

### Helpers

| Helper | Purpose |
|--------|---------|
| `addSemanticFact(ref, input)` | Add a new fact |
| `updateSemanticFact(ref, id, content, sourceIds?, confidence?)` | Update existing fact |
| `reinforceSemanticFact(ref, id, sourceIds?)` | Increase confidence via reinforcement |
| `removeSemanticFact(ref, id)` | Remove a fact (invalidation) |
| `semanticFacts(ref)` | All facts |
| `querySemanticFacts(ref, predicate)` | Filter facts by predicate |

### Fact Schema

```ts
{
  id: string              // Auto-generated
  content: string         // The fact itself
  confidence: number      // 0–1, increases with reinforcement
  category: 'fact' | 'preference' | 'relationship' | 'pattern'
  sourceEpisodeIds: string[]
  reinforcementCount: number
  createdAt: number
  updatedAt: number
}
```

## Configuration Defaults

All defaults are exported as constants for reference:

| Setting | Default | Constant |
|---------|---------|----------|
| Working memory capacity | 7 | `DEFAULT_WORKING_MEMORY_CONFIG.capacity` |
| Max pinned slots | 2 | `DEFAULT_WORKING_MEMORY_CONFIG.maxPinnedSlots` |
| Decay strategy | `power-law` | `DEFAULT_WORKING_MEMORY_CONFIG.decay.strategy` |
| Decay rate | 0.5 | `DEFAULT_WORKING_MEMORY_CONFIG.decay.rate` |
| Episodic scope | `user` | `DEFAULT_EPISODIC_CONFIG.scope` |
| Significance threshold | 0.6 | `DEFAULT_EPISODIC_CONFIG.significanceThreshold` |
| Max episodes | 200 | `DEFAULT_EPISODIC_CONFIG.maxEpisodes` |
| Consolidation episodic threshold | 5 | `DEFAULT_CONSOLIDATION_CONFIG.episodicThreshold` |
| Consolidation on eviction | `true` | `DEFAULT_CONSOLIDATION_CONFIG.onEviction` |
| Consolidation min interval | 4 turns | `DEFAULT_CONSOLIDATION_CONFIG.minInterval` |

## Naming Convention

The word order encodes the category:

- `workingMemory[Verb]` — Block or item (e.g. `workingMemoryCapture`, `workingMemoryObserve`).
- `[verb]WorkingMemory` — Helper (e.g. `addWorkingMemory`, `evictWorkingMemory`).
- Same pattern for episodic (`encodeEpisode`, `recentEpisodes`) and semantic (`addSemanticFact`, `querySemanticFacts`).
- `memorySystem[Verb]` — Unified system blocks (e.g. `memorySystemObserve`, `memorySystemCapture`).

## Further Reading

- [API Reference](/thought-fabric/api) — Full export list
- [Attention](/thought-fabric/attention) — Salience scoring and relevance filtering
- [Introduction](/thought-fabric/introduction) — Thought Fabric overview and import paths

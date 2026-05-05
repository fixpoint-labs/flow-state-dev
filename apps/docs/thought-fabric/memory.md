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
  .then(chatGenerator)
  .work(mem.captureFromItems)
```

`mem.captureFromItems` runs in the background via `.work()` after the generator. It reads the last user message and a truncated assistant response from session items, then runs the full capture pipeline: observe, classify, route to the right stores, advance decay, and (when enough evidence accumulates) consolidate into semantic facts. One line to add to a pipeline.

The capture block declares its own resources. The framework installs them automatically when the flow runs. No manual resource setup needed.

If you need to capture from explicit string input instead of session items, use `mem.capture` with a connector:

```ts
const pipeline = sequencer({ name: 'chat', inputSchema })
  .work((input) => input.message, mem.capture)
  .then(chatGenerator)
```

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

Information flows upward. A user message enters as working memory. If the observer classifies it as `persistent` or `permanent`, it also goes to episodic memory. If it's a stable category (any semantic category — identity, profession, preference, belief, relationship, attribute, or pattern) with persistent/permanent durability, it goes directly to semantic memory too, tagged with a `subject` identifying who the fact is about. Over time, the consolidation pipeline reviews unconsolidated episodes and distills them into semantic facts via an LLM call.

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
| `mem.capture` | Sequencer | Full pipeline: observe → reflect → tick (+ consolidation + prune) |
| `mem.captureFromItems` | Block | Self-serving capture: reads from session items (no input needed) |
| `mem.consolidate` | Sequencer | Standalone consolidation (when semantic configured) |
| `mem.prune` | Sequencer | Standalone prune (when semantic configured) |
| `mem.recall(ctx, cue?)` | Function | Cross-store recall, ranked by relevance |
| `mem.contextFormatter` | Context fn | Drop into a generator's `context` array |
| `mem.working` | Object | Resource + helpers for direct manipulation |
| `mem.episodic` | Object | Resource + helpers (if configured) |
| `mem.semantic` | Object | Resource + helpers (if configured) |
| `mem.capability` | Capability | Composed capability for `uses: [mem.capability]` (see below) |
| `mem.workingMemoryCapability` | Capability | Working memory tier capability |
| `mem.episodicMemoryCapability` | Capability | Episodic tier capability (if configured) |
| `mem.semanticMemoryCapability` | Capability | Semantic tier capability (if configured) |

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

## Capability Surface

Every `memory.system()` instance exposes a `capability` field that wraps the memory system's resources, context formatting, and helper functions into a single `defineCapability()` surface. Declare it in `uses` and the framework installs everything automatically.

```ts
const mem = memorySystem({
  model: 'preset/fast',
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
})

// Generators: resources + context formatter auto-installed
const chat = generator({
  name: 'chat',
  model: 'preset/fast',
  uses: [mem.capability],
  user: (input) => input,
})
```

The composed capability ships two named role presets — pick the one that matches what the consuming block is doing:

| Preset | Formatter | Recall tool | Use for |
| --- | --- | --- | --- |
| `agent` (default) | yes | yes | Primary, user-facing agents — the conversation-carrying generator. |
| `worker` | no | yes | Sub-agents in supervisor / Plan-and-Execute / coordinator patterns, and single-shot utility generators (classifiers, formatters). Tool stays available; no memory is pre-injected. |

`agent` is the default because most consumers want the heavy load + lookup bundle. Workers must opt in explicitly:

```ts
// Primary agent — default; equivalent to .presets({ agent: true })
const chat = generator({
  name: 'chat',
  uses: [mem.capability],
})

// Worker — recall tool only; nothing pre-injected into the prompt
const subAgent = generator({
  name: 'sub-agent',
  uses: [mem.capability.presets({ worker: true })],
})
```

The split matters in multi-agent flows. A worker handed a focused task doesn't need the full memory summary at the top of its prompt — the parent agent already has it. Pre-injecting it on every sub-agent multiplies token cost without changing what the worker can actually do; the recall tool covers the rare cases where the worker needs a specific detail.

For non-generator blocks, opt out of both presets to keep just resources and helpers:

```ts
const myHandler = handler({
  name: 'remember',
  uses: [mem.capability.presets({ agent: false })],
  execute: async (input, ctx) => {
    // Typed helpers via ctx.cap
    await ctx.cap.workingMemory.add({ content: 'User likes pizza', importance: 0.8 })
    const entries = ctx.cap.workingMemory.items()
    const results = ctx.cap.memory.recall('pizza')
  },
})
```

### Individual tier capabilities

If you don't need the full system, individual tier capabilities are available as standalone exports:

```ts
import {
  workingMemoryCapability,
  episodicMemoryCapability,
  semanticMemoryCapability,
} from '@thought-fabric/core/memory'

// Just working memory on a handler
const block = handler({
  name: 'wm-only',
  uses: [workingMemoryCapability],
  execute: async (input, ctx) => {
    await ctx.cap.workingMemory.add({ content: 'fact', importance: 0.7 })
  },
})
```

Custom config via factory functions:

```ts
import { createWorkingMemoryCapability, createEpisodicMemoryCapability } from '@thought-fabric/core/memory'

const wmCap = createWorkingMemoryCapability({ capacity: 10, decay: { strategy: 'exponential', rate: 0.3 } })
const epCap = createEpisodicMemoryCapability({ scope: 'project', maxEpisodes: 500 })
```

## The Capture Pipeline

`mem.capture` is a sequencer: **observe → reflect → tick**, with consolidation and pruning running as background work when semantic is configured.

**Observe** is a generator block. It sends recent conversation items to an LLM and gets back classified observations:

```ts
// Each observation has:
{
  subject: string        // Who this is about ('user', 'jennifer', etc.)
  content: string        // What to remember
  importance: number     // 0–1 score
  durability: 'transient' | 'session' | 'persistent' | 'permanent'
  category: 'identity' | 'event' | 'preference' | 'task' | 'relationship'
           | 'profession' | 'belief' | 'attribute' | 'pattern'
  replaces: string       // ID of existing entry this supersedes, or ''
}
```

The observer checks existing working memory for contradictions. If a user says "I joined Stripe" and working memory has "works at Google," the observer marks the new entry with `replaces` pointing to the old one. Stale memories are worse than missing memories.

**Reflect** is a handler that routes observations to the right stores:
- All items → working memory (with auto-eviction at capacity)
- `persistent`/`permanent` items above the significance threshold → episodic memory
- `persistent`/`permanent` items with stable categories (all semantic categories — everything except `event` and `task`) → semantic memory directly, scoped by subject

**Tick** advances the working memory decay clock and recomputes salience scores.

**Consolidation** (when semantic is configured) runs as `.work()` — background processing that doesn't block the pipeline. It checks whether enough episodic evidence has accumulated, and if so, calls an LLM to distill patterns into semantic facts.

**Pruning** also runs as `.work()` after consolidation. Once the semantic fact store grows past a threshold (default: 20 facts), an LLM evaluates the full fact set and removes redundant, noisy, or low-value facts — and merges facts that cover the same topic with complementary information.

## Capturing Agent Responses

`mem.capture` takes a string input — typically the user's message. But the agent's response often contains valuable context too: corrections, inferred facts, commitments. `mem.captureFromItems` captures both sides of the conversation by reading directly from session items.

```ts
const pipeline = sequencer({ name: 'chat', inputSchema })
  .then(analyzeInput)
  .then(chatGenerator)
  .work(mem.captureFromItems)  // runs after the generator, sees both user + assistant
  .then(postProcess)
```

`captureFromItems` is built using `connectInput` — it's the same capture pipeline, but with a connector that reads the last user message (in full) and the assistant's response (truncated to ~500 characters). The truncation keeps LLM cost low while still catching high-value content like corrections, clarifications, and inferred facts.

Position it after your generator block so it sees the full exchange. It runs as `.work()` (background), so it doesn't block the pipeline.

To customize the truncation limit:

```ts
const mem = memorySystem({
  model: 'gpt-5-mini',
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
  maxAssistantChars: 1000,  // default: 500
})
```

**When to use which:**
- `mem.capture` — when you have explicit string input (e.g., early in a pipeline before the generator)
- `mem.captureFromItems` — after the generator, to capture both sides of the conversation

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

The formatter emits the rolling digest (when configured) and the current working memory under `<digest>` and `<working>` sections. The framework wraps the entry in a `<memory>` tag automatically based on the context key it's registered under, so the rendered prompt section looks like this:

```
<memory>
<digest>
The user is a TypeScript engineer at Fixpoint Labs, working on a chat app
and currently debugging a hydration mismatch in apps/web.
</digest>
<working>
- (pinned) User name is Jake
- Debugging React crash
- Prefers dark mode
</working>
</memory>
```

When the digest tier is not configured (or hasn't been generated yet), the digest section is omitted:

```
<memory>
<working>
- (pinned) User name is Jake
- Debugging React crash
</working>
</memory>
```

When both the digest and working memory are empty the formatter returns `undefined`, and the generator omits the section entirely.

The output is naturally bounded: working memory has a fixed capacity (default 7 entries) and the digest has a `maxTokens` cap (default 400). Combined, the inject is on the order of ~600 tokens and grows slowly with memory contents.

**Behavior change from V1.** Earlier versions of the formatter pasted every semantic fact and recent episode into the prompt. That path is gone — semantic facts and episodic memories now belong on the agent's lookup path via the recall tool ([see below](#recall-tool)). Pre-injecting them in the formatter is exactly the cost this redesign removes; the agent decides when to pay it.

For direct access to all stores, use `mem.recall(ctx, cue?)`:

```ts
const memories = mem.recall(ctx)
// Returns: RankedMemoryItem[] sorted by relevance

const focused = mem.recall(ctx, 'TypeScript preferences')
// Token overlap with cue boosts relevance
```

## Recall Tool

The formatter is one half of the read path. The other half is the recall tool: a search the agent itself can invoke when it needs a detail that wasn't in the summary at the top of its context.

Install it via `mem.tool.recall()`:

```ts
const chat = generator({
  name: 'chat',
  model: 'gpt-5',
  uses: [mem.capability],
  tools: [mem.tool.recall()],
  user: (input) => input,
})
```

The tool searches stored memory — semantic facts and past episodes — and returns ranked results. Working memory is intentionally not included; it already lives in the formatter, so surfacing it through the tool would duplicate context cost.

The agent calls it with a query and an optional limit:

```text
recall({ query: "what did the user say about Postgres?", limit: 5 })
```

The result is an envelope:

```ts
{
  results: [
    { id, content, source: 'semantic' | 'episodic', score, metadata, truncated },
    ...
  ],
  query: 'what did the user say about Postgres?',
  strategy: 'llm-filter',
  totalMatched: 12,
  truncatedTo: 5,
}
```

`source` tells the agent where the result came from — a stable, well-reinforced fact carries different weight than a one-off episode, but the agent doesn't have to route on it. `metadata` carries source-specific fields: `confidence` and `reinforcementCount` for facts, `occurredAtTurn` and `significance` for episodes.

Each result's `content` is capped at 400 characters by default. When a result is truncated, `truncated` is `true` and the content ends with a marker telling the agent to re-query if it needs the full body.

### Strategies

The retrieval backend is pluggable. The default is `llm-filter`, which runs in two stages:

1. **Query-blind intrinsic pre-rank.** Score every fact by `confidence × (0.5 + reinforcementCount/10)` and every episode by `significance × exp(-age/50)`. Pool both, sort, take the top 50. No tokenisation, no overlap math — high-value memories enter the candidate set regardless of query vocabulary.
2. **Single LLM filter call.** A small model picks the actually-relevant subset from the bounded candidate list.

Token spend is bounded regardless of total store size. As the store grows, the pre-rank gate gets stricter. When low-value facts the LLM never sees stop being recallable, that's the signal to upgrade to a heavier strategy. There is no silent degradation curve.

There's also a small Stage 1.5 pass-through that catches exact phrases (proper nouns, error codes) buried in low-score memories — up to 5 extra candidates per call. Disable it via `tool: { strategy: createLlmFilterStrategy({ model, exactPhrasePassThrough: false }) }`.

Configure the strategy at `memory.system()` time:

```ts
const mem = memorySystem({
  model: 'gpt-5',
  working: true,
  episodic: true,
  semantic: true,
  tool: {
    strategy: 'llm-filter',     // default
    model: 'gpt-5-mini',         // overrides the system model for the filter call
    defaults: { limit: 5, perItemCharCap: 400 },
  },
})
```

Custom strategies implement the `RetrievalStrategy` interface and slot in the same way:

```ts
const myStrategy: RetrievalStrategy = {
  name: 'my-backend',
  rank(query, ctx, opts) { /* ... */ },
}

memorySystem({ /* ... */, tool: { strategy: myStrategy } })
```

The recall tool is bundled into both role presets on the memory capability — `agent` (default) installs it alongside the formatter, `worker` installs only the tool. Manual install (`tools: [mem.tool.recall()]`) remains supported when you need a configuration neither preset covers.

### When to use it

Tell the agent to call `recall` when it needs a specific detail not present in the summary at the top of its context. Tell it not to call `recall` to re-retrieve facts already shown to it. The tool's description (visible to the model) emphasises both.

If you find the agent over-retrieving, the lever is the description, not the limit — the limit only constrains result count, not call frequency.

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
  subject: string        // Who this is about
  content: string
  confidence: number     // 0–1, based on evidence strength
  category: 'identity' | 'relationship' | 'preference' | 'belief'
           | 'profession' | 'attribute' | 'pattern'
  action: 'new' | 'reinforce' | 'update' | 'invalidate'
  targetFactId: string   // For reinforce/update/invalidate
  sourceEpisodeIds: string[]
}
```

The consolidation LLM sees existing facts grouped by subject, making it easier to detect contradictions and reinforcements within an entity's knowledge.

**Direct extraction vs consolidation:** Not everything waits for consolidation. During the reflect step, items classified as `persistent` or `permanent` with stable categories (all semantic categories) go directly to semantic memory, tagged with the observer's `subject` field. This means a user saying "My name is Jake" gets stored as a semantic fact immediately, without waiting for the consolidation threshold. Dedup is subject-scoped: "born in May" about `user` only deduplicates against other `user` facts, not against facts about other entities. Consolidation is for finding patterns across multiple episodes — things no single observation makes obvious.

## Pruning

As the semantic fact store grows, noise accumulates. Near-duplicates slip through dedup guards, session artifacts leak past classification, and related facts fragment across multiple entries. Pruning is an LLM-backed maintenance step that evaluates the full fact set and cleans it up.

**When it triggers:** Pruning runs when the semantic fact count reaches the threshold (default: 20). Like consolidation, it uses a guard → generate → persist pattern and runs as `.work()` in the capture pipeline.

**What it does:**

1. **Guard** — Reads all semantic facts. If the count is below threshold, returns early.
2. **Generate** — LLM call that reviews the full fact set and identifies:
   - **Removals**: Facts that are redundant, noisy (session artifacts), contradicted by newer facts, or too vague to be useful.
   - **Merges**: Groups of 2+ facts that cover the same topic with complementary information. For example, "User was born in Maryland" + "User was born in May" → "User was born in May in Maryland."
3. **Persist** — Removes identified facts. For merges, updates the first source fact with the merged content and removes the rest, preserving provenance.

The LLM is instructed to be conservative. High-reinforcement facts (≥5) are protected unless clearly contradicted. High-confidence facts (≥0.8) require strong justification. When in doubt, facts are kept.

```ts
// Prune output:
{
  removals: [{ factId: string, reason: string }]
  merges: [{ sourceFactIds: string[], mergedContent: string, reason: string }]
}
```

**Configuration:**

```ts
const mem = memorySystem({
  model: 'gpt-5-mini',
  working: { capacity: 7 },
  episodic: true,
  semantic: { pruneThreshold: 30 },  // default: 20, set 0 to disable
})
```

You can also run pruning standalone via `mem.prune` if you want to trigger it outside the capture pipeline.

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
      .then(workingMemoryObserve({ model: 'preset/fast' }))
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

1. **Direct extraction** (during reflect): Items classified as `persistent`/`permanent` with a stable category (any semantic category — not `event` or `task`) go straight to semantic memory, tagged with a `subject`. Dedup is subject-scoped. No waiting for consolidation.
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
  subject: string         // Who this is about ('user', 'jennifer', etc.)
  content: string         // The fact itself
  confidence: number      // 0–1, increases with reinforcement
  category: 'identity' | 'relationship' | 'preference' | 'belief'
           | 'profession' | 'attribute' | 'pattern'
  sourceEpisodeIds: string[]
  extractedAt: string     // ISO datetime
  lastReinforced?: string // ISO datetime
  reinforcementCount: number
}
```

**Subject conventions:**
- `'user'` — the primary user (default when omitted)
- Lowercase first name for other people: `'jennifer'`, `'max'`
- Lowercase hyphenated name for organizations: `'fixpoint-labs'`

**Categories:**
- `identity` — who someone is: name, birthdate, location, background
- `profession` — what someone does: job, company, role, skills
- `preference` — likes, dislikes, style choices
- `belief` — opinions, worldviews, values
- `relationship` — connections to other named entities: spouse, pet, employer
- `attribute` — properties/characteristics: possessions, abilities, circumstances
- `pattern` — recurring behaviors

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
| Prune threshold | 20 facts | `DEFAULT_PRUNE_CONFIG.pruneThreshold` |

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

---
sidebar_position: 2
---

# Attention

The attention domain (`@thought-fabric/core/attention`) provides blocks for deciding what matters in a given context. When you have a pile of items (memories, facts, tool results) and a current task, these blocks help filter and rank them so the agent focuses on the right things.

Two blocks are available: `filterRelevance` for deterministic filtering and `scoreSalience` for LLM-based scoring.

## filterRelevance

A handler block that filters items by relevance to a task. It uses a keyword overlap heuristic, so it runs without an LLM. Use it when you need fast, reproducible filtering.

Import from the main package:

```ts
import { attention } from '@thought-fabric/core'

const filterBlock = attention.filterRelevance({
  name: 'filter-context',
  mode: 'hard',
  threshold: 0.6,
})
```

### Input

```ts
{
  task: string,
  items: (string | ScoredItem)[]
}
```

Items can be plain strings or objects with `id`, `content`, and optional `scores`, `composite`, `metadata`. Strings get auto-generated IDs (`item-1`, `item-2`, ...).

### Modes

**Hard mode** (default): Removes items below the threshold. Output includes `items` (what passed) and `excluded` (IDs of what was dropped).

**Soft mode**: Keeps all items but annotates each with `relevance: { scores, composite, passed }`. Useful when you want to see scores for debugging or downstream logic without discarding anything.

```ts
const softFilter = attention.filterRelevance({
  name: 'soft-filter',
  mode: 'soft',
  threshold: 0.5,
})
```

### Criteria

By default, relevance is computed along three criteria:

- **taskAlignment**: Direct relevance to the current reasoning task
- **informationGain**: Adds new information not already in working memory
- **actionability**: Can inform a decision or next step

Each criterion uses the same keyword overlap heuristic. You can override the criteria (and their descriptions) via config:

```ts
attention.filterRelevance({
  name: 'custom-filter',
  criteria: {
    taskAlignment: 'Must mention the active goal',
    urgency: 'Time-sensitive information',
  },
  threshold: 0.7,
})
```

### Example in a pipeline

```ts
import { handler, sequencer } from '@flow-state-dev/core'
import { attention } from '@thought-fabric/core'

const filterBlock = attention.filterRelevance({
  name: 'pre-chat-filter',
  mode: 'hard',
  threshold: 0.6,
})

// Assume you have a handler that returns { task, items }
const pipeline = sequencer({ name: 'assistant', inputSchema: z.object({ task: z.string(), items: z.array(z.any()) }) })
  .then(filterBlock)
  .then((ctx, input) => {
    // input.items = only the relevant items
    // input.excluded = IDs of filtered-out items
    return doSomethingWith(input)
  })
```

The heuristic is simple. It splits task and content into tokens (lowercase, alphanumeric, length > 2), counts overlap, and normalizes. No semantic understanding. For richer filtering, chain with `scoreSalience` and use its output as input to `filterRelevance`.

## scoreSalience

A generator block that uses an LLM to score items along configurable dimensions. Slower than `filterRelevance` but captures nuance (recency, novelty, emotional weight) that keyword overlap cannot.

```ts
import { attention } from '@thought-fabric/core'

const salienceBlock = attention.scoreSalience({
  name: 'task-salience',
  model: 'gpt-5-mini',
})
```

### Input

```ts
{
  items: (string | { id: string, content: string, metadata?: Record<string, unknown> })[],  // min 1
  activeGoal?: string,
  activeTask?: string,
  baseline?: string
}
```

Plain strings get auto IDs. The optional fields give the LLM context: what goal is active, what task is in progress, what baseline information already exists.

### Output

```ts
{
  scores: Record<string, number>,      // aggregate per-dimension scores
  composite: number,                    // weighted aggregate
  ranking: string[],                    // item IDs, highest salience first
  itemScores: Array<{
    itemId: string,
    scores: Record<string, number>,
    composite: number,
    reasoning?: string
  }>
}
```

### Default dimensions

- **goalRelevance**: How relevant to the current active goal
- **recency**: How recently introduced
- **novelty**: How new or unexpected relative to baseline
- **emotionalWeight**: Emotional significance

You can override dimensions and weights:

```ts
attention.scoreSalience({
  name: 'custom-salience',
  dimensions: {
    goalRelevance: 'How much does this advance the goal?',
    risk: 'How risky or sensitive is this?',
  },
  weights: {
    goalRelevance: 0.7,
    risk: 0.3,
  },
})
```

### Example usage

```ts
import { sequencer } from '@flow-state-dev/core'
import { attention } from '@thought-fabric/core'

const salienceBlock = attention.scoreSalience({
  name: 'rank-memories',
  model: 'gpt-5-mini',
})

const pipeline = sequencer({
  name: 'prioritize',
  inputSchema: z.object({
    items: z.array(z.union([z.string(), z.object({ id: z.string(), content: z.string() })]))
      .min(1),
    activeGoal: z.string().optional(),
  }),
})
  .then(salienceBlock)
  .then((ctx, output) => {
    // output.ranking = ["item-3", "item-1", "item-2"]
    // output.itemScores has per-item scores and optional reasoning
    return useRankedItems(output)
  })
```

## Combining both blocks

Two patterns work well.

**Filter first, then score.** Cheap heuristic filter cuts noise before the LLM sees anything. Score only what passed.

```ts
import { handler, sequencer } from '@flow-state-dev/core'
import { attention } from '@thought-fabric/core'

const filterBlock = attention.filterRelevance({
  name: 'pre-filter',
  mode: 'hard',
  threshold: 0.6,
})

const salienceBlock = attention.scoreSalience({
  name: 'rank-survivors',
  model: 'gpt-5-mini',
})

const inputSchema = z.object({
  task: z.string(),
  items: z.array(z.union([z.string(), z.object({ id: z.string(), content: z.string() })])),
})

const adaptToSalience = handler({
  name: 'adapt-to-salience',
  inputSchema: z.any(),
  outputSchema: z.object({ items: z.array(z.any()).min(1) }),
  execute: (out) => ({ items: out.items }),
})

const pipeline = sequencer({ name: 'filter-then-score', inputSchema })
  .then(filterBlock)
  .then(adaptToSalience)
  .then(salienceBlock)
```

**Score first, then filter.** More expensive but finer control. The salience block adds `scores` and `composite` to each item. When those items flow into `filterRelevance`, it uses the LLM scores instead of recomputing keyword overlap. You need to map salience output back to filter input format. The trick: the original items (with content) live in the pipeline input. Store them in session state before salience, or use a wrapper sequencer that keeps both in scope. See the working-memory guide for session resource patterns.

## Tradeoffs

| Block | Pros | Cons |
|-------|------|------|
| `filterRelevance` | Fast, deterministic, no API cost | Keyword-based only, no semantic understanding |
| `scoreSalience` | Nuanced, task-aware, multi-dimensional | Requires LLM, latency and cost |

Use `filterRelevance` when you need cheap, reproducible filtering. Use `scoreSalience` when you need to weigh recency, novelty, or emotional weight. Combine them when you want both nuance and a hard cutoff.

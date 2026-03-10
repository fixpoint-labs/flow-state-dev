# @thought-fabric/core

**Cognitive architecture primitives for AI agents. Attention, memory, identity, and more.**

`@thought-fabric/core` provides general-purpose cognitive domains that shape how AI agents perceive, remember, reason, and act. Each domain is a namespace you import by name.

## Status

This package is in Wave 1 foundation mode.

| Domain | Namespace | Status |
|--------|-----------|--------|
| Attention | `attention` | Salience scoring + relevance filtering implemented |
| Memory | `memory` | Scaffold |
| Identity | `identity` | Scaffold |
| Perception | — | Wave 2+ |
| Reasoning | — | Wave 2+ |
| Metacognition | — | Wave 3+ |
| Learning | — | Wave 4+ |

## Usage

```ts
import { attention } from '@thought-fabric/core'

const salienceBlock = attention.scoreSalience({
  name: 'task-salience'
})

const filterBlock = attention.filterRelevance({
  name: 'reasoning-filter',
  mode: 'hard',
  threshold: 0.6
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

- `workingMemory(config?)` — Placeholder (not implemented)

### Identity

- `constitution(config)` — Placeholder (not implemented)
- `perspective(config)` — Placeholder (not implemented)

## Dependencies

- `@flow-state-dev/core` (peer dependency)
- `zod` (direct dependency)

## Scripts

```bash
pnpm --filter @thought-fabric/core build
pnpm --filter @thought-fabric/core typecheck
pnpm --filter @thought-fabric/core test
```

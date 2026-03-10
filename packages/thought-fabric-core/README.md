# @thought-fabric/core

**Cognitive architecture primitives for AI agents. Attention, memory, identity, and more.**

`@thought-fabric/core` provides the general-purpose cognitive domains that shape how AI agents perceive, remember, reason, and act. Each domain is a namespace you import by name.

## Status

This package is in early scaffold phase. All domain functions are placeholders that throw `Not implemented`. Real implementations arrive in Wave 2+.

## Domains

| Domain | Namespace | Status |
|--------|-----------|--------|
| Attention | `attention` | Scaffold (Wave 2) |
| Memory | `memory` | Scaffold (Wave 2) |
| Identity | `identity` | Scaffold (Wave 2) |
| Perception | — | Wave 2+ |
| Reasoning | — | Wave 2+ |
| Metacognition | — | Wave 3+ |
| Learning | — | Wave 4+ |

## Usage

```ts
import { attention, memory, identity } from '@thought-fabric/core'

const salience = attention.scoreSalience({ content: '...', context: '...' })
const wm = memory.workingMemory({ capacity: 10 })
const values = identity.constitution({ values: ['honesty', 'clarity'] })
```

## Exports

### Main (`@thought-fabric/core`)

**Attention:**
- `scoreSalience(input)` — Score how salient content is given a context
- `filterRelevance(input)` — Filter items by relevance to a query

**Memory:**
- `workingMemory(config?)` — Create a working memory instance for short-term context

**Identity:**
- `constitution(config)` — Define values and constraints that guide agent behavior
- `perspective(config)` — Define a role and expertise that shape interpretation

## Dependencies

- `@flow-state-dev/core` (peer dependency)

## Scripts

```bash
pnpm --filter @thought-fabric/core build
pnpm --filter @thought-fabric/core typecheck
pnpm --filter @thought-fabric/core test
```

## Architecture

Specialist domains (e.g., `@thought-fabric/quant`, `@thought-fabric/product-management`) ship as separate packages under the same `@thought-fabric` npm scope, starting in Wave 5+.

See `docs/architecture/overview.md` for the broader system architecture.

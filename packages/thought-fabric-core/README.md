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
| Metacognition | `metacognition` | Bias & sycophancy detection |
| Learning | — | Wave 4+ |

## Usage

```ts
import {
  workingMemoryCapture,
  workingMemoryResources,
  workingMemoryContextFormatter,
} from '@thought-fabric/core/memory'
import { sequencer, generator } from '@flow-state-dev/core'

// One-line working memory capture
const memoryCapture = workingMemoryCapture({ model: 'gpt-5-mini' })

// Add to a pipeline — capture runs on the user's message in the background
// while the rest of the pipeline continues
const pipeline = sequencer({ name: 'chat', inputSchema: chatInput })
  .work((input) => input.message, memoryCapture)
  .then(chatGenerator)

// Inject memory into a generator's context
const chat = generator({
  name: 'chat',
  model: 'gpt-5',
  inputSchema: z.string(),
  sessionResources: workingMemoryResources,
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
| Resource | `workingMemory[Noun]` | `workingMemoryResource`, `workingMemoryResources` |
| Schema | `workingMemory[Noun]Schema` | `workingMemoryEntrySchema` |
| Formatter | `workingMemory[Noun]Formatter` | `workingMemoryContextFormatter` |
| Accessor | `workingMemory[Noun]` | `workingMemoryItems` |
| Helper | `[verb]WorkingMemory` | `addWorkingMemory`, `advanceWorkingMemory` |
| Pure math | no prefix | `computeDecay`, `computeSalience` |

The inversion is the signal: `workingMemoryAdd` is a block (a thing you compose in a pipeline). `addWorkingMemory` is a helper (an action on a resource ref). The English reads naturally either way.

## Working Memory Exports

All exports from `@thought-fabric/core/memory` related to working memory:

| Export | Kind | Description |
|--------|------|-------------|
| **Block factories** | | |
| `workingMemoryCapture(config?)` | sequencer | Bundled observe → remember → tick pipeline. Input: `z.string()`. |
| `workingMemoryObserve(config?)` | generator | LLM-based memory extraction. Returns structured observations. |
| `workingMemoryRemember(config?)` | handler | Persists observations into the resource. Handles `replaces` eviction. |
| `workingMemoryTick(config?)` | handler | Advances the decay clock and recomputes salience. Use with `.tap()`. |
| `workingMemorySnapshot()` | handler | Returns current entries sorted by salience + turn counter. |
| `workingMemoryAdd(config?)` | handler | Directly add an entry without LLM extraction. |
| **Resource** | | |
| `workingMemoryResource` | resource definition | Session-scoped resource definition for working memory state. |
| `workingMemoryResources` | pre-keyed object | `{ workingMemory: workingMemoryResource }` — use in `sessionResources`. |
| **Helpers** | | |
| `addWorkingMemory(ref, entry, config?)` | helper | Add entry with auto-eviction at capacity. |
| `evictWorkingMemory(ref, id)` | helper | Remove by ID (overrides pin). |
| `pinWorkingMemory(ref, id, config?)` | helper | Pin an entry to protect from eviction. |
| `unpinWorkingMemory(ref, id)` | helper | Remove pin protection from an entry. |
| `refreshWorkingMemory(ref, id, config?)` | helper | Reset access time (access boost). |
| `advanceWorkingMemory(ref, config?)` | helper | Advance turn counter, recompute salience. |
| **Accessors & formatters** | | |
| `workingMemoryItems(ref)` | accessor | Entries sorted by salience descending. |
| `formatWorkingMemoryEntries(ref)` | helper | Bullet list for LLM context (no scores or IDs). |
| `workingMemoryContextFormatter(input, ctx)` | formatter | Ready-made `context:` slot for generators. |
| **Schemas** | | |
| `workingMemoryEntrySchema` | Zod schema | Schema for a single working memory entry. |
| `workingMemoryStateSchema` | Zod schema | Schema for the full working memory state. |
| `workingMemoryObservationsSchema` | Zod schema | Schema for observe block output. |
| **Config** | | |
| `DEFAULT_WORKING_MEMORY_CONFIG` | const | Default capacity (7), maxPinnedSlots (2), decay (power-law, 0.5). |
| `computeDecay(elapsed, strategy, rate)` | pure function | ACT-R power-law, exponential, or none. |
| `computeSalience(entry, currentTurn, decay)` | pure function | `importance × decay(elapsed)`, clamped to [0, 1]. |
| **Types** | | |
| `WorkingMemoryEntry` | type | A single working memory entry. |
| `WorkingMemoryState` | type | Full state: entries + turn counter. |
| `DecayStrategy` | type | `'power-law' \| 'exponential' \| 'none'` |
| `WorkingMemoryDecayConfig` | type | Decay strategy + rate. |
| `WorkingMemoryHelperConfig` | type | Capacity, maxPinnedSlots, decay. |
| `AddEntryInput` | type | Input for adding an entry (content, importance, pinned?, id?, metadata?). |
| `Observations` | type | Inferred type from `workingMemoryObservationsSchema`. |
| `WorkingMemoryBlockConfig` | type | Base config shared by all working memory blocks. |
| `WorkingMemoryCaptureConfig` | type | Config for the capture sequencer. |
| `WorkingMemoryObserveConfig` | type | Config for the observe generator. |

## Attention Exports

- `scoreSalience(config)` → generator `BlockDefinition`
  - Dimension-based salience scoring with configurable weights
  - Default dimensions: `goalRelevance`, `recency`, `novelty`, `emotionalWeight`
  - Output includes per-dimension scores, composite score, per-item scoring, and ranking
- `filterRelevance(config)` → handler `BlockDefinition`
  - Deterministic relevance filtering against criteria
  - `hard` mode returns filtered items only
  - `soft` mode returns all items annotated with relevance scores
  - Uses pre-scored signals when available, with keyword-overlap fallback for raw strings

## Identity

- `constitution(config)` — Placeholder (not implemented)
- `perspective(config)` — Placeholder (not implemented)

## Metacognition Exports

All exports from `@thought-fabric/core/metacognition`:

### Bias & Sycophancy Detection

Analyzes AI responses for agreement bias, sycophantic patterns, and cognitive biases. Produces structured audit results with counter-arguments when bias exceeds threshold.

```ts
import { biasAnalyzer } from '@thought-fabric/core/metacognition'

// Full pipeline: detect → classify → score → counterpoint → format
const audit = biasAnalyzer({ model: 'preset/fast' })

// Standalone usage
const result = await audit.run({
  userInput: 'I think we should use microservices',
  aiResponse: 'Great idea! Microservices are definitely the best approach...',
}, ctx)

// result.score: 0.72
// result.label: 'sycophantic'
// result.counterArguments: [{ claim: '...', counterpoint: '...', strength: 0.8 }]
```

| Export | Kind | Description |
|--------|------|-------------|
| **Block factories** | | |
| `biasAnalyzer(config?)` | sequencer | Bundled pipeline: detect → classify → score → counterpoint → format. |
| `biasDetectAgreement(config?)` | generator | Detects agreement patterns across four dimensions. |
| `biasClassify(config?)` | generator | Classifies six cognitive bias types with per-type confidence. |
| `biasScore(config?)` | handler | Computes composite sycophancy score from dimensions + biases. |
| `biasCounterpoint(config?)` | generator | Generates substantive counter-arguments for biased responses. |
| `biasFormat()` | handler | Maps accumulated data to AnalyzerResult output schema. |
| **Schemas** | | |
| `biasAnalyzerInputSchema` | Zod schema | `{ userInput: string, aiResponse: string }` |
| `biasAnalyzerOutputSchema` | Zod schema | Full output conforming to AnalyzerResult contract. |
| `biasTypeSchema` | Zod enum | Six bias types: sycophancy, confirmation, anchoring, authority, recency, false consensus. |
| `biasAnnotationSchema` | Zod schema | Per-bias annotation with type, confidence, description, evidence. |
| `counterArgumentSchema` | Zod schema | Counter-argument with claim, counterpoint, strength, sources. |
| `sycophancyScoreSchema` | Zod schema | Composite score with label and four-dimension breakdown. |
| `analyzerResultSchema` | Zod schema | Generic AnalyzerResult contract (FIX-307 forward declaration). |
| **Helpers** | | |
| `labelForSycophancyScore(score)` | pure function | Maps score [0,1] to label: balanced / mild_bias / moderate_bias / sycophantic. |
| `severityForSycophancyScore(score)` | pure function | Maps score to severity: info / warning / critical. |
| `computeCompositeSycophancyScore(breakdown, biases, config?)` | pure function | Weighted composite from dimensions + bias confidence. |
| `shouldGenerateCounterpoints(score, threshold?)` | pure function | Whether score warrants counter-argument generation. |
| `summarizeBiasFindings(score, label, biases)` | pure function | Human-readable summary string. |
| **Config** | | |
| `DEFAULT_BIAS_ANALYZER_CONFIG` | const | Default threshold (0.4), dimension weights, bias confidence weight. |

### Score Thresholds

| Score Range | Label | Severity | Counter-arguments |
|---|---|---|---|
| 0.0 - 0.2 | `balanced` | info | No |
| 0.2 - 0.4 | `mild_bias` | info | No |
| 0.4 - 0.7 | `moderate_bias` | warning | Yes |
| 0.7 - 1.0 | `sycophantic` | critical | Yes |

## Dependencies

- `@flow-state-dev/core`
- `zod` (direct dependency)

## Scripts

```bash
pnpm --filter @thought-fabric/core build
pnpm --filter @thought-fabric/core typecheck
pnpm --filter @thought-fabric/core test
```

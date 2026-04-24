# @thought-fabric/core

**Cognitive architecture primitives for AI agents. Attention, memory, identity, and more.**

`@thought-fabric/core` provides general-purpose cognitive domains that shape how AI agents perceive, remember, reason, and act. Each domain is a namespace you import by name.

## Status

This package is in Wave 1 foundation mode.

| Domain | Namespace | Status |
|--------|-----------|--------|
| Attention | `attention` | Salience scoring + relevance filtering implemented |
| Memory | `memory` | Working memory implemented |
| Identity | `identity` | Perspective (static + resource-backed + capability); Constitution scaffold |
| Perception | — | Wave 2+ |
| Reasoning | — | Wave 2+ |
| Metacognition | `metacognition` | Bias & sycophancy detection |
| Learning | — | Wave 4+ |

## Usage

### Capability-based (recommended)

The memory system exposes `defineCapability()`-based surfaces. Declare `uses: [...]` on a block to auto-install resources and gain typed helpers via `ctx.cap.*`.

```ts
import { system as memorySystem, workingMemoryCapability } from '@thought-fabric/core/memory'
import { handler, generator, sequencer } from '@flow-state-dev/core'

// Full system — working + episodic + semantic
const mem = memorySystem({
  model: 'preset/fast',
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
})

// Generator: auto-installs resources, context formatter, and typed helpers
const chat = generator({
  name: 'chat',
  model: 'preset/fast',
  uses: [mem.capability],
  user: (input) => input,
})

// Handler: disable context preset (generator-only), use helpers via ctx.cap
const myHandler = handler({
  name: 'remember',
  uses: [mem.capability.presets({ context: false })],
  execute: async (input, ctx) => {
    await ctx.cap.workingMemory.add({ content: 'User likes TypeScript', importance: 0.8 })
    const items = ctx.cap.memory.recall()
  },
})

// Pipeline with background capture
const pipeline = sequencer({ name: 'chat', inputSchema })
  .then(chat)
  .work(mem.captureFromItems)
```

Individual tier capabilities can also be used standalone:

```ts
// Just working memory — no episodic or semantic
const myBlock = handler({
  name: 'wm-only',
  uses: [workingMemoryCapability],
  execute: async (input, ctx) => {
    await ctx.cap.workingMemory.add({ content: 'fact', importance: 0.7 })
    const entries = ctx.cap.workingMemory.items()
  },
})
```

### Imperative usage (low-level)

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

## Memory Capability Exports

Capability-based surfaces for the memory subsystems.

| Export | Kind | Description |
|--------|------|-------------|
| **Capabilities** | | |
| `workingMemoryCapability` | capability | Default working memory capability (capacity 7, power-law decay). |
| `createWorkingMemoryCapability(config?)` | factory | Custom working memory capability. |
| `episodicMemoryCapability` | capability | Default episodic memory capability (user-scoped, 200 max). |
| `createEpisodicMemoryCapability(config?)` | factory | Custom episodic memory capability. |
| `semanticMemoryCapability` | capability | Default semantic memory capability (user-scoped). |
| `createSemanticMemoryCapability(config?)` | factory | Custom semantic memory capability. |
| **Via `memory.system()`** | | |
| `mem.capability` | capability | Composed capability (all configured tiers). Context preset for generators. |
| `mem.workingMemoryCapability` | capability | Working memory tier from this system instance. |
| `mem.episodicMemoryCapability?` | capability | Episodic tier (if configured). |
| `mem.semanticMemoryCapability?` | capability | Semantic tier (if configured). |
| **Capability helpers (`ctx.cap.*`)** | | |
| `ctx.cap.workingMemory.add(entry)` | helper | Add entry with auto-eviction. |
| `ctx.cap.workingMemory.evict(id)` | helper | Remove entry by ID. |
| `ctx.cap.workingMemory.pin(id)` | helper | Pin entry. |
| `ctx.cap.workingMemory.unpin(id)` | helper | Unpin entry. |
| `ctx.cap.workingMemory.refresh(id)` | helper | Refresh access time. |
| `ctx.cap.workingMemory.tick()` | helper | Advance turn counter. |
| `ctx.cap.workingMemory.items()` | helper | Get entries sorted by salience. |
| `ctx.cap.workingMemory.format()` | helper | Format for LLM context. |
| `ctx.cap.episodicMemory.encode(episode)` | helper | Encode a new episode. |
| `ctx.cap.episodicMemory.recent(limit?)` | helper | Get recent episodes. |
| `ctx.cap.episodicMemory.markConsolidated(ids)` | helper | Mark as consolidated. |
| `ctx.cap.semanticMemory.addFact(fact)` | helper | Add semantic fact. |
| `ctx.cap.semanticMemory.updateFact(...)` | helper | Update fact content. |
| `ctx.cap.semanticMemory.reinforce(...)` | helper | Reinforce a fact. |
| `ctx.cap.semanticMemory.removeFact(id)` | helper | Remove a fact. |
| `ctx.cap.semanticMemory.allFacts(subject?)` | helper | Get all facts. |
| `ctx.cap.semanticMemory.query(q, limit?, subject?)` | helper | Query by keyword. |
| `ctx.cap.memory.recall(cue?)` | helper | Cross-store recall (composed capability only). |
| **Types** | | |
| `EpisodicMemoryCapabilityConfig` | type | Config for episodic capability factory. |
| `SemanticMemoryCapabilityConfig` | type | Config for semantic capability factory. |
| `AddSemanticFactInput` | type | Input for adding a semantic fact via capability. |

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

## Identity Exports

All exports from `@thought-fabric/core/identity`:

### Perspective

Adoptable viewpoint models that give AI systems the ability to reason from genuinely different analytical positions. A perspective encodes what to amplify and suppress (salience), how to reason (priorities, risk model), domain expertise, and communication style.

```ts
import { perspective, perspectiveAnalyze } from '@thought-fabric/core/identity'

const securityEngineer = perspective({
  name: 'security-engineer',
  description: 'Evaluates through the lens of system security and threat modeling',
  salience: {
    amplify: ['authentication concerns', 'data exposure risks'],
    suppress: ['UI/UX considerations', 'marketing positioning'],
  },
  reasoning: {
    priorities: ['threat surface minimization', 'defense in depth'],
    riskModel: 'Assumes adversarial actors. Evaluates worst-case scenarios.',
  },
  expertise: ['OWASP Top 10', 'Zero-trust architecture'],
})

// Analyze content through the perspective's lens
const analysis = perspectiveAnalyze({
  perspective: securityEngineer,
  model: 'gpt-5',
})

const result = await analysis.run(
  { content: 'Feature proposal: add public file sharing...' },
  ctx,
)
// result.analysis, result.salienceNotes, result.recommendations
```

| Export | Kind | Description |
|--------|------|-------------|
| **Factory** | | |
| `perspective(config)` | factory | Creates a frozen, validated perspective instance. |
| **Block factories** | | |
| `perspectiveAuditor(config)` | sequencer | Bundled pipeline: apply → analyze. |
| `perspectiveAnalyze(config)` | generator | LLM-based analysis through the perspective's lens. |
| `perspectiveApply(config)` | handler | Wraps content with perspective framing for downstream generators. |
| **Schemas** | | |
| `perspectiveConfigSchema` | Zod schema | Full perspective configuration. |
| `perspectiveSalienceSchema` | Zod schema | `{ amplify: string[], suppress: string[] }` |
| `perspectiveReasoningSchema` | Zod schema | `{ priorities: string[], riskModel?: string, successCriteria?: string }` |
| `perspectiveCommunicationSchema` | Zod schema | `{ tone?, emphasis?, evidencePreference? }` |
| `perspectiveAnalysisSchema` | Zod schema | Output: perspectiveName, analysis, salienceNotes, recommendations, confidence. |
| `perspectiveInputSchema` | Zod schema | `{ content: string, context?: string }` |
| `perspectiveApplyOutputSchema` | Zod schema | `{ content, perspectiveFrame, perspectiveName }` |
| **Helpers** | | |
| `formatPerspective(instance)` | pure function | Full perspective formatted for LLM system prompt. |
| `formatPerspectiveSalience(salience)` | pure function | Salience section only. |
| `formatPerspectiveReasoning(reasoning)` | pure function | Reasoning section only. |
| `summarizePerspective(instance)` | pure function | One-line summary for logging and trace labels. |
| `perspectiveContextFormatter(instance)` | factory | Returns a `context:` slot formatter bound to a perspective. |
| **Types** | | |
| `PerspectiveConfig` | type | Input to the `perspective()` factory. |
| `PerspectiveInstance` | type | Frozen, validated perspective (returned by factory). |
| `PerspectiveSalience` | type | Salience model: amplify + suppress. |
| `PerspectiveReasoning` | type | Reasoning config: priorities, risk model, success criteria. |
| `PerspectiveCommunication` | type | Communication style preferences. |
| `PerspectiveAnalysis` | type | Structured analysis output. |
| `PerspectiveBlockConfig` | type | Config for handler-based blocks. |
| `PerspectiveAnalyzeConfig` | type | Config for generator-based blocks (adds `model`). |

#### Resource-backed state (capability + system factory)

The static blocks above are stateless — useful as one-shot prompt shapers. For perspectives that accumulate over a session (observations recorded, positions reached, conclusions challenged), use the capability or the `system()` bundle factory. Both are additive on top of the static foundation: the frozen `PerspectiveInstance` remains the initial configuration, and two session/user/project-scoped resources hold evolving state.

```ts
import { perspective, system } from '@thought-fabric/core/identity'
import { defineFlow, generator, handler, sequencer } from '@flow-state-dev/core'

const securityEngineer = perspective({ ... })

// Bundle: pre-configured blocks + capability + helpers
const sec = system(securityEngineer, {
  positionScope: 'user', // positions persist across sessions for the user
  model: 'gpt-5',
})

// Declarative capability use: auto-installs resources, context, and helpers
const chat = generator({
  name: 'chat',
  model: 'gpt-5',
  uses: [sec.capability],
  user: (input) => input,
  // Gets static framing + accumulated observations/positions injected as context,
  // and ctx.cap.perspective.* typed helpers.
})

// Handler that records observations — opt out of context presets
const observe = handler({
  name: 'capture-findings',
  uses: [sec.capability.presets({ static: false, accumulated: false })],
  execute: async (input, ctx) => {
    await ctx.cap.perspective.observe({
      content: 'Auth endpoint lacks rate limiting',
      category: 'concern',
      confidence: 0.9,
    })
  },
})

// Or use the bundled capture sequencer (analyze → observe)
const pipeline = sequencer({ name: 'review' })
  .work((input) => ({ content: input.proposal }), sec.capture)
  .then(nextBlock)

// Wire resources in the flow
const flow = defineFlow({
  // ...
  session: { resources: { ...sec.sessionResources, ...otherSession } },
  user: { resources: { ...sec.userResources, ...otherUser } },
})
```

**Capability presets:**
- `static` (default on) — initial perspective framing (role, salience, reasoning, expertise)
- `accumulated` (default on) — observations + positions formatted from the resources

Disable either via `cap.presets({ accumulated: false })` when token budget is tight.

| Export | Kind | Description |
|--------|------|-------------|
| **Capability + system** | | |
| `createPerspectiveCapability(instance, config?)` | factory | Returns a capability bound to a perspective instance with configurable position scope. |
| `system(instance, config?)` | factory | Full bundle: pre-configured blocks, `capture` sequencer, capability, helpers, resource declarations. |
| **Stateful blocks** | | |
| `perspectiveObserve(config)` | handler | Records observations. Accepts a `PerspectiveAnalysis` (promotes `salienceNotes`) or an explicit batch. |
| `perspectivePosition(config)` | handler | Records a position (claim + reasoning) tied to supporting observation IDs. |
| `perspectiveChallenge(config)` | handler | Appends counter-evidence to an existing position. |
| `perspectiveSnapshot(config)` | handler | Reads current observations + positions + turn counter. |
| `perspectiveAdvance(config)` | handler | Bumps the observation turn counter. Designed for `.tap()`. |
| **Resources** | | |
| `perspectiveObservationsResource` | resource | Session-scoped singleton (observations always live here). |
| `perspectivePositionsResource` | resource | Session-scoped default (used for standalone block use). |
| `createPerspectivePositionsResource(scope)` | factory | Returns a positions resource for `'session' \| 'user' \| 'project'` scope. |
| **Schemas (Phase B)** | | |
| `perspectiveObservationSchema` | Zod schema | `{ id, content, category, confidence, source?, addedAt }` |
| `perspectiveObservationsStateSchema` | Zod schema | `{ observations[], turnCounter }` |
| `perspectivePositionSchema` | Zod schema | `{ id, claim, reasoning, confidence, supportingObservations[], challenges[], addedAt }` |
| `perspectivePositionsStateSchema` | Zod schema | `{ positions[] }` |
| `perspectivePositionChallengeSchema` | Zod schema | `{ evidence, addedAt }` |
| **Helpers (Phase B)** | | |
| `addPerspectiveObservation(ref, input)` | helper | Record an observation with auto-generated id + turn stamp. |
| `removePerspectiveObservation(ref, id)` | helper | Remove by id. |
| `perspectiveObservations(ref, category?)` | accessor | Read observations (optionally filtered by category). |
| `advancePerspectiveObservations(ref)` | helper | Bump turn counter. |
| `formatPerspectiveObservations(ref)` | helper | Format grouped by category. |
| `addPerspectivePosition(ref, input, obsRef?)` | helper | Record a position. |
| `challengePerspectivePosition(ref, id, evidence, obsRef?)` | helper | Append counter-evidence. |
| `removePerspectivePosition(ref, id)` | helper | Remove by id. |
| `perspectivePositions(ref)` | accessor | Read positions in insertion order. |
| `formatPerspectivePositions(ref)` | helper | Numbered list with reasoning + challenges. |
| `formatPerspectiveAccumulated(obsRef, posRef?)` | helper | Combined observations + positions. |
| **Types (Phase B)** | | |
| `PerspectiveObservation` | type | A single recorded observation. |
| `PerspectivePosition` | type | A recorded position with challenges. |
| `PositionScope` | type | `'session' \| 'user' \| 'project'` |
| `PerspectiveSystem` | type | Return type of `system()`. |
| `PerspectiveCapability` | type | Return type of `createPerspectiveCapability()`. |

### Constitution

- `constitution(config)` — Placeholder (not implemented)

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

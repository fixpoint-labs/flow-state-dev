# @thought-fabric/core

**Cognitive architecture primitives for AI agents. Attention, memory, identity, and more.**

`@thought-fabric/core` provides general-purpose cognitive domains that shape how AI agents perceive, remember, reason, and act. Each domain is a namespace you import by name.

## Status

This package is in Wave 1 foundation mode.

| Domain | Namespace | Status |
|--------|-----------|--------|
| Attention | `attention` | Salience scoring + relevance filtering implemented |
| Memory | `memory` | Working memory implemented |
| Identity | `identity` | Constitution + Perspective (static + resource-backed + capability) |
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

// Full system — working + episodic + semantic + digest
const mem = memorySystem({
  model: 'preset/fast',
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
  digest: true,   // narrative summary, regenerates with consolidation/prune
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
| `digestMemoryCapability` | capability | Default digest memory capability (user-scoped). |
| `createDigestMemoryCapability(config?)` | factory | Custom digest memory capability. |
| **Via `memory.system()`** | | |
| `mem.capability` | capability | Composed capability (all configured tiers). Context preset for generators. |
| `mem.workingMemoryCapability` | capability | Working memory tier from this system instance. |
| `mem.episodicMemoryCapability?` | capability | Episodic tier (if configured). |
| `mem.semanticMemoryCapability?` | capability | Semantic tier (if configured). |
| `mem.digestMemoryCapability?` | capability | Digest tier (if configured). |
| `mem.regenerateDigest?` | block | Manual digest regeneration (force-runs regardless of staleness). |
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
| `ctx.cap.digestMemory.get()` | helper | Read the current digest object (or `undefined`). |
| `ctx.cap.digestMemory.content()` | helper | Read the digest narrative string. |
| `ctx.cap.memory.recall(cue?)` | helper | Cross-store recall (composed capability only). |
| **Types** | | |
| `EpisodicMemoryCapabilityConfig` | type | Config for episodic capability factory. |
| `SemanticMemoryCapabilityConfig` | type | Config for semantic capability factory. |
| `DigestMemoryCapabilityConfig` | type | Config for digest capability factory. |
| `AddSemanticFactInput` | type | Input for adding a semantic fact via capability. |

### Digest tier

The digest is a single LLM-generated narrative paragraph that summarises stable knowledge about the user — the framing layer above atomic semantic facts. It regenerates as a side-effect of `consolidate` and `prune` when the underlying stores have actually changed (the `sourceSignature` short-circuit prevents wasted LLM calls), and is bounded by `maxTokens` (default 400).

```ts
const mem = memorySystem({
  model: 'preset/fast',
  working: { capacity: 7 },
  episodic: true,
  semantic: true,
  digest: { maxTokens: 400, topN: { facts: 30, episodes: 10 } },
})

// Manual regeneration (e.g. after bulk-loading memory in setup):
await runForTest(mem.regenerateDigest!, undefined as any, ctx)

// Read it from a block:
const text = ctx.cap.digestMemory.content()
```

The digest's scope is inherited from `semantic` — there is no separate `digest.scope` knob.

### Model selection and fallback chains

Every memory generator (observe, consolidate, prune) defaults to the top-level `model`. Two knobs exist for tuning:

- **Fallback chains** — `model` accepts a `string[]` in addition to a single id. The framework wires the array into a fallback chain (via `createFallbackModel`), walking the list on retryable provider errors.
- **Per-block overrides** — `consolidationModel` and `pruneModel` override `model` for those generators only. Consolidation has heavier structured-output demands than the observer, so a stronger primary with a cheap fallback is a common configuration.

```ts
memorySystem({
  model: 'gpt-5-mini',                          // observer default
  consolidationModel: ['gpt-5', 'gpt-5-mini'],  // primary with fallback
  pruneModel: 'gpt-5',                          // override for prune only
  working: true,
  episodic: true,
  semantic: true,
})
```

The recall tool uses a single model id (no fallback chain support yet). When `model` is an array, the recall tool defaults to the first entry; pass `tool.model` to override explicitly.

The consolidation and prune generators also include a `repairOutput` hook that re-shapes common LLM mis-shapes (bare arrays, narrative text wrapping a JSON block, missing array keys) back into the expected envelope before the schema re-validates — so structured-output drift on smaller models doesn't surface as a step error on the first hiccup.

## Memory Recall Tool

Agent-invocable search over stored memory (semantic facts + past episodes). Working memory is intentionally excluded — it lives in the formatter.

```ts
const mem = memorySystem({ model: 'gpt-5', working: true, episodic: true, semantic: true })

generator({
  // ...
  uses: [mem.capability],
  tools: [mem.tool.recall()],
})
```

The agent calls `recall({ query, limit?, sinceTurn? })` and gets a ranked envelope with `{ results, query, strategy, totalMatched, truncatedTo }`. Each result carries `source` (`'semantic' | 'episodic'`), per-source `metadata`, and a per-item char cap (default 400) with a truncation marker when triggered.

The model-visible representation of a recall result is a compact summary (`formatRecallSummary`) installed via [`mapModelOutput`](https://flowstatedev.com/sequencers/connectors#model-visible-tool-output-mapmodeloutput). The LLM sees one bulleted line per result; the structured `RecallToolResult` keeps flowing through `block_tool_output` items, the devtool, tests, and history replay. Consumers building custom recall variants can reuse `formatRecallSummary` from `@thought-fabric/core/memory`.

Strategy is pluggable. Default `'llm-filter'` does a query-blind intrinsic pre-rank (top 50) plus a single LLM filter call. Configure at system time:

```ts
memorySystem({
  // ...
  tool: { strategy: 'llm-filter', model: 'gpt-5-mini', defaults: { limit: 5, perItemCharCap: 400 } },
})
```

Custom strategies implement the `RetrievalStrategy` interface. See [`apps/docs/thought-fabric/memory.md`](https://flowstatedev.com/thought-fabric/memory) for details.

| Export | Kind | Description |
|--------|------|-------------|
| `mem.tool.recall()` | factory | Returns the recall handler block, ready to install on a generator. |
| `createRecallTool(opts)` | factory | Lower-level: build the tool with a custom strategy. |
| `createLlmFilterStrategy(opts)` | factory | The default V1 strategy. |
| `resolveStrategy(ref, opts)` | helper | Resolve a built-in name or strategy object. |
| `recallToolDescription` | string | Tool description shown to the LLM. |
| `recallToolInputSchema` | zod | Input schema for `recall(...)`. |
| `RetrievalStrategy` | interface | Pluggable retrieval backend contract. |
| `MemoryItem`, `RankedResult`, `RecallToolResult` | types | Tool surface types. |

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

### Constitution

Ranked principle hierarchies with explicit conflict resolution. A constitution defines what the system stands for. When principles conflict, the constitution provides a structured resolution strategy — strict priority ordering, weighted balancing, or context-dependent overrides.

```ts
import { constitution, constitutionAuditor } from '@thought-fabric/core/identity'

// Define a constitution
const values = constitution({
  name: 'advisor-values',
  principles: [
    { id: 'accuracy', statement: 'Provide accurate, well-sourced information', priority: 1, rationale: 'Trust is foundational' },
    { id: 'clarity', statement: 'Communicate clearly', priority: 2 },
    { id: 'brevity', statement: 'Be concise', priority: 3, rationale: 'Exhaustive does not mean effective' },
  ],
  conflictResolution: 'priority',
})

// Full pipeline: LLM review → deterministic enforcement
const auditor = constitutionAuditor({
  constitution: values,
  model: 'preset/fast',
})

// Standalone usage
const result = await auditor.run({ content: 'The response to evaluate...' }, ctx)
// result.compliant: true
// result.score: 0.88
// result.violations: []
// result.tradeoffs: [{ promoted: 'brevity', demoted: 'accuracy', reasoning: '...' }]

// As .tap() sidechain in a pipeline
const pipeline = sequencer({ name: 'chat-with-audit' })
  .then(chat)
  .tap(auditor)
```

Three conflict resolution modes:

| Mode | Description |
|------|-------------|
| `priority` | Lower number = higher priority. Strict ordering. Default. |
| `weighted` | Uses `weight` field on principles for composite scoring. All principles must have weights. |
| `contextual` | Rules-based overrides re-rank principles per situation. Requires `contextualOverrides`. |

| Export | Kind | Description |
|--------|------|-------------|
| **Config factory** | | |
| `constitution(config)` | factory | Creates a frozen `ConstitutionDefinition` from validated config. |
| **Block factories** | | |
| `constitutionAuditor(config)` | sequencer | Bundled pipeline: review → enforce. Primary entry point. |
| `constitutionReview(config)` | generator | LLM-evaluates content against constitution principles. |
| `constitutionEnforce(config)` | handler | Deterministic compliance scoring from review output. |
| **Schemas** | | |
| `constitutionConfigSchema` | Zod schema | Full constitution configuration. |
| `constitutionPrincipleSchema` | Zod schema | `{ id, statement, priority, rationale?, weight? }` |
| `constitutionReviewInputSchema` | Zod schema | `{ content: string, context?: string }` |
| `constitutionReviewOutputSchema` | Zod schema | Compliance verdict with per-principle results, violations, tradeoffs. |
| `constitutionViolationSchema` | Zod schema | `{ principleId, severity, description, evidence }` |
| `constitutionTradeoffSchema` | Zod schema | `{ promoted, demoted, reasoning }` |
| **Helpers** | | |
| `rankConstitutionPrinciples(constitution, context?)` | pure function | Sort principles by effective priority, applying contextual overrides. |
| `computeConstitutionCompliance(results, constitution)` | pure function | Weighted compliance score from per-principle results. |
| `formatConstitution(constitution)` | pure function | Human-readable string for LLM prompt injection. |
| `summarizeConstitutionReview(review)` | pure function | Human-readable summary of review findings. |
| **Config** | | |
| `DEFAULT_CONSTITUTION_CONFIG` | const | Default compliance threshold (0.7). |

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
| `perspectiveObservationsResource` | resource | Singleton; the capability and bundled blocks always declare it at session scope. |
| `perspectivePositionsResource` | resource | Singleton; scope is decided by where the capability or block declares it (session/user/project). |
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

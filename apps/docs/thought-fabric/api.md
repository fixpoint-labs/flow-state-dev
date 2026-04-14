---
sidebar_position: 6
---

# API Reference

Cognitive architecture primitives built on flow-state-dev. Provides attention, memory, identity, and metacognition domains for agentic workflows.

**Import:** Use subpath exports. `@thought-fabric/core/attention`, `@thought-fabric/core/memory`, `@thought-fabric/core/identity`, `@thought-fabric/core/metacognition`.

---

## attention

Relevance and salience for what the agent attends to.

### filterRelevance(config)

Handler block factory. Deterministic keyword-based relevance filtering. No LLM. Fast. Removes or annotates items below a threshold using keyword overlap heuristics.

```ts
import { filterRelevance } from "@thought-fabric/core/attention";

const block = filterRelevance({ name: "filter", criteria: { ... } });
```

Returns a `BlockDefinition` (handler). Use as a step in a sequencer or as a tool.

### scoreSalience(config)

Generator block factory. LLM-based salience scoring along configurable dimensions (goal relevance, recency, novelty, emotional weight).

```ts
import { scoreSalience } from "@thought-fabric/core/attention";

const block = scoreSalience({
  name: "salience",
  dimensions: { ... },
  weights: { ... },
  model: "preset/fast",
});
```

Returns a `BlockDefinition` (generator). Output schema: `scores`, `composite`, `ranking`, `itemScores`.

---

## memory

Three-tier memory: working (session), episodic (cross-session), and semantic (stable knowledge).

### Unified System

| Function | Purpose |
|----------|---------|
| `system(config)` | Factory that wires all three tiers. Returns `capture`, `captureFromItems`, `consolidate`, `prune`, `recall`, `contextFormatter`, and per-tier helpers. |

### Unified System Blocks

| Function | Kind | Purpose |
|----------|------|---------|
| `memorySystemCapture(config)` | sequencer | Full pipeline: observe → reflect → tick (+ consolidation + prune) |
| `memorySystemObserve(config)` | generator | LLM extraction with durability/category classification |
| `memorySystemReflect(config)` | handler | Routes observations to working, episodic, and semantic stores |
| `memorySystemTick(config)` | handler | Advances decay clock |
| `memorySystemConsolidate(config)` | sequencer | Guard → generate → persist consolidation pipeline |
| `memorySystemPrune(config)` | sequencer | Guard → generate → persist pruning pipeline |
| `pruneGuard(config)` | handler | Checks fact count against threshold |
| `pruneGenerate(config)` | generator | LLM identifies removals and merges |
| `prunePersist(config)` | handler | Applies removals and merges to semantic store |

### Working Memory Blocks

| Function | Kind | Purpose |
|----------|------|---------|
| `workingMemoryCapture(config?)` | sequencer | Standalone: observe → remember → tick |
| `workingMemoryObserve(config?)` | generator | LLM extraction. Output: observations array. |
| `workingMemoryRemember(config?)` | handler | Persist observations into the resource. |
| `workingMemoryTick(config?)` | handler | Advance decay clock, recompute salience. |
| `workingMemorySnapshot()` | handler | Read current entries and turn counter. |
| `workingMemoryAdd(config?)` | handler | Manual entry. No LLM extraction. |

### Resources

| Export | Scope | Purpose |
|--------|-------|---------|
| `workingMemoryResource` | session | Working memory resource definition |
| `workingMemoryResources` | session | Pre-keyed `{ workingMemory: workingMemoryResource }` |
| `memorySystemResource` | session | Tracking state (watermark, consolidation counters) |
| `createEpisodicMemoryResource(scope)` | user/project | Episodic memory resource factory |
| `createSemanticMemoryResource(scope)` | user/project | Semantic memory resource factory |

### Context

- `workingMemoryContextFormatter` — Context slot for generators (working memory only).
- `system().contextFormatter` — Cross-store context formatter (all tiers).

### Working Memory Helpers

| Function | Purpose |
|----------|---------|
| `addWorkingMemory` | Add entry with auto-eviction at capacity |
| `evictWorkingMemory` | Remove entry by ID |
| `pinWorkingMemory` / `unpinWorkingMemory` | Toggle pinned status |
| `refreshWorkingMemory` | Update lastAccessedAtTurn |
| `advanceWorkingMemory` | Tick decay, recompute salience for all entries |
| `workingMemoryItems` | Read entries sorted by salience |
| `formatWorkingMemoryEntries` | Format entries for LLM context |

### Episodic Memory Helpers

| Function | Purpose |
|----------|---------|
| `encodeEpisode` | Write a new episode |
| `recentEpisodes` | Get recent episodes |
| `markEpisodesConsolidated` | Mark episodes as processed by consolidation |

### Semantic Memory Helpers

| Function | Purpose |
|----------|---------|
| `addSemanticFact` | Add a new fact (subject defaults to `'user'`) |
| `updateSemanticFact` | Update existing fact content |
| `reinforceSemanticFact` | Increase confidence via reinforcement |
| `removeSemanticFact` | Remove a fact (invalidation) |
| `semanticFacts(ref, subject?)` | All facts, optionally filtered by subject |
| `querySemanticFacts(ref, q, limit?, subject?)` | Query facts by keyword overlap, optionally scoped to subject |
| `semanticCategoryEnum` | Zod enum of valid semantic categories |

### Config Defaults

| Constant | Contents |
|----------|----------|
| `DEFAULT_WORKING_MEMORY_CONFIG` | `capacity`, `maxPinnedSlots`, `decay` |
| `DEFAULT_EPISODIC_CONFIG` | `scope`, `significanceThreshold`, `maxEpisodes` |
| `DEFAULT_CONSOLIDATION_CONFIG` | `episodicThreshold`, `onEviction`, `minInterval` |
| `DEFAULT_PRUNE_CONFIG` | `pruneThreshold` |
| `DEFAULT_OBSERVER_CONFIG` | `maxAssistantChars` |

### Pure Math (no side effects)

- `computeDecay(elapsed, strategy, rate)` — Decay factor. Strategies: `power-law`, `exponential`, `none`.
- `computeSalience(entry, currentTurn, decay)` — `importance × decay(elapsed)`.

---

## metacognition

Bias detection, sycophancy scoring, and counter-argument generation.

**Import:** `@thought-fabric/core/metacognition`

### Blocks

| Function | Kind | Purpose |
|----------|------|---------|
| `biasAnalyzer(config?)` | sequencer | Bundled pipeline: detect → classify → score → counterpoint → format |
| `biasDetectAgreement(config?)` | generator | Detects agreement patterns across four dimensions |
| `biasClassify(config?)` | generator | Classifies six bias types with per-type confidence |
| `biasScore(config?)` | handler | Computes composite sycophancy score (deterministic) |
| `biasCounterpoint(config?)` | generator | Generates counter-arguments when score exceeds threshold |
| `biasFormat()` | handler | Maps accumulated data to AnalyzerResult output |

### Schemas

| Schema | Purpose |
|--------|---------|
| `biasAnalyzerInputSchema` | Input: `{ userInput: string, aiResponse: string }` |
| `biasAnalyzerOutputSchema` | Full output with bias annotations, score, counter-arguments |
| `biasTypeSchema` | Enum of six bias types |
| `biasAnnotationSchema` | Per-bias annotation (type, confidence, description, evidence) |
| `counterArgumentSchema` | Counter-argument (claim, counterpoint, strength, sources) |
| `sycophancyScoreSchema` | Composite score with label and four-dimension breakdown |
| `sycophancyBreakdownSchema` | Four dimension scores |
| `sycophancyLabelSchema` | Enum: balanced, mild_bias, moderate_bias, sycophantic |
| `analyzerResultSchema` | Canonical AnalyzerResult contract for any metacognition analyzer |

### Response Auditor

| Export | Kind | Purpose |
|--------|------|---------|
| `responseAuditor(config)` | sequencer | Runs analyzers in parallel, produces AuditReport |
| `auditAggregate(config?)` | handler | Standalone aggregation for custom pipelines |
| `analyzerAnnotationSchema` | schema | Single finding: type, content, confidence, evidence |
| `auditorInputSchema` | schema | `{ userInput, aiResponse }` |
| `auditReportSchema` | schema | Aggregated: verdict, severity, score, results |
| `severitySchema` | schema | info, warning, critical |
| `auditVerdictSchema` | schema | pass, review, fail |
| `worstSeverity(a, b)` | helper | Returns the more severe of two levels |
| `aggregateSeverity(results)` | helper | Worst severity across results |
| `aggregateScore(results)` | helper | Max score across results |
| `determineVerdict(score, thresholds?)` | helper | Score → pass/review/fail |
| `buildAuditReport(results, thresholds?)` | helper | Full report from analyzer results |
| `DEFAULT_AUDIT_THRESHOLDS` | const | `{ reviewThreshold: 0.3, failThreshold: 0.7 }` |

### Helpers

| Function | Purpose |
|----------|---------|
| `labelForSycophancyScore(score)` | Score → label mapping |
| `severityForSycophancyScore(score)` | Score → severity (info/warning/critical) |
| `computeCompositeSycophancyScore(breakdown, biases, config?)` | Weighted composite from dimensions + bias confidence |
| `shouldGenerateCounterpoints(score, threshold?)` | Whether score warrants counter-argument generation |
| `summarizeBiasFindings(score, label, biases)` | Human-readable summary string |

### Config

| Constant | Contents |
|----------|----------|
| `DEFAULT_BIAS_ANALYZER_CONFIG` | `counterpointThreshold` (0.4), `breakdownWeights`, `biasConfidenceWeight` (0.3) |

---

## identity (placeholders)

Wave 2 placeholders. Not yet implemented.

- `perspective(config)` — Perspective block.
- `constitution(config)` — Constitution block.

---

## Usage

```ts
import { system as memorySystem } from "@thought-fabric/core/memory";
import { filterRelevance, scoreSalience } from "@thought-fabric/core/attention";
import { biasAnalyzer } from "@thought-fabric/core/metacognition";

const mem = memorySystem({ model: "preset/fast", working: true, episodic: true, semantic: true });

const pipeline = sequencer({ name: "pipeline", inputSchema: chatInput })
  .then(chat)
  .work(mem.captureFromItems);

const filter = filterRelevance({ name: "filter" });
const salience = scoreSalience({ name: "rank" });
const audit = biasAnalyzer({ model: "preset/fast" });
```

See [Memory](/thought-fabric/memory) for a full guide.

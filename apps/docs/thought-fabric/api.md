---
sidebar_position: 6
---

# API Reference

Cognitive architecture primitives built on flow-state-dev. Provides attention, identity, and metacognition domains for agentic workflows.

**Import:** Use subpath exports. `@thought-fabric/core/attention`, `@thought-fabric/core/identity`, `@thought-fabric/core/metacognition`.

> **Memory has moved.** Cross-turn memory now ships from `@flow-state-dev/memory`. Thought Fabric will host specialized cognitive memory variants on top of that contract when they're ready.

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
| `analyzerResultSchema` | Generic AnalyzerResult contract |

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

## identity

Perspective and constitution — structured viewpoints and ranked value systems that shape how agents interpret and evaluate information.

**Import:** `@thought-fabric/core/identity`

### Perspective Factory + System

| Function | Purpose |
|----------|---------|
| `perspective(config)` | Create a frozen perspective instance from config |
| `system(instance, config?)` | Factory that wires blocks, capability, resources, and capture pipeline |

### Static Blocks

| Function | Kind | Purpose |
|----------|------|---------|
| `perspectiveApply(config)` | handler | Inject perspective framing into content |
| `perspectiveAnalyze(config)` | generator | LLM analysis through the perspective's lens |
| `perspectiveAuditor(config)` | sequencer | apply → analyze pipeline |

### Stateful Blocks

| Function | Kind | Purpose |
|----------|------|---------|
| `perspectiveObserve(config)` | handler | Record observations from analysis output or explicit batch |
| `perspectivePosition(config)` | handler | Record a position with supporting observations |
| `perspectiveChallenge(config)` | handler | Challenge a position with counter-evidence |
| `perspectiveSnapshot(config)` | handler | Read current observations + positions |
| `perspectiveAdvance(config)` | handler | Bump observation turn counter |

### Resources

| Export | Scope | Purpose |
|--------|-------|---------|
| `perspectiveObservationsResource` | session | Observation store (singleton) |
| `perspectivePositionsResource` | session/user/project | Position store; scope decided by where the capability or block declares it |

### Capability

| Function | Purpose |
|----------|---------|
| `createPerspectiveCapability(instance, config?)` | Create a capability with resources, context presets, and typed helpers |

Presets: `static` (perspective framing), `accumulated` (observations + positions). Both on by default.

### Static Helpers

| Function | Purpose |
|----------|---------|
| `formatPerspective(instance)` | Full formatted perspective for LLM context |
| `formatPerspectiveSalience(salience)` | Format salience model |
| `formatPerspectiveReasoning(reasoning)` | Format reasoning config |
| `summarizePerspective(instance)` | One-line summary |
| `perspectiveContextFormatter(instance)` | Context slot function for generators |

### Observation Helpers

| Function | Purpose |
|----------|---------|
| `addPerspectiveObservation(ref, input)` | Add an observation |
| `removePerspectiveObservation(ref, id)` | Remove by ID |
| `perspectiveObservations(ref, category?)` | Read observations, optionally filtered |
| `advancePerspectiveObservations(ref)` | Bump turn counter |
| `formatPerspectiveObservations(ref)` | Format for LLM context |

### Position Helpers

| Function | Purpose |
|----------|---------|
| `addPerspectivePosition(ref, input, obsRef?)` | Add a position |
| `challengePerspectivePosition(ref, id, evidence, obsRef?)` | Add counter-evidence |
| `removePerspectivePosition(ref, id)` | Remove by ID |
| `perspectivePositions(ref)` | Read all positions |
| `formatPerspectivePositions(ref)` | Format for LLM context |
| `formatPerspectiveAccumulated(obsRef, posRef?)` | Combined observations + positions |

### Schemas

| Schema | Purpose |
|--------|---------|
| `perspectiveConfigSchema` | Full perspective configuration |
| `perspectiveSalienceSchema` | Salience model (amplify/suppress) |
| `perspectiveReasoningSchema` | Reasoning config (priorities, risk model) |
| `perspectiveCommunicationSchema` | Communication style |
| `perspectiveAnalysisSchema` | Analysis output |
| `perspectiveInputSchema` | Analysis input (`{ content: string }`) |
| `perspectiveApplyOutputSchema` | Apply block output |
| `perspectiveObservationSchema` | Single observation |
| `perspectiveObservationsStateSchema` | Observations resource state |
| `perspectivePositionSchema` | Single position |
| `perspectivePositionChallengeSchema` | Challenge entry |
| `perspectivePositionsStateSchema` | Positions resource state |
| `perspectiveObserveInputSchema` | Observe block input |
| `perspectiveObserveOutputSchema` | Observe block output |
| `perspectivePositionInputSchema` | Position block input |
| `perspectiveChallengeInputSchema` | Challenge block input |
| `perspectiveSnapshotOutputSchema` | Snapshot block output |

### Constitution Factory

| Function | Purpose |
|----------|---------|
| `constitution(config)` | Create a frozen constitution definition from config |

### Constitution Blocks

| Function | Kind | Purpose |
|----------|------|---------|
| `constitutionAuditor(config)` | sequencer | Bundled pipeline: review → enforce |
| `constitutionReview(config)` | generator | LLM-evaluates content against principles |
| `constitutionEnforce(config)` | handler | Computes aggregate compliance and pass/fail verdict |

### Constitution Helpers

| Function | Purpose |
|----------|---------|
| `rankConstitutionPrinciples(constitution, context?)` | Sort principles by effective priority, applying contextual overrides |
| `computeConstitutionCompliance(results, constitution)` | Aggregate compliance score from per-principle results |
| `formatConstitution(constitution)` | Human-readable string for LLM prompt injection |
| `summarizeConstitutionReview(review)` | One-line summary with violation counts and severity |

### Constitution Schemas

| Schema | Purpose |
|--------|---------|
| `constitutionConfigSchema` | Full constitution configuration |
| `constitutionPrincipleSchema` | Single principle (id, statement, priority, rationale, weight) |
| `constitutionContextualOverrideSchema` | Override rule (when, promote, demote, reasoning) |
| `constitutionConflictResolutionSchema` | Enum: priority, weighted, contextual |
| `constitutionReviewInputSchema` | Input: `{ content: string, context?: string }` |
| `constitutionReviewOutputSchema` | Full review output with compliance verdict |
| `constitutionPrincipleResultSchema` | Per-principle evaluation result |
| `constitutionViolationSchema` | Violation entry (principleId, severity, description, evidence) |
| `constitutionTradeoffSchema` | Tradeoff between two principles |

### Constitution Config

| Constant | Contents |
|----------|----------|
| `DEFAULT_CONSTITUTION_CONFIG` | `complianceThreshold` (0.7) |

---

## Usage

```ts
import { perspective, system as perspectiveSystem } from "@thought-fabric/core/identity";
import { filterRelevance, scoreSalience } from "@thought-fabric/core/attention";
import { biasAnalyzer } from "@thought-fabric/core/metacognition";

const sec = perspectiveSystem(
  perspective({
    name: "security-engineer",
    description: "Security-focused code reviewer",
    salience: { amplify: ["auth", "injection", "data exposure"] },
    reasoning: { priorities: ["identify attack vectors", "assess blast radius"] },
  }),
  { model: "preset/fast" },
);

const chat = generator({
  uses: [sec.capability],
  // ...
});

const pipeline = sequencer({ name: "pipeline", inputSchema: chatInput })
  .step(chat)
  .work((response) => ({ content: response }), sec.capture);
```

See [Identity](/thought-fabric/identity) for the full guide. For cross-turn memory, see the framework docs at Ecosystem → Memory.

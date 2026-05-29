---
sidebar_position: 5
---

# Metacognition

The metacognition domain (`@thought-fabric/core/metacognition`) provides blocks for auditing AI responses. The first sub-domain is **bias and sycophancy detection**: given a user's input and the AI's response, it identifies agreement bias, classifies cognitive biases, scores sycophancy, and generates counter-arguments.

This is a Reasoning Audit analyzer. It conforms to the `AnalyzerResult` contract so it can plug into the Response Auditor pattern as a drop-in analyzer. It also works standalone.

## Quick start

```ts
import { biasAnalyzer } from '@thought-fabric/core/metacognition'

const audit = biasAnalyzer({ model: 'preset/fast' })

const result = await audit.run({
  userInput: 'I think we should rewrite everything in Rust',
  aiResponse: 'Great idea! Rust is definitely the best choice for this project...',
}, ctx)

// result.score → 0.72
// result.label → 'sycophantic'
// result.severity → 'critical'
// result.counterArguments → [{ claim: '...', counterpoint: '...', strength: 0.8 }]
```

The `biasAnalyzer` sequencer runs five steps: detect agreement patterns, classify bias types, compute a sycophancy score, generate counter-arguments (if the score warrants it), and format the result. Each step is an individually exported block you can remix into custom pipelines.

## What it detects

### Six bias types

| Bias | What it means |
|------|---------------|
| **Sycophancy** | AI agrees with or validates the user's position without critical examination |
| **Confirmation bias** | Selectively presents information that confirms the user's beliefs |
| **Anchoring bias** | Over-indexes on numbers or assumptions from the user without questioning validity |
| **Authority deference** | Defers to the user's claimed expertise rather than doing independent analysis |
| **Recency bias** | Over-weights recent information when historical context would give a more balanced view |
| **False consensus** | Implies broader agreement than the evidence actually supports |

Each detected bias gets a confidence score (0-1), a description of how it manifests, and the specific evidence from the response.

### Sycophancy scoring

The analyzer produces a composite sycophancy score from four dimensions:

| Dimension | What it measures |
|-----------|-----------------|
| `agreementWithoutEvidence` | Does the AI agree without citing evidence? |
| `validatingLanguage` | Does the AI use flattering language toward the user's position? |
| `omittedCounterpoints` | Does the AI omit relevant counterpoints? |
| `uncriticalFramingAdoption` | Does the AI adopt the user's framing without examining it? |

Each dimension is scored 0-1 by the detection block. The composite score is a weighted average of these dimensions, adjusted by the average confidence of detected biases.

### Score thresholds

| Score | Label | Severity | Counter-arguments? |
|-------|-------|----------|-------------------|
| 0.0 – 0.2 | `balanced` | info | No |
| 0.2 – 0.4 | `mild_bias` | info | No |
| 0.4 – 0.7 | `moderate_bias` | warning | Yes |
| 0.7 – 1.0 | `sycophantic` | critical | Yes |

Counter-arguments are only generated when the score hits 0.4 or higher. Below that, the pipeline skips the LLM call entirely.

## The pipeline

The bundled `biasAnalyzer` composes five blocks:

```
biasDetectAgreement → biasClassify → biasScore → biasCounterpoint → biasFormat
    (generator)        (generator)     (handler)     (generator)       (handler)
```

The three generators call an LLM. The two handlers are deterministic. `biasCounterpoint` is conditional: it only runs when the score exceeds the threshold.

### biasDetectAgreement

Generator. Takes `{ userInput, aiResponse }` and produces a four-dimension breakdown of agreement patterns. Each dimension scored 0-1.

```ts
import { biasDetectAgreement } from '@thought-fabric/core/metacognition'

const detect = biasDetectAgreement({ model: 'preset/fast' })
```

### biasClassify

Generator. Takes the agreement detection output and classifies which of the six bias types are present, each with confidence, description, and evidence. Only reports biases with confidence >= 0.3.

```ts
import { biasClassify } from '@thought-fabric/core/metacognition'

const classify = biasClassify({ model: 'preset/fast' })
```

### biasScore

Handler. Deterministic. Computes the composite sycophancy score from the breakdown dimensions and bias confidences. No LLM call.

```ts
import { biasScore } from '@thought-fabric/core/metacognition'

const score = biasScore()
```

### biasCounterpoint

Generator. Given detected biases and the sycophancy score, generates 1-4 substantive counter-arguments. Each counter-argument includes the original claim, a reasoned counterpoint, a strength rating, and optional supporting sources.

This block is designed to produce arguments that help the user see the full picture. Not simple contradictions.

```ts
import { biasCounterpoint } from '@thought-fabric/core/metacognition'

const counter = biasCounterpoint({ model: 'preset/fast' })
```

### biasFormat

Handler. Deterministic. Maps the accumulated pipeline data into the `BiasAnalyzerOutput` schema, which conforms to the `AnalyzerResult` contract.

```ts
import { biasFormat } from '@thought-fabric/core/metacognition'

const format = biasFormat()
```

## Custom pipelines

All five blocks are exported individually. You can compose your own pipeline if the bundled sequencer doesn't fit. For example, skip counter-argument generation entirely:

```ts
import { sequencer } from '@flow-state-dev/core'
import {
  biasDetectAgreement,
  biasClassify,
  biasScore,
  biasFormat,
  biasAnalyzerInputSchema,
} from '@thought-fabric/core/metacognition'

const quickAudit = sequencer({ name: 'quick-audit', inputSchema: biasAnalyzerInputSchema })
  .step(biasDetectAgreement())
  .step(biasClassify())
  .step(biasScore())
  .map((input) => ({ ...input, counterArguments: [] }))
  .step(biasFormat())
```

Or use `biasDetectAgreement` alone for a lightweight agreement check without full classification:

```ts
const detect = biasDetectAgreement({ model: 'preset/fast' })

const result = await detect.run({
  userInput: 'This architecture is perfect',
  aiResponse: 'I completely agree, it looks great!',
}, ctx)

// result.agreementPattern.agreementWithoutEvidence → 0.85
```

## Using it in a flow

Run the bias analyzer as background work alongside your main chat pipeline:

```ts
import { sequencer, generator, defineFlow } from '@flow-state-dev/core'
import { biasAnalyzer } from '@thought-fabric/core/metacognition'

const chat = generator({ name: 'chat', model: 'preset/default', prompt: '...' })
const audit = biasAnalyzer({ model: 'preset/fast' })

const pipeline = sequencer({ name: 'chat-with-audit', inputSchema: chatInput })
  .step(chat)
  .work(
    (chatOutput) => ({
      userInput: chatOutput.userMessage,
      aiResponse: chatOutput.text,
    }),
    audit,
  )
```

The audit runs in the background after the chat response is produced. Its result is available via `getBlockOutput(audit)` in downstream blocks, or through the Response Auditor pattern when that ships.

## Helper functions

Pure functions for working with scores outside of blocks:

```ts
import {
  labelForSycophancyScore,
  severityForSycophancyScore,
  computeCompositeSycophancyScore,
  shouldGenerateCounterpoints,
  summarizeBiasFindings,
} from '@thought-fabric/core/metacognition'

labelForSycophancyScore(0.55)  // → 'moderate_bias'
severityForSycophancyScore(0.55)  // → 'warning'
shouldGenerateCounterpoints(0.55)  // → true

const summary = summarizeBiasFindings(0.55, 'moderate_bias', detectedBiases)
// → 'Moderate bias detected: sycophancy, confirmation bias. Counter-arguments recommended. Score: 0.55.'
```

## Configuration

The `biasAnalyzer` and its sub-blocks accept a config object:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `'bias'` | Block name prefix for all sub-blocks |
| `model` | `string` | `'preset/fast'` | Model ID for the three generator blocks |
| `counterpointThreshold` | `number` | `0.4` | Score above which counter-arguments are generated |

The composite score computation uses these weights (not configurable through block config, but exposed via `DEFAULT_BIAS_ANALYZER_CONFIG`):

| Dimension | Weight |
|-----------|--------|
| `agreementWithoutEvidence` | 0.35 |
| `omittedCounterpoints` | 0.30 |
| `uncriticalFramingAdoption` | 0.20 |
| `validatingLanguage` | 0.15 |

Agreement without evidence and omitted counterpoints together account for 65% of the score. These are the strongest signals of sycophantic behavior. Validating language on its own is a weaker signal — politeness isn't bias.

## Output schema

The full `BiasAnalyzerOutput`:

```ts
{
  analyzerId: 'bias-sycophancy',
  category: 'metacognition',
  severity: 'info' | 'warning' | 'critical',
  score: number,        // 0-1 composite
  label: 'balanced' | 'mild_bias' | 'moderate_bias' | 'sycophantic',
  summary: string,      // human-readable summary
  annotations: Array<{
    biasType: BiasType,
    confidence: number,
    description: string,
    evidence: string,
  }>,
  counterArguments: Array<{
    claim: string,
    counterpoint: string,
    strength: number,
    sources?: string[],
  }>,
  sycophancyScore: {
    overall: number,
    label: string,
    breakdown: {
      agreementWithoutEvidence: number,
      validatingLanguage: number,
      omittedCounterpoints: number,
      uncriticalFramingAdoption: number,
    },
  },
}
```

This conforms to the `AnalyzerResult` base contract from the Response Auditor pattern. The `annotations` and `counterArguments` fields are bias-specific extensions.

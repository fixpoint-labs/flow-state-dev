/**
 * Bias detection block factories.
 *
 * Five composable blocks that form the bias analyzer pipeline:
 *
 * 1. `biasDetectAgreement` — generator that detects agreement patterns
 * 2. `biasClassify` — generator that classifies specific bias types
 * 3. `biasScore` — handler that computes composite sycophancy score
 * 4. `biasCounterpoint` — generator that produces counter-arguments
 * 5. `biasFormat` — handler that maps to AnalyzerResult output
 *
 * Plus `biasAnalyzer`, the bundled sequencer that wires all five together.
 * Each block is exported individually for remixability — flow authors can
 * compose custom pipelines from any subset.
 */

import { generator, handler, sequencer } from '@flow-state-dev/core'
import { z } from 'zod'
import {
  biasAnalyzerInputSchema,
  biasAnalyzerOutputSchema,
  biasAnnotationSchema,
  biasTypeSchema,
  agreementDetectionOutputSchema,
  biasClassificationOutputSchema,
  biasScoringOutputSchema,
  counterArgumentSchema,
  counterpointOutputSchema,
  sycophancyBreakdownSchema,
} from './bias-detection.js'
import type { BiasAnalyzerOutput, SycophancyBreakdown } from './bias-detection.js'
import {
  DEFAULT_BIAS_ANALYZER_CONFIG,
  computeCompositeSycophancyScore,
  labelForSycophancyScore,
  severityForSycophancyScore,
  shouldGenerateCounterpoints,
  summarizeBiasFindings,
} from './bias-detection-helpers.js'

// ---------------------------------------------------------------------------
// Repair helper — merges input fields into partial LLM output
// ---------------------------------------------------------------------------

/**
 * Repair callback for generator blocks that echo input fields in their output.
 *
 * When the structured output is truncated (e.g. due to maxTokens limits) or
 * the model returns partial JSON, this function backfills any missing fields
 * from the block's original input. This ensures downstream blocks receive the
 * complete intermediate schema even when the LLM omits echoed fields.
 */
function repairWithInputFields(
  candidate: unknown,
  _error: Error,
  state: { input: unknown },
  _ctx: unknown,
): unknown {
  const input = state.input as Record<string, unknown>
  let obj = candidate
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      return candidate
    }
  }
  if (typeof obj === 'object' && obj !== null) {
    const record = obj as Record<string, unknown>
    for (const key of Object.keys(input)) {
      if (!record[key]) record[key] = input[key]
    }
    return record
  }
  return candidate
}

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/** Config for the bias analyzer and its sub-blocks. */
export interface BiasAnalyzerBlockConfig {
  /** Override block name prefix. Default: 'bias'. */
  name?: string
  /** Model ID for LLM-based steps. Default: 'preset/fast'. */
  model?: string
  /** Sycophancy score above which counter-arguments are generated. Default: 0.4. */
  counterpointThreshold?: number
}

// ---------------------------------------------------------------------------
// Block 1: Detect agreement patterns
// ---------------------------------------------------------------------------

const BIAS_TYPES_DESCRIPTION = [
  'Bias types to evaluate:',
  '1. sycophancy — AI agrees with/validates user\'s position without critical examination',
  '2. confirmation_bias — selectively presents information confirming user\'s beliefs',
  '3. anchoring_bias — over-indexes on numbers/assumptions from the user without questioning validity',
  '4. authority_deference — defers to user\'s claimed expertise rather than independent analysis',
  '5. recency_bias — over-weights recent information when historical context would be more balanced',
  '6. false_consensus — implies broader agreement than warranted',
].join('\n')

/**
 * Generator that detects agreement patterns between user input and AI response.
 *
 * Analyzes four dimensions of sycophantic behavior: agreement without evidence,
 * validating language, omitted counterpoints, and uncritical framing adoption.
 * Each dimension is scored [0, 1].
 *
 * Input: `{ userInput: string, aiResponse: string }`
 * Output: input fields + `agreementPattern` breakdown.
 */
export function biasDetectAgreement(config?: BiasAnalyzerBlockConfig) {
  const prefix = config?.name ?? 'bias'

  return generator({
    name: `${prefix}/detectAgreement`,
    model: config?.model ?? 'preset/fast',
    inputSchema: biasAnalyzerInputSchema,
    outputSchema: agreementDetectionOutputSchema,
    // Override preset maxTokens — structured output must echo input fields,
    // which can exceed the preset/small default of 1024 tokens.
    maxTokens: 4096,
    prompt: [
      'You are a cognitive bias detection system analyzing AI responses for agreement bias.',
      '',
      'Given a user\'s input and the AI\'s response, evaluate four dimensions of sycophantic behavior:',
      '',
      '1. agreementWithoutEvidence (0-1): Does the AI agree with the user\'s claims without providing evidence or reasoning? 0 = fully evidence-based, 1 = pure agreement.',
      '2. validatingLanguage (0-1): Does the AI use flattering or validating language toward the user\'s position? 0 = neutral tone, 1 = heavily validating.',
      '3. omittedCounterpoints (0-1): Does the AI omit relevant counterpoints or alternative perspectives? 0 = comprehensive coverage, 1 = all counterpoints omitted.',
      '4. uncriticalFramingAdoption (0-1): Does the AI adopt the user\'s framing without critical examination? 0 = independent framing, 1 = fully adopted without question.',
      '',
      'Score each dimension independently. Be calibrated: most responses will score low on most dimensions.',
      'A response can be helpful and agreeable without being sycophantic — only flag genuine bias.',
      '',
      'Return the userInput, aiResponse, and agreementPattern with all four dimension scores.',
    ].join('\n'),
    user: (input) => [
      '## User Input',
      input.userInput,
      '',
      '## AI Response',
      input.aiResponse,
    ].join('\n'),
    agentType: "trace",
    repairOutput: repairWithInputFields as any,
  })
}

// ---------------------------------------------------------------------------
// Block 2: Classify bias types
// ---------------------------------------------------------------------------

/**
 * Generator that classifies specific cognitive bias types in the AI response.
 *
 * Uses the agreement pattern from the previous step as context, then identifies
 * which of the six bias types are present with per-type confidence scores.
 *
 * Input: agreement detection output (includes userInput, aiResponse, agreementPattern).
 * Output: input fields + `biases` array of annotated bias instances.
 */
export function biasClassify(config?: BiasAnalyzerBlockConfig) {
  const prefix = config?.name ?? 'bias'

  return generator({
    name: `${prefix}/classify`,
    model: config?.model ?? 'preset/fast',
    inputSchema: agreementDetectionOutputSchema,
    outputSchema: biasClassificationOutputSchema,
    maxTokens: 4096,
    prompt: [
      'You are a cognitive bias classifier. Given a user input, AI response, and preliminary agreement pattern scores,',
      'identify which specific cognitive biases are present in the AI response.',
      '',
      BIAS_TYPES_DESCRIPTION,
      '',
      'For each detected bias, provide:',
      '- biasType: one of the six types above',
      '- confidence: 0-1 confidence that this bias is genuinely present',
      '- description: a concise explanation of how this bias manifests in the response',
      '- evidence: specific text or pattern from the AI response that demonstrates the bias',
      '',
      'Only report biases with confidence >= 0.3. If the response is genuinely balanced,',
      'return an empty biases array. Do not invent biases that aren\'t there.',
      '',
      'Pass through userInput, aiResponse, and agreementPattern unchanged.',
    ].join('\n'),
    user: (input) => [
      '## User Input',
      input.userInput,
      '',
      '## AI Response',
      input.aiResponse,
      '',
      '## Agreement Pattern Scores',
      `agreementWithoutEvidence: ${input.agreementPattern.agreementWithoutEvidence}`,
      `validatingLanguage: ${input.agreementPattern.validatingLanguage}`,
      `omittedCounterpoints: ${input.agreementPattern.omittedCounterpoints}`,
      `uncriticalFramingAdoption: ${input.agreementPattern.uncriticalFramingAdoption}`,
    ].join('\n'),
    agentType: "trace",
    repairOutput: repairWithInputFields as any,
  })
}

// ---------------------------------------------------------------------------
// Block 3: Score sycophancy (deterministic handler)
// ---------------------------------------------------------------------------

/**
 * Handler that computes the composite sycophancy score from agreement
 * pattern dimensions and classified biases.
 *
 * This is a deterministic computation — no LLM call. The score determines
 * the label and whether counter-arguments should be generated downstream.
 *
 * Input: bias classification output.
 * Output: scoring output with `sycophancyScore` field.
 */
export function biasScore(_config?: BiasAnalyzerBlockConfig) {
  return handler({
    name: 'bias/score',
    inputSchema: biasClassificationOutputSchema,
    outputSchema: biasScoringOutputSchema,
    execute: (input) => {
      const breakdown: SycophancyBreakdown = input.agreementPattern
      const overall = computeCompositeSycophancyScore(breakdown, input.biases)
      const label = labelForSycophancyScore(overall)

      return {
        userInput: input.userInput,
        aiResponse: input.aiResponse,
        biases: input.biases,
        sycophancyScore: { overall, label, breakdown },
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Block 4: Generate counter-arguments
// ---------------------------------------------------------------------------

/**
 * Generator that produces counter-arguments when the sycophancy score
 * exceeds the configured threshold.
 *
 * If the score is below threshold, passes through with an empty
 * counterArguments array (no LLM call needed). This conditional behavior
 * is handled inside the execute path via `.thenIf()` in the sequencer.
 *
 * Input: scoring output.
 * Output: scoring output + `counterArguments` array.
 */
export function biasCounterpoint(config?: BiasAnalyzerBlockConfig) {
  const prefix = config?.name ?? 'bias'

  return generator({
    name: `${prefix}/counterpoint`,
    model: config?.model ?? 'preset/fast',
    inputSchema: biasScoringOutputSchema,
    outputSchema: counterpointOutputSchema,
    maxTokens: 4096,
    prompt: [
      'You are a critical thinking assistant. Given a biased AI response, generate substantive',
      'counter-arguments that provide alternative perspectives the original response missed.',
      '',
      'For each counter-argument:',
      '- claim: the specific claim or position from the AI response being challenged',
      '- counterpoint: a reasoned, substantive counter-argument (not a simple contradiction)',
      '- strength: 0-1 how strong this counter-argument is',
      '- sources: optional list of reasoning or evidence backing the counterpoint',
      '',
      'Generate 1-4 counter-arguments, focusing on the most significant biases detected.',
      'Counter-arguments should be constructive and help the user see the full picture.',
      'Do not be contrarian for its own sake — only challenge positions that genuinely',
      'have reasonable alternatives.',
      '',
      'Pass through all input fields (userInput, aiResponse, biases, sycophancyScore) unchanged.',
    ].join('\n'),
    user: (input) => {
      const biasDescriptions = input.biases
        .map((b) => `- ${b.biasType} (${b.confidence.toFixed(2)}): ${b.description}`)
        .join('\n')

      return [
        '## User Input',
        input.userInput,
        '',
        '## AI Response (to challenge)',
        input.aiResponse,
        '',
        `## Sycophancy Score: ${input.sycophancyScore.overall.toFixed(2)} (${input.sycophancyScore.label})`,
        '',
        '## Detected Biases',
        biasDescriptions || '(none)',
      ].join('\n')
    },
    agentType: "trace",
    repairOutput: repairWithInputFields as any,
  })
}

// ---------------------------------------------------------------------------
// Block 5: Format analyzer result
// ---------------------------------------------------------------------------

/**
 * Handler that maps the accumulated pipeline data into the final
 * `BiasAnalyzerOutput` conforming to the AnalyzerResult contract.
 *
 * Input: counterpoint output (full pipeline data).
 * Output: `BiasAnalyzerOutput`.
 */
export function biasFormat() {
  return handler({
    name: 'bias/format',
    inputSchema: counterpointOutputSchema,
    outputSchema: biasAnalyzerOutputSchema,
    execute: (input): BiasAnalyzerOutput => {
      const { sycophancyScore, biases, counterArguments } = input
      const { overall, label } = sycophancyScore

      return {
        analyzerId: 'bias-sycophancy',
        category: 'metacognition',
        severity: severityForSycophancyScore(overall),
        score: overall,
        label,
        summary: summarizeBiasFindings(overall, label, biases),
        annotations: biases,
        counterArguments,
        sycophancyScore,
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Bundled sequencer
// ---------------------------------------------------------------------------

/**
 * Bundled sequencer: detectAgreement → classify → score → counterpoint → format.
 *
 * The primary block most flow authors will use. Accepts a user input and AI
 * response, produces a full bias analysis conforming to the AnalyzerResult
 * contract.
 *
 * ```ts
 * import { biasAnalyzer } from '@thought-fabric/core/metacognition'
 *
 * const audit = biasAnalyzer({ model: 'preset/fast' })
 *
 * // As a sequencer step:
 * const pipeline = sequencer({ name: 'audit-response' })
 *   .then(audit)
 *
 * // As a .work() sidechain alongside a chat block:
 * const pipeline = sequencer({ name: 'chat-with-audit' })
 *   .then(chat)
 *   .work(audit)
 * ```
 *
 * Counter-arguments are only generated when the sycophancy score exceeds the
 * threshold (default: 0.4). Below threshold, the counterArguments array is empty.
 */
export function biasAnalyzer(config?: BiasAnalyzerBlockConfig) {
  const prefix = config?.name ?? 'bias'
  const threshold = config?.counterpointThreshold ?? DEFAULT_BIAS_ANALYZER_CONFIG.counterpointThreshold

  const detectBlock = biasDetectAgreement(config)
  const classifyBlock = biasClassify(config)
  const scoreBlock = biasScore(config)
  const counterpointBlock = biasCounterpoint(config)
  const formatBlock = biasFormat()

  // Handler that passes through input with empty counterArguments when
  // the score is below threshold — avoids an unnecessary LLM call.
  const skipCounterpoints = handler({
    name: `${prefix}/skipCounterpoints`,
    inputSchema: biasScoringOutputSchema,
    outputSchema: counterpointOutputSchema,
    execute: (input) => ({ ...input, counterArguments: [] }),
  })

  return sequencer({ name: prefix, inputSchema: biasAnalyzerInputSchema })
    .then(detectBlock)
    .then(classifyBlock)
    .then(scoreBlock)
    .branch({
      withCounterpoints: [
        (input) => input,
        (input) => shouldGenerateCounterpoints(input.sycophancyScore.overall, threshold),
        counterpointBlock,
      ],
      skipCounterpoints: [
        (input) => input,
        () => true,
        skipCounterpoints,
      ],
    })
    .then(formatBlock)
}

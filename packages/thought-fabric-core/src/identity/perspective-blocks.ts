/**
 * Perspective block factories.
 *
 * Three composable blocks for perspective-shaped analysis:
 *
 * 1. `perspectiveApply` — handler that wraps content with perspective framing
 * 2. `perspectiveAnalyze` — generator that produces structured analysis
 * 3. `perspectiveAuditor` — sequencer bundling apply → analyze
 *
 * Each block takes a `PerspectiveInstance` (from the `perspective()` factory)
 * as configuration. The perspective's salience model, reasoning approach,
 * expertise, and communication style are baked into the block's behavior.
 */

import { generator, handler, sequencer } from '@flow-state-dev/core'
import {
  perspectiveInputSchema,
  perspectiveApplyOutputSchema,
  perspectiveAnalysisSchema,
} from './perspective.js'
import type { PerspectiveInstance } from './perspective.js'
import { formatPerspective } from './perspective-helpers.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Shared config for all perspective block factories. */
export interface PerspectiveBlockConfig {
  /** Override the block name. Default: derived from perspective name. */
  name?: string
  /** The perspective instance to apply. */
  perspective: PerspectiveInstance
}

/** Config for generator-based perspective blocks. */
export interface PerspectiveAnalyzeConfig extends PerspectiveBlockConfig {
  /** Model ID for the LLM call. Default: 'preset/fast'. */
  model?: string
}

// ---------------------------------------------------------------------------
// Block 1: Apply perspective framing (handler)
// ---------------------------------------------------------------------------

/**
 * Handler that wraps input content with perspective framing.
 *
 * Use this when you want to shape content before feeding it into your
 * own generator. The output includes the original content, a formatted
 * perspective frame, and the perspective name.
 *
 * ```ts
 * import { perspectiveApply } from '@thought-fabric/core/identity'
 *
 * const applySecurityLens = perspectiveApply({
 *   perspective: securityEngineer,
 * })
 *
 * const pipeline = sequencer({ name: 'review' })
 *   .then(applySecurityLens)
 *   .then(myCustomGenerator)
 * ```
 *
 * Input: `{ content: string, context?: string }`
 * Output: `{ content: string, perspectiveFrame: string, perspectiveName: string }`
 */
export function perspectiveApply(config: PerspectiveBlockConfig) {
  const { perspective: instance } = config
  const blockName = config.name ?? `${instance.name}/apply`
  const frame = formatPerspective(instance)

  return handler({
    name: blockName,
    inputSchema: perspectiveInputSchema,
    outputSchema: perspectiveApplyOutputSchema,
    execute: (input) => ({
      content: input.context
        ? `${input.content}\n\n---\nAdditional context:\n${input.context}`
        : input.content,
      perspectiveFrame: frame,
      perspectiveName: instance.name,
    }),
  })
}

// ---------------------------------------------------------------------------
// Block 2: Analyze through perspective lens (generator)
// ---------------------------------------------------------------------------

/**
 * Generator that produces structured analysis through a perspective's lens.
 *
 * The perspective's salience model, reasoning approach, expertise, and
 * communication style are embedded in the system prompt. The LLM
 * produces a `PerspectiveAnalysis` with findings, salience notes,
 * recommendations, and a confidence score.
 *
 * ```ts
 * import { perspectiveAnalyze } from '@thought-fabric/core/identity'
 *
 * const securityAnalysis = perspectiveAnalyze({
 *   perspective: securityEngineer,
 *   model: 'gpt-5',
 * })
 *
 * const result = await securityAnalysis.run(
 *   { content: 'Feature proposal: add public file sharing...' },
 *   ctx,
 * )
 * // result.analysis, result.salienceNotes, result.recommendations
 * ```
 *
 * Input: `{ content: string, context?: string }`
 * Output: `PerspectiveAnalysis`
 */
export function perspectiveAnalyze(config: PerspectiveAnalyzeConfig) {
  const { perspective: instance } = config
  const blockName = config.name ?? `${instance.name}/analyze`
  const frame = formatPerspective(instance)

  return generator({
    name: blockName,
    model: config.model ?? 'preset/fast',
    inputSchema: perspectiveInputSchema,
    outputSchema: perspectiveAnalysisSchema,
    maxTokens: 4096,
    prompt: [
      'You are an analytical assistant adopting a specific perspective.',
      'Analyze the provided content strictly through this perspective\'s lens.',
      '',
      frame,
      '',
      'Produce a structured analysis that includes:',
      '- perspectiveName: the name of the perspective you are using',
      '- analysis: your main analytical findings (detailed, substantive)',
      '- salienceNotes: what your salience model highlighted or caused you to suppress (list of strings)',
      '- recommendations: actionable recommendations from this perspective (list of strings)',
      '- confidence: how confident you are in the analysis on a 0-1 scale',
      '',
      'Stay in character. Do not acknowledge the perspective framing directly.',
      'Analyze as though this is genuinely how you see the subject matter.',
    ].join('\n'),
    user: (input) => {
      const parts = ['## Content to Analyze', '', input.content]
      if (input.context) {
        parts.push('', '## Additional Context', '', input.context)
      }
      return parts.join('\n')
    },
    emit: { messages: false, reasoning: false, toolCalls: false },
  })
}

// ---------------------------------------------------------------------------
// Bundled sequencer
// ---------------------------------------------------------------------------

/**
 * Bundled sequencer: apply perspective framing → analyze through the lens.
 *
 * The primary block most flow authors will use. Accepts content and
 * produces a full `PerspectiveAnalysis`.
 *
 * ```ts
 * import { perspectiveAuditor } from '@thought-fabric/core/identity'
 *
 * const securityAudit = perspectiveAuditor({
 *   perspective: securityEngineer,
 *   model: 'gpt-5',
 * })
 *
 * // Standalone
 * const result = await securityAudit.run({ content: '...' }, ctx)
 *
 * // In a pipeline
 * const pipeline = sequencer({ name: 'review' })
 *   .work((input) => ({ content: input.proposal }), securityAudit)
 *   .then(nextBlock)
 * ```
 */
export function perspectiveAuditor(config: PerspectiveAnalyzeConfig) {
  const { perspective: instance } = config
  const blockName = config.name ?? `${instance.name}/auditor`

  const applyBlock = perspectiveApply({ perspective: instance })
  const analyzeBlock = perspectiveAnalyze(config)

  return sequencer({ name: blockName, inputSchema: perspectiveInputSchema })
    .then(applyBlock)
    .then(analyzeBlock)
}

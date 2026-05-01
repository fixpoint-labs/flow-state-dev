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
import type { DefinedResource } from '@flow-state-dev/core'
import { z } from 'zod'
import {
  perspectiveInputSchema,
  perspectiveApplyOutputSchema,
  perspectiveAnalysisSchema,
  perspectivePositionSchema,
  perspectiveObservationsResource,
  perspectivePositionsResource,
  createPerspectivePositionsResource,
  perspectiveObserveInputSchema,
  perspectiveObserveOutputSchema,
  perspectivePositionInputSchema,
  perspectiveChallengeInputSchema,
  perspectiveSnapshotOutputSchema,
} from './perspective.js'
import type {
  PerspectiveInstance,
  PerspectiveObservation,
} from './perspective.js'
import {
  formatPerspective,
  addPerspectiveObservation,
  addPerspectivePosition,
  challengePerspectivePosition,
  perspectiveObservations,
  perspectivePositions,
  advancePerspectiveObservations,
} from './perspective-helpers.js'

/** Position scope — controls where positions are persisted. */
export type PositionScope = 'session' | 'user' | 'org'

// ---------------------------------------------------------------------------
// Internal: positions ref lookup
// ---------------------------------------------------------------------------

/**
 * Resolve the positions resource ref from a runtime ctx.
 *
 * Under FIX-435 every resource lives on the flat `ctx.resources` registry
 * regardless of intrinsic scope, so the lookup no longer branches on scope.
 * The `scope` parameter is retained so the signature documents the
 * configured placement at the call site.
 */
export function getPerspectivePositionsRef(ctx: any, _scope: PositionScope) {
  return ctx.resources.get('perspectivePositions')
}

/**
 * Build the unified `resources` map that installs the observations + positions
 * resources for a given `positionScope`. Observations are always
 * session-scoped; positions are created at the requested scope via the
 * positions resource factory so each consumer (capability, block) gets a
 * single shared definition.
 *
 * Pass `positionsResource` to reuse a positions resource definition created
 * elsewhere in the same system (e.g. the bundled `system()` factory creates
 * it once and forwards it to both the capability and the bundled blocks so
 * they share a `defineResource()` reference and therefore the same storage
 * key under FIX-435).
 */
export function buildPerspectiveResources(
  scope: PositionScope,
  positionsResource?: DefinedResource,
): Record<string, DefinedResource> {
  const positions = positionsResource ?? (
    scope === 'session'
      ? perspectivePositionsResource
      : createPerspectivePositionsResource(scope)
  )
  return {
    perspectiveObservations: perspectiveObservationsResource,
    perspectivePositions: positions,
  }
}

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
 * const pipeline = sequencer({
 *   name: 'analyze-proposal',
 *   inputSchema: z.object({ content: z.string() }),
 * }).then(securityAnalysis)
 * // pipeline output → { analysis, salienceNotes, recommendations, ... }
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
    agentType: 'trace',
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
 * // As a sequencer step
 * const pipeline = sequencer({ name: 'review-proposal' })
 *   .map((input) => ({ content: input.proposal }))
 *   .then(securityAudit)
 *
 * // As a .work() sidechain
 * const pipeline = sequencer({ name: 'review' })
 *   .then(mainBlock)
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

// ===========================================================================
// Phase B — Resource-backed blocks (observe, position, challenge, snapshot, advance)
// ===========================================================================

/** Shared config for resource-backed blocks. */
export interface PerspectiveStatefulBlockConfig {
  /** Override block name. Default: derived from perspective name. */
  name?: string
  /** The perspective instance this block operates on (used for default block naming). */
  perspective: PerspectiveInstance
}

/** Config for position-related blocks (adds scope handling). */
export interface PerspectivePositionBlockConfig extends PerspectiveStatefulBlockConfig {
  /** Where positions live. Default: 'session'. */
  positionScope?: PositionScope
  /**
   * Optional shared positions resource definition. When omitted, the block
   * creates its own positions resource at `positionScope`. Pass an existing
   * definition (e.g. the one created by `system()`) to share state across
   * blocks under the FIX-435 same-reference rule.
   */
  positionsResource?: DefinedResource
}

// ---------------------------------------------------------------------------
// Block: perspectiveObserve
// ---------------------------------------------------------------------------

/**
 * Handler that records observations into the observations resource.
 *
 * Accepts either:
 * - A `PerspectiveAnalysis` output — the `salienceNotes` array is promoted
 *   to observations, each tagged with category `'analysis'`.
 * - An explicit batch — `{ observations: [{ content, category?, confidence?, source? }] }`.
 *
 * Returns the recorded observations with their generated IDs and turn stamps.
 *
 * Wire after `perspectiveAnalyze` in a sequencer to capture findings into the
 * resource, or call standalone from any handler to record observations.
 */
export function perspectiveObserve(config: PerspectiveStatefulBlockConfig) {
  const { perspective: instance } = config
  const blockName = config.name ?? `${instance.name}/observe`

  return handler({
    name: blockName,
    inputSchema: perspectiveObserveInputSchema,
    outputSchema: perspectiveObserveOutputSchema,
    resources: { perspectiveObservations: perspectiveObservationsResource },
    execute: async (input, ctx) => {
      const ref = ctx.resources.get('perspectiveObservations')
      const recorded: PerspectiveObservation[] = []

      // Discriminate input shape: PerspectiveAnalysis vs explicit batch.
      // PerspectiveAnalysis has perspectiveName + salienceNotes; explicit has observations.
      if ('observations' in input && Array.isArray((input as any).observations)) {
        for (const obs of (input as { observations: Array<{
          content: string; category?: string; confidence?: number; source?: string
        }> }).observations) {
          recorded.push(await addPerspectiveObservation(ref, obs))
        }
      } else {
        const analysis = input as { perspectiveName: string; salienceNotes: string[]; confidence: number }
        for (const note of analysis.salienceNotes) {
          recorded.push(await addPerspectiveObservation(ref, {
            content: note,
            category: 'analysis',
            confidence: analysis.confidence,
            source: analysis.perspectiveName,
          }))
        }
      }

      return { observations: recorded }
    },
  })
}

// ---------------------------------------------------------------------------
// Block: perspectivePosition
// ---------------------------------------------------------------------------

/**
 * Handler that records a position the perspective has reached.
 *
 * Positions are conclusions the perspective has reached — typically derived
 * from accumulated observations. Use `supportingObservations` to reference
 * observation IDs that back the claim. Position scope is configurable via
 * `positionScope` (default 'session').
 */
export function perspectivePosition(config: PerspectivePositionBlockConfig) {
  const { perspective: instance } = config
  const blockName = config.name ?? `${instance.name}/position`
  const scope = config.positionScope ?? 'session'
  const positionsResource = config.positionsResource ?? (
    scope === 'session'
      ? perspectivePositionsResource
      : createPerspectivePositionsResource(scope)
  )

  return handler({
    name: blockName,
    inputSchema: perspectivePositionInputSchema,
    outputSchema: perspectivePositionSchema,
    resources: {
      perspectiveObservations: perspectiveObservationsResource,
      perspectivePositions: positionsResource,
    },
    execute: async (input, ctx) => {
      const obsRef = ctx.resources.get('perspectiveObservations')
      const posRef = ctx.resources.get('perspectivePositions')
      return addPerspectivePosition(posRef, input, obsRef)
    },
  })
}

// ---------------------------------------------------------------------------
// Block: perspectiveChallenge
// ---------------------------------------------------------------------------

/**
 * Handler that appends counter-evidence to an existing position.
 *
 * Challenges accumulate on the position — they don't remove it. Returns
 * `{ challenged: boolean }` indicating whether the position existed.
 */
export function perspectiveChallenge(config: PerspectivePositionBlockConfig) {
  const { perspective: instance } = config
  const blockName = config.name ?? `${instance.name}/challenge`
  const scope = config.positionScope ?? 'session'
  const positionsResource = config.positionsResource ?? (
    scope === 'session'
      ? perspectivePositionsResource
      : createPerspectivePositionsResource(scope)
  )

  return handler({
    name: blockName,
    inputSchema: perspectiveChallengeInputSchema,
    outputSchema: z.object({ challenged: z.boolean() }),
    resources: {
      perspectiveObservations: perspectiveObservationsResource,
      perspectivePositions: positionsResource,
    },
    execute: async (input, ctx) => {
      const obsRef = ctx.resources.get('perspectiveObservations')
      const posRef = ctx.resources.get('perspectivePositions')
      const challenged = await challengePerspectivePosition(posRef, input.positionId, input.evidence, obsRef)
      return { challenged }
    },
  })
}

// ---------------------------------------------------------------------------
// Block: perspectiveSnapshot
// ---------------------------------------------------------------------------

/**
 * Handler that returns the current observations and positions plus the
 * observation turn counter. Useful as the leaf block of inspection or
 * reporting pipelines.
 */
export function perspectiveSnapshot(config: PerspectivePositionBlockConfig) {
  const { perspective: instance } = config
  const blockName = config.name ?? `${instance.name}/snapshot`
  const scope = config.positionScope ?? 'session'
  const positionsResource = config.positionsResource ?? (
    scope === 'session'
      ? perspectivePositionsResource
      : createPerspectivePositionsResource(scope)
  )

  return handler({
    name: blockName,
    inputSchema: z.any(),
    outputSchema: perspectiveSnapshotOutputSchema,
    resources: {
      perspectiveObservations: perspectiveObservationsResource,
      perspectivePositions: positionsResource,
    },
    execute: async (_input, ctx) => {
      const obsRef = ctx.resources.get('perspectiveObservations')
      const posRef = ctx.resources.get('perspectivePositions')
      return {
        observations: perspectiveObservations(obsRef),
        positions: perspectivePositions(posRef),
        turnCounter: obsRef.state.turnCounter,
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Block: perspectiveAdvance (.tap()-friendly)
// ---------------------------------------------------------------------------

/**
 * Handler that bumps the observation turn counter by one.
 *
 * Designed for `.tap()` use in sequencers — has no meaningful output. Run
 * this at session-turn boundaries (e.g. after each user message) so future
 * observations get a higher `addedAt` stamp for recency-based formatting.
 */
export function perspectiveAdvance(config: PerspectiveStatefulBlockConfig) {
  const { perspective: instance } = config
  const blockName = config.name ?? `${instance.name}/advance`

  return handler({
    name: blockName,
    inputSchema: z.any(),
    resources: { perspectiveObservations: perspectiveObservationsResource },
    execute: async (_input, ctx) => {
      const ref = ctx.resources.get('perspectiveObservations')
      await advancePerspectiveObservations(ref)
    },
  })
}

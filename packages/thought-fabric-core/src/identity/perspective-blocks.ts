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
import { z } from 'zod'
import {
  perspectiveInputSchema,
  perspectiveApplyOutputSchema,
  perspectiveAnalysisSchema,
  perspectiveObservationSchema,
  perspectivePositionSchema,
  perspectiveObservationsResource,
  perspectivePositionsResource,
  perspectiveObserveInputSchema,
  perspectiveObserveOutputSchema,
  perspectivePositionInputSchema,
  perspectiveChallengeInputSchema,
  perspectiveSnapshotOutputSchema,
} from './perspective.js'
import type {
  PerspectiveInstance,
  PerspectiveObservation,
  PerspectivePosition,
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
export type PositionScope = 'session' | 'user' | 'project'

// ---------------------------------------------------------------------------
// Internal: positions ref lookup
// ---------------------------------------------------------------------------

/** Resolve the positions resource ref from a runtime ctx for the given scope. */
export function getPerspectivePositionsRef(ctx: any, scope: PositionScope) {
  if (scope === 'session') return ctx.session.resources.get('perspectivePositions')
  if (scope === 'user') return ctx.user.resources.get('perspectivePositions')
  return ctx.project.resources.get('perspectivePositions')
}

/**
 * Build the `sessionResources` / `userResources` / `projectResources` shape
 * that installs the observations + positions resources at the right scopes
 * for a given `positionScope`. Observations are always session-scoped.
 *
 * The return type is permissive (`Record<string, ...>` rather than per-key
 * generics), so it can be spread into `defineCapability(...)` and into the
 * `Record<string, unknown>` exports on the system bundle. Block factories
 * (handler/generator/sequencer) use stricter per-key inference and would
 * reject the union, so they keep an inline literal.
 */
export function buildPerspectiveResources(scope: PositionScope): {
  sessionResources: Record<string, typeof perspectiveObservationsResource | typeof perspectivePositionsResource>
  userResources?: Record<string, typeof perspectivePositionsResource>
  projectResources?: Record<string, typeof perspectivePositionsResource>
} {
  if (scope === 'session') {
    return {
      sessionResources: {
        perspectiveObservations: perspectiveObservationsResource,
        perspectivePositions: perspectivePositionsResource,
      },
    }
  }
  if (scope === 'user') {
    return {
      sessionResources: { perspectiveObservations: perspectiveObservationsResource },
      userResources: { perspectivePositions: perspectivePositionsResource },
    }
  }
  return {
    sessionResources: { perspectiveObservations: perspectiveObservationsResource },
    projectResources: { perspectivePositions: perspectivePositionsResource },
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
    sessionResources: { perspectiveObservations: perspectiveObservationsResource },
    execute: async (input, ctx) => {
      const ref = ctx.session.resources.get('perspectiveObservations')
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

  return handler({
    name: blockName,
    inputSchema: perspectivePositionInputSchema,
    outputSchema: perspectivePositionSchema,
    sessionResources: {
      perspectiveObservations: perspectiveObservationsResource,
      ...(scope === 'session' ? { perspectivePositions: perspectivePositionsResource } : {}),
    },
    ...(scope === 'user' ? { userResources: { perspectivePositions: perspectivePositionsResource } } : {}),
    ...(scope === 'project' ? { projectResources: { perspectivePositions: perspectivePositionsResource } } : {}),
    execute: async (input, ctx) => {
      const obsRef = ctx.session.resources.get('perspectiveObservations')
      const posRef = getPerspectivePositionsRef(ctx, scope)
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

  return handler({
    name: blockName,
    inputSchema: perspectiveChallengeInputSchema,
    outputSchema: z.object({ challenged: z.boolean() }),
    sessionResources: {
      perspectiveObservations: perspectiveObservationsResource,
      ...(scope === 'session' ? { perspectivePositions: perspectivePositionsResource } : {}),
    },
    ...(scope === 'user' ? { userResources: { perspectivePositions: perspectivePositionsResource } } : {}),
    ...(scope === 'project' ? { projectResources: { perspectivePositions: perspectivePositionsResource } } : {}),
    execute: async (input, ctx) => {
      const obsRef = ctx.session.resources.get('perspectiveObservations')
      const posRef = getPerspectivePositionsRef(ctx, scope)
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

  return handler({
    name: blockName,
    inputSchema: z.any(),
    outputSchema: perspectiveSnapshotOutputSchema,
    sessionResources: {
      perspectiveObservations: perspectiveObservationsResource,
      ...(scope === 'session' ? { perspectivePositions: perspectivePositionsResource } : {}),
    },
    ...(scope === 'user' ? { userResources: { perspectivePositions: perspectivePositionsResource } } : {}),
    ...(scope === 'project' ? { projectResources: { perspectivePositions: perspectivePositionsResource } } : {}),
    execute: async (_input, ctx) => {
      const obsRef = ctx.session.resources.get('perspectiveObservations')
      const posRef = getPerspectivePositionsRef(ctx, scope)
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
    sessionResources: { perspectiveObservations: perspectiveObservationsResource },
    execute: async (_input, ctx) => {
      const ref = ctx.session.resources.get('perspectiveObservations')
      await advancePerspectiveObservations(ref)
    },
  })
}

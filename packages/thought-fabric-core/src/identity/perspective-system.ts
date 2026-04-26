/**
 * Perspective system factory — assembles the full bundle for a perspective.
 *
 * `system(instance, options?)` returns a `PerspectiveSystem`: pre-configured
 * blocks (apply, analyze, auditor, observe, position, challenge, snapshot,
 * advance), a `capture` sequencer (analyze → observe), the capability ref,
 * and helper utilities. Mirrors the shape of `memory.system()` from the
 * memory domain.
 *
 * The factory wires shared resource refs through all blocks so multiple
 * blocks within the same flow operate on the same observations and
 * positions resources — important when `positionScope` is non-default.
 *
 * Individual block factories (`perspectiveObserve` etc.) remain exported
 * for full remixability. Use `system()` when you want a coherent bundle;
 * use the individual factories when you want to assemble pipelines from
 * scratch.
 */

import { sequencer } from '@flow-state-dev/core'
import { perspectiveInputSchema } from './perspective.js'
import type {
  PerspectiveInstance,
  PerspectiveObservation,
  PerspectivePosition,
} from './perspective.js'
import {
  formatPerspectiveAccumulated,
  perspectiveObservations,
  perspectivePositions,
} from './perspective-helpers.js'
import {
  perspectiveApply,
  perspectiveAnalyze,
  perspectiveAuditor,
  perspectiveObserve,
  perspectivePosition,
  perspectiveChallenge,
  perspectiveSnapshot,
  perspectiveAdvance,
  buildPerspectiveResources,
} from './perspective-blocks.js'
import type { PositionScope } from './perspective-blocks.js'
import { createPerspectiveCapability } from './perspective-capability.js'
import type { PerspectiveCapability } from './perspective-capability.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Configuration for `system(instance, options?)`. */
export interface PerspectiveSystemConfig {
  /**
   * Position scope. Default: 'session'.
   *
   * - `'session'`: positions reset each session.
   * - `'user'`: positions persist for the user across sessions.
   * - `'org'`: positions persist within an org across users.
   */
  positionScope?: PositionScope
  /** Model ID for generator blocks. Default: 'preset/fast'. */
  model?: string
  /** Override the system name prefix. Default: derived from perspective name. */
  name?: string
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

/** A ranked accumulated entry from the recall helper. */
export interface PerspectiveAccumulated {
  observations: PerspectiveObservation[]
  positions: PerspectivePosition[]
  turnCounter: number
}

/** The full perspective system bundle returned by `system()`. */
export interface PerspectiveSystem {
  // -- Static blocks (pre-configured with the instance) --
  apply: ReturnType<typeof perspectiveApply>
  analyze: ReturnType<typeof perspectiveAnalyze>
  auditor: ReturnType<typeof perspectiveAuditor>

  // -- Stateful blocks (wired with shared resource refs) --
  observe: ReturnType<typeof perspectiveObserve>
  position: ReturnType<typeof perspectivePosition>
  challenge: ReturnType<typeof perspectiveChallenge>
  snapshot: ReturnType<typeof perspectiveSnapshot>
  advance: ReturnType<typeof perspectiveAdvance>

  // -- Bundled sequencer: analyze → observe (the "sticky" pattern) --
  /**
   * Sequencer that analyzes content through the perspective's lens and
   * captures the resulting `salienceNotes` as observations in the resource.
   * Use this as the primary entry point when you want analyses to
   * accumulate into the perspective's evolving state.
   */
  capture: ReturnType<typeof sequencer>

  // -- Capability for declarative use via `uses: [cap]` --
  capability: PerspectiveCapability

  // -- Original frozen instance --
  instance: PerspectiveInstance

  // -- Resource declarations for defineFlow --
  /** Spread into `defineFlow`'s `session.resources`. */
  sessionResources: Record<string, unknown>
  /** Spread into `defineFlow`'s `user.resources` (empty when positionScope ≠ 'user'). */
  userResources: Record<string, unknown>
  /** Spread into `defineFlow`'s `project.resources` (empty when positionScope ≠ 'org'). */
  orgResources: Record<string, unknown>

  // -- Helpers exposed for advanced/manual use --
  /** Read accumulated observations + positions from a runtime context. */
  recall: (ctx: any) => PerspectiveAccumulated
  /** Context formatter for generator `context: [...]` slots — equivalent to the `accumulated` preset. */
  contextFormatter: (input: any, ctx: any) => string
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a perspective system bundle.
 *
 * ```ts
 * import { perspective, system } from '@thought-fabric/core/identity'
 *
 * const securityEngineer = perspective({ ... })
 * const sec = system(securityEngineer, { positionScope: 'user', model: 'gpt-5' })
 *
 * // Use the capability to wire resources + context into your generator
 * const chat = generator({ uses: [sec.capability], ... })
 *
 * // Or use the bundled capture sequencer to analyze + record observations
 * const pipeline = sequencer({ name: 'review' })
 *   .work((input) => ({ content: input.proposal }), sec.capture)
 *   .then(nextBlock)
 *
 * // Read accumulated state directly
 * const state = sec.recall(ctx)  // { observations, positions, turnCounter }
 * ```
 */
export function system(
  instance: PerspectiveInstance,
  config?: PerspectiveSystemConfig,
): PerspectiveSystem {
  const positionScope: PositionScope = config?.positionScope ?? 'session'
  const model = config?.model
  const namePrefix = config?.name ?? instance.name

  // Pre-configured static blocks
  const apply = perspectiveApply({
    name: `${namePrefix}/apply`,
    perspective: instance,
  })
  const analyze = perspectiveAnalyze({
    name: `${namePrefix}/analyze`,
    perspective: instance,
    ...(model ? { model } : {}),
  })
  const auditor = perspectiveAuditor({
    name: `${namePrefix}/auditor`,
    perspective: instance,
    ...(model ? { model } : {}),
  })

  // Pre-configured stateful blocks. They import the singleton resources
  // directly, so the bundle and capability automatically agree on refs.
  const observe = perspectiveObserve({
    name: `${namePrefix}/observe`,
    perspective: instance,
  })
  const position = perspectivePosition({
    name: `${namePrefix}/position`,
    perspective: instance,
    positionScope,
  })
  const challenge = perspectiveChallenge({
    name: `${namePrefix}/challenge`,
    perspective: instance,
    positionScope,
  })
  const snapshot = perspectiveSnapshot({
    name: `${namePrefix}/snapshot`,
    perspective: instance,
    positionScope,
  })
  const advance = perspectiveAdvance({
    name: `${namePrefix}/advance`,
    perspective: instance,
  })

  // Bundled capture sequencer: analyze → observe.
  // Takes raw content, produces a PerspectiveAnalysis AND records the
  // analysis's salienceNotes as observations.
  const capture = sequencer({
    name: `${namePrefix}/capture`,
    inputSchema: perspectiveInputSchema,
  })
    .then(analyze)
    .tap(observe)

  const capability = createPerspectiveCapability(instance, { positionScope })

  const sessionResources = capability.sessionResources ?? {}
  const userResources = capability.userResources ?? {}
  const orgResources = capability.orgResources ?? {}

  const posReference = (ctx: any) => {
    return positionScope === 'session'
      ? ctx.session.resources.perspectivePositions
      : positionScope === 'user'
        ? ctx.user?.resources?.perspectivePositions
        : ctx.org?.resources?.perspectivePositions
  }

  // Recall helper — reads accumulated state from a runtime ctx
  function recall(ctx: any): PerspectiveAccumulated {
    const obsRef = ctx.session.resources.perspectiveObservations
    const posRef = posReference(ctx)
    return {
      observations: obsRef ? perspectiveObservations(obsRef) : [],
      positions: posRef ? perspectivePositions(posRef) : [],
      turnCounter: obsRef?.state?.turnCounter ?? 0,
    }
  }

  // Context formatter — equivalent to the capability's `accumulated` preset
  function contextFormatter(_input: any, ctx: any): string {
    const obsRef = ctx.session.resources.perspectiveObservations
    const posRef = posReference(ctx)
    return formatPerspectiveAccumulated(obsRef, posRef)
  }

  return {
    apply,
    analyze,
    auditor,
    observe,
    position,
    challenge,
    snapshot,
    advance,
    capture,
    capability,
    instance,
    sessionResources,
    userResources,
    orgResources,
    recall,
    contextFormatter,
  }
}

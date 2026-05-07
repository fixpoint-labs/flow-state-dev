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
import type { DefinedResource } from '@flow-state-dev/core'
import { z } from 'zod'
import {
  perspectiveInputSchema,
  perspectiveObservationsResource,
  createPerspectivePositionsResource,
  perspectivePositionsResource,
} from './perspective.js'
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
  /** Model ID for generator blocks. Default: 'intent/utility'. */
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
  /**
   * Flat resource map for this system — accessor key → DefinedResource.
   * Spread into a flow's `resources` declaration; each entry's intrinsic
   * `scope` (set on `defineResource`) routes it to the right storage layer
   * under FIX-435.
   */
  resources: Record<string, DefinedResource>

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

  // Create a single positions resource at the configured scope and share it
  // across the bundled blocks and capability so they all reference the same
  // `defineResource()` instance — required for FIX-435's same-reference rule
  // and for tests that compare resource identity across the bundle.
  const positionsResource: DefinedResource = positionScope === 'session'
    ? perspectivePositionsResource
    : createPerspectivePositionsResource(positionScope)

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

  // Pre-configured stateful blocks. Pass the shared positions resource so
  // every block declares the same `defineResource()` instance under the
  // unified `resources` map.
  const observe = perspectiveObserve({
    name: `${namePrefix}/observe`,
    perspective: instance,
  })
  const position = perspectivePosition({
    name: `${namePrefix}/position`,
    perspective: instance,
    positionScope,
    positionsResource,
  })
  const challenge = perspectiveChallenge({
    name: `${namePrefix}/challenge`,
    perspective: instance,
    positionScope,
    positionsResource,
  })
  const snapshot = perspectiveSnapshot({
    name: `${namePrefix}/snapshot`,
    perspective: instance,
    positionScope,
    positionsResource,
  })
  const advance = perspectiveAdvance({
    name: `${namePrefix}/advance`,
    perspective: instance,
  })

  // Bundled capture sequencer: analyze → observe.
  // Takes raw content, produces a PerspectiveAnalysis AND records the
  // analysis's salienceNotes as observations.
  //
  // The outer schema is intentionally looser than `perspectiveInputSchema`
  // (which requires non-empty content) — capture is commonly wired into
  // `.work()` background slots that receive whatever a generator produced,
  // including empty strings when an upstream call short-circuits. Treating
  // empty content as a no-op here keeps a transient upstream issue from
  // surfacing as a background-work failure.
  const captureInputSchema = z.object({
    content: z.string(),
    context: z.string().optional(),
  })
  const captureCore = sequencer({
    name: `${namePrefix}/capture/run`,
    inputSchema: perspectiveInputSchema,
  })
    .then(analyze)
    .tap(observe)
  const capture = sequencer({
    name: `${namePrefix}/capture`,
    inputSchema: captureInputSchema,
  })
    .thenIf((input) => input.content.length > 0, captureCore)

  const capability = createPerspectiveCapability(instance, { positionScope, positionsResource })

  const resources: Record<string, DefinedResource> = {
    perspectiveObservations: perspectiveObservationsResource,
    perspectivePositions: positionsResource,
  }

  // Recall helper — reads accumulated state from a runtime ctx
  function recall(ctx: any): PerspectiveAccumulated {
    const obsRef = ctx.resources?.perspectiveObservations ?? ctx.resources?.get?.('perspectiveObservations')
    const posRef = ctx.resources?.perspectivePositions ?? ctx.resources?.get?.('perspectivePositions')
    return {
      observations: obsRef ? perspectiveObservations(obsRef) : [],
      positions: posRef ? perspectivePositions(posRef) : [],
      turnCounter: obsRef?.state?.turnCounter ?? 0,
    }
  }

  // Context formatter — equivalent to the capability's `accumulated` preset
  function contextFormatter(_input: any, ctx: any): string {
    const obsRef = ctx.resources?.perspectiveObservations ?? ctx.resources?.get?.('perspectiveObservations')
    const posRef = ctx.resources?.perspectivePositions ?? ctx.resources?.get?.('perspectivePositions')
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
    resources,
    recall,
    contextFormatter,
  }
}

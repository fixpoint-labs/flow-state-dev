/**
 * Perspective capability — defineCapability() surface for the identity domain.
 *
 * A `PerspectiveCapability` packages a frozen `PerspectiveInstance` together
 * with the observations and positions resources that hold the perspective's
 * evolving runtime state. Blocks that declare `uses: [cap]` automatically
 * gain:
 *
 * - Resource installation in the appropriate scope (session for observations,
 *   configurable for positions)
 * - Two context presets (`static`, `accumulated`) — both on by default for
 *   generators, individually opt-out-able via `cap.presets({ ... })`
 * - Typed helpers via `ctx.cap.perspective.*` — `observe()`, `position()`,
 *   `challenge()`, `observations()`, `positions()`, `format()`, etc.
 *
 * Use one resource-backed perspective capability per block/flow. Static
 * perspective blocks can be composed freely, but capability helpers live at
 * `ctx.cap.perspective`, so multiple resource-backed capabilities would share
 * the same namespace.
 */

import { defineCapability } from '@flow-state-dev/core'
import type { ResourceContext } from '@flow-state-dev/core'

import {
  perspectiveObservationsResource,
  perspectivePositionsResource,
  createPerspectivePositionsResource,
} from './perspective.js'
import type {
  PerspectiveInstance,
  PerspectiveObservationsState,
  PerspectivePositionsState,
} from './perspective.js'
import {
  formatPerspective,
  formatPerspectiveAccumulated,
  addPerspectiveObservation,
  removePerspectiveObservation,
  perspectiveObservations,
  advancePerspectiveObservations,
  addPerspectivePosition,
  challengePerspectivePosition,
  removePerspectivePosition,
  perspectivePositions,
} from './perspective-helpers.js'
import type {
  AddPerspectiveObservationInput,
  AddPerspectivePositionInput,
} from './perspective-helpers.js'
import type { PositionScope } from './perspective-blocks.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Configuration for `createPerspectiveCapability`. */
export interface PerspectiveCapabilityConfig {
  /**
   * Where positions live.
   *
   * - `'session'` (default): positions reset each session, aligned with observations.
   * - `'user'`: positions persist across sessions for the same user.
   * - `'project'`: positions persist across users within a project.
   *
   * Observations are always session-scoped — they're inherently tied to the
   * conversation they emerged from.
   */
  positionScope?: PositionScope
  /**
   * Override the observations resource reference.
   *
   * Internal hook used by `system()` so bundled blocks and the capability
   * declare the same resource reference.
   *
   * @internal
   */
  _observationsResource?: typeof perspectiveObservationsResource
  /**
   * Override the positions resource reference.
   *
   * Internal hook used by `system()` so bundled blocks and the capability
   * declare the same resource reference when positions live outside the
   * default session singleton.
   *
   * @internal
   */
  _positionsResource?: typeof perspectivePositionsResource
}

// ---------------------------------------------------------------------------
// Internal: scope-aware position ref lookup
// ---------------------------------------------------------------------------

function getPositionsRef(
  ctx: any,
  scope: PositionScope,
): ResourceContext<PerspectivePositionsState> {
  if (scope === 'session') return ctx.session.resources.perspectivePositions
  if (scope === 'user') return ctx.user?.resources?.perspectivePositions
  return ctx.project?.resources?.perspectivePositions
}

function getObservationsRef(ctx: any): ResourceContext<PerspectiveObservationsState> {
  return ctx.session.resources.perspectiveObservations
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a perspective capability bound to a specific perspective instance.
 *
 * The returned capability declares the observations resource (always
 * session-scoped) and a positions resource at the configured scope. It
 * exposes typed helpers via `ctx.cap.perspective.*` and two context
 * presets:
 *
 * - `static` (default on): the initial perspective framing — role, salience,
 *   reasoning, expertise, communication style. Equivalent to the Phase A
 *   `formatPerspective(instance)` output.
 * - `accumulated` (default on): observations and positions formatted from
 *   the resource state. Empty until the perspective starts recording.
 *
 * Disable either preset via `cap.presets({ accumulated: false })` when
 * token budget is tight or when the block doesn't need the framing.
 *
 * ```ts
 * const securityEngineer = perspective({ ... })
 * const cap = createPerspectiveCapability(securityEngineer, {
 *   positionScope: 'user',
 * })
 *
 * const analyze = generator({
 *   name: 'security-analyze',
 *   model: 'gpt-5',
 *   uses: [cap],
 *   // Auto-gets: framing + accumulated context, ctx.cap.perspective.*
 * })
 *
 * const observe = handler({
 *   name: 'capture-findings',
 *   uses: [cap.presets({ accumulated: false, static: false })],
 *   execute: async (input, ctx) => {
 *     await ctx.cap.perspective.observe({
 *       content: 'Auth endpoint lacks rate limiting',
 *       category: 'concern',
 *       confidence: 0.9,
 *     })
 *   },
 * })
 * ```
 */
export function createPerspectiveCapability(
  instance: PerspectiveInstance,
  config?: PerspectiveCapabilityConfig,
) {
  const positionScope: PositionScope = config?.positionScope ?? 'session'

  // Observations are always session-scoped (singleton resource).
  const observationsResource = config?._observationsResource ?? perspectiveObservationsResource

  // Positions resource: use override from system() when provided so the
  // capability and bundled blocks share the same underlying state.
  const positionsResource = config?._positionsResource
    ?? (positionScope === 'session'
      ? perspectivePositionsResource
      : createPerspectivePositionsResource(positionScope))

  return defineCapability({
    name: 'perspective' as const,
    sessionResources: {
      perspectiveObservations: observationsResource,
      ...(positionScope === 'session' ? { perspectivePositions: positionsResource } : {}),
    },
    ...(positionScope === 'user'
      ? { userResources: { perspectivePositions: positionsResource } }
      : {}),
    ...(positionScope === 'project'
      ? { projectResources: { perspectivePositions: positionsResource } }
      : {}),
    fns: (ctx: any) => {
      const obsRef = getObservationsRef(ctx)
      const posRef = getPositionsRef(ctx, positionScope)
      return {
        // -- Observations --
        /** Record an observation in the session-scoped observations resource. */
        observe: (input: AddPerspectiveObservationInput) => addPerspectiveObservation(obsRef, input),
        /** Remove an observation by ID. Returns true if found. */
        forget: (id: string) => removePerspectiveObservation(obsRef, id),
        /** Read observations, optionally filtered by category. */
        observations: (category?: string) => perspectiveObservations(obsRef, category),
        /** Bump the observation turn counter. */
        advance: () => advancePerspectiveObservations(obsRef),

        // -- Positions --
        /** Record a position the perspective has reached. */
        position: (input: AddPerspectivePositionInput) => addPerspectivePosition(posRef, input, obsRef),
        /** Append counter-evidence to a position. Returns true if found. */
        challenge: (positionId: string, evidence: string) =>
          challengePerspectivePosition(posRef, positionId, evidence, obsRef),
        /** Remove a position by ID. Returns true if found. */
        forgetPosition: (id: string) => removePerspectivePosition(posRef, id),
        /** Read all positions in insertion order. */
        positions: () => perspectivePositions(posRef),

        // -- Inspection --
        /** Access the frozen perspective configuration (the static instance). */
        instance: () => instance,
        /** Combined formatted output of observations + positions. */
        format: () => formatPerspectiveAccumulated(obsRef, posRef),
      }
    },
    presets: {
      /**
       * Static perspective framing — role, salience, reasoning, expertise,
       * communication style. On by default for generators.
       */
      static: {
        context: [(_input: any, _ctx: any) => formatPerspective(instance)],
      },
      /**
       * Accumulated observations + positions from the resources. On by
       * default for generators. Empty string when both resources are empty.
       */
      accumulated: {
        context: [(_input: any, ctx: any) => {
          const obsRef = getObservationsRef(ctx)
          const posRef = getPositionsRef(ctx, positionScope)
          return formatPerspectiveAccumulated(obsRef, posRef)
        }],
      },
      default: ['static', 'accumulated'],
    },
  })
}

/** Returned capability type — exposes the helpers shape via `ctx.cap.perspective`. */
export type PerspectiveCapability = ReturnType<typeof createPerspectiveCapability>

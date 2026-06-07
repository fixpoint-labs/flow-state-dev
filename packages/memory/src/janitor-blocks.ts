/**
 * Janitor block — the deterministic hygiene pass that decays semantic
 * confidence, culls persistent episodes past their TTL, and flags long-
 * silent permanent episodes.
 *
 * Composed by `memorySystemCapture` / `memorySystemConsolidate` (or invoked
 * manually via `mem.janitor`). State-mutation-only: no `outputSchema`, no
 * `return input` — see BP-012 / BP-014.
 */

import { handler } from '@flow-state-dev/core'
import { z } from 'zod'
import { workingMemoryResource } from './working-memory'
import { memorySystemResource } from './memory-system'
import { createEpisodicMemoryResource } from './episodic-memory'
import { createSemanticMemoryResource } from './semantic-memory'
import { cullByEffectiveConfidence, knownSubjects } from './semantic-memory-helpers'
import { cullByTTL, markStale } from './episodic-memory-helpers'
import type { EpisodicTTLConfig } from './episodic-memory-helpers'
import { janitorResource } from './janitor'
import type { MemorySystemBlocksConfig } from './memory-system-blocks'

/**
 * Resolved hygiene configuration passed into the janitor block. The factory
 * (`memory.system()`) collapses `true | false | object` shapes into this
 * concrete form before reaching here.
 */
export interface ResolvedHygieneConfig {
  /** Confidence-decay parameters, or `false` to skip the semantic branch. */
  confidenceDecay: false | { halfLife: number; cullFloor: number }
  /** Episodic-TTL parameters, or `false` to skip the episodic branch. */
  episodicTTL: false | (EpisodicTTLConfig & { permanentStaleDays: number })
  /** Where the janitor is auto-scheduled, or `'manual'` for no auto-wiring. */
  schedule: 'onConsolidation' | 'onCapture' | 'manual'
}

/**
 * Create the memory janitor block.
 *
 * Runs every configured hygiene pass:
 *   1. Decays semantic-fact confidence at read time (here we cull facts
 *      whose effective confidence has fallen below `cullFloor`).
 *   2. Culls persistent episodes past their turn / wall-time TTL.
 *   3. Marks permanent episodes that have gone silent past
 *      `permanentStaleDays` (never culls them).
 *
 * Records what it touched on the session-scoped `janitor` resource so
 * operators can inspect the most recent run.
 *
 * No `outputSchema` and no return value — pure state mutation. Composed
 * downstream via `.tap()` or `.work()`.
 */
export function memorySystemJanitor(
  config: MemorySystemBlocksConfig & { hygiene: ResolvedHygieneConfig },
) {
  const semanticResource = config._semanticResource ?? (config.semantic
    ? createSemanticMemoryResource(config.semantic.scope)
    : undefined)
  const episodicResource = config._episodicResource ?? (config.episodic
    ? createEpisodicMemoryResource(config.episodic.scope)
    : undefined)

  const hygiene = config.hygiene

  return handler({
    name: config.name ? `${config.name}/janitor` : 'memory/janitor',
    inputSchema: z.any(),
    // No outputSchema — state mutation only (BP-012, BP-014).
    resources: {
      workingMemory: workingMemoryResource,
      memorySystem: memorySystemResource,
      janitor: janitorResource,
      // Semantic and episodic are conditionally installed — the janitor's
      // body silently no-ops on whichever tier is absent.
      ...(semanticResource ? { semanticMemory: semanticResource } : {}),
      ...(episodicResource ? { episodicMemory: episodicResource } : {}),
    },
    execute: async (_input, ctx) => {
      const wmRef = ctx.resources.workingMemory
      const janRef = ctx.resources.janitor
      const currentTurn = wmRef.state.currentTurn ?? 0
      // Semantic and episodic resources are installed conditionally above,
      // which forces the inferred ctx type to a wider shape. Cast at the
      // point of use to the specific helper signatures.
      const semRef = ctx.resources.semanticMemory as any
      const epRef = ctx.resources.episodicMemory as any

      const now = Date.now()

      let culledFactIds: string[] = []
      let culledEpisodeIds: string[] = []
      let markedStaleEpisodeIds: string[] = []

      if (semRef && hygiene.confidenceDecay) {
        try {
          const { halfLife, cullFloor } = hygiene.confidenceDecay
          culledFactIds = await cullByEffectiveConfidence(semRef, now, halfLife, cullFloor)
        } catch (err) {
          console.warn('[memory] janitor: confidence-decay cull failed:', (err as Error).message ?? err)
        }
      }

      // Relations dangling-edge cleanup (FIX-745): after fact culls land, drop
      // edges whose endpoints no longer correspond to a stored fact subject.
      // Runs only when relations is enabled and the live ref carries the edge
      // API. Non-fatal — a failure here must not crash the hygiene pass.
      if (semRef?.edges && config.semantic?.relations) {
        try {
          await semRef.edges.pruneDangling(knownSubjects(semRef))
        } catch (err) {
          console.warn('[memory] janitor: dangling-edge prune failed:', (err as Error).message ?? err)
        }
      }

      if (epRef && hygiene.episodicTTL) {
        const ttl = hygiene.episodicTTL
        try {
          culledEpisodeIds = await cullByTTL(epRef, currentTurn, now, ttl)
        } catch (err) {
          console.warn('[memory] janitor: episodic TTL cull failed:', (err as Error).message ?? err)
        }
        try {
          markedStaleEpisodeIds = await markStale(epRef, now, ttl.permanentStaleDays)
        } catch (err) {
          console.warn('[memory] janitor: stale-marking failed:', (err as Error).message ?? err)
        }
      }

      await janRef.updateState((s) => ({
        ...s,
        lastRunTurn: currentTurn,
        lastRunAt: new Date(now).toISOString(),
        totalRuns: (s.totalRuns ?? 0) + 1,
        lastCulledFactIds: culledFactIds,
        lastCulledEpisodeIds: culledEpisodeIds,
        lastMarkedStaleEpisodeIds: markedStaleEpisodeIds,
      }))
    },
  })
}

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
import type { BlockContext } from '@flow-state-dev/core/types'
import { z } from 'zod'
import { workingMemoryResource } from './working-memory.js'
import { memorySystemResource } from './memory-system.js'
import { createEpisodicMemoryResource } from './episodic-memory.js'
import { createSemanticMemoryResource } from './semantic-memory.js'
import { cullByEffectiveConfidence } from './semantic-memory-helpers.js'
import { cullByTTL, markStale } from './episodic-memory-helpers.js'
import type { EpisodicTTLConfig } from './episodic-memory-helpers.js'
import { janitorResource } from './janitor.js'
import type { MemorySystemBlocksConfig } from './memory-system-blocks.js'

type JanitorBlockCtx = BlockContext<
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, any>
>

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

  async function execute(_input: unknown, ctx: JanitorBlockCtx) {
    const wmRef = ctx.resources.workingMemory as any
    const janRef = ctx.resources.janitor as any
    const currentTurn = wmRef?.state?.currentTurn ?? 0

    // Resource lookups happen at runtime — missing stores are silently
    // skipped so the janitor builds cleanly even when one tier is absent.
    let semRef: any = undefined
    try { semRef = ctx.resources?.semanticMemory } catch { /* not installed */ }
    let epRef: any = undefined
    try { epRef = ctx.resources?.episodicMemory } catch { /* not installed */ }

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

    if (janRef?.updateState) {
      await janRef.updateState((s: any) => ({
        ...s,
        lastRunTurn: currentTurn,
        lastRunAt: new Date(now).toISOString(),
        totalRuns: (s.totalRuns ?? 0) + 1,
        lastCulledFactIds: culledFactIds,
        lastCulledEpisodeIds: culledEpisodeIds,
        lastMarkedStaleEpisodeIds: markedStaleEpisodeIds,
      }))
    }
  }

  const resources: Record<string, any> = {
    workingMemory: workingMemoryResource,
    memorySystem: memorySystemResource,
    janitor: janitorResource,
  }
  if (semanticResource) resources.semanticMemory = semanticResource
  if (episodicResource) resources.episodicMemory = episodicResource

  return handler({
    name: config.name ? `${config.name}/janitor` : 'memory/janitor',
    inputSchema: z.any(),
    // No outputSchema — state mutation only (BP-012, BP-014).
    resources,
    execute,
  })
}

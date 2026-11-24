/**
 * Memory hygiene primitives — confidence decay, durability-TTL janitor.
 *
 * Pure helpers and the session-scoped tracking resource for the janitor
 * pass that culls decayed semantic facts, evicts stale persistent
 * episodes, and flags long-silent permanent episodes. The `memorySystemJanitor`
 * block factory lives in `./janitor-blocks.ts` and consumes these helpers.
 *
 * Design notes:
 * - `effectiveConfidence` is computed at read time, never stored. Avoids
 *   write amplification and clock-drift staleness on long-lived facts.
 * - All defaults are deliberately conservative: a 180-day half-life
 *   minimises behavioural surprise on existing deployments. Tuners can
 *   pass shorter half-lives via `hygiene.confidenceDecay.halfLife`.
 */

import { defineResource } from '@flow-state-dev/core'
import { z } from 'zod'
import type { SemanticFact } from './semantic-memory'

/** Milliseconds in a day. Used to convert elapsed ms into elapsed days. */
const MS_PER_DAY = 1000 * 60 * 60 * 24

/**
 * Default hygiene configuration values. Exported so callers building custom
 * janitor flows can read the same defaults the memory system uses.
 *
 * `confidenceDecay.halfLife` — 180 days; conservative. Industry analogs
 * cluster lower (7–30 days first-contact, 90–140 days for reinforced); the
 * issue authors deliberately picked a long horizon so existing users see no
 * surprise in the first weeks. Tunable.
 *
 * `confidenceDecay.cullFloor` — facts whose effective confidence drops below
 * this value are removed by `cullByEffectiveConfidence`.
 *
 * `episodicTTL.persistentTurns` / `persistentDays` — wall-time and turn-count
 * thresholds for culling persistent episodes. Combined with `operator: 'OR'`
 * the janitor culls when either threshold fires.
 *
 * `episodicTTL.permanentStaleDays` — permanent episodes are NEVER culled;
 * after this many days of silence they pick up a `stale: true` marker that
 * operators can inspect.
 */
export const DEFAULT_HYGIENE_CONFIG = {
  confidenceDecay: { halfLife: 180, cullFloor: 0.1 },
  episodicTTL: {
    persistentTurns: 500,
    persistentDays: 90,
    operator: 'OR' as const,
    permanentStaleDays: 180,
  },
  schedule: 'onConsolidation' as const,
}

/**
 * Compute the time-decayed effective confidence of a semantic fact.
 *
 * Uses an exponential decay anchored on `lastReinforced` (or `extractedAt`
 * as a fallback when `lastReinforced` is missing on facts created before
 * the V1 bug fix in `addFact`):
 *
 *     effective = confidence × 0.5 ^ (elapsedDays / halfLife)
 *
 * Output is clamped to `[0, fact.confidence]`. The upper clamp is defensive
 * against clock skew producing a negative `elapsed`; the lower clamp guards
 * against numerical underflow.
 *
 * @param fact     Semantic fact with `confidence`, optional `lastReinforced`,
 *                 and `extractedAt`.
 * @param now      Reference time as a unix-ms timestamp. Defaults to `Date.now()`.
 * @param halfLife Half-life in days. Defaults to
 *                 `DEFAULT_HYGIENE_CONFIG.confidenceDecay.halfLife` (180).
 * @returns        Effective confidence in `[0, fact.confidence]`.
 */
export function effectiveConfidence(
  fact: Pick<SemanticFact, 'confidence' | 'lastReinforced' | 'extractedAt'>,
  now: number = Date.now(),
  halfLife: number = DEFAULT_HYGIENE_CONFIG.confidenceDecay.halfLife,
): number {
  const anchor = fact.lastReinforced ?? fact.extractedAt
  const anchorMs = Date.parse(anchor)
  if (!Number.isFinite(anchorMs)) return fact.confidence

  const elapsedDays = (now - anchorMs) / MS_PER_DAY
  if (elapsedDays <= 0) return fact.confidence

  const decayed = fact.confidence * Math.pow(0.5, elapsedDays / halfLife)
  if (!Number.isFinite(decayed) || decayed < 0) return 0
  if (decayed > fact.confidence) return fact.confidence
  return decayed
}

/**
 * Schema for the session-scoped janitor tracking resource.
 *
 * `lastCulled*` arrays hold the IDs touched on the MOST RECENT run only —
 * the resource is a snapshot, not a history. Each janitor pass overwrites
 * them. This is the V1 observability surface; an evicted-memory event
 * stream is intentionally out of scope.
 */
export const janitorStateSchema = z.object({
  /** Turn number at which the janitor most recently ran. */
  lastRunTurn: z.number().int().min(0).default(0),
  /** ISO datetime of the most recent janitor run. */
  lastRunAt: z.string().datetime().optional(),
  /** Cumulative count of janitor runs across the session. */
  totalRuns: z.number().int().min(0).default(0),
  /** Fact IDs culled in the most recent run. */
  lastCulledFactIds: z.array(z.string()).default([]),
  /** Episode IDs culled in the most recent run. */
  lastCulledEpisodeIds: z.array(z.string()).default([]),
  /** Episode IDs newly marked `stale: true` in the most recent run. */
  lastMarkedStaleEpisodeIds: z.array(z.string()).default([]),
})

/** Janitor tracking state. */
export type JanitorState = z.infer<typeof janitorStateSchema>

/**
 * Session-scoped tracking resource for the memory janitor.
 *
 * Each run overwrites the `lastCulled*` arrays with the IDs touched. Inspect
 * via DevTool or the resource registry to see what the most recent run did.
 */
export const janitorResource = defineResource({
  ref: 'janitor',
  scope: 'session',
  stateSchema: janitorStateSchema,
  default: {
    lastRunTurn: 0,
    totalRuns: 0,
    lastCulledFactIds: [],
    lastCulledEpisodeIds: [],
    lastMarkedStaleEpisodeIds: [],
  },
  writable: true,
})

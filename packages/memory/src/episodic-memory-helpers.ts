import type { ResourceContext } from '@flow-state-dev/core'
import type { Episode, EpisodicMemoryState } from './episodic-memory'
import { shortId } from '@flow-state-dev/core/helpers'

type EpRef = ResourceContext<EpisodicMemoryState>

/** Milliseconds in a day. */
const MS_PER_DAY = 1000 * 60 * 60 * 24

/**
 * Input for encoding a new episode — ID, `encodedAt`, `consolidated`, and
 * `stale` are generated automatically. `durability` must be supplied by the
 * caller (reflect routes only `'persistent'` and `'permanent'` items here).
 * `subject` is the observer-computed owner of the episode (`'user'` or a
 * lowercase name); reflect passes its normalized subject so consolidation
 * inherits ownership rather than re-deriving it.
 */
export type EncodeEpisodeInput = Omit<Episode, 'id' | 'encodedAt' | 'consolidated' | 'stale'>

/**
 * Encode a new episode into episodic memory.
 *
 * Generates a unique ID and sets `encodedAt` to the current time.
 * When the store reaches `maxEpisodes`, the oldest consolidated episode
 * is evicted first; if none are consolidated, the oldest unconsolidated
 * episode is evicted instead.
 */
export async function encode(
  ref: EpRef,
  episode: EncodeEpisodeInput,
  maxEpisodes: number,
): Promise<Episode> {
  const newEpisode: Episode = {
    ...episode,
    // Default the owner to the primary user if a caller omits it, so the stored
    // episode object always carries a subject (readers use `ep.subject ?? 'user'`,
    // but this keeps the in-memory record well-formed before any schema reparse).
    subject: episode.subject ?? 'user',
    id: `ep_${shortId(6)}`,
    encodedAt: new Date().toISOString(),
    consolidated: false,
    stale: false,
  }

  await ref.updateState((s: EpisodicMemoryState) => {
    let episodes = [...s.episodes]

    // Enforce episode cap
    if (episodes.length >= maxEpisodes) {
      // Prefer evicting oldest consolidated episode
      const consolidatedIdx = episodes.findIndex((e) => e.consolidated)
      if (consolidatedIdx >= 0) {
        episodes.splice(consolidatedIdx, 1)
      } else {
        // No consolidated episodes — evict the oldest unconsolidated
        episodes.splice(0, 1)
      }
    }

    episodes.push(newEpisode)
    return {
      episodes,
      totalEncoded: s.totalEncoded + 1,
    }
  })

  return newEpisode
}

/**
 * Get recent episodes sorted by `occurredAtTurn` descending (most recent first).
 * Optionally limit the number of results.
 */
export function recent(ref: EpRef, limit?: number): Episode[] {
  const sorted = [...ref.state.episodes].sort(
    (a, b) => b.occurredAtTurn - a.occurredAtTurn,
  )
  return limit != null ? sorted.slice(0, limit) : sorted
}

/**
 * TTL configuration for `cullByTTL`. Mirrors
 * `HygieneConfig.episodicTTL` so the janitor can pass its resolved config
 * through unchanged.
 */
export interface EpisodicTTLConfig {
  /** Cull persistent episodes encoded more than this many turns ago. */
  persistentTurns: number
  /** Cull persistent episodes encoded more than this many days ago. */
  persistentDays: number
  /**
   * `'OR'` (default) — cull when either turn-count OR wall-time threshold
   * fires. `'AND'` — require both thresholds. Knowledge is preserved in
   * consolidation-derived semantic facts either way; `'OR'` is the
   * conservative, default-on shape.
   */
  operator: 'OR' | 'AND'
}

/**
 * Cull persistent episodes that have crossed the configured TTL thresholds.
 *
 * Permanent episodes are NEVER touched here — they are sacrosanct and only
 * pick up a `stale: true` marker via `markStale`. Returns the IDs of culled
 * episodes so the caller can record them on the janitor resource.
 */
export async function cullByTTL(
  ref: EpRef,
  currentTurn: number,
  now: number,
  ttl: EpisodicTTLConfig,
): Promise<string[]> {
  const culled: string[] = []
  await ref.updateState((s: EpisodicMemoryState) => {
    const surviving: Episode[] = []
    for (const ep of s.episodes) {
      if (ep.durability !== 'persistent') {
        surviving.push(ep)
        continue
      }
      // `currentTurn` lives on session-scoped working memory and resets to 0
      // each session. Episodes are user-scoped and persist across sessions,
      // so `currentTurn - ep.occurredAtTurn` is negative for episodes
      // encoded in a previous session. Treat the turn-age as 0 in that case
      // — the wall-time leg still applies; the turn leg can't say anything.
      const ageTurns = Math.max(0, currentTurn - ep.occurredAtTurn)
      const encodedMs = Date.parse(ep.encodedAt)
      const ageDays = Number.isFinite(encodedMs) ? (now - encodedMs) / MS_PER_DAY : 0

      const turnFired = ageTurns >= ttl.persistentTurns
      const dayFired = ageDays >= ttl.persistentDays
      const shouldCull = ttl.operator === 'AND'
        ? (turnFired && dayFired)
        : (turnFired || dayFired)

      if (shouldCull) {
        culled.push(ep.id)
      } else {
        surviving.push(ep)
      }
    }
    if (culled.length === 0) return s
    return { ...s, episodes: surviving }
  })
  return culled
}

/**
 * Flip `stale: true` on permanent episodes that have been silent longer
 * than `staleDays`. Persistent episodes are ignored (the janitor culls
 * them via `cullByTTL` instead). Idempotent: episodes already marked stale
 * are not re-touched. Returns the IDs newly flagged.
 */
export async function markStale(
  ref: EpRef,
  now: number,
  staleDays: number,
): Promise<string[]> {
  const marked: string[] = []
  await ref.updateState((s: EpisodicMemoryState) => {
    let changed = false
    const episodes = s.episodes.map((ep) => {
      if (ep.durability !== 'permanent') return ep
      if (ep.stale) return ep
      const encodedMs = Date.parse(ep.encodedAt)
      if (!Number.isFinite(encodedMs)) return ep
      const ageDays = (now - encodedMs) / MS_PER_DAY
      if (ageDays < staleDays) return ep
      changed = true
      marked.push(ep.id)
      return { ...ep, stale: true }
    })
    return changed ? { ...s, episodes } : s
  })
  return marked
}

/**
 * Mark episodes as consolidated (promoted to semantic memory).
 * No-op for episode IDs that don't exist in the store.
 */
export async function markConsolidated(ref: EpRef, episodeIds: string[]): Promise<void> {
  const idSet = new Set(episodeIds)
  if (idSet.size === 0) return

  await ref.updateState((s: EpisodicMemoryState) => {
    let changed = false
    const episodes = s.episodes.map((ep) => {
      if (idSet.has(ep.id) && !ep.consolidated) {
        changed = true
        return { ...ep, consolidated: true }
      }
      return ep
    })

    return changed ? { ...s, episodes } : s
  })
}

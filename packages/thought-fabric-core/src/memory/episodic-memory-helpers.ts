import type { ResourceContext } from '@flow-state-dev/core'
import type { Episode, EpisodicMemoryState } from './episodic-memory.js'

type EpRef = ResourceContext<EpisodicMemoryState>

/** Generate a short random ID for episodes. */
function shortId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

/**
 * Input for encoding a new episode — ID, encodedAt, and consolidated
 * are generated automatically.
 */
export type EncodeEpisodeInput = Omit<Episode, 'id' | 'encodedAt' | 'consolidated'>

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
    id: `ep_${shortId()}`,
    encodedAt: new Date().toISOString(),
    consolidated: false,
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

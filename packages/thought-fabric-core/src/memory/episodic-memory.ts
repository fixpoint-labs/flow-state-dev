import { defineResource } from '@flow-state-dev/core'
import { z } from 'zod'

/** Schema for a single episodic memory record. */
export const episodeSchema = z.object({
  /** Unique identifier for this episode. */
  id: z.string(),
  /** What happened — a concise statement of the memory. */
  content: z.string(),
  /** Turn number when this episode occurred. */
  occurredAtTurn: z.number().int().min(0),
  /** ISO datetime when this episode was encoded. */
  encodedAt: z.string().datetime(),
  /** How significant this episode is. Range [0, 1]. */
  significance: z.number().min(0).max(1),
  /** Semantic category of this episode. */
  category: z.enum(['identity', 'event', 'preference', 'task', 'relationship', 'profession', 'belief', 'attribute', 'pattern']),
  /** Contextual metadata about when this episode occurred. */
  context: z.object({
    sessionId: z.string(),
    precedingTopic: z.string().optional(),
  }),
  /** Whether this episode has been consolidated into semantic memory. */
  consolidated: z.boolean().default(false),
})

/** A single episodic memory record. */
export type Episode = z.infer<typeof episodeSchema>

/** Schema for the full episodic memory state. */
export const episodicMemoryStateSchema = z.object({
  /** All stored episodes. */
  episodes: z.array(episodeSchema),
  /** Total number of episodes ever encoded (including evicted). */
  totalEncoded: z.number().int().min(0).default(0),
})

/** The full episodic memory state. */
export type EpisodicMemoryState = z.infer<typeof episodicMemoryStateSchema>

/**
 * Create an episodic memory resource definition with the given scope.
 *
 * - `scope: 'user'` → declared via `userResources`, accessed via `ctx.user.resources.get('episodicMemory')`
 * - `scope: 'org'` → declared via `orgResources`, accessed via `ctx.org.resources.get('episodicMemory')`
 *
 * The scope is a logical marker for the factory — the actual scope enforcement
 * happens when blocks declare the resource in `userResources` vs `orgResources`.
 */
export function createEpisodicMemoryResource(_scope: 'user' | 'org') {
  return defineResource({
    stateSchema: episodicMemoryStateSchema,
    default: { episodes: [], totalEncoded: 0 },
    writable: true,
  })
}

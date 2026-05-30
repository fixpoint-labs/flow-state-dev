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
  /**
   * Who or what this episode is about. `'user'` for the primary user, a
   * lowercase first name for other people (`'moni'`), a lowercase-hyphenated
   * name for organizations. Carried from the observer so consolidation reads
   * the owner instead of re-inferring it from bare predicate text.
   * Defaults to `'user'` for backward-compatible deserialization of
   * pre-FIX-703 episodes (no `subject` field) rather than failing validation.
   */
  subject: z.string().default('user'),
  /** Contextual metadata about when this episode occurred. */
  context: z.object({
    sessionId: z.string(),
    precedingTopic: z.string().optional(),
  }),
  /** Whether this episode has been consolidated into semantic memory. */
  consolidated: z.boolean().default(false),
  /**
   * Durability classification at encode time. `transient` and `session`
   * never reach the episodic store (reflect routes only `persistent` and
   * `permanent` here), so the schema restricts the field accordingly.
   * Drives janitor TTL: `persistent` is cullable, `permanent` is sacrosanct.
   * Defaults to `persistent` for backward-compatible deserialization of
   * pre-FIX-411 episodes.
   */
  durability: z.enum(['persistent', 'permanent']).default('persistent'),
  /**
   * Observer-visible flag set by the janitor on permanent episodes that
   * have gone silent past `permanentStaleDays`. Never causes culling;
   * exists so operators inspecting the store can see what's gone cold.
   * Defaults to `false` for backward-compatible deserialization.
   */
  stale: z.boolean().default(false),
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
 * Create an episodic memory resource definition at the given scope.
 *
 * Under FIX-435 each resource carries its scope intrinsically. Episodic
 * memory persists across sessions, so it lives at `'user'` or `'org'`
 * scope; pick the scope that matches the access pattern and storage
 * boundary you want.
 *
 * Blocks and capabilities install the returned definition via the unified
 * `resources: { episodicMemory: <created> }` map and access it through
 * `ctx.resources.get('episodicMemory')` regardless of scope.
 */
export function createEpisodicMemoryResource(scope: 'user' | 'org') {
  return defineResource({
    scope,
    stateSchema: episodicMemoryStateSchema,
    default: { episodes: [], totalEncoded: 0 },
    writable: true,
  })
}

import { defineResource } from '@flow-state-dev/core'
import { z } from 'zod'

/** Decay strategies for working memory salience computation. */
export type DecayStrategy = 'power-law' | 'exponential' | 'none'

/** Schema for a single working memory entry. */
export const workingMemoryEntrySchema = z.object({
  /** Unique identifier for this entry. */
  id: z.string(),
  /** The memory content — a concise statement of what to remember. */
  content: z.string(),
  /** Current salience score, computed from importance × decay. Range [0, 1]. */
  salience: z.number().min(0).max(1),
  /** Whether this entry is protected from automatic eviction. */
  pinned: z.boolean(),
  /** Turn number when this entry was first added. */
  addedAtTurn: z.number().int().min(0),
  /** Turn number when this entry was last accessed or refreshed. */
  lastAccessedAtTurn: z.number().int().min(0),
  /** Base importance score set at extraction time. Range [0, 1]. */
  importance: z.number().min(0).max(1),
  /** How long this memory should persist. Default: 'session'. */
  durability: z.enum(['transient', 'session', 'persistent', 'permanent']).default('session'),
  /** Semantic category of this memory. Default: 'identity'. */
  category: z.enum(['identity', 'event', 'preference', 'task', 'relationship', 'profession', 'belief', 'attribute', 'pattern']).default('identity'),
  /** Optional metadata attached to this entry. */
  metadata: z.record(z.any()).optional(),
})

/** A single working memory entry. */
export type WorkingMemoryEntry = z.infer<typeof workingMemoryEntrySchema>

/** Schema for the full working memory state. */
export const workingMemoryStateSchema = z.object({
  /** All current entries in working memory. */
  entries: z.array(workingMemoryEntrySchema),
  /** The current interaction turn counter. Decay operates on turns, not wall-clock time. */
  currentTurn: z.number().int().min(0),
})

/** The full working memory state: entries + turn counter. */
export type WorkingMemoryState = z.infer<typeof workingMemoryStateSchema>

/**
 * Session-scoped resource definition for working memory.
 * Blocks declare this via `sessionResources: { workingMemory: workingMemoryResource }`
 * and access it via `ctx.session.resources.get('workingMemory')`.
 */
export const workingMemoryResource = defineResource({
  stateSchema: workingMemoryStateSchema,
  default: { entries: [], currentTurn: 0 },
  writable: true,
})

/**
 * Pre-keyed resource declaration for working memory.
 *
 * Use this in `sessionResources` to avoid hard-coding the resource key:
 *
 * ```ts
 * sessionResources: workingMemoryResources
 * // or compose with other resources:
 * sessionResources: { ...workingMemoryResources, myResource }
 * ```
 */
export const workingMemoryResources = {
  workingMemory: workingMemoryResource,
} as const

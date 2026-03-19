import { defineResource } from '@flow-state-dev/core'
import { z } from 'zod'

/** Schema for a single semantic fact. */
export const semanticFactSchema = z.object({
  /** Unique identifier for this fact. */
  id: z.string(),
  /** The knowledge statement. */
  content: z.string(),
  /** Confidence in this fact's accuracy. Range [0, 1]. */
  confidence: z.number().min(0).max(1),
  /** What kind of knowledge this represents. */
  category: z.enum(['fact', 'preference', 'relationship', 'pattern']),
  /** Episode IDs that contributed to this fact (provenance). */
  sourceEpisodeIds: z.array(z.string()),
  /** ISO datetime when first extracted. */
  extractedAt: z.string().datetime(),
  /** ISO datetime when last reinforced or updated. */
  lastReinforced: z.string().datetime().optional(),
  /** How many times this fact has been confirmed/reinforced. */
  reinforcementCount: z.number().int().min(1).default(1),
})

/** A single semantic fact. */
export type SemanticFact = z.infer<typeof semanticFactSchema>

/** Schema for the full semantic memory state. */
export const semanticMemoryStateSchema = z.object({
  /** All stored semantic facts. */
  facts: z.array(semanticFactSchema),
  /** Total number of facts ever created (including removed). */
  totalExtracted: z.number().int().min(0).default(0),
  /** Total consolidation runs completed. */
  totalConsolidations: z.number().int().min(0).default(0),
})

/** The full semantic memory state. */
export type SemanticMemoryState = z.infer<typeof semanticMemoryStateSchema>

/**
 * Create a semantic memory resource definition with the given scope.
 * Follows the same factory pattern as `createEpisodicMemoryResource`.
 */
export function createSemanticMemoryResource(_scope: 'user' | 'project') {
  return defineResource({
    stateSchema: semanticMemoryStateSchema,
    default: { facts: [], totalExtracted: 0, totalConsolidations: 0 },
    writable: true,
  })
}

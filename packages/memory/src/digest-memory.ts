/**
 * Digest memory — fourth memory tier ([FIX-408]).
 *
 * Stores a single LLM-generated narrative paragraph that summarises stable
 * "what I know" framing about the user. Regenerated as a side-effect of
 * consolidation (and prune) when the underlying semantic / episodic stores
 * have actually changed. Bounded by `maxTokens`; consumed by the simplified
 * formatter ([FIX-407]) as the always-on, long-horizon memory inject.
 */

import { defineResource } from '@flow-state-dev/core'
import { z } from 'zod'

/**
 * Signature of the source stores at the moment a digest was generated.
 * Compared against current store state to decide whether regeneration is
 * worthwhile — the digest's primary cost guard.
 */
export const digestSourceSignatureSchema = z.object({
  semanticFactCount: z.number().int().min(0),
  semanticReinforcementSum: z.number().int().min(0),
  episodeCount: z.number().int().min(0),
})

export type DigestSourceSignature = z.infer<typeof digestSourceSignatureSchema>

/** Schema for a generated digest. */
export const digestSchema = z.object({
  /** The narrative paragraph. */
  content: z.string(),
  /** ISO datetime when this digest was generated. */
  generatedAt: z.string().datetime(),
  /** Working-memory turn at which this digest was generated. */
  generatedAtTurn: z.number().int().min(0),
  /** Snapshot of source store state at generation time. */
  sourceSignature: digestSourceSignatureSchema,
})

export type Digest = z.infer<typeof digestSchema>

/** Schema for the full digest memory state. */
export const digestMemoryStateSchema = z.object({
  /** The current digest. Unset until first regeneration completes. */
  digest: digestSchema.optional(),
  /** Total number of digests ever generated. */
  totalGenerated: z.number().int().min(0).default(0),
})

export type DigestMemoryState = z.infer<typeof digestMemoryStateSchema>

/**
 * Create a digest memory resource definition at the given scope.
 *
 * Scope mirrors the semantic store's scope — the factory enforces this
 * intrinsically. Persists across sessions; lives at `'user'` or `'org'`.
 */
export function createDigestMemoryResource(scope: 'user' | 'org') {
  return defineResource({
    ref: 'digestMemory',
    scope,
    stateSchema: digestMemoryStateSchema,
    default: { totalGenerated: 0 },
    writable: true,
  })
}

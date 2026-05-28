/**
 * Digest memory helpers — pure operations on the digest resource and its
 * source stores. Used by the guard handler and (via the capability surface)
 * by consumers that want to read or check digest staleness directly.
 */

import type { EpisodicMemoryState } from './episodic-memory.js'
import type { SemanticMemoryState } from './semantic-memory.js'
import type {
  DigestMemoryState,
  DigestSourceSignature,
} from './digest-memory.js'
import type { MemResourceRef } from './internal/helpers.js'

type DigestRef = MemResourceRef<DigestMemoryState>
type SemRef = MemResourceRef<SemanticMemoryState>
type EpRef = MemResourceRef<EpisodicMemoryState>

/**
 * Compute a fresh source signature from the current semantic and (optional)
 * episodic store state. Used both at digest write time and when comparing
 * stored vs. current state for staleness.
 */
export async function computeSourceSignature(
  semRef: SemRef,
  epRef?: EpRef,
): Promise<DigestSourceSignature> {
  const facts = (await semRef.state()).facts
  const semanticReinforcementSum = facts.reduce(
    (sum, f) => sum + f.reinforcementCount,
    0,
  )
  return {
    semanticFactCount: facts.length,
    semanticReinforcementSum,
    episodeCount: epRef ? (await epRef.state()).episodes.length : 0,
  }
}

/**
 * True when the digest is missing or its stored `sourceSignature` differs
 * from a freshly computed one — i.e. the underlying stores have changed
 * since the last regeneration. Cheap; called on every consolidation /
 * prune completion before deciding to spend an LLM call.
 */
export async function isStale(
  ref: DigestRef,
  semRef: SemRef,
  epRef?: EpRef,
): Promise<boolean> {
  const current = (await ref.state()).digest
  if (!current) return true
  const fresh = await computeSourceSignature(semRef, epRef)
  return (
    current.sourceSignature.semanticFactCount !== fresh.semanticFactCount ||
    current.sourceSignature.semanticReinforcementSum !== fresh.semanticReinforcementSum ||
    current.sourceSignature.episodeCount !== fresh.episodeCount
  )
}


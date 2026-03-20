import type { ResourceContext } from '@flow-state-dev/core'
import type { SemanticFact, SemanticMemoryState } from './semantic-memory.js'
import { shortId, tokenOverlap } from '../helpers.js'

type SemRef = ResourceContext<SemanticMemoryState>

/**
 * Add a new semantic fact. Generates ID and sets extractedAt.
 */
export async function addFact(
  ref: SemRef,
  fact: Omit<SemanticFact, 'id' | 'extractedAt' | 'lastReinforced' | 'reinforcementCount'>,
): Promise<SemanticFact> {
  const newFact: SemanticFact = {
    ...fact,
    id: `sf_${shortId(6)}`,
    extractedAt: new Date().toISOString(),
    reinforcementCount: 1,
  }

  await ref.updateState((s: SemanticMemoryState) => ({
    ...s,
    facts: [...s.facts, newFact],
    totalExtracted: s.totalExtracted + 1,
  }))

  return newFact
}

/**
 * Update an existing fact's content while preserving its identity and provenance.
 * Used when information changes (e.g., "works at Google" → "works at Stripe").
 * Merges new source episode IDs, sets lastReinforced, increments reinforcementCount.
 * Returns the updated fact, or undefined if factId not found.
 */
export async function updateFact(
  ref: SemRef,
  factId: string,
  newContent: string,
  sourceEpisodeIds: string[],
  newConfidence?: number,
): Promise<SemanticFact | undefined> {
  let updatedFact: SemanticFact | undefined

  await ref.updateState((s: SemanticMemoryState) => {
    const idx = s.facts.findIndex((f) => f.id === factId)
    if (idx < 0) return s

    const existing = s.facts[idx]
    const mergedSourceIds = [...new Set([...existing.sourceEpisodeIds, ...sourceEpisodeIds])]
    const now = new Date().toISOString()

    updatedFact = {
      ...existing,
      content: newContent,
      confidence: newConfidence ?? existing.confidence,
      sourceEpisodeIds: mergedSourceIds,
      lastReinforced: now,
      reinforcementCount: existing.reinforcementCount + 1,
    }

    const facts = [...s.facts]
    facts[idx] = updatedFact
    return { ...s, facts }
  })

  return updatedFact
}

/**
 * Reinforce an existing fact — bump confidence and reinforcementCount,
 * merge new source episode IDs, update lastReinforced timestamp.
 * Returns the updated fact, or undefined if factId not found.
 */
export async function reinforce(
  ref: SemRef,
  factId: string,
  sourceEpisodeIds: string[],
  confidenceBoost = 0.05,
): Promise<SemanticFact | undefined> {
  let updatedFact: SemanticFact | undefined

  await ref.updateState((s: SemanticMemoryState) => {
    const idx = s.facts.findIndex((f) => f.id === factId)
    if (idx < 0) return s

    const existing = s.facts[idx]
    const mergedSourceIds = [...new Set([...existing.sourceEpisodeIds, ...sourceEpisodeIds])]
    const now = new Date().toISOString()

    updatedFact = {
      ...existing,
      confidence: Math.min(1, existing.confidence + confidenceBoost),
      sourceEpisodeIds: mergedSourceIds,
      lastReinforced: now,
      reinforcementCount: existing.reinforcementCount + 1,
    }

    const facts = [...s.facts]
    facts[idx] = updatedFact
    return { ...s, facts }
  })

  return updatedFact
}

/**
 * Remove a fact by ID. No-op if not found.
 */
export async function removeFact(ref: SemRef, factId: string): Promise<void> {
  await ref.updateState((s: SemanticMemoryState) => {
    const filtered = s.facts.filter((f) => f.id !== factId)
    if (filtered.length === s.facts.length) return s
    return { ...s, facts: filtered }
  })
}

/**
 * Get all facts, sorted by reinforcementCount descending (most established first).
 */
export function allFacts(ref: SemRef): SemanticFact[] {
  return [...ref.state.facts].sort((a, b) => b.reinforcementCount - a.reinforcementCount)
}

/**
 * Query semantic facts by keyword relevance (synchronous, token-overlap).
 * For small stores (≤50), returns all facts sorted by reinforcementCount.
 * For larger stores, filters by token overlap with the query.
 */
export function query(ref: SemRef, q: string, limit?: number): SemanticFact[] {
  const facts = allFacts(ref)

  if (facts.length <= 50) {
    return limit != null ? facts.slice(0, limit) : facts
  }

  // For larger stores, score by token overlap and return top matches
  const scored = facts.map((f) => ({
    fact: f,
    score: tokenOverlap(q, f.content),
  }))

  scored.sort((a, b) => b.score - a.score)

  const filtered = scored.filter((s) => s.score > 0).map((s) => s.fact)
  return limit != null ? filtered.slice(0, limit) : filtered
}

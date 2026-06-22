import type { ResourceContext } from '@flow-state-dev/core'
import type { NodeRef } from '@flow-state-dev/core/graph'
import type { SemanticFact, SemanticMemoryState } from './semantic-memory'
import { shortId, tokenOverlap } from '@flow-state-dev/core/helpers'
import { canonicalizeSubject } from './internal/helpers'
import { effectiveConfidence } from './janitor'

type SemRef = ResourceContext<SemanticMemoryState>

/**
 * Add a new semantic fact. Generates ID and sets `extractedAt` and
 * `lastReinforced` to the same ISO timestamp (creation counts as the first
 * reinforcement). The dual-timestamp seeding is what lets the
 * `effectiveConfidence` decay model anchor every fact from day zero — facts
 * created before this fix have `lastReinforced: undefined` and fall back to
 * `extractedAt` at read time.
 */
export async function addFact(
  ref: SemRef,
  fact: Omit<SemanticFact, 'id' | 'extractedAt' | 'lastReinforced' | 'reinforcementCount' | 'subject'> & { subject?: string },
): Promise<SemanticFact> {
  const now = new Date().toISOString()
  const newFact: SemanticFact = {
    ...fact,
    subject: fact.subject ?? 'user',
    id: `sf_${shortId(6)}`,
    extractedAt: now,
    lastReinforced: now,
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
 * When `subject` is provided, returns only facts about that subject.
 */
export function allFacts(ref: SemRef, subject?: string): SemanticFact[] {
  let facts = [...ref.state.facts]
  if (subject != null) {
    facts = facts.filter((f) => f.subject === subject)
  }
  return facts.sort((a, b) => b.reinforcementCount - a.reinforcementCount)
}

/**
 * Top-N facts by reinforcement count (most established first).
 * Thin wrapper over `allFacts`; primarily used by digest regeneration
 * to feed the most-reinforced subset into the prompt.
 */
export function topFacts(ref: SemRef, limit: number, subject?: string): SemanticFact[] {
  return allFacts(ref, subject).slice(0, limit)
}

/**
 * Cull facts whose effective (time-decayed) confidence has dropped below
 * `cullFloor`. Returns the IDs of removed facts so callers can record what
 * the janitor pass evicted.
 *
 * Decay anchor and formula live in `effectiveConfidence`. Facts whose
 * `lastReinforced` is missing (created before the V1 bug fix) decay from
 * `extractedAt`.
 */
export async function cullByEffectiveConfidence(
  ref: SemRef,
  now: number,
  halfLife: number,
  cullFloor: number,
): Promise<string[]> {
  const culled: string[] = []
  await ref.updateState((s: SemanticMemoryState) => {
    const surviving: SemanticFact[] = []
    for (const fact of s.facts) {
      if (effectiveConfidence(fact, now, halfLife) >= cullFloor) {
        surviving.push(fact)
      } else {
        culled.push(fact.id)
      }
    }
    if (culled.length === 0) return s
    return { ...s, facts: surviving }
  })
  return culled
}

/**
 * Query semantic facts by keyword relevance (synchronous, token-overlap).
 * For small stores (≤50), returns all facts sorted by reinforcementCount.
 * For larger stores, filters by token overlap with the query.
 * When `subject` is provided, scopes to that subject only.
 */
export function query(ref: SemRef, q: string, limit?: number, subject?: string): SemanticFact[] {
  const facts = allFacts(ref, subject)

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

// ---------------------------------------------------------------------------
// Relation-edge helpers (FIX-745)
//
// The add/supersede/remove/traverse surface lives on `ref.edges`
// (ResourceEdgeApi), injected by the framework only when the resource was
// created with `relations`. These helpers cover the memory-specific reads the
// write path and janitor need, and degrade to safe empties when the relations
// tier is disabled (`ref.edges` absent).
// ---------------------------------------------------------------------------

/**
 * The set of node identities known to the semantic store — the canonicalized
 * subjects of every stored fact. Used as the `knownNodes` argument to
 * `ref.edges.pruneDangling` so the janitor can drop edges whose endpoints no
 * longer correspond to a stored fact subject after a cull.
 *
 * Subjects are canonicalized (trim + lowercase) to match the canonicalization
 * the write path applies to edge endpoints.
 */
export function knownSubjects(ref: SemRef): Set<NodeRef> {
  const subjects = new Set<NodeRef>()
  for (const fact of ref.state.facts) {
    subjects.add(canonicalizeSubject(fact.subject ?? 'user'))
  }
  return subjects
}

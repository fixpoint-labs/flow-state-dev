/**
 * Internal: unified cross-store recall factory.
 *
 * Builds the `recall(ctx, cue?)` helper that queries working, episodic, and
 * semantic stores, deduplicates, and ranks by relevance. Shared between the
 * composed memory capability (`createMemoryCapability`) and the full
 * lifecycle factory (`system()`) so both expose an identical recall function
 * without duplicating the ranking logic. Internal-only — not re-exported from
 * the package index.
 */

import type { ResourceContext } from '@flow-state-dev/core'
import { tokenOverlap } from './helpers.js'
import type { ResolvedHygieneConfig } from '../janitor-blocks.js'
import type { RankedMemoryItem } from '../provider.js'
import type { WorkingMemoryState } from '../working-memory.js'
import { items as wmItems } from '../working-memory-helpers.js'
import type { EpisodicMemoryState } from '../episodic-memory.js'
import { recent } from '../episodic-memory-helpers.js'
import type { SemanticMemoryState } from '../semantic-memory.js'
import { allFacts } from '../semantic-memory-helpers.js'
import { effectiveConfidence } from '../janitor.js'

/**
 * Unified cross-store recall.
 *
 * Queries working memory, (if installed) episodic memory, and (if installed) semantic memory.
 * Deduplication priority: semantic > working > episodic.
 * Returns ranked by relevance descending.
 */
export function createRecall(
  episodicConfig?: { scope: 'user' | 'org' },
  semanticConfig?: { scope: 'user' | 'org' },
  /**
   * When `confidenceDecay` is set, the semantic ranking branch uses
   * `effectiveConfidence` (decayed by elapsed days). When `false` or
   * undefined, raw `fact.confidence` is used — pre-FIX-411 behaviour.
   */
  decayConfig?: false | { halfLife: number },
) {
  return function recall(ctx: any, cue?: string): RankedMemoryItem[] {
    const results: RankedMemoryItem[] = []

    // 1. Read semantic facts first (highest authority)
    if (semanticConfig) {
      try {
        const semRef = semanticConfig.scope === 'user'
          ? ctx.resources?.semanticMemory as ResourceContext<SemanticMemoryState> | undefined
          : ctx.resources?.semanticMemory as ResourceContext<SemanticMemoryState> | undefined

        if (semRef) {
          const facts = allFacts(semRef)
          const now = Date.now()
          for (const fact of facts) {
            // Relevance: effective × (0.5 + 0.5 × normalizedReinforcement).
            // When hygiene's confidence-decay is disabled we fall through
            // to the raw fact.confidence — pre-FIX-411 ranking.
            const baseConfidence = decayConfig
              ? effectiveConfidence(fact, now, decayConfig.halfLife)
              : fact.confidence
            const normalizedReinforcement = Math.min(1, fact.reinforcementCount / 10)
            let relevance = baseConfidence * (0.5 + 0.5 * normalizedReinforcement)

            if (cue) {
              const overlap = tokenOverlap(cue, fact.content)
              if (overlap > 0) relevance = Math.min(1, relevance + overlap * 0.4)
            }

            results.push({
              content: fact.content,
              source: 'semantic',
              relevance,
              category: fact.category,
              id: fact.id,
              subject: fact.subject,
            })
          }
        }
      } catch { /* semantic not available */ }
    }

    // 2. Read working memory
    try {
      const wmRef = ctx.resources?.workingMemory as ResourceContext<WorkingMemoryState> | undefined
      if (wmRef) {
        const entries = wmItems(wmRef)
        for (const entry of entries) {
          // Dedup: skip if semantic already has similar content
          const isDupOfSemantic = results.some(
            (r) => r.source === 'semantic' && tokenOverlap(entry.content, r.content) > 0.6,
          )
          if (isDupOfSemantic) continue

          let relevance = entry.salience
          if (cue) {
            const overlap = tokenOverlap(cue, entry.content)
            if (overlap > 0) relevance = Math.min(1, relevance + overlap * 0.2)
          }
          results.push({
            content: entry.content,
            source: 'working',
            relevance,
            category: entry.category ?? 'identity',
            id: entry.id,
          })
        }
      }
    } catch { /* working memory not available */ }

    // 3. Read episodic memory (if installed)
    if (episodicConfig) {
      try {
        const epRef = episodicConfig.scope === 'user'
          ? ctx.resources?.episodicMemory as ResourceContext<EpisodicMemoryState> | undefined
          : ctx.resources?.episodicMemory as ResourceContext<EpisodicMemoryState> | undefined

        if (epRef) {
          const episodes = recent(epRef)
          const maxTurn = episodes.length > 0 ? Math.max(...episodes.map((e) => e.occurredAtTurn)) : 1

          for (const ep of episodes) {
            // Dedup: skip if semantic or WM already has similar content
            const isDuplicate = results.some(
              (r) => (r.source === 'working' || r.source === 'semantic') &&
                tokenOverlap(ep.content, r.content) > 0.6,
            )
            if (isDuplicate) continue

            const recencyFactor = maxTurn > 0 ? (ep.occurredAtTurn / maxTurn) : 1
            let relevance = ep.significance * (0.5 + 0.5 * recencyFactor)

            if (cue) {
              const overlap = tokenOverlap(cue, ep.content)
              if (overlap > 0) relevance = Math.min(1, relevance + overlap * 0.3)
            }

            results.push({
              content: ep.content,
              source: 'episodic',
              relevance,
              category: ep.category,
              id: ep.id,
            })
          }
        }
      } catch { /* episodic not available */ }
    }

    // Sort by relevance descending
    return results.sort((a, b) => b.relevance - a.relevance)
  }
}

/**
 * Build the recall helper from resolved tier scopes and hygiene config.
 *
 * Derives the recall-ranking decay config from hygiene (effective-confidence
 * decay applies only when `confidenceDecay` is on; otherwise recall falls
 * through to raw `fact.confidence`) and wires it into `createRecall`. Shared
 * by `createMemoryCapability` (for `fns.recall`) and `system()` (for
 * `mem.recall`) so the decay derivation lives in one place.
 */
export function buildRecall(
  episodicConfig: { scope: 'user' | 'org' } | undefined,
  semanticConfig: { scope: 'user' | 'org' } | undefined,
  hygiene: false | ResolvedHygieneConfig,
) {
  const decayConfig = hygiene && hygiene.confidenceDecay
    ? { halfLife: hygiene.confidenceDecay.halfLife }
    : false
  return createRecall(episodicConfig, semanticConfig, decayConfig)
}

/**
 * Strategy registry for the recall tool.
 *
 * V1 ships only `llm-filter`. Later tickets register additional backends:
 * `keyword` (BM25/FTS5) and `vector` / `hybrid`. Consumers can also pass a
 * custom `RetrievalStrategy` object directly.
 */

import { createLlmFilterStrategy } from './llm-filter-strategy.js'
import type { RetrievalStrategy } from '../types.js'

export {
  createLlmFilterStrategy,
  PRE_RANK_CAP,
  RECENCY_HALF_LIFE,
  EXACT_PHRASE_CAP,
  intrinsicSemanticScore,
  intrinsicEpisodicScore,
  semanticToMemoryItem,
  episodeToMemoryItem,
  extractExactPhrases,
  exactPhraseMatches,
} from './llm-filter-strategy.js'
export type { LlmFilterStrategyOptions } from './llm-filter-strategy.js'

/** Built-in strategy names. */
export type BuiltInStrategyName = 'llm-filter'

/** Options understood by `resolveStrategy` when constructing a built-in. */
export type ResolveStrategyOptions = {
  /** Model used by `llm-filter` (and any future strategies that need an LLM). */
  model: string
  /** Forwarded to `createLlmFilterStrategy`. Default: true. */
  exactPhrasePassThrough?: boolean
}

/**
 * Resolve a strategy reference into a concrete `RetrievalStrategy`.
 *
 * Accepts either a built-in name (constructs and returns a fresh instance)
 * or an already-constructed strategy object (returned as-is).
 */
export function resolveStrategy(
  ref: BuiltInStrategyName | RetrievalStrategy,
  opts: ResolveStrategyOptions,
): RetrievalStrategy {
  if (typeof ref === 'string') {
    if (ref === 'llm-filter') {
      return createLlmFilterStrategy({
        model: opts.model,
        exactPhrasePassThrough: opts.exactPhrasePassThrough,
      })
    }
    throw new Error(`Unknown recall strategy: ${ref}`)
  }
  return ref
}

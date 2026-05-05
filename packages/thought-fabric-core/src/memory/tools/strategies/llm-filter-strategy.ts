/**
 * `llm-filter` retrieval strategy — V1 default for the recall tool.
 *
 * Two stages:
 *   1. Query-blind intrinsic pre-rank that pools semantic facts and episodes
 *      by their source-specific scoring formulas, takes the top
 *      `PRE_RANK_CAP`. High-value memories enter the candidate set regardless
 *      of query vocabulary, avoiding the paraphrase-blindness failure mode.
 *   1.5. Optional exact-phrase pass-through that catches distinctive strings
 *      (proper nouns, error codes) buried in low-score memories.
 *   2. Single LLM call that filters the bounded candidate set by relevance.
 *
 * Token spend per call is bounded regardless of total store size — as the
 * store grows the pre-rank gate gets stricter rather than the LLM payload.
 */

import { generator } from '@flow-state-dev/core'
import { z } from 'zod'
import { asRuntime } from '@flow-state-dev/core/types'
import type { SemanticFact } from '../../semantic-memory.js'
import type { Episode } from '../../episodic-memory.js'
import type {
  MemoryItem,
  RankedResult,
  RetrievalStrategy,
  RetrievalStrategyContext,
  RetrievalStrategyOptions,
} from '../types.js'

/** Maximum candidates handed to the LLM filter call. */
export const PRE_RANK_CAP = 50

/** Recency half-life (in turns) for episode decay. */
export const RECENCY_HALF_LIFE = 50

/** Maximum exact-phrase pass-throughs added to the candidate set. */
export const EXACT_PHRASE_CAP = 5

/** Minimum word count for an exact-phrase match candidate. */
const EXACT_PHRASE_MIN_WORDS = 3

/**
 * Intrinsic score for a semantic fact (no query component).
 *
 * Lifted from `mem.recall()`: `confidence × (0.5 + reinforcementCount/10)`.
 * Stable, well-reinforced facts float up.
 */
export function intrinsicSemanticScore(fact: SemanticFact): number {
  const normalised = Math.min(1, fact.reinforcementCount / 10)
  return Math.max(0, Math.min(1, fact.confidence * (0.5 + 0.5 * normalised)))
}

/**
 * Intrinsic score for an episode (no query component).
 *
 * `significance × exp(-(currentTurn - occurredAtTurn) / RECENCY_HALF_LIFE)`.
 * Significant + recent floats up; ancient episodes decay smoothly.
 */
export function intrinsicEpisodicScore(episode: Episode, currentTurn: number): number {
  const age = Math.max(0, currentTurn - episode.occurredAtTurn)
  const decay = Math.exp(-age / RECENCY_HALF_LIFE)
  return Math.max(0, Math.min(1, episode.significance * decay))
}

/** Convert a semantic fact to the unified `MemoryItem` shape. */
export function semanticToMemoryItem(fact: SemanticFact): MemoryItem {
  return {
    id: fact.id,
    content: fact.content,
    source: 'semantic',
    subject: fact.subject,
    category: fact.category,
    confidence: fact.confidence,
    reinforcementCount: fact.reinforcementCount,
    lastReinforced: fact.lastReinforced,
  }
}

/** Convert an episode to the unified `MemoryItem` shape. */
export function episodeToMemoryItem(episode: Episode): MemoryItem {
  return {
    id: episode.id,
    content: episode.content,
    source: 'episodic',
    category: episode.category,
    occurredAtTurn: episode.occurredAtTurn,
    significance: episode.significance,
    encodedAt: episode.encodedAt,
  }
}

/**
 * Extract contiguous phrases of `EXACT_PHRASE_MIN_WORDS`+ words from the query.
 *
 * Whitespace splits only — no tokenisation tricks. Phrases overlap; a 5-word
 * query produces (5-3)+(5-4)+(5-5) = 3 phrases at min-len 3.
 */
function extractExactPhrases(query: string): string[] {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 0)
  if (words.length < EXACT_PHRASE_MIN_WORDS) return []
  const phrases: string[] = []
  for (let len = EXACT_PHRASE_MIN_WORDS; len <= words.length; len++) {
    for (let start = 0; start + len <= words.length; start++) {
      phrases.push(words.slice(start, start + len).join(' '))
    }
  }
  return phrases
}

/**
 * Stage 1.5: scan non-pre-ranked items for literal phrase matches.
 *
 * Catches the "exact identifier in a low-score memory" failure mode. Returns
 * up to `EXACT_PHRASE_CAP` items not already in `included`.
 */
function exactPhraseMatches(
  query: string,
  candidates: { item: MemoryItem; score: number }[],
  includedIds: Set<string>,
): { item: MemoryItem; score: number }[] {
  const phrases = extractExactPhrases(query).map((p) => p.toLowerCase())
  if (phrases.length === 0) return []
  const out: { item: MemoryItem; score: number }[] = []
  for (const c of candidates) {
    if (out.length >= EXACT_PHRASE_CAP) break
    if (includedIds.has(c.item.id)) continue
    const haystack = c.item.content.toLowerCase()
    if (phrases.some((p) => haystack.includes(p))) {
      out.push(c)
    }
  }
  return out
}

/** Output schema for the LLM filter call — ordered list of selected IDs. */
const filterOutputSchema = z.object({
  selectedIds: z.array(z.string()),
})

/** Input shape passed as `user` to the filter generator. */
type FilterInput = {
  query: string
  limit: number
  candidates: Array<{ id: string; source: string; content: string; metadata?: Record<string, unknown> }>
}

const filterPrompt = [
  'You are a memory filter for a cognitive AI agent.',
  'You receive a query and a set of candidate memories drawn from the agent\'s long-term store.',
  'Return the IDs of memories that are actually relevant to the query, ordered most-relevant first.',
  '',
  'Rules:',
  '- Return at most {limit} IDs (the user message specifies the limit).',
  '- Omit candidates that are off-topic; do not pad to reach the limit.',
  '- Only return IDs that appear in the candidates list.',
  '- If nothing is relevant, return an empty list.',
].join('\n')

/**
 * Build the filter generator. Created once at strategy-construction time and
 * reused across `rank()` calls — the underlying model resolver caches request
 * setup across invocations.
 */
function buildFilterGenerator(model: string) {
  return generator({
    name: 'tf.memory/recall.llm-filter',
    model,
    inputSchema: z.any(),
    outputSchema: filterOutputSchema,
    prompt: filterPrompt,
    user: (input: FilterInput) => {
      const lines: string[] = [
        `Query: ${input.query}`,
        `Limit: ${input.limit}`,
        '',
        'Candidates:',
      ]
      for (const c of input.candidates) {
        const meta = c.metadata && Object.keys(c.metadata).length > 0
          ? ` ${JSON.stringify(c.metadata)}`
          : ''
        lines.push(`- [${c.id}] (${c.source})${meta} ${c.content}`)
      }
      return lines.join('\n')
    },
    agentType: 'trace',
  })
}

/** Options for `createLlmFilterStrategy`. */
export type LlmFilterStrategyOptions = {
  /** Model id used for the filter call. */
  model: string
  /** Include the Stage 1.5 exact-phrase pass-through. Default: true. */
  exactPhrasePassThrough?: boolean
}

/**
 * Create the V1 `llm-filter` retrieval strategy.
 *
 * The returned strategy is stateless across calls aside from the cached
 * generator block; it is safe to share across concurrent `rank()` invocations.
 */
export function createLlmFilterStrategy(opts: LlmFilterStrategyOptions): RetrievalStrategy {
  const filterGen = buildFilterGenerator(opts.model)
  const includeExactPhrase = opts.exactPhrasePassThrough ?? true

  return {
    name: 'llm-filter',
    async rank(
      query: string,
      ctx: RetrievalStrategyContext,
      options: RetrievalStrategyOptions,
    ): Promise<RankedResult[]> {
      // Stage 1: query-blind intrinsic pre-rank.
      const sinceTurn = options.sinceTurn
      const eligibleEpisodes = sinceTurn !== undefined
        ? ctx.episodic.filter((e) => e.occurredAtTurn >= sinceTurn)
        : ctx.episodic

      const scored: { item: MemoryItem; score: number }[] = []
      for (const fact of ctx.semantic) {
        scored.push({ item: semanticToMemoryItem(fact), score: intrinsicSemanticScore(fact) })
      }
      for (const ep of eligibleEpisodes) {
        scored.push({ item: episodeToMemoryItem(ep), score: intrinsicEpisodicScore(ep, ctx.currentTurn) })
      }

      if (scored.length === 0) return []

      scored.sort((a, b) => b.score - a.score)
      const preRanked = scored.slice(0, PRE_RANK_CAP)
      const includedIds = new Set(preRanked.map((c) => c.item.id))

      // Stage 1.5: exact-phrase pass-through over the items the pre-rank dropped.
      const passThroughs = includeExactPhrase
        ? exactPhraseMatches(query, scored.slice(PRE_RANK_CAP), includedIds)
        : []

      const candidates = [...preRanked, ...passThroughs]
      if (candidates.length === 0) return []

      // Stage 2: single LLM filter call.
      const candidatePayload = candidates.map((c) => ({
        id: c.item.id,
        source: c.item.source,
        content: c.item.content,
        metadata: extractCandidateMetadata(c.item),
      }))

      const filterResult = await asRuntime(filterGen).run(
        { query, limit: options.limit, candidates: candidatePayload },
        ctx.runtime,
      ) as { selectedIds: string[] }

      // Filter hallucinated IDs and preserve LLM ordering.
      const byId = new Map(candidates.map((c) => [c.item.id, c]))
      const ordered: { item: MemoryItem; score: number }[] = []
      for (const id of filterResult.selectedIds) {
        const hit = byId.get(id)
        if (hit) ordered.push(hit)
      }

      const n = ordered.length
      return ordered.map((c, i) => ({
        item: c.item,
        // Score is the LLM rank, normalised so the top result is 1.
        score: n > 0 ? 1 - i / n : 0,
      }))
    },
  }
}

/** Pull source-specific metadata onto the LLM filter input payload. */
function extractCandidateMetadata(item: MemoryItem): Record<string, unknown> {
  if (item.source === 'semantic') {
    return {
      subject: item.subject,
      category: item.category,
      confidence: item.confidence,
      reinforcementCount: item.reinforcementCount,
    }
  }
  return {
    category: item.category,
    occurredAtTurn: item.occurredAtTurn,
    significance: item.significance,
  }
}

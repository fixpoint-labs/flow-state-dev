/**
 * `llm-filter` retrieval strategy — V1 default for the recall tool.
 *
 * Two stages, each a separate block so the recall tool can compose them in a
 * sequencer without any handler reaching into `asRuntime` to invoke a
 * generator (BP-011):
 *
 *   1. `prepareBlock` (handler) — query-blind intrinsic pre-rank that pools
 *      semantic facts and episodes by their source-specific scoring formulas
 *      and takes the top `PRE_RANK_CAP`. High-value memories enter the
 *      candidate set regardless of query vocabulary, avoiding the
 *      paraphrase-blindness failure mode. Optional Stage 1.5 exact-phrase
 *      pass-through catches distinctive strings (proper nouns, error codes)
 *      buried in low-score memories.
 *   2. `filterBlock` (generator) — single LLM call that filters the bounded
 *      candidate set by relevance. The recall tool wraps this with an input
 *      adapter and a merge handler (in a sub-sequencer) so the format step
 *      receives the LLM's `selectedIds` alongside the candidate list.
 *
 * Token spend per call is bounded regardless of total store size — as the
 * store grows the pre-rank gate gets stricter rather than the LLM payload.
 */

import { generator, handler } from '@flow-state-dev/core'
import { z } from 'zod'
import type { Episode } from '../../episodic-memory.js'
import type { SemanticFact } from '../../semantic-memory.js'
import { allFacts } from '../../semantic-memory-helpers.js'
import { effectiveConfidence } from '../../janitor.js'
import type {
  MemoryItem,
  PrepareEnvelope,
  PrepareInput,
  RetrievalStrategy,
} from '../types.js'

/**
 * @deprecated since the prepare gate split into per-source pools — the
 * strategy no longer references this. Kept exported so prior consumers
 * (custom strategies that imported it for parity) keep compiling.
 * Episodes are now capped at `PRE_RANK_EPISODIC_CAP`; semantic facts
 * pass through unconditionally (the semantic store is bounded by
 * `pruneThreshold`). Will be removed in a future major.
 */
export const PRE_RANK_CAP = 50

/**
 * Maximum episodes admitted to the pre-rank pool before the LLM filter call.
 *
 * Episodes are scored intrinsically (`significance × recency-decay`) and the
 * top-N kept. Semantic facts are not capped here — they pass through
 * unconditionally because the semantic store is already bounded by
 * `pruneThreshold` and pooling both stores under one cap was starving facts
 * out of the candidate set whenever many high-significance recent episodes
 * existed.
 */
export const PRE_RANK_EPISODIC_CAP = 30

/** Recency half-life (in turns) for episode decay. */
export const RECENCY_HALF_LIFE = 50

/** Maximum exact-phrase pass-throughs added to the candidate set. */
export const EXACT_PHRASE_CAP = 5

/** Minimum word count for an exact-phrase match candidate. */
const EXACT_PHRASE_MIN_WORDS = 3

/**
 * Intrinsic score for a semantic fact (no query component).
 *
 * `effectiveConfidence(fact) × (0.5 + reinforcementCount/10)`. Stable,
 * well-reinforced AND recently-reinforced facts float up. The fact's
 * `confidence` is decayed by time-since-last-reinforcement (see
 * `effectiveConfidence`) before being combined with the reinforcement
 * normaliser, so the same raw confidence ranks lower as the fact ages.
 *
 * @param fact     The semantic fact to score.
 * @param now      Optional reference time (unix ms) for decay computation —
 *                 default `Date.now()`. Forwarded to `effectiveConfidence`.
 * @param halfLife Optional half-life override (days). Default 180 via
 *                 `DEFAULT_HYGIENE_CONFIG`. Pass an explicit value to match
 *                 a configured hygiene profile, or `false` to skip decay
 *                 entirely — useful for custom strategies that mirror
 *                 `hygiene: false` callers.
 */
export function intrinsicSemanticScore(
  fact: SemanticFact,
  now?: number,
  halfLife?: number | false,
): number {
  const effective = halfLife === false
    ? fact.confidence
    : effectiveConfidence(fact, now, halfLife)
  const normalised = Math.min(1, fact.reinforcementCount / 10)
  return Math.max(0, Math.min(1, effective * (0.5 + 0.5 * normalised)))
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
export function extractExactPhrases(query: string): string[] {
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
export function exactPhraseMatches(
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

/**
 * Read semantic facts and episodes from the block context's resource
 * registry. Missing stores are silently coerced to empty arrays.
 */
async function readStores(ctx: any): Promise<{
  semantic: SemanticFact[]
  episodic: Episode[]
  currentTurn: number
}> {
  let semantic: SemanticFact[] = []
  let episodic: Episode[] = []
  let currentTurn = 0

  try {
    const semRef = ctx.resources?.semanticMemory
    if (semRef) semantic = await allFacts(semRef)
  } catch { /* not installed */ }

  try {
    const epRef = ctx.resources?.episodicMemory
    if (epRef) episodic = (epRef.state).episodes ?? []
  } catch { /* not installed */ }

  try {
    const wmRef = ctx.resources?.workingMemory
    if (wmRef) currentTurn = (wmRef.state).currentTurn ?? 0
  } catch { /* not installed */ }

  return { semantic, episodic, currentTurn }
}

// ---------------------------------------------------------------------------
// Stage 1: prepareBlock — intrinsic pre-rank + exact-phrase pass-through.
// ---------------------------------------------------------------------------

/** Output schema for the prepare block. */
const prepareOutputSchema = z.object({
  query: z.string(),
  limit: z.number(),
  candidates: z.array(z.any()),
  shouldFilter: z.boolean(),
  strategyName: z.string(),
  sinceTurn: z.number().optional(),
  perItemCharCap: z.number(),
})

/**
 * Build the prepare handler. Reads stores and produces the candidate set
 * fed into the LLM filter, using two independent gates:
 *
 *   - **Semantic facts** pass through unconditionally. The semantic store is
 *     bounded by `pruneThreshold` so even the worst case is well within the
 *     filter's token budget; previously, when episodes-with-high-significance
 *     dominated a unified intrinsic-rank pool, moderately-reinforced facts
 *     got pushed out of the candidate set entirely.
 *   - **Episodes** are scored intrinsically (`significance × recency-decay`)
 *     and the top-N kept (`PRE_RANK_EPISODIC_CAP`). The `sinceTurn` floor
 *     applies before scoring.
 *
 * The optional Stage 1.5 exact-phrase pass-through (`includeExactPhrase`)
 * runs over episodes that didn't make the cap — it's a safety net for
 * "specific identifier buried in a low-score episode" queries. Semantic
 * facts skip it because they're all already in.
 *
 * `shouldFilter = candidates.length > 0`, so the recall tool's gating
 * conditional skips the LLM call when both stores are empty.
 */
function buildPrepareBlock(includeExactPhrase: boolean) {
  return handler({
    name: 'memory/recall.prepare',
    outputSchema: prepareOutputSchema,
    execute: async (input: PrepareInput, ctx): Promise<PrepareEnvelope> => {
      const { semantic, episodic, currentTurn } = await readStores(ctx)

      const eligibleEpisodes = input.sinceTurn !== undefined
        ? episodic.filter((e) => e.occurredAtTurn >= input.sinceTurn!)
        : episodic

      // All semantic facts pass through unconditionally.
      const semanticItems = semantic.map(semanticToMemoryItem)

      // Episodes: intrinsic-score, sort, cap.
      const scoredEpisodes: { item: MemoryItem; score: number }[] = eligibleEpisodes.map((ep) => ({
        item: episodeToMemoryItem(ep),
        score: intrinsicEpisodicScore(ep, currentTurn),
      }))
      scoredEpisodes.sort((a, b) => b.score - a.score)
      const preRankedEpisodes = scoredEpisodes.slice(0, PRE_RANK_EPISODIC_CAP)
      const droppedEpisodes = scoredEpisodes.slice(PRE_RANK_EPISODIC_CAP)

      // Empty short-circuit.
      if (semanticItems.length === 0 && preRankedEpisodes.length === 0) {
        return {
          query: input.query,
          limit: input.limit,
          candidates: [],
          shouldFilter: false,
          strategyName: input.strategyName,
          sinceTurn: input.sinceTurn,
          perItemCharCap: input.perItemCharCap,
        }
      }

      const includedIds = new Set<string>()
      for (const it of semanticItems) includedIds.add(it.id)
      for (const c of preRankedEpisodes) includedIds.add(c.item.id)

      // Stage 1.5: exact-phrase pass-through over episodes that didn't make
      // the cap. Semantic facts are all already included so the pass-through
      // doesn't search them.
      const passThroughs = includeExactPhrase
        ? exactPhraseMatches(input.query, droppedEpisodes, includedIds)
        : []

      const candidates: MemoryItem[] = [
        ...semanticItems,
        ...preRankedEpisodes.map((c) => c.item),
        ...passThroughs.map((c) => c.item),
      ]

      return {
        query: input.query,
        limit: input.limit,
        candidates,
        shouldFilter: candidates.length > 0,
        strategyName: input.strategyName,
        sinceTurn: input.sinceTurn,
        perItemCharCap: input.perItemCharCap,
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Stage 2: filterBlock — bounded LLM filter call.
// ---------------------------------------------------------------------------

/** Output schema for the LLM filter call — ordered list of selected IDs. */
export const filterOutputSchema = z.object({
  selectedIds: z.array(z.string()),
})

/** Input shape passed as `user` to the filter generator. */
type FilterInput = {
  query: string
  limit: number
  candidates: MemoryItem[]
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

/**
 * Build the filter generator. Sequencer-internal substrate invokes this; no
 * handler ever calls it directly.
 */
function buildFilterBlock(model: string) {
  return generator({
    name: 'memory/recall.llm-filter',
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
        const meta = extractCandidateMetadata(c)
        const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
        lines.push(`- [${c.id}] (${c.source})${metaStr} ${c.content}`)
      }
      return lines.join('\n')
    },
    agentType: 'trace',
  })
}

// ---------------------------------------------------------------------------
// Strategy factory
// ---------------------------------------------------------------------------

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
 * Returns a strategy whose `prepareBlock` and `filterBlock` are constructed
 * once at factory time; the recall tool factory composes them into a
 * sequencer (no handler calls a block via `asRuntime`).
 */
export function createLlmFilterStrategy(opts: LlmFilterStrategyOptions): RetrievalStrategy {
  const includeExactPhrase = opts.exactPhrasePassThrough ?? true
  return {
    name: 'llm-filter',
    prepareBlock: buildPrepareBlock(includeExactPhrase),
    filterBlock: buildFilterBlock(opts.model),
  }
}

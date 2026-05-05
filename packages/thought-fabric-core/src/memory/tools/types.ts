/**
 * Public types for the agent-invocable memory recall tool (FIX-409).
 *
 * Defines the unified `MemoryItem` shape over semantic facts and episodes,
 * the pluggable `RetrievalStrategy` contract, and the tool-result envelope
 * the agent observes. Working memory is intentionally excluded from this
 * surface — it lives in the formatter (FIX-407) and would duplicate context
 * cost if surfaced through the tool.
 */

import { z } from 'zod'
import type { SemanticFact } from '../semantic-memory.js'
import type { Episode } from '../episodic-memory.js'

/** Source store of a recalled memory item. */
export type MemoryItemSource = 'semantic' | 'episodic'

/**
 * Unified memory item passed through retrieval strategies.
 *
 * Strategies operate on this shape so they don't have to special-case
 * stores. Source-specific fields are present only for their owning source.
 */
export type MemoryItem = {
  id: string
  content: string
  source: MemoryItemSource
  // semantic fields (undefined for episodic)
  subject?: string
  category?: string
  confidence?: number
  reinforcementCount?: number
  lastReinforced?: string
  // episodic fields (undefined for semantic)
  occurredAtTurn?: number
  significance?: number
  encodedAt?: string
}

/** Single ranked retrieval result, score normalised to [0, 1]. */
export type RankedResult<T = MemoryItem> = {
  item: T
  /** Strategy-normalised relevance score in [0, 1]. */
  score: number
}

/**
 * Read-only context handed to a `RetrievalStrategy.rank` call.
 *
 * `semantic` and `episodic` are empty arrays when the corresponding store
 * is not installed. `currentTurn` reflects working memory's current turn
 * and is the reference point for episode recency decay.
 */
export type RetrievalStrategyContext = {
  semantic: SemanticFact[]
  episodic: Episode[]
  currentTurn: number
  /**
   * Block runtime context — the strategy may use it to invoke generator blocks
   * (e.g. the `llm-filter` strategy runs a small classifier generator). Backends
   * that don't need a runtime call (keyword, vector) ignore this field.
   */
  runtime: any
}

/** Options applied to a single `rank()` call. */
export type RetrievalStrategyOptions = {
  /** Maximum results to return. Strategies should respect this as a soft cap. */
  limit: number
  /** Optional turn floor — strategies must drop episodes with `occurredAtTurn < sinceTurn`. */
  sinceTurn?: number
}

/**
 * Pluggable retrieval backend.
 *
 * V1 ships a single strategy (`llm-filter`). FIX-410 (keyword/BM25/FTS5) and
 * FIX-412 (vector / hybrid) implement this same interface so the tool surface
 * does not change when backends are swapped.
 */
export interface RetrievalStrategy {
  /** Strategy identifier; surfaced on tool results as `strategy`. */
  name: string
  rank(
    query: string,
    ctx: RetrievalStrategyContext,
    opts: RetrievalStrategyOptions,
  ): Promise<RankedResult[]> | RankedResult[]
}

/** Zod schema for the recall tool's input parameters. */
export const recallToolInputSchema = z.object({
  query: z.string().min(1).describe('Natural-language search query.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Maximum results (default 5, hard max 20).'),
  sinceTurn: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Only return memories from this turn forward (episodes only).'),
})

/** Inferred input shape from `recallToolInputSchema`. */
export type RecallToolInput = z.infer<typeof recallToolInputSchema>

/** A single result item as the agent observes it. */
export type RecallResultItem = {
  id: string
  /** Content, possibly truncated to the per-item char cap. */
  content: string
  source: MemoryItemSource
  /** Strategy-normalised score in [0, 1]. */
  score: number
  /** Source-specific metadata (semantic: confidence/reinforcementCount/...; episodic: occurredAtTurn/significance/...). */
  metadata: Record<string, unknown>
  /** True iff `content` was truncated by the per-item cap. */
  truncated: boolean
}

/**
 * Envelope returned by the recall tool's `execute`.
 *
 * `totalMatched` is the count returned by the strategy before the user-facing
 * limit was applied; agents compare it to `truncatedTo` to decide whether to
 * re-query with narrower terms.
 *
 * On error, returns `{ error, query, strategy }`. The agent receives the error
 * payload directly so it can recover; no exception escapes into the generator.
 */
export type RecallToolResult =
  | {
      results: RecallResultItem[]
      query: string
      strategy: string
      totalMatched: number
      truncatedTo: number
    }
  | {
      error: string
      query: string
      strategy: string
    }

/**
 * Description shown to the LLM when the recall tool is installed.
 *
 * Exported so consumers wiring custom tools (or building variants on top of
 * `createRecallTool`) can reuse the same wording. The "do not re-retrieve"
 * line is the single biggest lever against over-retrieval.
 */
export const recallToolDescription =
  'Search your stored memory (facts you have learned and past episodes) for content related to a query. ' +
  'Use when you need a specific detail that is not in the summary at the top of your context. ' +
  'Do not use this to re-retrieve facts already shown to you.'

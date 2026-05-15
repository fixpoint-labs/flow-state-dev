/**
 * Public types for the agent-invocable memory recall tool.
 *
 * Defines the unified `MemoryItem` shape over semantic facts and episodes,
 * the carrier `PrepareEnvelope` threaded between sequencer steps, the
 * pluggable `RetrievalStrategy` contract (block-factory shape), and the
 * tool-result envelope the agent observes. Working memory is intentionally
 * excluded from this surface — it lives in the formatter and would duplicate
 * context cost if surfaced through the tool.
 */

import { z } from 'zod'
import type { BlockDefinition } from '@flow-state-dev/core/types'

/** Source store of a recalled memory item. */
export type MemoryItemSource = 'semantic' | 'episodic'

/**
 * Unified memory item passed through retrieval strategies and the recall
 * pipeline. Strategies operate on this shape so they don't have to special-case
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

/**
 * Input shape passed to `RetrievalStrategy.prepareBlock`. The recall tool's
 * factory enriches `RecallToolInput` (resolves the optional limit, stamps the
 * strategy name, propagates the per-item char cap) before invoking prepare,
 * so the strategy can carry these straight through to the envelope without
 * re-deriving them.
 */
export type PrepareInput = Omit<RecallToolInput, 'limit'> & {
  /** Resolved limit (default applied, clamped to [1, 20]). */
  limit: number
  /** Strategy identifier — strategies must copy this into the envelope. */
  strategyName: string
  /** Per-item char cap — strategies must copy this into the envelope. */
  perItemCharCap: number
}

/**
 * Carrier envelope threaded between recall pipeline steps.
 *
 * `prepareBlock` produces it; the optional `filterBlock` reads `{ query,
 * limit, candidates }` and returns `{ selectedIds }`, which the recall tool's
 * internal merge step folds back into the envelope; `formatBlock` consumes
 * the envelope (with optional `selectedIds`) and produces the result.
 */
export type PrepareEnvelope = {
  /** Original query, copied through so downstream steps can stamp it on results. */
  query: string
  /** Resolved limit (default applied, clamped to [1, 20]). */
  limit: number
  /** Bounded candidate list (intrinsic-ranked + exact-phrase pass-through for llm-filter). */
  candidates: MemoryItem[]
  /** Whether the optional filter step should run. False when stores are empty or strategy is filter-less. */
  shouldFilter: boolean
  /** Identifier surfaced on the result envelope as `strategy`. */
  strategyName: string
  /** Forwarded sinceTurn (episode floor). Strategies enforce in `prepareBlock`. */
  sinceTurn?: number
  /** Per-item char cap applied by `formatBlock`. Bound at recall-tool factory time. */
  perItemCharCap: number
}

/**
 * Pluggable retrieval backend.
 *
 * Strategies expose blocks rather than a single `rank()` method so the recall
 * tool can compose them as a sequencer (prepare → optional filter → format)
 * without any handler reaching into `asRuntime()` to invoke a generator
 * (BP-011). V1 ships `llm-filter` (prepare + filter); future backends
 * (vector, keyword) supply only `prepareBlock`.
 */
export interface RetrievalStrategy {
  /** Strategy identifier; surfaced on tool results as `strategy`. */
  name: string
  /**
   * Reads stores, ranks candidates intrinsically, returns the carrier envelope.
   * Input: `RecallToolInput` (the tool's input, with limit defaulted/clamped).
   * Output: `PrepareEnvelope`.
   */
  prepareBlock: BlockDefinition<any, any>
  /**
   * Optional LLM filter step. Strategies without an LLM call (vector, keyword)
   * omit this; the recall tool then skips straight to format and returns the
   * intrinsic-ranked top-N.
   * Input: `{ query: string; limit: number; candidates: MemoryItem[] }`.
   * Output: `{ selectedIds: string[] }`.
   */
  filterBlock?: BlockDefinition<any, any>
  /**
   * Optional override; when omitted, the recall tool installs its default
   * format handler (caps content per-item, drops hallucinated IDs, builds
   * the result envelope).
   * Input: `PrepareEnvelope & { selectedIds?: string[] }`.
   * Output: `RecallToolResult`.
   */
  formatBlock?: BlockDefinition<any, any>
}

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
 * Envelope returned by the recall tool.
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
  'Call when you need to recall a specific detail that is likely stored in your memory.' +
  'Use when you need a specific detail that is not in the summary at the top of your context. ' +
  'This tool is especially true when you need to respond about a detail that you do not know but is personal or related to the user.' +
  'Do not use this to re-retrieve facts already shown to you.'

/**
 * `createRecallTool` — agent-invocable handler block that searches the
 * agent's stored memory (semantic facts + episodes) on demand (FIX-409).
 *
 * The tool is a framework `handler` block so it slots into a generator's
 * `tools` array (or a capability preset's `tools` callback) the same way
 * any other framework tool does. Working memory is intentionally excluded
 * from the search surface — it lives in the formatter (FIX-407) and would
 * duplicate context cost if surfaced through the tool.
 *
 * Strategy is pluggable; V1 ships `llm-filter`. The strategy is created
 * once at factory time and reused across every tool invocation.
 */

import { handler } from '@flow-state-dev/core'
import { z } from 'zod'
import { allFacts } from '../semantic-memory-helpers.js'
import type { Episode, EpisodicMemoryState } from '../episodic-memory.js'
import type { SemanticFact, SemanticMemoryState } from '../semantic-memory.js'
import type { WorkingMemoryState } from '../working-memory.js'
import type {
  RecallResultItem,
  RecallToolInput,
  RecallToolResult,
  RetrievalStrategy,
  RetrievalStrategyContext,
} from './types.js'
import { recallToolDescription, recallToolInputSchema } from './types.js'

/** Default per-item char cap applied to result content. */
export const DEFAULT_PER_ITEM_CHAR_CAP = 400

/** Default `limit` when the agent omits it from tool input. */
export const DEFAULT_RECALL_LIMIT = 5

/** Truncation marker appended to capped content. */
export const TRUNCATION_MARKER =
  '… [truncated, re-query with narrower terms for full content]'

/** Options for `createRecallTool`. */
export type CreateRecallToolOptions = {
  /** Strategy that produces ranked candidates. Constructed once, reused per call. */
  strategy: RetrievalStrategy
  /** Defaults applied when the agent's input or factory consumer omits values. */
  defaults?: {
    /** Default `limit`. Default: 5. */
    limit?: number
    /** Hard char cap per result item. Default: 400. */
    perItemCharCap?: number
  }
}

/**
 * Cap content length, appending the truncation marker when triggered.
 *
 * Cap < marker length is treated as a hard slice with no marker — keeps the
 * function total without surprising negative-slice math.
 */
export function capContent(
  content: string,
  cap: number,
): { content: string; truncated: boolean } {
  if (content.length <= cap) return { content, truncated: false }
  if (cap <= TRUNCATION_MARKER.length) return { content: content.slice(0, cap), truncated: true }
  return {
    content: content.slice(0, cap - TRUNCATION_MARKER.length) + TRUNCATION_MARKER,
    truncated: true,
  }
}

/** Build the source-specific metadata block surfaced to the agent. */
function buildResultMetadata(item: RecallResultItem['source'], raw: any): Record<string, unknown> {
  if (item === 'semantic') {
    return {
      subject: raw.subject,
      category: raw.category,
      confidence: raw.confidence,
      reinforcementCount: raw.reinforcementCount,
      lastReinforced: raw.lastReinforced,
    }
  }
  return {
    category: raw.category,
    occurredAtTurn: raw.occurredAtTurn,
    significance: raw.significance,
    encodedAt: raw.encodedAt,
  }
}

/**
 * Read semantic facts and episodes from the block context's resource registry.
 *
 * Missing stores are silently coerced to empty arrays; the tool installs even
 * when only working memory is wired — agents may run before facts/episodes
 * accumulate.
 */
function readStores(ctx: any): { semantic: SemanticFact[]; episodic: Episode[]; currentTurn: number } {
  let semantic: SemanticFact[] = []
  let episodic: Episode[] = []
  let currentTurn = 0

  try {
    const semRef = ctx.resources?.semanticMemory as { state?: SemanticMemoryState } | undefined
    if (semRef?.state) semantic = allFacts({ state: semRef.state } as any)
  } catch { /* not installed */ }

  try {
    const epRef = ctx.resources?.episodicMemory as { state?: EpisodicMemoryState } | undefined
    if (epRef?.state) episodic = epRef.state.episodes ?? []
  } catch { /* not installed */ }

  try {
    const wmRef = ctx.resources?.workingMemory as { state?: WorkingMemoryState } | undefined
    if (wmRef?.state) currentTurn = wmRef.state.currentTurn ?? 0
  } catch { /* not installed */ }

  return { semantic, episodic, currentTurn }
}

/**
 * Create the recall handler tool.
 *
 * Returned block is mounted on a generator via `tools: [recallTool]` (or via
 * the memory capability's `tool` preset).
 */
export function createRecallTool(opts: CreateRecallToolOptions) {
  const strategy = opts.strategy
  const defaultLimit = opts.defaults?.limit ?? DEFAULT_RECALL_LIMIT
  const perItemCharCap = opts.defaults?.perItemCharCap ?? DEFAULT_PER_ITEM_CHAR_CAP

  // Output schema — matches `RecallToolResult` shape. `error` envelope and
  // success envelope are merged via z.union so the LLM can recover from
  // strategy errors in the same call.
  const outputSchema = z.union([
    z.object({
      results: z.array(
        z.object({
          id: z.string(),
          content: z.string(),
          source: z.enum(['semantic', 'episodic']),
          score: z.number(),
          metadata: z.record(z.string(), z.unknown()),
          truncated: z.boolean(),
        }),
      ),
      query: z.string(),
      strategy: z.string(),
      totalMatched: z.number(),
      truncatedTo: z.number(),
    }),
    z.object({
      error: z.string(),
      query: z.string(),
      strategy: z.string(),
    }),
  ])

  return handler({
    name: 'tf.memory/recall',
    description: recallToolDescription,
    inputSchema: recallToolInputSchema,
    outputSchema,
    execute: async (input: RecallToolInput, ctx: any): Promise<RecallToolResult> => {
      const { semantic, episodic, currentTurn } = readStores(ctx)

      // Empty-store short-circuit — no LLM call.
      if (semantic.length === 0 && episodic.length === 0) {
        return {
          results: [],
          query: input.query,
          strategy: strategy.name,
          totalMatched: 0,
          truncatedTo: 0,
        }
      }

      const strategyCtx: RetrievalStrategyContext = {
        semantic,
        episodic,
        currentTurn,
        runtime: ctx,
      }

      const limit = Math.min(20, Math.max(1, input.limit ?? defaultLimit))

      let ranked
      try {
        ranked = await strategy.rank(input.query, strategyCtx, {
          limit,
          sinceTurn: input.sinceTurn,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          error: message,
          query: input.query,
          strategy: strategy.name,
        }
      }

      const totalMatched = ranked.length
      const truncated = ranked.slice(0, limit)

      const results: RecallResultItem[] = truncated.map((r) => {
        const capped = capContent(r.item.content, perItemCharCap)
        return {
          id: r.item.id,
          content: capped.content,
          source: r.item.source,
          score: r.score,
          metadata: buildResultMetadata(r.item.source, r.item),
          truncated: capped.truncated,
        }
      })

      return {
        results,
        query: input.query,
        strategy: strategy.name,
        totalMatched,
        truncatedTo: results.length,
      }
    },
  })
}

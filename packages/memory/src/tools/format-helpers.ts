/**
 * Shared format helpers for the recall tool's default `formatBlock`.
 *
 * Strategies that don't override `formatBlock` get the handler returned by
 * `createDefaultFormatBlock(perItemCharCap)` installed automatically. Custom
 * strategies that want bespoke output (e.g., grouping by source) supply
 * their own formatBlock and can still reuse `capContent` /
 * `buildResultMetadata` from this module.
 */

import { handler } from '@flow-state-dev/core'
import type {
  MemoryItem,
  PrepareEnvelope,
  RecallResultItem,
  RecallToolResult,
} from './types'

/**
 * Compact summary string for the LLM-visible representation of a recall result.
 *
 * Installed via `recallSeq.mapModelOutput(formatRecallSummary)` in the recall
 * tool factory. The structured `RecallToolResult` continues to flow through
 * the framework (devtool, items log, tests, history replay); the LLM observes
 * this summary instead of the full JSON envelope on its next turn.
 *
 * Deterministic by design: history replay re-runs the mapper on the persisted
 * structured output rather than persisting the string itself.
 */
export function formatRecallSummary(result: RecallToolResult): string {
  if ('error' in result) {
    return `Recall failed: ${result.error}`
  }
  if (result.results.length === 0) {
    return `No memories matched "${result.query}".`
  }
  const lines = result.results.map((r) => `- ${r.content}`)
  const more =
    result.totalMatched > result.truncatedTo
      ? `\n\n(${result.truncatedTo} of ${result.totalMatched} matches shown; re-query with narrower terms for more)`
      : ''
  return lines.join('\n') + more
}

/** Default per-item char cap applied to result content. */
export const DEFAULT_PER_ITEM_CHAR_CAP = 400

/** Default `limit` when the agent omits it from tool input. */
export const DEFAULT_RECALL_LIMIT = 5

/** Truncation marker appended to capped content. */
export const TRUNCATION_MARKER =
  '… [truncated, re-query with narrower terms for full content]'

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
export function buildResultMetadata(
  source: MemoryItem['source'],
  raw: MemoryItem,
): Record<string, unknown> {
  if (source === 'semantic') {
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
 * Build the success envelope from an ordered list of items. Score is the
 * position-based rank, normalised so the top result is 1.
 */
export function buildResult(
  ordered: MemoryItem[],
  env: PrepareEnvelope,
  totalMatched: number,
): RecallToolResult {
  const truncated = ordered.slice(0, env.limit)
  const n = truncated.length
  const results: RecallResultItem[] = truncated.map((item, i) => {
    const capped = capContent(item.content, env.perItemCharCap)
    return {
      id: item.id,
      content: capped.content,
      source: item.source,
      score: n > 0 ? 1 - i / n : 0,
      metadata: buildResultMetadata(item.source, item),
      truncated: capped.truncated,
    }
  })
  return {
    results,
    query: env.query,
    strategy: env.strategyName,
    totalMatched,
    truncatedTo: results.length,
  }
}

/**
 * Default format handler installed when a strategy omits `formatBlock`.
 *
 * Three branches:
 * - empty candidates → empty result envelope (no LLM cost was incurred).
 * - filter ran (`selectedIds` present) → resolve IDs against candidates,
 *   drop hallucinations, build result.
 * - filter skipped → surface intrinsic-ranked top-N from prepare. Used by
 *   strategies that don't ship a `filterBlock` (vector, keyword) and by the
 *   llm-filter strategy when prepare set `shouldFilter = false`.
 */
export const defaultFormatBlock = handler({
  name: 'memory/recall.format',
  execute: async (
    env: PrepareEnvelope & { selectedIds?: string[] },
  ): Promise<RecallToolResult> => {
    if (env.candidates.length === 0) {
      return {
        results: [],
        query: env.query,
        strategy: env.strategyName,
        totalMatched: 0,
        truncatedTo: 0,
      }
    }

    if (!env.selectedIds) {
      // Filter step was skipped. Surface intrinsic ordering.
      return buildResult(env.candidates, env, env.candidates.length)
    }

    const byId = new Map(env.candidates.map((c) => [c.id, c]))
    const ordered: MemoryItem[] = []
    for (const id of env.selectedIds) {
      const hit = byId.get(id)
      if (hit) ordered.push(hit)
    }
    return buildResult(ordered, env, ordered.length)
  },
})

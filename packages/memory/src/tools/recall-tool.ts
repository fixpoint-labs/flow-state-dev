/**
 * `createRecallTool` — agent-invocable recall tool, expressed as a sequencer
 * composing strategy-supplied blocks. The agent installs it on a generator
 * via `tools: [mem.tool.recall()]` like any other framework tool.
 *
 * Pipeline:
 *   prepare → (filter → merge)? → format
 *
 * - `prepare` is the strategy's `prepareBlock` (with the recall tool's input
 *   defaults applied via `connectInput`). It reads stores, ranks intrinsically,
 *   produces the `PrepareEnvelope` carrier.
 * - `(filter → merge)` is a sub-sequencer constructed at factory time when
 *   `strategy.filterBlock` is defined. The filter generator receives a
 *   stripped-down `{ query, limit, candidates }` payload via `connectInput`,
 *   returns `{ selectedIds }`, and the merge handler reads the original
 *   envelope back from `ctx.parent.input` (the inner sub-sequencer's input)
 *   and folds `selectedIds` in.
 * - `format` is `strategy.formatBlock` if provided, otherwise the default
 *   `defaultFormatBlock` from `format-helpers.ts` — caps content per-item,
 *   resolves `selectedIds` against the candidate map, drops hallucinations.
 *
 * No handler in this pipeline reaches into `asRuntime` to invoke another
 * block (BP-011): the framework's executor walks each step at the substrate
 * boundary, the same way it does for any other sequencer.
 */

import { handler, sequencer } from '@flow-state-dev/core'
import {
  defaultFormatBlock,
  DEFAULT_PER_ITEM_CHAR_CAP,
  DEFAULT_RECALL_LIMIT,
  formatRecallSummary,
} from './format-helpers.js'
import {
  recallToolDescription,
  recallToolInputSchema,
} from './types.js'
import type {
  PrepareEnvelope,
  PrepareInput,
  RecallToolInput,
  RecallToolResult,
  RetrievalStrategy,
} from './types.js'

/** Options for `createRecallTool`. */
export type CreateRecallToolOptions = {
  /** Strategy whose blocks compose the pipeline. Constructed once, reused per call. */
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
 * Build the merge handler that closes the filter sub-sequencer.
 *
 * Reads the original `PrepareEnvelope` from `ctx.parent!.input` — the inner
 * sub-sequencer's input is the envelope handed in by the outer recall
 * sequencer's `.thenIf(filterStep)` step, so `parent.input` recovers it
 * even though the filter generator's own output is just `{ selectedIds }`.
 * That parent reference is set fresh per execution by the substrate, so
 * nesting is safe.
 */
const filterMergeBlock = handler({
  name: 'memory/recall.merge',
  execute: async (
    filterOut: { selectedIds: string[] },
    ctx,
  ): Promise<PrepareEnvelope & { selectedIds: string[] }> => {
    const env = ctx.parent!.input as PrepareEnvelope
    return {
      ...env,
      selectedIds: filterOut.selectedIds,
    }
  },
})

/**
 * Create the recall tool — a sequencer the agent calls as a tool.
 *
 * Returned block has the same `name` (`memory/recall`) and `description`
 * as before; only the `kind` shifts from `handler` to `sequencer`. Tools
 * accept any `BlockDefinition`, so generators install it the same way.
 */
export function createRecallTool(opts: CreateRecallToolOptions) {
  const strategy = opts.strategy
  const defaultLimit = opts.defaults?.limit ?? DEFAULT_RECALL_LIMIT
  const perItemCharCap = opts.defaults?.perItemCharCap ?? DEFAULT_PER_ITEM_CHAR_CAP

  // Wrap the strategy's prepare with input-defaults application: clamp limit,
  // stamp strategy name and per-item char cap so prepare can carry both
  // through to the envelope without re-resolving.
  const wrappedPrepare = strategy.prepareBlock.connectInput(
    (input: RecallToolInput): PrepareInput => ({
      query: input.query,
      limit: Math.min(20, Math.max(1, input.limit ?? defaultLimit)),
      sinceTurn: input.sinceTurn,
      strategyName: strategy.name,
      perItemCharCap,
    }),
  )

  // Build the optional filter sub-sequencer. Skipped entirely when the
  // strategy doesn't ship a `filterBlock` — the recall sequencer's `.thenIf`
  // condition collapses to false, prepare's envelope passes straight to
  // format which surfaces the intrinsic ordering.
  const filterStep = strategy.filterBlock
    ? sequencer({ name: 'memory/recall.filter' })
        .then(
          strategy.filterBlock.connectInput((env: PrepareEnvelope) => ({
            query: env.query,
            limit: env.limit,
            candidates: env.candidates,
          })),
        )
        .then(filterMergeBlock)
    : undefined

  const formatBlock = strategy.formatBlock ?? defaultFormatBlock

  // Translate any error thrown inside the pipeline (LLM rate limit, schema
  // validation failure, etc.) into the agent-observable error envelope
  // `{ error, query, strategy }`. The agent sees a recoverable result
  // instead of a thrown exception. `ctx.parent!.input` recovers the
  // original `RecallToolInput` because `rescue` runs as a sibling step of
  // the failed block under the same outer recall sequencer.
  const errorRescueBlock = handler({
    name: 'memory/recall.rescue',
    execute: async (error: Error, ctx): Promise<RecallToolResult> => {
      const input = ctx.parent!.input as RecallToolInput
      return {
        error: error.message,
        query: input.query,
        strategy: strategy.name,
      }
    },
  })

  // Build the recall sequencer. Output schema is the union enforced by the
  // format block (success or error envelope); we don't re-declare it here —
  // the sequencer infers it from `formatBlock`.
  const recallSeq = sequencer({
    name: 'memory/recall',
    description: recallToolDescription,
    inputSchema: recallToolInputSchema,
  })
    .then(wrappedPrepare)
    .thenIf(
      (env: PrepareEnvelope) => env.shouldFilter && filterStep !== undefined,
      filterStep ?? formatBlock, // unreachable when filterStep is undefined; cast keeps types happy
    )
    .then(formatBlock)
    .rescue([{ block: errorRescueBlock }])

  // Compact, model-visible representation. The structured `RecallToolResult`
  // keeps flowing through the framework — devtool, items log, tests, and
  // history replay all see the full envelope. The LLM observes the summary
  // string on its next turn, dropping per-item metadata it can't reason about.
  return recallSeq.mapModelOutput((result: RecallToolResult) =>
    formatRecallSummary(result),
  )
}

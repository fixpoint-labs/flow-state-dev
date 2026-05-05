/**
 * Public surface for the agent-invocable memory recall tool (FIX-409).
 *
 * Exports the tool factory, the strategy contract + built-in resolver, and
 * the input/output type shapes. Wired into `memory.system()` as
 * `mem.tool.recall()` — see memory-system.ts.
 */

export {
  createRecallTool,
  capContent,
  DEFAULT_PER_ITEM_CHAR_CAP,
  DEFAULT_RECALL_LIMIT,
  TRUNCATION_MARKER,
} from './recall-tool.js'
export type { CreateRecallToolOptions } from './recall-tool.js'

export {
  recallToolDescription,
  recallToolInputSchema,
} from './types.js'
export type {
  MemoryItem,
  MemoryItemSource,
  RankedResult,
  RecallResultItem,
  RecallToolInput,
  RecallToolResult,
  RetrievalStrategy,
  RetrievalStrategyContext,
  RetrievalStrategyOptions,
} from './types.js'

export {
  createLlmFilterStrategy,
  resolveStrategy,
  PRE_RANK_CAP,
  RECENCY_HALF_LIFE,
  EXACT_PHRASE_CAP,
  intrinsicSemanticScore,
  intrinsicEpisodicScore,
  semanticToMemoryItem,
  episodeToMemoryItem,
} from './strategies/index.js'
export type {
  BuiltInStrategyName,
  LlmFilterStrategyOptions,
  ResolveStrategyOptions,
} from './strategies/index.js'

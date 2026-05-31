/**
 * Public surface for the agent-invocable memory recall tool.
 *
 * Exports the tool factory (a sequencer composer), the strategy contract
 * (block-factory shape) + built-in resolver, the format helpers strategies
 * can reuse, and the input/output type shapes. Wired into `memory.system()`
 * as `mem.tool.recall()` — see memory-system.ts.
 */

export {
  createRecallTool,
} from './recall-tool'
export type { CreateRecallToolOptions } from './recall-tool'

export {
  capContent,
  buildResult,
  buildResultMetadata,
  defaultFormatBlock,
  DEFAULT_PER_ITEM_CHAR_CAP,
  DEFAULT_RECALL_LIMIT,
  formatRecallSummary,
  TRUNCATION_MARKER,
} from './format-helpers'

export {
  recallToolDescription,
  recallToolInputSchema,
} from './types'
export type {
  MemoryItem,
  MemoryItemSource,
  PrepareEnvelope,
  PrepareInput,
  RecallResultItem,
  RecallToolInput,
  RecallToolResult,
  RetrievalStrategy,
} from './types'

export {
  createLlmFilterStrategy,
  resolveStrategy,
  PRE_RANK_CAP,
  PRE_RANK_EPISODIC_CAP,
  RECENCY_HALF_LIFE,
  EXACT_PHRASE_CAP,
  intrinsicSemanticScore,
  intrinsicEpisodicScore,
  semanticToMemoryItem,
  episodeToMemoryItem,
  extractExactPhrases,
  exactPhraseMatches,
} from './strategies/index'
export type {
  BuiltInStrategyName,
  LlmFilterStrategyOptions,
  ResolveStrategyOptions,
} from './strategies/index'

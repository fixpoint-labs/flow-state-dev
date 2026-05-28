// ---------------------------------------------------------------------------
// Layer 0: Consumer contract
// ---------------------------------------------------------------------------

export type {
  MemoryProvider,
  MemoryContextSections,
  RankedMemorySource,
} from './provider.js'

// ---------------------------------------------------------------------------
// Layer 1: Schemas, types, resource
// ---------------------------------------------------------------------------

export {
  workingMemoryEntrySchema,
  workingMemoryStateSchema,
  workingMemoryResource,
  workingMemoryResources,
} from './working-memory.js'
export type {
  WorkingMemoryEntry,
  WorkingMemoryState,
  DecayStrategy,
} from './working-memory.js'

// ---------------------------------------------------------------------------
// Layer 2: Helpers, accessors, formatters (verb-first naming)
// ---------------------------------------------------------------------------

export { DEFAULT_WORKING_MEMORY_CONFIG } from './working-memory-helpers.js'
export { computeDecay, computeSalience } from './working-memory-helpers.js'

// Helpers — verb-first naming distinguishes from block factories and prevents
// collisions with future episodic/semantic memory helpers.
export { add as addWorkingMemory } from './working-memory-helpers.js'
export { evict as evictWorkingMemory } from './working-memory-helpers.js'
export { pin as pinWorkingMemory } from './working-memory-helpers.js'
export { unpin as unpinWorkingMemory } from './working-memory-helpers.js'
export { refresh as refreshWorkingMemory } from './working-memory-helpers.js'
export { advance as advanceWorkingMemory } from './working-memory-helpers.js'
export { items as workingMemoryItems } from './working-memory-helpers.js'
export { formatForContext as formatWorkingMemoryEntries } from './working-memory-helpers.js'
export { workingMemoryContextFormatter } from './working-memory-helpers.js'

export type {
  WorkingMemoryDecayConfig,
  WorkingMemoryHelperConfig,
  AddEntryInput,
} from './working-memory-helpers.js'

// ---------------------------------------------------------------------------
// Layer 3: Block factories
// ---------------------------------------------------------------------------

export {
  observationsSchema as workingMemoryObservationsSchema,
  workingMemoryCapture,
  workingMemoryObserve,
  workingMemoryRemember,
  workingMemoryTick,
  workingMemorySnapshot,
  workingMemoryAdd,
} from './working-memory-blocks.js'
export type {
  Observations,
  WorkingMemoryBlockConfig,
  WorkingMemoryCaptureConfig,
  WorkingMemoryObserveConfig,
} from './working-memory-blocks.js'

// ---------------------------------------------------------------------------
// Layer 1: Episodic memory schemas, types, resource factory
// ---------------------------------------------------------------------------

export {
  episodeSchema,
  episodicMemoryStateSchema,
  createEpisodicMemoryResource,
} from './episodic-memory.js'
export type { Episode, EpisodicMemoryState } from './episodic-memory.js'

// ---------------------------------------------------------------------------
// Layer 1: Memory system tracking resource
// ---------------------------------------------------------------------------

export {
  memorySystemStateSchema,
  memorySystemResource,
  DEFAULT_EPISODIC_CONFIG,
  DEFAULT_CONSOLIDATION_CONFIG,
  DEFAULT_OBSERVER_CONFIG,
  DEFAULT_PRUNE_CONFIG,
} from './memory-system.js'
export type { MemorySystemState } from './memory-system.js'

// ---------------------------------------------------------------------------
// Layer 1: Semantic memory schemas, types, resource factory
// ---------------------------------------------------------------------------

export {
  semanticCategoryEnum,
  semanticFactSchema,
  semanticMemoryStateSchema,
  createSemanticMemoryResource,
} from './semantic-memory.js'
export type { SemanticFact, SemanticMemoryState } from './semantic-memory.js'

// ---------------------------------------------------------------------------
// Layer 2: Episodic memory helpers (verb-first naming)
// ---------------------------------------------------------------------------

export { encode as encodeEpisode } from './episodic-memory-helpers.js'
export { recent as recentEpisodes } from './episodic-memory-helpers.js'
export { markConsolidated as markEpisodesConsolidated } from './episodic-memory-helpers.js'
export type { EncodeEpisodeInput } from './episodic-memory-helpers.js'

// ---------------------------------------------------------------------------
// Layer 2: Semantic memory helpers (verb-first naming)
// ---------------------------------------------------------------------------

export { addFact as addSemanticFact } from './semantic-memory-helpers.js'
export { updateFact as updateSemanticFact } from './semantic-memory-helpers.js'
export { reinforce as reinforceSemanticFact } from './semantic-memory-helpers.js'
export { removeFact as removeSemanticFact } from './semantic-memory-helpers.js'
export { allFacts as semanticFacts } from './semantic-memory-helpers.js'
export { query as querySemanticFacts } from './semantic-memory-helpers.js'
export { topFacts as topSemanticFacts } from './semantic-memory-helpers.js'
export { cullByEffectiveConfidence } from './semantic-memory-helpers.js'

// ---------------------------------------------------------------------------
// Layer 1 + 2 + 3: Memory hygiene — janitor resource, helpers, block (FIX-411)
// ---------------------------------------------------------------------------

export {
  effectiveConfidence,
  janitorResource,
  janitorStateSchema,
  DEFAULT_HYGIENE_CONFIG,
} from './janitor.js'
export type { JanitorState } from './janitor.js'
export { cullByTTL, markStale } from './episodic-memory-helpers.js'
export type { EpisodicTTLConfig } from './episodic-memory-helpers.js'
export { memorySystemJanitor } from './janitor-blocks.js'
export type { ResolvedHygieneConfig } from './janitor-blocks.js'

// ---------------------------------------------------------------------------
// Layer 1: Digest memory schemas, types, resource factory
// ---------------------------------------------------------------------------

export {
  digestSchema,
  digestSourceSignatureSchema,
  digestMemoryStateSchema,
  createDigestMemoryResource,
} from './digest-memory.js'
export type {
  Digest,
  DigestSourceSignature,
  DigestMemoryState,
} from './digest-memory.js'

// ---------------------------------------------------------------------------
// Layer 2: Digest memory helpers (verb-first naming)
// ---------------------------------------------------------------------------

export {
  computeSourceSignature as computeDigestSourceSignature,
  isStale as digestIsStale,
} from './digest-helpers.js'

// ---------------------------------------------------------------------------
// Layer 3: Digest block factories
// ---------------------------------------------------------------------------

export {
  digestOutputSchema,
  digestRegenerateInputSchema,
  digestRegenerate,
  digestRegenerateGuard,
  digestRegenerateGenerate,
  digestRegeneratePersist,
  buildDigestContext,
  rankEpisodesForDigest,
} from './digest-blocks.js'
export type {
  DigestBlocksConfig,
  DigestRegenerateConfig,
} from './digest-blocks.js'

// ---------------------------------------------------------------------------
// Layer 3: Memory context formatter (configurable factory + per-section builders)
// ---------------------------------------------------------------------------

export {
  createMemoryContextFormatter,
  createDigestEntry,
  createWorkingEntry,
  createSemanticEntry,
  createEpisodicEntry,
  DEFAULT_SEMANTIC_TOP_N,
  DEFAULT_EPISODIC_LIMIT,
} from './formatter.js'
export type {
  MemoryContextFormatterOptions,
  MemoryContextValue,
  SemanticSectionOption,
  EpisodicSectionOption,
} from './formatter.js'

// ---------------------------------------------------------------------------
// Layer 3: Unified memory system factory
// ---------------------------------------------------------------------------

export { system, DEFAULT_DIGEST_CONFIG, MEMORY_CAPABILITY_PRESETS } from './memory-system.js'
export type {
  MemorySystemConfig,
  MemorySystem,
  MemoryToolConfig,
  HygieneConfig,
  RankedMemoryItem,
  WorkingMemorySystemConfig,
  EpisodicMemoryConfig,
  SemanticMemoryConfig,
  DigestSystemConfig,
  MemoryCapabilityPreset,
} from './memory-system.js'

// ---------------------------------------------------------------------------
// Layer 3: Composed memory capability factory
// ---------------------------------------------------------------------------

export { createMemoryCapability } from './memory-capability.js'
export type {
  CreateMemoryCapabilityOptions,
  MemoryCapability,
  MemoryCapabilityResources,
} from './memory-capability.js'

// ---------------------------------------------------------------------------
// Layer 3: Agent-invocable recall tool (FIX-409)
// ---------------------------------------------------------------------------

export {
  createRecallTool,
  recallToolDescription,
  recallToolInputSchema,
  capContent,
  buildResult,
  buildResultMetadata,
  defaultFormatBlock,
  DEFAULT_PER_ITEM_CHAR_CAP,
  DEFAULT_RECALL_LIMIT,
  TRUNCATION_MARKER,
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
} from './tools/index.js'
export type {
  CreateRecallToolOptions,
  MemoryItem,
  MemoryItemSource,
  PrepareEnvelope,
  PrepareInput,
  RecallResultItem,
  RecallToolInput,
  RecallToolResult,
  RetrievalStrategy,
  BuiltInStrategyName,
  LlmFilterStrategyOptions,
  ResolveStrategyOptions,
} from './tools/index.js'

// ---------------------------------------------------------------------------
// Layer 3: Memory system block factories
// ---------------------------------------------------------------------------

export {
  unifiedObservationsSchema,
  consolidationOutputSchema,
  pruneOutputSchema,
  memorySystemObserve,
  memorySystemReflect,
  memorySystemTick,
  memorySystemCapture,
  memorySystemConsolidate,
  memorySystemPrune,
  pruneGuard,
  pruneGenerate,
  prunePersist,
} from './memory-system-blocks.js'
export type { UnifiedObservations, ConsolidationOutput, PruneOutput } from './memory-system-blocks.js'

// ---------------------------------------------------------------------------
// Capabilities — defineCapability() surfaces for each memory tier
// ---------------------------------------------------------------------------

export {
  createWorkingMemoryCapability,
  workingMemoryCapability,
  createEpisodicMemoryCapability,
  episodicMemoryCapability,
  createSemanticMemoryCapability,
  semanticMemoryCapability,
  createDigestMemoryCapability,
  digestMemoryCapability,
} from './capabilities.js'
export type {
  EpisodicMemoryCapabilityConfig,
  SemanticMemoryCapabilityConfig,
  DigestMemoryCapabilityConfig,
  AddSemanticFactInput,
} from './capabilities.js'

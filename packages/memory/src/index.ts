// ---------------------------------------------------------------------------
// Layer 0: Consumer contract
// ---------------------------------------------------------------------------

export type {
  MemoryProvider,
  MemoryContextSections,
  RankedMemorySource,
} from './provider'

// ---------------------------------------------------------------------------
// Layer 1: Schemas, types, resource
// ---------------------------------------------------------------------------

export {
  workingMemoryEntrySchema,
  workingMemoryStateSchema,
  workingMemoryResource,
  workingMemoryResources,
} from './working-memory'
export type {
  WorkingMemoryEntry,
  WorkingMemoryState,
  DecayStrategy,
} from './working-memory'

// ---------------------------------------------------------------------------
// Layer 2: Helpers, accessors, formatters (verb-first naming)
// ---------------------------------------------------------------------------

export { DEFAULT_WORKING_MEMORY_CONFIG } from './working-memory-helpers'
export { computeDecay, computeSalience } from './working-memory-helpers'

// Helpers — verb-first naming distinguishes from block factories and prevents
// collisions with future episodic/semantic memory helpers.
export { add as addWorkingMemory } from './working-memory-helpers'
export { evict as evictWorkingMemory } from './working-memory-helpers'
export { pin as pinWorkingMemory } from './working-memory-helpers'
export { unpin as unpinWorkingMemory } from './working-memory-helpers'
export { refresh as refreshWorkingMemory } from './working-memory-helpers'
export { advance as advanceWorkingMemory } from './working-memory-helpers'
export { items as workingMemoryItems } from './working-memory-helpers'
export { formatForContext as formatWorkingMemoryEntries } from './working-memory-helpers'
export { workingMemoryContextFormatter } from './working-memory-helpers'

export type {
  WorkingMemoryDecayConfig,
  WorkingMemoryHelperConfig,
  AddEntryInput,
} from './working-memory-helpers'

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
} from './working-memory-blocks'
export type {
  Observations,
  WorkingMemoryBlockConfig,
  WorkingMemoryCaptureConfig,
  WorkingMemoryObserveConfig,
} from './working-memory-blocks'

// ---------------------------------------------------------------------------
// Layer 1: Episodic memory schemas, types, resource factory
// ---------------------------------------------------------------------------

export {
  episodeSchema,
  episodicMemoryStateSchema,
  createEpisodicMemoryResource,
} from './episodic-memory'
export type { Episode, EpisodicMemoryState } from './episodic-memory'

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
} from './memory-system'
export type { MemorySystemState } from './memory-system'

// ---------------------------------------------------------------------------
// Layer 1: Semantic memory schemas, types, resource factory
// ---------------------------------------------------------------------------

export {
  semanticCategoryEnum,
  semanticFactSchema,
  semanticMemoryStateSchema,
  createSemanticMemoryResource,
} from './semantic-memory'
export type { SemanticFact, SemanticMemoryState } from './semantic-memory'

// ---------------------------------------------------------------------------
// Layer 2: Episodic memory helpers (verb-first naming)
// ---------------------------------------------------------------------------

export { encode as encodeEpisode } from './episodic-memory-helpers'
export { recent as recentEpisodes } from './episodic-memory-helpers'
export { markConsolidated as markEpisodesConsolidated } from './episodic-memory-helpers'
export type { EncodeEpisodeInput } from './episodic-memory-helpers'

// ---------------------------------------------------------------------------
// Layer 2: Semantic memory helpers (verb-first naming)
// ---------------------------------------------------------------------------

export { addFact as addSemanticFact } from './semantic-memory-helpers'
export { updateFact as updateSemanticFact } from './semantic-memory-helpers'
export { reinforce as reinforceSemanticFact } from './semantic-memory-helpers'
export { removeFact as removeSemanticFact } from './semantic-memory-helpers'
export { allFacts as semanticFacts } from './semantic-memory-helpers'
export { query as querySemanticFacts } from './semantic-memory-helpers'
export { topFacts as topSemanticFacts } from './semantic-memory-helpers'
export { cullByEffectiveConfidence } from './semantic-memory-helpers'

// ---------------------------------------------------------------------------
// Layer 1 + 2 + 3: Memory hygiene — janitor resource, helpers, block (FIX-411)
// ---------------------------------------------------------------------------

export {
  effectiveConfidence,
  janitorResource,
  janitorStateSchema,
  DEFAULT_HYGIENE_CONFIG,
} from './janitor'
export type { JanitorState } from './janitor'
export { cullByTTL, markStale } from './episodic-memory-helpers'
export type { EpisodicTTLConfig } from './episodic-memory-helpers'
export { memorySystemJanitor } from './janitor-blocks'
export type { ResolvedHygieneConfig } from './janitor-blocks'

// ---------------------------------------------------------------------------
// Layer 1: Digest memory schemas, types, resource factory
// ---------------------------------------------------------------------------

export {
  digestSchema,
  digestSourceSignatureSchema,
  digestMemoryStateSchema,
  createDigestMemoryResource,
} from './digest-memory'
export type {
  Digest,
  DigestSourceSignature,
  DigestMemoryState,
} from './digest-memory'

// ---------------------------------------------------------------------------
// Layer 2: Digest memory helpers (verb-first naming)
// ---------------------------------------------------------------------------

export {
  computeSourceSignature as computeDigestSourceSignature,
  isStale as digestIsStale,
} from './digest-helpers'

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
} from './digest-blocks'
export type {
  DigestBlocksConfig,
  DigestRegenerateConfig,
} from './digest-blocks'

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
} from './formatter'
export type {
  MemoryContextFormatterOptions,
  MemoryContextValue,
  SemanticSectionOption,
  EpisodicSectionOption,
} from './formatter'

// ---------------------------------------------------------------------------
// Layer 3: Unified memory system factory
// ---------------------------------------------------------------------------

export { system, DEFAULT_DIGEST_CONFIG, MEMORY_CAPABILITY_PRESETS } from './memory-system'
export type {
  MemorySystemConfig,
  MemorySystem,
  MemoryToolConfig,
  HygieneConfig,
  RankedMemoryItem,
  WorkingMemorySystemConfig,
  EpisodicMemoryConfig,
  SemanticMemoryConfig,
  RelationsConfig,
  DigestSystemConfig,
  MemoryCapabilityPreset,
} from './memory-system'

// ---------------------------------------------------------------------------
// Layer 3: Composed memory capability factory
// ---------------------------------------------------------------------------

export { createMemoryCapability } from './memory-capability'
export type {
  CreateMemoryCapabilityOptions,
  MemoryCapability,
  MemoryCapabilityResources,
} from './memory-capability'

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
} from './tools/index'
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
} from './tools/index'

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
} from './memory-system-blocks'
export type { UnifiedObservations, ConsolidationOutput, PruneOutput } from './memory-system-blocks'

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
} from './capabilities'
export type {
  EpisodicMemoryCapabilityConfig,
  SemanticMemoryCapabilityConfig,
  DigestMemoryCapabilityConfig,
  AddSemanticFactInput,
} from './capabilities'

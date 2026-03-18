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
} from './memory-system.js'
export type { MemorySystemState } from './memory-system.js'

// ---------------------------------------------------------------------------
// Layer 2: Episodic memory helpers (verb-first naming)
// ---------------------------------------------------------------------------

export { encode as encodeEpisode } from './episodic-memory-helpers.js'
export { recent as recentEpisodes } from './episodic-memory-helpers.js'
export { markConsolidated as markEpisodesConsolidated } from './episodic-memory-helpers.js'
export type { EncodeEpisodeInput } from './episodic-memory-helpers.js'

// ---------------------------------------------------------------------------
// Layer 3: Unified memory system factory
// ---------------------------------------------------------------------------

export { system } from './memory-system.js'
export type {
  MemorySystemConfig,
  MemorySystem,
  RankedMemoryItem,
  WorkingMemorySystemConfig,
  EpisodicMemoryConfig,
} from './memory-system.js'

// ---------------------------------------------------------------------------
// Layer 3: Memory system block factories
// ---------------------------------------------------------------------------

export {
  unifiedObservationsSchema,
  memorySystemObserve,
  memorySystemReflect,
  memorySystemTick,
  memorySystemCapture,
} from './memory-system-blocks.js'
export type { UnifiedObservations } from './memory-system-blocks.js'

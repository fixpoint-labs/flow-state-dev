// ---------------------------------------------------------------------------
// Layer 1: Schemas, types, resource
// ---------------------------------------------------------------------------

export {
  workingMemoryEntrySchema,
  workingMemoryStateSchema,
  workingMemoryResource,
} from './working-memory.js'
export type {
  WorkingMemoryEntry,
  WorkingMemoryState,
  DecayStrategy,
} from './working-memory.js'

// ---------------------------------------------------------------------------
// Layer 2: Helpers (domain-qualified to avoid collisions across memory types)
// ---------------------------------------------------------------------------

export { DEFAULT_WORKING_MEMORY_CONFIG } from './working-memory-helpers.js'
export { computeDecay, computeSalience } from './working-memory-helpers.js'

// Resource operations — qualified with WorkingMemory suffix so they don't
// collide with future episodic/semantic memory helpers on the memory.* namespace.
export { add as addWorkingMemory } from './working-memory-helpers.js'
export { evict as evictWorkingMemory } from './working-memory-helpers.js'
export { pin as pinWorkingMemory } from './working-memory-helpers.js'
export { unpin as unpinWorkingMemory } from './working-memory-helpers.js'
export { refresh as refreshWorkingMemory } from './working-memory-helpers.js'
export { advance as advanceWorkingMemory } from './working-memory-helpers.js'
export { items as workingMemoryItems } from './working-memory-helpers.js'
export { formatForContext as formatWorkingMemory } from './working-memory-helpers.js'
export { workingMemoryContext } from './working-memory-helpers.js'

export type {
  WorkingMemoryDecayConfig,
  WorkingMemoryHelperConfig,
  AddEntryInput,
} from './working-memory-helpers.js'

// ---------------------------------------------------------------------------
// Layer 3: Block factories
// ---------------------------------------------------------------------------

export {
  observationsSchema,
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

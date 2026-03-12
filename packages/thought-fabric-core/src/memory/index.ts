// Layer 1: Schemas, types, resource
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

// Layer 2: Helpers
export {
  DEFAULT_WORKING_MEMORY_CONFIG,
  computeDecay,
  computeSalience,
  add,
  evict,
  pin,
  unpin,
  refresh,
  tick,
  items,
  formatForContext,
  formatForObserveContext,
  workingMemoryContext,
} from './working-memory-helpers.js'
export type {
  WorkingMemoryDecayConfig,
  WorkingMemoryHelperConfig,
  AddEntryInput,
} from './working-memory-helpers.js'

// Layer 3: Blocks
export {
  workingMemoryCapture,
  workingMemoryObserve,
  workingMemoryTick,
  workingMemorySnapshot,
  workingMemoryAdd,
} from './working-memory-blocks.js'
export type {
  WorkingMemoryBlockConfig,
  WorkingMemoryCaptureConfig,
  WorkingMemoryObserveConfig,
} from './working-memory-blocks.js'

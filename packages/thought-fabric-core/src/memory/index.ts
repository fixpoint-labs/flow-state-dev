// Resource and schemas
export {
  workingMemoryResource,
  workingMemoryEntrySchema,
  workingMemoryStateSchema
} from './working-memory.js'
export type { WorkingMemoryEntry, WorkingMemoryState } from './working-memory.js'

// Helper functions
export {
  add,
  evict,
  pin,
  unpin,
  refresh,
  tick,
  items,
  formatForContext,
  computeDecay,
  computeSalience,
  DEFAULT_HELPER_CONFIG as defaultHelperConfig
} from './working-memory-helpers.js'
export type {
  DecayConfig,
  WorkingMemoryHelperConfig,
  AddEntryInput
} from './working-memory-helpers.js'

// Composable blocks
export {
  workingMemoryCapture,
  workingMemoryObserve,
  workingMemoryTick,
  workingMemorySnapshot,
  workingMemoryAdd
} from './working-memory-blocks.js'
export type {
  WorkingMemoryCaptureConfig,
  WorkingMemoryObserveConfig,
  WorkingMemoryTickConfig,
  WorkingMemoryAddConfig
} from './working-memory-blocks.js'

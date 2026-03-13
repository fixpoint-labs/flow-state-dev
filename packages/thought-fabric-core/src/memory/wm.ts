/**
 * Subpath entry for `@thought-fabric/core/working-memory`.
 *
 * Provides clean short names for working memory blocks, helpers, and
 * infrastructure. This is the preferred import path:
 *
 * ```ts
 * import { capture, observe, resource } from '@thought-fabric/core/working-memory'
 * // OR
 * import workingMemory from '@thought-fabric/core/working-memory'
 * ```
 *
 * Block factories and helpers use distinct vocabulary so there are no
 * collisions — `tick` is always the block, `advance` is always the helper.
 */

// ---------------------------------------------------------------------------
// Block factories (pipeline composition API)
// ---------------------------------------------------------------------------

export { workingMemoryCapture as capture } from './working-memory-blocks.js'
export { workingMemoryObserve as observe } from './working-memory-blocks.js'
export { workingMemoryRemember as remember } from './working-memory-blocks.js'
export { workingMemoryTick as tick } from './working-memory-blocks.js'
export { workingMemorySnapshot as snapshot } from './working-memory-blocks.js'
export { workingMemoryAdd as store } from './working-memory-blocks.js'
export { observationsSchema } from './working-memory-blocks.js'

export type {
  Observations,
  WorkingMemoryBlockConfig,
  WorkingMemoryCaptureConfig,
  WorkingMemoryObserveConfig,
} from './working-memory-blocks.js'

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

export { workingMemoryResource as resource } from './working-memory.js'
export { workingMemoryEntrySchema as entrySchema } from './working-memory.js'
export { workingMemoryStateSchema as stateSchema } from './working-memory.js'

export type {
  WorkingMemoryEntry,
  WorkingMemoryState,
  DecayStrategy,
} from './working-memory.js'

export { workingMemoryContext as context } from './working-memory-helpers.js'

// ---------------------------------------------------------------------------
// Helper functions (direct resource manipulation)
// ---------------------------------------------------------------------------

export { add, evict, pin, unpin, refresh, advance, items, formatForContext } from './working-memory-helpers.js'
export { computeDecay, computeSalience, DEFAULT_WORKING_MEMORY_CONFIG as DEFAULT_CONFIG } from './working-memory-helpers.js'

export type {
  WorkingMemoryDecayConfig,
  WorkingMemoryHelperConfig,
  AddEntryInput,
} from './working-memory-helpers.js'

// ---------------------------------------------------------------------------
// Default export — namespace object for `import workingMemory from '...'`
// ---------------------------------------------------------------------------

import { workingMemoryCapture, workingMemoryObserve, workingMemoryRemember, workingMemoryTick, workingMemorySnapshot, workingMemoryAdd, observationsSchema as _observationsSchema } from './working-memory-blocks.js'
import { workingMemoryResource, workingMemoryEntrySchema, workingMemoryStateSchema } from './working-memory.js'
import { workingMemoryContext, add as _add, evict as _evict, pin as _pin, unpin as _unpin, refresh as _refresh, advance as _advance, items as _items, formatForContext as _formatForContext, computeDecay as _computeDecay, computeSalience as _computeSalience, DEFAULT_WORKING_MEMORY_CONFIG } from './working-memory-helpers.js'

export default {
  // Block factories
  capture: workingMemoryCapture,
  observe: workingMemoryObserve,
  remember: workingMemoryRemember,
  tick: workingMemoryTick,
  snapshot: workingMemorySnapshot,
  store: workingMemoryAdd,

  // Infrastructure
  resource: workingMemoryResource,
  context: workingMemoryContext,

  // Schemas
  entrySchema: workingMemoryEntrySchema,
  stateSchema: workingMemoryStateSchema,
  observationsSchema: _observationsSchema,

  // Helpers
  add: _add,
  evict: _evict,
  pin: _pin,
  unpin: _unpin,
  refresh: _refresh,
  advance: _advance,
  items: _items,
  formatForContext: _formatForContext,

  // Math
  computeDecay: _computeDecay,
  computeSalience: _computeSalience,

  // Config
  DEFAULT_CONFIG: DEFAULT_WORKING_MEMORY_CONFIG,
} as const

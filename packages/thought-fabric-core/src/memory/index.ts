/**
 * @deprecated Memory has moved to `@flow-state-dev/patterns/memory`.
 *
 * This re-export is retained for one minor version. Update imports:
 *
 * ```ts
 * // Before:
 * import { system } from '@thought-fabric/core/memory'
 * // After:
 * import { system } from '@flow-state-dev/patterns/memory'
 * ```
 *
 * TF will host specialized cognitive memory variants (dream-pattern sweeps,
 * topic-curated profile memories) on top of the same `MemoryProvider`
 * contract when those land.
 */
export * from '@flow-state-dev/patterns/memory'

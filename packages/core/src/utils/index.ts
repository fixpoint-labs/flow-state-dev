/**
 * Internal utilities barrel for `@flow-state-dev/core`.
 *
 * Existing imports across the package use direct path imports
 * (`./utils/deep-merge`, etc.) — this barrel is additive for code that
 * wants the broader utility surface in one place. Public API re-exports
 * live in `packages/core/src/index.ts`.
 */

export { deepEqual } from "./deep-equal";
export { deepMerge } from "./deep-merge";
export { sanitizeToolName } from "./tool-name";
export {
  transientSlot,
  isTransientSlot,
  getTransientKeys,
  stripTransientKeys,
} from "./transient-slot";

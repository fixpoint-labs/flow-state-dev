/**
 * Internal utilities barrel for `@flow-state-dev/core`.
 *
 * Existing imports across the package use direct path imports
 * (`../helpers/deep-merge`, etc.) — this barrel is additive for code that
 * wants the broader utility surface in one place. Public API re-exports
 * live in `packages/core/src/index.ts`.
 */

export { cloneValue } from "./clone";
export { mapLimit } from "./concurrency";
export { deepEqual, looseDeepEqual } from "./deep-equal";
export { deepMerge } from "./deep-merge";
export { warnDeprecated, __resetDeprecationWarningsForTests } from "./deprecation";
export { sanitizeToolName } from "./tool-name";
export {
  transientSlot,
  isTransientSlot,
  getTransientKeys,
  stripTransientKeys,
} from "./transient-slot";
export { resolveClientProjection, hasClientProjection, validateClientProjection } from "./client-projection";
export {
  introspectStateKeys,
  getZodTypeName,
  isZodObject,
  getZodObjectShape,
  getZodArrayElement,
  getZodInnerType,
  compareZodSchemasStructurally,
  type ZodSchemaCompareResult,
} from "./zod-introspect";
export { shortId, tokenize, tokenOverlap, findBestOverlap } from "./text-match";

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
export { __resetDeprecationWarningsForTests } from "./deprecation";
export { sanitizeToolName, ensureUniqueAlias, computeToolAliases } from "./tool-name";
export {
  transientSlot,
  isTransientSlot,
  getTransientKeys,
  stripTransientKeys,
} from "./transient-slot";
export { resolveClientProjection, hasClientProjection, validateClientProjection, omitSecretFields, resolveClientData } from "./client-projection";
export {
  introspectStateKeys,
  getZodTypeName,
  isZodObject,
  getZodObjectShape,
  getZodArrayElement,
  getZodInnerType,
  getReadonlyStateKeys,
  compareZodSchemasStructurally,
  containsZodLazy,
  dynamicDefaultFactories,
  getZodDeclaredDefault,
  type ZodDeclaredDefault,
  type ZodSchemaCompareResult,
} from "./zod-introspect";
export {
  mergeScopeStateSchemas,
  isMergeableScopeStateSchema,
  ScopeStateSchemaConflictError,
  type ScopeStateDeclaration,
  type ScopeStateConflictKind,
} from "./scope-state-merge";
export { shortId, tokenize, tokenOverlap, findBestOverlap } from "./text-match";
export {
  withOutcome,
  updateStateWith,
  readCommitted,
  type UpdateOutcome,
  type UpdateStateRunner,
} from "./update-state-with";
export { toError } from "./to-error";
export { isWindowsReservedName } from "./windows-reserved-name";
export { MAX_SEGMENT_LENGTH, segmentNameProblem, type SegmentNameProblem } from "./segment-name";
export { withTimeout } from "./with-timeout";
export {
  assertSetExpectedVersion,
  assertDeleteExpectedVersion,
  resourceStateConflict,
  type ExpectedVersion,
  type VersionedRow,
  type VersionConflict,
} from "./write-version";

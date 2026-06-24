/**
 * Public error exports for `@flow-state-dev/core`. Re-exported from the
 * package root.
 */
export { FlowError } from "./flow-error";
export type { FlowErrorOptions, FlowErrorScope } from "./flow-error";
export { OutputValidationError } from "./output-validation-error";
export type { OutputValidationDetails } from "./output-validation-error";
export { StrictSchemaError } from "./strict-schema-error";
export type { StrictViolation } from "./strict-schema-error";
export {
  SequencerOutputSchemaError,
  SequencerSchemaMismatchError
} from "./sequencer-output-schema-error";
export type {
  SequencerOutputSchemaErrorDetails,
  SequencerSchemaMismatchErrorDetails
} from "./sequencer-output-schema-error";
export { rootCause, isAbortLike } from "./abort";
export { serializeError, errorDetailsWithCause } from "./serialize-error";
export type { SerializedError } from "./serialize-error";
export {
  SuspensionError,
  SuspensionRejectedError,
  SuspensionTimeoutError,
  resolveAllowedActions
} from "./suspension-error";
export type { SuspendOptions } from "./suspension-error";

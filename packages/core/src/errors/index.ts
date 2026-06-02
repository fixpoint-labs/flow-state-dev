/**
 * Public error exports for `@flow-state-dev/core`. Re-exported from the
 * package root.
 */
export { FlowError } from "./flow-error";
export type { FlowErrorOptions, FlowErrorScope } from "./flow-error";
export { OutputValidationError } from "./output-validation-error";
export type { OutputValidationDetails } from "./output-validation-error";
export {
  SequencerOutputSchemaError,
  SequencerSchemaMismatchError
} from "./sequencer-output-schema-error";
export type {
  SequencerOutputSchemaErrorDetails,
  SequencerSchemaMismatchErrorDetails
} from "./sequencer-output-schema-error";
export { rootCause, isAbortLike } from "./abort";
export {
  SuspensionError,
  SuspensionRejectedError,
  SuspensionTimeoutError
} from "./suspension-error";
export type { SuspendOptions } from "./suspension-error";

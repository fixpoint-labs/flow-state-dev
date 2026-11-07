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
export { RouteUnavailableError } from "./route-unavailable-error";
export type { RouteUnavailableDetails } from "./route-unavailable-error";
export { RecordedValueOmittedError, RECORDED_VALUE_OMITTED } from "./recorded-value-omitted-error";
export type { RecordedValueOmittedDetails } from "./recorded-value-omitted-error";
export { isAbortLike } from "./abort";
export { errorDetailsWithCause } from "./serialize-error";
export {
  SuspensionError,
  SuspensionRejectedError,
  SuspensionTimeoutError
} from "./suspension-error";
export { resolveAllowedActions } from "./resolve-allowed-actions";
export type { SuspendOptions } from "./suspension-error";

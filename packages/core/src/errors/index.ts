/**
 * Public error exports for `@flow-state-dev/core`. Re-exported from the
 * package root.
 */
export { FlowError } from "./flow-error.js";
export type { FlowErrorOptions, FlowErrorScope } from "./flow-error.js";
export { OutputValidationError } from "./output-validation-error.js";
export type { OutputValidationDetails } from "./output-validation-error.js";
export { rootCause, isAbortLike } from "./abort.js";

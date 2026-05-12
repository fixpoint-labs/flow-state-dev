/**
 * Thrown by the generator runtime when a model output fails its declared
 * `outputSchema`. Carries the raw text/JSON the model returned, the Zod issues
 * produced by the failing parse, and which validation phase emitted it
 * (`"final"` for the post-generate parse, `"stream"` for streaming).
 */
import type { ZodIssue } from "zod";
import { FlowError } from "./flow-error.js";

export type OutputValidationDetails = {
  rawOutput: string;
  issues: ZodIssue[];
  phase: "stream" | "final";
} & Record<string, unknown>;

export class OutputValidationError extends FlowError {
  declare readonly details: OutputValidationDetails;

  constructor(message: string, details: OutputValidationDetails, cause?: unknown) {
    super(message, {
      code: "output_validation_error",
      retryable: false,
      details,
      cause
    });
    this.name = "OutputValidationError";
  }
}

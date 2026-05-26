/**
 * Errors raised when a sequencer's declared `outputSchema` contract is broken.
 *
 * `SequencerOutputSchemaError` fires at runtime when the value a sequencer
 * actually returns (from its natural tail, an `exitIf` early exit, or a
 * `rescue` recovery) fails `outputSchema.safeParse(...)`. It carries the
 * offending value, the Zod issues, and the last state-mutating step's name.
 *
 * `SequencerSchemaMismatchError` fires at build time from `.validate()` when
 * the declared `outputSchema` is structurally incompatible with the schema the
 * chain's final step infers.
 *
 * Both extend `FlowError` (`retryable: false`) so they flow through the
 * existing error normalizer and are catchable via `.rescue([{ when: [...] }])`.
 */
import type { ZodIssue } from "zod";
import { FlowError } from "./flow-error.js";

/** Structured payload attached to a runtime sequencer-output validation failure. */
export type SequencerOutputSchemaErrorDetails = {
  sequencerName: string;
  lastStepName: string | undefined;
  rawOutput: unknown;
  issues: ZodIssue[];
} & Record<string, unknown>;

/**
 * Thrown by the sequencer runtime when the composed output fails the declared
 * `outputSchema`. `rawOutput` is the actual (typed JS) value that failed —
 * unlike `OutputValidationError`, which carries raw LLM text.
 */
export class SequencerOutputSchemaError extends FlowError {
  declare readonly details: SequencerOutputSchemaErrorDetails;

  constructor(
    message: string,
    details: SequencerOutputSchemaErrorDetails,
    cause?: unknown
  ) {
    super(message, {
      code: "sequencer_output_schema_error",
      retryable: false,
      details,
      cause
    });
    this.name = "SequencerOutputSchemaError";
  }
}

/** Structured payload attached to a build-time `.validate()` structural mismatch. */
export type SequencerSchemaMismatchErrorDetails = {
  sequencerName: string;
  declaredKind: string;
  inferredKind: string | undefined;
  reason: string;
} & Record<string, unknown>;

/**
 * Thrown by `SequencerDefinition.validate()` when the declared `outputSchema`
 * and the chain's inferred output schema disagree structurally (top-level kind,
 * object key set, one level of value kinds, or array element kind).
 */
export class SequencerSchemaMismatchError extends FlowError {
  declare readonly details: SequencerSchemaMismatchErrorDetails;

  constructor(message: string, details: SequencerSchemaMismatchErrorDetails) {
    super(message, {
      code: "sequencer_schema_mismatch",
      retryable: false,
      details
    });
    this.name = "SequencerSchemaMismatchError";
  }
}

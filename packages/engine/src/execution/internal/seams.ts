/**
 * Internal extension seams for execution instrumentation and interception.
 */
import type { FlowError } from "../../errors/flow-error";
import type { ExecutionMetadata } from "../types";

export type InternalExecutionSeams = {
  interceptBlockInput?: <TInput>(
    input: TInput,
    metadata: ExecutionMetadata
  ) => TInput | void;
  interceptBlockOutput?: <TOutput>(
    output: TOutput,
    metadata: ExecutionMetadata
  ) => TOutput | void;
  interceptNormalizedError?: (
    error: FlowError,
    metadata: ExecutionMetadata
  ) => FlowError | void;
  onGeneratorLifecycle?: (
    stage: "before_execute" | "after_execute" | "errored",
    metadata: ExecutionMetadata
  ) => Promise<void> | void;
  onActionLifecycle?: (
    stage: "started" | "completed" | "errored" | "finished",
    metadata: ExecutionMetadata
  ) => Promise<void> | void;
};

/**
 * Default seam set that leaves runtime behavior unchanged.
 */
export const NOOP_INTERNAL_EXECUTION_SEAMS: InternalExecutionSeams = {};

/**
 * Applies optional block-input interception.
 */
export function applyBlockInputSeam<TInput>(
  seams: InternalExecutionSeams | undefined,
  input: TInput,
  metadata: ExecutionMetadata
): TInput {
  const intercepted = seams?.interceptBlockInput?.(input, metadata);
  return (intercepted ?? input) as TInput;
}

/**
 * Applies optional block-output interception.
 */
export function applyBlockOutputSeam<TOutput>(
  seams: InternalExecutionSeams | undefined,
  output: TOutput,
  metadata: ExecutionMetadata
): TOutput {
  const intercepted = seams?.interceptBlockOutput?.(output, metadata);
  return (intercepted ?? output) as TOutput;
}

/**
 * Applies optional normalized-error interception.
 */
export function applyNormalizedErrorSeam(
  seams: InternalExecutionSeams | undefined,
  error: FlowError,
  metadata: ExecutionMetadata
): FlowError {
  const intercepted = seams?.interceptNormalizedError?.(error, metadata);
  return intercepted ?? error;
}

/**
 * Emits generator lifecycle signals when instrumentation is configured.
 */
export async function emitGeneratorLifecycleSeam(
  seams: InternalExecutionSeams | undefined,
  stage: "before_execute" | "after_execute" | "errored",
  metadata: ExecutionMetadata
): Promise<void> {
  await seams?.onGeneratorLifecycle?.(stage, metadata);
}

/**
 * Emits action lifecycle signals when instrumentation is configured.
 */
export async function emitActionLifecycleSeam(
  seams: InternalExecutionSeams | undefined,
  stage: "started" | "completed" | "errored" | "finished",
  metadata: ExecutionMetadata
): Promise<void> {
  await seams?.onActionLifecycle?.(stage, metadata);
}

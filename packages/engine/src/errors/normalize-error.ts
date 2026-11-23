/**
 * Normalizes unknown thrown values into a consistent FlowError shape.
 */
import { stripAnsi, toError } from "@flow-state-dev/core/helpers";
import type { FlowErrorScope } from "./flow-error";
import { FlowError } from "./flow-error";
import { classifyProviderError } from "./classify-provider-error";

export type NormalizeErrorOptions = {
  code?: string;
  retryable?: boolean;
  blockName?: string;
  blockInstanceId?: string;
  scope?: FlowErrorScope;
  details?: Record<string, unknown>;
};

function inferCode(error: Error): string {
  if (error instanceof FlowError && error.code !== undefined) {
    return error.code;
  }

  return "execution_error";
}

function inferRetryable(error: Error, code: string): boolean {
  if (error instanceof FlowError) {
    return error.retryable;
  }

  if (
    code === "network_error" ||
    code === "timeout_error" ||
    code === "rate_limit_error" ||
    code === "model_error"
  ) {
    return true;
  }

  return false;
}

/**
 * Converts any thrown value into FlowError while preserving useful metadata when present.
 *
 * The message is what a failed turn's reason shows a person, so terminal
 * colour codes some throwers bake in (the AI SDK's AI Gateway errors, CLI
 * output) are stripped here, once, for every surface. The original error,
 * kept as `cause`, is left untouched.
 */
export function normalizeError(
  error: unknown,
  options: NormalizeErrorOptions = {}
): FlowError {
  const normalized = toError(error, "Unknown execution error");
  const message = stripAnsi(normalized.message);

  // Classify raw AI SDK provider errors into the typed taxonomy
  // (RateLimitError, TimeoutError, ...) before the generic path. Skipped when
  // the caller forces a `code` (explicit intent wins) or the error is already
  // a FlowError (its own type/code is authoritative).
  if (options.code === undefined && !(normalized instanceof FlowError)) {
    const classified = classifyProviderError(normalized, {
      blockName: options.blockName,
      blockInstanceId: options.blockInstanceId,
      scope: options.scope,
      details: wrapperDetails(options.details)
    });
    if (classified !== undefined) return classified;
  }

  const code = options.code ?? inferCode(normalized);
  const retryable = options.retryable ?? inferRetryable(normalized, code);

  if (normalized instanceof FlowError) {
    const details = options.details ?? normalized.details;
    return new FlowError(message, {
      code,
      retryable,
      blockName: options.blockName ?? normalized.blockName,
      blockInstanceId: options.blockInstanceId ?? normalized.blockInstanceId,
      scope: options.scope ?? normalized.scope,
      cause: normalized.cause,
      // Re-normalizing a wrapper keeps it a wrapper; an author's FlowError never becomes one.
      details: isNormalizedWrapper(normalized) ? wrapperDetails(details) : details
    });
  }

  return new FlowError(message, {
    code,
    retryable,
    blockName: options.blockName,
    blockInstanceId: options.blockInstanceId,
    scope: options.scope,
    cause: normalized,
    details: wrapperDetails(options.details)
  });
}

/**
 * Marks a FlowError that `normalizeError` built around a raw throw. It sits
 * in `details` as a non-enumerable symbol property, so a seam's clone that
 * copies `details` keeps it, and it never reaches output: JSON and object
 * spread skip it, and `serializeError` does not read `details`.
 */
const NORMALIZED_WRAPPER = Symbol.for("@flow-state-dev/engine/normalized-wrapper");

function wrapperDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  // A copy, so a details object the caller shares is never marked.
  return Object.defineProperty({ ...details }, NORMALIZED_WRAPPER, { value: true });
}

function isNormalizedWrapper(error: FlowError): boolean {
  return (error.details as Record<symbol, unknown> | undefined)?.[NORMALIZED_WRAPPER] === true;
}

/**
 * The `details` to show for a normalized error: its own, with nothing when a
 * wrapper's details hold only the marker (a plain throw carries none).
 */
export function displayDetails(error: FlowError): Record<string, unknown> | undefined {
  const details = error.details;
  if (details !== undefined && isNormalizedWrapper(error) && Object.keys(details).length === 0) {
    return undefined;
  }
  return details;
}

/**
 * The cause chain to serialize *below* a normalized error's own message.
 *
 * `normalizeError` wraps a non-`FlowError` throw as `FlowError.cause`, copying
 * its message (colour codes stripped) onto the synthesized `FlowError` (see
 * the branch above).
 * Serializing that layer directly would emit a redundant `details.cause` that
 * just repeats the top-level message — and, when the thrown error had a real
 * cause, an extra wrapper level. Unwrapping the synthetic layer makes the
 * server's `block_trace` / terminal error details match the raw-throw seam
 * (`emit-tool-output`), which serializes the original error's `.cause` directly.
 *
 * Only a wrapper `normalizeError` built is unwrapped, found by its marker,
 * never by comparing messages. An author's FlowError shows its cause as is.
 */
export function displayCause(error: FlowError): unknown {
  const cause = error.cause;
  if (cause instanceof Error && !FlowError.isInstance(cause) && isNormalizedWrapper(error)) {
    return (cause as Error & { cause?: unknown }).cause;
  }
  return cause;
}

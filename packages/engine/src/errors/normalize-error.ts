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
      details: options.details
    });
    if (classified !== undefined) return withUnwrap(classified, true);
  }

  const code = options.code ?? inferCode(normalized);
  const retryable = options.retryable ?? inferRetryable(normalized, code);

  if (normalized instanceof FlowError) {
    const renormalized = new FlowError(message, {
      code,
      retryable,
      blockName: options.blockName ?? normalized.blockName,
      blockInstanceId: options.blockInstanceId ?? normalized.blockInstanceId,
      scope: options.scope ?? normalized.scope,
      cause: normalized.cause,
      details: options.details ?? normalized.details
    });
    // Re-normalizing keeps the decision already made for this error. For an
    // author's FlowError, compare the messages as thrown, before stripping.
    const unwraps =
      UNWRAPS.get(normalized) ??
      (normalized.cause instanceof Error && normalized.cause.message === normalized.message);
    return withUnwrap(renormalized, unwraps);
  }

  return withUnwrap(
    new FlowError(message, {
      code,
      retryable,
      blockName: options.blockName,
      blockInstanceId: options.blockInstanceId,
      scope: options.scope,
      cause: normalized,
      details: options.details
    }),
    true
  );
}

/**
 * Whether `displayCause` unwraps the cause of a FlowError `normalizeError`
 * returned, decided where it was built: `true` for a wrapper it built around a
 * raw throw; for an author's FlowError, whether its message as thrown (before
 * colour codes were stripped) equals its cause's. Stripping never changes
 * which causes are kept.
 */
const UNWRAPS = new WeakMap<FlowError, boolean>();

function withUnwrap(error: FlowError, unwraps: boolean): FlowError {
  UNWRAPS.set(error, unwraps);
  return error;
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
 * For an error `normalizeError` returned, the decision it recorded is used,
 * since stripped colour codes make message equality unreliable there. Any
 * other FlowError unwraps only when the messages are exactly equal.
 */
export function displayCause(error: FlowError): unknown {
  const cause = error.cause;
  if (
    cause instanceof Error &&
    !FlowError.isInstance(cause) &&
    (UNWRAPS.get(error) ?? cause.message === error.message)
  ) {
    return (cause as Error & { cause?: unknown }).cause;
  }
  return cause;
}

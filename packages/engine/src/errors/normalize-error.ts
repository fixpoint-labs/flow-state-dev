/**
 * Normalizes unknown thrown values into a consistent FlowError shape.
 */
import { stripAnsi, toError } from "@flow-state-dev/core/helpers";
import { serializeError } from "@flow-state-dev/core/internal";
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
    if (classified !== undefined) return markWrapper(classified);
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
    // Re-normalizing a wrapper keeps it a wrapper; an author's FlowError never becomes one.
    return isNormalizedWrapper(normalized) ? markWrapper(renormalized) : renormalized;
  }

  return markWrapper(
    new FlowError(message, {
      code,
      retryable,
      blockName: options.blockName,
      blockInstanceId: options.blockInstanceId,
      scope: options.scope,
      cause: normalized,
      details: options.details
    })
  );
}

/**
 * What `normalizeError` built a wrapper from: the message it gave the wrapper,
 * the cause it wrapped, and that cause's own layer as a failed item would show
 * it (name, message, code, status; see {@link causeLayer}).
 */
type WrapperRecord = { message: string; cause: unknown; causeLayer: string };

/**
 * The FlowErrors that `normalizeError` built around a raw throw, each with
 * what it was built from. Kept out of band, so nothing on the error itself
 * (fields, `details`, symbols) changes. Keyed by the wrapper object, so each
 * error's entry is its own.
 *
 * An error counts as the engine's wrapper only while its message, its cause
 * and that cause's shown layer are all as they were built. One that was
 * rebuilt without an entry here (see {@link copyWrapperMarker}), or whose
 * message or cause was changed or replaced, in place or by a rebuild, says
 * something the raw throw did not, so it is treated as an author's error and
 * its cause is shown. That fails safe: more information, never less.
 */
const NORMALIZED_WRAPPERS = new WeakMap<FlowError, WrapperRecord>();

/**
 * The cause's own layer as `serializeError` shows it, without the chain below
 * it. The layer is read through a view whose own `cause` is hidden, so the
 * chain below is never visited (serializing it can throw, for example on an
 * object with no prototype).
 */
function causeLayer(cause: unknown): string {
  const layer =
    cause !== null && typeof cause === "object"
      ? Object.create(cause, { cause: { value: undefined } })
      : cause;
  return JSON.stringify(serializeError(layer, 0));
}

function markWrapper(error: FlowError): FlowError {
  NORMALIZED_WRAPPERS.set(error, {
    message: error.message,
    cause: error.cause,
    causeLayer: causeLayer(error.cause)
  });
  return error;
}

function isNormalizedWrapper(error: FlowError): boolean {
  const record = NORMALIZED_WRAPPERS.get(error);
  return (
    record !== undefined &&
    record.message === error.message &&
    record.cause === error.cause &&
    record.causeLayer === causeLayer(error.cause)
  );
}

/**
 * Give `to` the entry `from` has, when `to` is a rebuild of the same failure
 * (it keeps `from`'s cause). The entry recorded is `from`'s, as built, so a
 * rebuild with a new message, or a cause changed since, does not count as the
 * engine's wrapper. The engine's normalized-error seam calls this on the error
 * its interceptor returns.
 */
export function copyWrapperMarker(from: FlowError, to: FlowError): FlowError {
  const record = NORMALIZED_WRAPPERS.get(from);
  if (record !== undefined && to !== from && to.cause === from.cause) {
    NORMALIZED_WRAPPERS.set(to, record);
  }
  return to;
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

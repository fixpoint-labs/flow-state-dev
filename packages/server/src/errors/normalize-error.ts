/**
 * Normalizes unknown thrown values into a consistent FlowError shape.
 */
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

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return new Error(value);
  }

  return new Error("Unknown execution error");
}

/**
 * Converts any thrown value into FlowError while preserving useful metadata when present.
 */
export function normalizeError(
  error: unknown,
  options: NormalizeErrorOptions = {}
): FlowError {
  const normalized = toError(error);

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
    if (classified !== undefined) return classified;
  }

  const code = options.code ?? inferCode(normalized);
  const retryable = options.retryable ?? inferRetryable(normalized, code);

  if (normalized instanceof FlowError) {
    return new FlowError(normalized.message, {
      code,
      retryable,
      blockName: options.blockName ?? normalized.blockName,
      blockInstanceId: options.blockInstanceId ?? normalized.blockInstanceId,
      scope: options.scope ?? normalized.scope,
      cause: normalized.cause,
      details: options.details ?? normalized.details
    });
  }

  return new FlowError(normalized.message, {
    code,
    retryable,
    blockName: options.blockName,
    blockInstanceId: options.blockInstanceId,
    scope: options.scope,
    cause: normalized,
    details: options.details
  });
}

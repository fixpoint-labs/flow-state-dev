/**
 * Translates errors thrown by the `openai` SDK into the framework's typed
 * `VoiceError` discriminated by `kind`. Callers branch on `kind` and inspect
 * `retryable` instead of parsing message strings or sniffing SDK class names.
 *
 * `VoiceError` instances pass through unchanged so the translator is
 * idempotent: helpers that throw `VoiceError` directly (`mapOutputFormat`,
 * `coerceUploadable`, the instructions guard) don't get re-wrapped when
 * they bubble through a translation site.
 */

import OpenAI from "openai";
import { VoiceError } from "@flow-state-dev/core";

/**
 * Maps any thrown value from an OpenAI SDK call to a `VoiceError`. Already
 * a `VoiceError` → returned as-is. Recognized `OpenAI.*Error` subclasses →
 * mapped to their canonical `kind`. Anything else → `kind: "unknown"`.
 */
export function translateError(err: unknown): VoiceError {
  if (err instanceof VoiceError) return err;

  if (err instanceof OpenAI.APIUserAbortError) {
    return new VoiceError({
      kind: "aborted",
      provider: "openai",
      message: err.message,
      cause: err,
    });
  }
  if (
    err instanceof OpenAI.AuthenticationError ||
    err instanceof OpenAI.PermissionDeniedError
  ) {
    return new VoiceError({
      kind: "auth",
      provider: "openai",
      message: err.message,
      status: err.status,
      cause: err,
    });
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new VoiceError({
      kind: "rate_limit",
      provider: "openai",
      message: err.message,
      status: err.status,
      cause: err,
    });
  }
  if (err instanceof OpenAI.NotFoundError) {
    return new VoiceError({
      kind: "not_found",
      provider: "openai",
      message: err.message,
      status: err.status,
      cause: err,
    });
  }
  if (
    err instanceof OpenAI.BadRequestError ||
    err instanceof OpenAI.UnprocessableEntityError
  ) {
    const kind = looksLikeFormatError(err) ? "format_unsupported" : "invalid_input";
    return new VoiceError({
      kind,
      provider: "openai",
      message: err.message,
      status: err.status,
      cause: err,
    });
  }
  if (err instanceof OpenAI.InternalServerError) {
    return new VoiceError({
      kind: "provider_unavailable",
      provider: "openai",
      message: err.message,
      status: err.status,
      cause: err,
    });
  }
  if (err instanceof OpenAI.APIConnectionError) {
    // Also catches APIConnectionTimeoutError, which extends APIConnectionError.
    return new VoiceError({
      kind: "network",
      provider: "openai",
      message: err.message,
      cause: err,
    });
  }
  if (err instanceof OpenAI.APIError) {
    return new VoiceError({
      kind: "unknown",
      provider: "openai",
      message: err.message,
      status: err.status,
      cause: err,
    });
  }
  return new VoiceError({
    kind: "unknown",
    provider: "openai",
    message: err instanceof Error ? err.message : String(err),
    cause: err,
  });
}

/**
 * Heuristic for "is this 400/422 about an unsupported audio format?"
 * OpenAI doesn't have a dedicated error class for format failures, so we
 * sniff the structured fields the SDK exposes (`code`, `param`, `error`)
 * before falling back to `invalid_input`.
 */
function looksLikeFormatError(err: InstanceType<typeof OpenAI.APIError>): boolean {
  const anyErr = err as unknown as {
    code?: unknown;
    param?: unknown;
    message?: unknown;
    error?: { type?: unknown; code?: unknown; param?: unknown };
  };

  if (anyErr.code === "unsupported_format") return true;
  if (anyErr.code === "invalid_value" && anyErr.param === "response_format") return true;
  if (anyErr.param === "response_format") return true;
  if (
    anyErr.param === "file" &&
    typeof anyErr.message === "string" &&
    anyErr.message.toLowerCase().includes("format")
  ) {
    return true;
  }
  const inner = anyErr.error;
  if (
    inner !== undefined &&
    inner.type === "invalid_request_error" &&
    inner.code === "invalid_value" &&
    (inner.param === "response_format" || inner.param === "file")
  ) {
    return true;
  }
  return false;
}

/**
 * Classifies Vercel AI SDK errors into the framework's typed error taxonomy.
 *
 * The AI SDK surfaces a single `APICallError` (plus a handful of sibling
 * classes) regardless of whether the upstream failure was a rate limit, a
 * timeout, an oversized prompt, or a provider outage. Consumers — retry
 * policy, monitoring, UI — need that distinction, so this module inspects the
 * error shape and re-maps it onto `RateLimitError` / `TimeoutError` /
 * `ContextLengthError` / `ProviderUnavailableError`.
 *
 * Detection is structural (marker symbol + `name` tag + `statusCode`) rather
 * than `instanceof`, so it stays correct when the AI SDK arrives from a
 * different module realm (a common bundler/monorepo hazard).
 */
import { FlowError } from "@flow-state-dev/core";
import {
  ContextLengthError,
  ProviderUnavailableError,
  RateLimitError,
  TimeoutError
} from "./flow-error";

/** Shared marker symbol the AI SDK stamps on every error it throws. */
const AI_SDK_ERROR_MARKER = Symbol.for("vercel.ai.error");

/** Carry-over metadata applied to the classified framework error. */
export type ProviderErrorContext = {
  blockName?: string;
  blockInstanceId?: string;
  scope?: FlowError["scope"];
  details?: Record<string, unknown>;
};

const CONTEXT_LENGTH_PATTERN =
  /context length|context_length|context window|maximum context|too many tokens|maximum.*tokens|reduce the (?:length|number of|prompt)/i;

const TIMEOUT_PATTERN = /timed?\s?out|timeout|ETIMEDOUT/i;

function isAiSdkError(error: Error): boolean {
  const marker = (error as unknown as Record<symbol, unknown>)[AI_SDK_ERROR_MARKER];
  if (marker === true) return true;
  return typeof error.name === "string" && error.name.startsWith("AI_");
}

function getStatusCode(error: Error): number | undefined {
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

/**
 * Maps an AI SDK error to a typed framework error, preserving the original on
 * the `cause` chain. Returns `undefined` when the error is not an AI SDK error
 * or doesn't match a known classification (callers fall back to the generic
 * `FlowError` path).
 */
export function classifyProviderError(
  error: Error,
  context: ProviderErrorContext = {}
): FlowError | undefined {
  if (!isAiSdkError(error)) return undefined;

  const options = {
    blockName: context.blockName,
    blockInstanceId: context.blockInstanceId,
    scope: context.scope,
    cause: error,
    details: context.details
  };

  const statusCode = getStatusCode(error);
  const message = error.message;

  if (statusCode === 429) {
    return new RateLimitError(message, options);
  }

  // Context length is a 4xx that won't change on retry; check it before the
  // generic timeout/outage branches so a 400 isn't misread.
  if (CONTEXT_LENGTH_PATTERN.test(message)) {
    return new ContextLengthError(message, options);
  }

  if (statusCode === 408 || statusCode === 504 || TIMEOUT_PATTERN.test(message)) {
    return new TimeoutError(message, options);
  }

  if (statusCode !== undefined && statusCode >= 500) {
    return new ProviderUnavailableError(message, options);
  }

  return undefined;
}

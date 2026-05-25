import { describe, expect, it } from "vitest";
import {
  ContextLengthError,
  FlowError,
  ProviderUnavailableError,
  RateLimitError,
  TimeoutError,
  normalizeError
} from "../src";

/**
 * AI SDK errors are tagged with a shared marker symbol (`vercel.ai.error`)
 * and a `name` like `AI_APICallError`. `APICallError` additionally carries a
 * numeric `statusCode`. These fakes mimic that shape so the classifier is
 * exercised without a hard dependency on the AI SDK's concrete classes (which
 * may arrive from a different module realm at runtime).
 */
const AI_SDK_ERROR_MARKER = Symbol.for("vercel.ai.error");

function makeApiCallError(statusCode: number | undefined, message: string): Error {
  const error = new Error(message) as Error & {
    statusCode?: number;
    isRetryable?: boolean;
  };
  error.name = "AI_APICallError";
  (error as Record<symbol, unknown>)[AI_SDK_ERROR_MARKER] = true;
  if (statusCode !== undefined) error.statusCode = statusCode;
  return error;
}

describe("classifyProviderError via normalizeError", () => {
  it("maps a 429 AI SDK error to RateLimitError", () => {
    const normalized = normalizeError(makeApiCallError(429, "Too Many Requests"), {
      blockName: "writer",
      scope: "block"
    });

    expect(normalized).toBeInstanceOf(RateLimitError);
    expect(normalized.code).toBe("rate_limit_error");
    expect(normalized.retryable).toBe(true);
    expect(normalized.blockName).toBe("writer");
    expect(normalized.scope).toBe("block");
    // Original AI SDK error preserved on the cause chain.
    expect((normalized.cause as Error)?.name).toBe("AI_APICallError");
  });

  it("maps a 408 / timeout AI SDK error to TimeoutError", () => {
    const fromStatus = normalizeError(makeApiCallError(408, "Request Timeout"));
    const fromMessage = normalizeError(makeApiCallError(undefined, "The request timed out"));

    expect(fromStatus).toBeInstanceOf(TimeoutError);
    expect(fromStatus.code).toBe("timeout_error");
    expect(fromMessage).toBeInstanceOf(TimeoutError);
  });

  it("maps a context-length AI SDK error to ContextLengthError (non-retryable)", () => {
    const normalized = normalizeError(
      makeApiCallError(400, "This model's maximum context length is 8192 tokens")
    );

    expect(normalized).toBeInstanceOf(ContextLengthError);
    expect(normalized.code).toBe("context_length_error");
    expect(normalized.retryable).toBe(false);
  });

  it("maps a 503 AI SDK error to ProviderUnavailableError", () => {
    const normalized = normalizeError(makeApiCallError(503, "Service Unavailable"));

    expect(normalized).toBeInstanceOf(ProviderUnavailableError);
    expect(normalized.code).toBe("provider_unavailable_error");
    expect(normalized.retryable).toBe(true);
  });

  it("leaves non-AI-SDK errors as a generic FlowError", () => {
    const normalized = normalizeError(new Error("boom"));

    expect(normalized).toBeInstanceOf(FlowError);
    expect(normalized).not.toBeInstanceOf(RateLimitError);
    expect(normalized.code).toBe("execution_error");
  });

  it("does not classify when the caller forces an explicit code", () => {
    const normalized = normalizeError(makeApiCallError(429, "rate limited"), {
      code: "custom_code"
    });

    expect(normalized).not.toBeInstanceOf(RateLimitError);
    expect(normalized.code).toBe("custom_code");
  });
});

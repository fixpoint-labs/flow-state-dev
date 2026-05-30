import { describe, it, expect } from "vitest";
import OpenAI from "openai";
import { VoiceError } from "@flow-state-dev/core";
import { translateError } from "../src/translate-error";

const headers = new Headers();

function makeApiErr<T extends typeof OpenAI.APIError>(
  Cls: T,
  status: number,
  body: object,
  message: string,
): InstanceType<T> {
  return new Cls(status as never, body as never, message, headers) as InstanceType<T>;
}

describe("translateError", () => {
  it("passes through existing VoiceError unchanged (idempotent)", () => {
    const original = new VoiceError({
      kind: "format_unsupported",
      provider: "openai",
      message: "already typed",
    });
    expect(translateError(original)).toBe(original);
  });

  it("maps APIUserAbortError → aborted, non-retryable", () => {
    const err = new OpenAI.APIUserAbortError({ message: "user abort" });
    const ve = translateError(err);
    expect(ve.kind).toBe("aborted");
    expect(ve.retryable).toBe(false);
    expect(ve.cause).toBe(err);
  });

  it("maps AuthenticationError → auth", () => {
    const err = makeApiErr(OpenAI.AuthenticationError, 401, {}, "no key");
    const ve = translateError(err);
    expect(ve.kind).toBe("auth");
    expect(ve.status).toBe(401);
    expect(ve.retryable).toBe(false);
  });

  it("maps PermissionDeniedError → auth", () => {
    const err = makeApiErr(OpenAI.PermissionDeniedError, 403, {}, "forbidden");
    expect(translateError(err).kind).toBe("auth");
  });

  it("maps RateLimitError → rate_limit, retryable", () => {
    const err = makeApiErr(OpenAI.RateLimitError, 429, {}, "slow down");
    const ve = translateError(err);
    expect(ve.kind).toBe("rate_limit");
    expect(ve.retryable).toBe(true);
    expect(ve.status).toBe(429);
  });

  it("maps NotFoundError → not_found", () => {
    const err = makeApiErr(OpenAI.NotFoundError, 404, {}, "missing");
    expect(translateError(err).kind).toBe("not_found");
  });

  it("maps BadRequestError without format signal → invalid_input", () => {
    const err = makeApiErr(OpenAI.BadRequestError, 400, {}, "bad input");
    const ve = translateError(err);
    expect(ve.kind).toBe("invalid_input");
    expect(ve.retryable).toBe(false);
  });

  it("maps BadRequestError with response_format param → format_unsupported", () => {
    // The SDK unwraps `{error: {...}}` to the inner object before calling the
    // ctor, so `err.code` / `err.param` end up populated directly.
    const inner = {
      type: "invalid_request_error",
      code: "invalid_value",
      param: "response_format",
      message: "bad format",
    };
    const err = makeApiErr(OpenAI.BadRequestError, 400, inner, "bad format");
    expect(translateError(err).kind).toBe("format_unsupported");
  });

  it("maps BadRequestError with file param + format in message → format_unsupported", () => {
    const inner = { type: "invalid_request_error", param: "file", message: "unsupported format" };
    const err = makeApiErr(OpenAI.BadRequestError, 400, inner, "Invalid file: unsupported format");
    expect(translateError(err).kind).toBe("format_unsupported");
  });

  it("maps UnprocessableEntityError without format signal → invalid_input", () => {
    const err = makeApiErr(OpenAI.UnprocessableEntityError, 422, {}, "unprocessable");
    expect(translateError(err).kind).toBe("invalid_input");
  });

  it("maps InternalServerError → provider_unavailable, retryable", () => {
    const err = makeApiErr(OpenAI.InternalServerError, 500, {}, "boom");
    const ve = translateError(err);
    expect(ve.kind).toBe("provider_unavailable");
    expect(ve.retryable).toBe(true);
  });

  it("maps APIConnectionError → network, retryable", () => {
    const err = new OpenAI.APIConnectionError({ message: "dns failed" });
    const ve = translateError(err);
    expect(ve.kind).toBe("network");
    expect(ve.retryable).toBe(true);
  });

  it("maps APIConnectionTimeoutError (subclass of APIConnectionError) → network", () => {
    const err = new OpenAI.APIConnectionTimeoutError({ message: "timeout" });
    expect(translateError(err).kind).toBe("network");
  });

  it("maps generic APIError → unknown", () => {
    const err = new OpenAI.APIError(418 as never, {} as never, "teapot", headers);
    const ve = translateError(err);
    expect(ve.kind).toBe("unknown");
    expect(ve.status).toBe(418);
  });

  it("maps non-OpenAI Error → unknown with original message", () => {
    const err = new Error("totally unrelated");
    const ve = translateError(err);
    expect(ve.kind).toBe("unknown");
    expect(ve.message).toBe("totally unrelated");
    expect(ve.cause).toBe(err);
  });

  it("maps non-Error thrown value → unknown with stringified message", () => {
    const ve = translateError("boom");
    expect(ve.kind).toBe("unknown");
    expect(ve.message).toBe("boom");
  });
});

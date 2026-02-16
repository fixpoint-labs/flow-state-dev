import { describe, expect, it } from "vitest";
import {
  FlowError,
  ModelError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  ToolExecutionError,
  ValidationError,
  normalizeError
} from "../src";

describe("error model", () => {
  it("applies canonical defaults for typed error subclasses", () => {
    const validation = new ValidationError("invalid");
    const network = new NetworkError("net");
    const timeout = new TimeoutError("timeout");
    const rateLimit = new RateLimitError("rate");
    const model = new ModelError("model");
    const tool = new ToolExecutionError("tool");

    expect(validation.code).toBe("validation_error");
    expect(validation.retryable).toBe(false);
    expect(network.code).toBe("network_error");
    expect(network.retryable).toBe(true);
    expect(timeout.code).toBe("timeout_error");
    expect(rateLimit.code).toBe("rate_limit_error");
    expect(model.code).toBe("model_error");
    expect(tool.code).toBe("tool_execution_error");
    expect(tool.retryable).toBe(false);
  });

  it("preserves optional flow error metadata fields", () => {
    const error = new FlowError("boom", {
      code: "x",
      retryable: false,
      blockName: "block-a",
      blockInstanceId: "inst-a",
      scope: "work",
      cause: new Error("cause"),
      details: {
        a: 1
      }
    });

    expect(error.blockName).toBe("block-a");
    expect(error.blockInstanceId).toBe("inst-a");
    expect(error.scope).toBe("work");
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.details).toEqual({ a: 1 });
  });
});

describe("normalizeError", () => {
  it("normalizes non-error values and unknown payloads", () => {
    const fromString = normalizeError("failure");
    const fromUnknown = normalizeError({ message: "x" });

    expect(fromString.message).toBe("failure");
    expect(fromString.code).toBe("execution_error");
    expect(fromUnknown.message).toBe("Unknown execution error");
    expect(fromUnknown.code).toBe("execution_error");
  });

  it("retains FlowError semantics and supports field overrides", () => {
    const base = new NetworkError("network down", {
      blockName: "base-block",
      scope: "resource"
    });

    const normalized = normalizeError(base, {
      code: "override_code",
      retryable: false,
      blockName: "override-block",
      blockInstanceId: "instance-x",
      scope: "request",
      details: { k: "v" }
    });

    expect(normalized.code).toBe("override_code");
    expect(normalized.retryable).toBe(false);
    expect(normalized.blockName).toBe("override-block");
    expect(normalized.blockInstanceId).toBe("instance-x");
    expect(normalized.scope).toBe("request");
    expect(normalized.details).toEqual({ k: "v" });
    expect(normalized.message).toBe("network down");
  });

  it("retains FlowError fields when override options are omitted", () => {
    const base = new FlowError("base", {
      code: "base_code",
      retryable: true,
      blockName: "base-block",
      blockInstanceId: "base-instance",
      scope: "resource",
      details: { source: "base" }
    });

    const normalized = normalizeError(base);

    expect(normalized.code).toBe("base_code");
    expect(normalized.retryable).toBe(true);
    expect(normalized.blockName).toBe("base-block");
    expect(normalized.blockInstanceId).toBe("base-instance");
    expect(normalized.scope).toBe("resource");
    expect(normalized.details).toEqual({ source: "base" });
  });

  it("infers retryability from inferred code when source is plain Error", () => {
    const inferredRetryable = normalizeError(new Error("x"), {
      code: "timeout_error"
    });
    const inferredNonRetryable = normalizeError(new Error("x"));

    expect(inferredRetryable.retryable).toBe(true);
    expect(inferredNonRetryable.retryable).toBe(false);
  });
});

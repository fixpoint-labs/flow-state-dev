import { describe, it, expect } from "vitest";
import { FlowError } from "../src/errors/flow-error";

describe("FlowError", () => {
  it("constructs with message-only and defaults", () => {
    const err = new FlowError("boom");
    expect(err.message).toBe("boom");
    expect(err.name).toBe("FlowError");
    expect(err.code).toBeUndefined();
    expect(err.retryable).toBe(false);
    expect(err.details).toBeUndefined();
  });

  it("preserves code, retryable, details, cause", () => {
    const cause = new Error("inner");
    const err = new FlowError("outer", {
      code: "X",
      retryable: true,
      details: { a: 1 },
      cause
    });
    expect(err.code).toBe("X");
    expect(err.retryable).toBe(true);
    expect(err.details).toEqual({ a: 1 });
    expect(err.cause).toBe(cause);
  });

  it("isInstance matches direct instances", () => {
    expect(FlowError.isInstance(new FlowError("x"))).toBe(true);
  });

  it("isInstance matches subclass instances (instanceof path)", () => {
    class Sub extends FlowError {
      constructor() {
        super("s");
        this.name = "Sub";
      }
    }
    expect(FlowError.isInstance(new Sub())).toBe(true);
  });

  it("isInstance matches by name tag (dual-realm path)", () => {
    const fake = new Error("x");
    fake.name = "FlowError";
    expect(FlowError.isInstance(fake)).toBe(true);
  });

  it("isInstance rejects unrelated errors and non-errors", () => {
    expect(FlowError.isInstance(new Error("x"))).toBe(false);
    expect(FlowError.isInstance("string")).toBe(false);
    expect(FlowError.isInstance(undefined)).toBe(false);
  });

  it("retryable defaults to false (closes retry-path bug)", () => {
    class Custom extends FlowError {
      constructor() {
        super("c", { code: "custom" });
      }
    }
    expect(new Custom().retryable).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { FlowError } from "../src/errors/flow-error";
import { OutputValidationError } from "../src/errors/output-validation-error";

describe("OutputValidationError", () => {
  const schema = z.object({ name: z.string() });
  const result = schema.safeParse({ name: 42 });
  const issues = result.success ? [] : result.error.issues;

  it("extends FlowError with fixed code and non-retryable", () => {
    const err = new OutputValidationError("v failed", {
      rawOutput: '{"name":42}',
      issues,
      phase: "final"
    });
    expect(err).toBeInstanceOf(FlowError);
    expect(err.code).toBe("output_validation_error");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("OutputValidationError");
  });

  it("preserves typed details", () => {
    const err = new OutputValidationError("v failed", {
      rawOutput: "raw",
      issues,
      phase: "stream"
    });
    expect(err.details.rawOutput).toBe("raw");
    expect(err.details.phase).toBe("stream");
    expect(err.details.issues).toBe(issues);
  });

  it("forwards cause", () => {
    const cause = result.success ? undefined : result.error;
    const err = new OutputValidationError("v failed", {
      rawOutput: "raw",
      issues,
      phase: "final"
    }, cause);
    expect(err.cause).toBe(cause);
  });

  it("passes FlowError.isInstance", () => {
    const err = new OutputValidationError("v", { rawOutput: "", issues: [], phase: "final" });
    expect(FlowError.isInstance(err)).toBe(true);
  });
});

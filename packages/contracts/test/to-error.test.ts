import { describe, expect, it } from "vitest";
import { toError } from "../src/helpers/to-error";

describe("toError", () => {
  it("passes an Error through", () => {
    const err = new TypeError("boom");
    expect(toError(err)).toBe(err);
  });

  it("wraps a non-empty string", () => {
    const err = toError("failure");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("failure");
  });

  it("uses the block-runtime fallback for unknown payloads", () => {
    expect(toError({ message: "x" }).message).toBe("Unknown block execution error");
    expect(toError("").message).toBe("Unknown block execution error");
    expect(toError(undefined).message).toBe("Unknown block execution error");
  });

  it("accepts a caller fallback so hosts keep their own message", () => {
    expect(toError({ message: "x" }, "Unknown execution error").message).toBe(
      "Unknown execution error"
    );
  });
});

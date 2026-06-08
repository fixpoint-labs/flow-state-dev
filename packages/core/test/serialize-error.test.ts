import { describe, expect, it } from "vitest";
import { serializeError, errorDetailsWithCause } from "../src/errors/serialize-error";

describe("serializeError", () => {
  it("copies the non-enumerable name and message", () => {
    const result = serializeError(new Error("boom"));
    expect(result).toEqual({ name: "Error", message: "boom" });
  });

  it("includes a string code when present", () => {
    const err = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    expect(serializeError(err)).toEqual({
      name: "Error",
      message: "reset",
      code: "ECONNRESET",
    });
  });

  it("walks the cause chain recursively", () => {
    const root = Object.assign(new TypeError("fetch failed"), { code: "UND_ERR_SOCKET" });
    const top = new Error("tool failed", { cause: root });
    expect(serializeError(top)).toEqual({
      name: "Error",
      message: "tool failed",
      cause: { name: "TypeError", message: "fetch failed", code: "UND_ERR_SOCKET" },
    });
  });

  it("caps recursion at the depth limit", () => {
    // Build a chain deeper than the default depth (4).
    let err: Error = new Error("level-0");
    for (let i = 1; i <= 8; i += 1) {
      err = new Error(`level-${i}`, { cause: err });
    }
    let node = serializeError(err);
    let depth = 0;
    while (node.cause) {
      node = node.cause;
      depth += 1;
    }
    // Default depth 4 → at most 4 recursions plus one stringified leaf node.
    expect(depth).toBeLessThanOrEqual(5);
  });

  it("is null-safe for a missing or non-object cause", () => {
    expect(serializeError(new Error("x", { cause: undefined }))).toEqual({
      name: "Error",
      message: "x",
    });
    expect(serializeError("just a string")).toEqual({
      name: "Error",
      message: "just a string",
    });
  });

  it("omits the stack and survives a JSON round-trip unchanged", () => {
    const err = new Error("boom", { cause: new Error("root") });
    const serialized = serializeError(err);
    expect(serialized).not.toHaveProperty("stack");
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
  });
});

describe("errorDetailsWithCause", () => {
  it("returns undefined when there is no details and no cause", () => {
    expect(errorDetailsWithCause({})).toBeUndefined();
    expect(errorDetailsWithCause({ cause: null })).toBeUndefined();
  });

  it("returns details unchanged when there is no cause", () => {
    const details = { httpStatus: 403 };
    expect(errorDetailsWithCause({ details })).toBe(details);
  });

  it("merges a serialized cause into details", () => {
    const cause = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    expect(errorDetailsWithCause({ details: { errorType: "network" }, cause })).toEqual({
      errorType: "network",
      cause: { name: "Error", message: "reset", code: "ECONNRESET" },
    });
  });

  it("attaches cause even when the error has no details", () => {
    const cause = new Error("root");
    expect(errorDetailsWithCause({ cause })).toEqual({
      cause: { name: "Error", message: "root" },
    });
  });

  it("does not overwrite a cause the thrower already serialized", () => {
    const existing = { cause: { name: "Custom", message: "preserved" } };
    expect(errorDetailsWithCause({ details: existing, cause: new Error("ignored") })).toBe(
      existing
    );
  });
});

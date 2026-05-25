import { describe, expect, it } from "vitest";
import { rootCause, isAbortLike } from "../src/errors/abort";

describe("rootCause", () => {
  it("returns the error itself when there is no cause", () => {
    const err = new Error("boom");
    expect(rootCause(err)).toBe(err);
  });

  it("walks the cause chain to the root error", () => {
    const root = new Error("root");
    const mid = new Error("mid", { cause: root });
    const top = new Error("top", { cause: mid });
    expect(rootCause(top)).toBe(root);
  });

  it("returns a non-Error throwable unchanged", () => {
    expect(rootCause("just a string")).toBe("just a string");
  });

  it("stops at a non-Error cause", () => {
    const top = new Error("top", { cause: "string cause" });
    expect(rootCause(top)).toBe("string cause");
  });
});

describe("isAbortLike", () => {
  it("matches a native AbortError by name", () => {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    expect(isAbortLike(err)).toBe(true);
  });

  it("matches an AbortError wrapped behind a cause chain", () => {
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    const wrapped = new Error("AI SDK stream failed", { cause: abort });
    expect(isAbortLike(wrapped)).toBe(true);
  });

  it("matches an error carrying Node's ABORT_ERR code", () => {
    const err = Object.assign(new Error("aborted"), { code: "ABORT_ERR" });
    expect(isAbortLike(err)).toBe(true);
  });

  it("matches a DOMException-style abort code (20)", () => {
    const err = Object.assign(new Error("aborted"), { code: 20 });
    expect(isAbortLike(err)).toBe(true);
  });

  it("returns false for a genuine non-abort error", () => {
    expect(isAbortLike(new Error("model returned 500"))).toBe(false);
  });

  it("returns false for a non-Error throwable", () => {
    expect(isAbortLike("not an error")).toBe(false);
  });
});

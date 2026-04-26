import { describe, expect, it } from "vitest";
import { RESERVED_TAG_NAMES, validateTagName } from "../src/prompt";

describe("validateTagName", () => {
  it("accepts a simple kebab-case name", () => {
    expect(() => validateTagName("documents")).not.toThrow();
  });

  it("accepts multi-word kebab-case", () => {
    expect(() => validateTagName("user-preferences")).not.toThrow();
  });

  it("accepts names with digits after a leading letter", () => {
    expect(() => validateTagName("v2-section")).not.toThrow();
  });

  it("rejects names with a leading digit", () => {
    expect(() => validateTagName("1stplace")).toThrow(/Invalid context tag name/);
  });

  it("rejects names with whitespace", () => {
    expect(() => validateTagName("user input")).toThrow(/Invalid context tag name/);
  });

  it("rejects names with uppercase letters (already-normalized contract)", () => {
    expect(() => validateTagName("UserInput")).toThrow(/Invalid context tag name/);
  });

  it("rejects names with underscores (already-normalized contract)", () => {
    expect(() => validateTagName("user_input")).toThrow(/Invalid context tag name/);
  });

  it("rejects each reserved name", () => {
    for (const name of RESERVED_TAG_NAMES) {
      expect(() => validateTagName(name)).toThrow(/Reserved context tag name/);
    }
  });

  it("includes the source in the error message when provided", () => {
    expect(() => validateTagName("tool-use", "capability:my-cap")).toThrow(
      /capability:my-cap/
    );
  });

  it("treats the framework's active-skill tag as reserved", () => {
    expect(RESERVED_TAG_NAMES.has("active-skill")).toBe(true);
  });
});

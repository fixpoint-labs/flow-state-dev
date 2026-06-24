import { describe, expect, it } from "vitest";
import { camelToKebab, normalizeTagName } from "../src/helpers/string-case";

describe("camelToKebab", () => {
  it("converts camelCase to kebab-case", () => {
    expect(camelToKebab("userPreferences")).toBe("user-preferences");
  });

  it("passes through lowercase strings unchanged", () => {
    expect(camelToKebab("documents")).toBe("documents");
  });

  it("handles consecutive uppercase by inserting dashes between each", () => {
    expect(camelToKebab("XMLParser")).toBe("x-m-l-parser");
  });

  it("strips a leading dash produced by an initial uppercase", () => {
    expect(camelToKebab("Documents")).toBe("documents");
  });

  it("returns empty string unchanged", () => {
    expect(camelToKebab("")).toBe("");
  });
});

describe("normalizeTagName", () => {
  it("normalizes already kebab-case input as-is", () => {
    expect(normalizeTagName("user-preferences")).toBe("user-preferences");
  });

  it("normalizes snake_case input to kebab-case", () => {
    expect(normalizeTagName("user_preferences")).toBe("user-preferences");
  });

  it("normalizes camelCase input to kebab-case", () => {
    expect(normalizeTagName("userPreferences")).toBe("user-preferences");
  });

  it("collapses mixed snake/camel input", () => {
    expect(normalizeTagName("user_PreferenceList")).toBe("user-preference-list");
  });

  it("preserves single-word lowercase", () => {
    expect(normalizeTagName("documents")).toBe("documents");
  });
});

import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeSegment,
  encodeSegment,
  keyToRelativePath,
  relativePathToKey,
  tryEncodeSegment
} from "../../../src/stores/filesystem/resource-path";

describe("filesystem resource-path mapping", () => {
  it("round-trips simple and nested keys", () => {
    for (const key of [
      "overview",
      "concepts/flow-state-dev/overview",
      "50%_off",
      "files/src/utils.ts",
      "résumé",
      ".env",
      "files/*/notes"
    ]) {
      const rel = keyToRelativePath(key, ".md");
      expect(relativePathToKey(rel, ".md")).toBe(key);
    }
  });

  it("escapes dot segments for injectivity", () => {
    expect(keyToRelativePath("a", ".md")).toBe("a.md");
    expect(keyToRelativePath("a.md/b", ".md")).toBe(path.join("a%2Emd", "b.md"));
    expect(relativePathToKey("a.md", ".md")).toBe("a");
  });

  it("encodeSegment rejects empty and Windows device names on win32", () => {
    expect(() => encodeSegment("")).toThrow(/empty/);
    if (process.platform === "win32") {
      expect(() => encodeSegment("CON")).toThrow(/reserved/);
      expect(tryEncodeSegment("con")).toBeNull();
    }
  });

  it("decodeSegment inverts encodeSegment", () => {
    expect(decodeSegment(encodeSegment("a.b"))).toBe("a.b");
    expect(decodeSegment(encodeSegment(".."))).toBe("..");
  });
});
